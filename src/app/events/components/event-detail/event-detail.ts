import { DatePipe, LowerCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, timer } from 'rxjs';

import { ApiService } from '../../../core/api';
import { cancelEventWithConfirmation } from '../../event-cancellation';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { AuthService } from '../../../core/auth';
import { isCompleted } from '../../../core/event-time';
import { QueueService, QueueStatus } from '../../../core/queue';
import { WorkspaceShell } from '../../../layout/components/workspace-shell/workspace-shell';

const EVENT_COMPLETED_MESSAGE =
  'This event has already taken place, so tickets are no longer on sale.';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type EventTier = 'TIER1_GA' | 'TIER2_SEATED';
type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
type QueueAccess =
  'checking' | 'not-joined' | 'waiting' | 'admitted' | 'expired' | 'checkout' | 'unavailable';

interface EventDetailData {
  readonly event_id: number;
  readonly organiser_sub: string;
  readonly title: string;
  readonly description: string | null;
  readonly venue: string;
  readonly starts_at: string;
  readonly total_seats: number;
  readonly available_buyers: number | null;
  readonly tier: EventTier;
  readonly status: EventStatus;
  readonly price_cents: number | null;
}

interface EventDetailResponse {
  readonly event: EventDetailData;
}

interface TeamMember {
  readonly membership_id: number;
  readonly user_sub: string;
  readonly user_email: string;
  readonly role: 'ORGANISER' | 'HELPER';
  readonly invite_status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  /** Cognito display name; blank if the lookup failed or is still loading. */
  readonly name?: string;
}

interface TeamResponse {
  readonly members: readonly TeamMember[];
}

/** Matches the `ticket` service's `/events/:eventId/checkin-stats` response shape. */
interface CheckinStatsResponse {
  readonly issued: number;
  readonly checkedIn: number;
}

/** A single bookable seat within the organiser's zone/grid layout (inventory domain). */
interface SeatOption {
  readonly seatId: number;
  readonly seatLabel: string;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly inventoryItemId: number;
  readonly sectionName: string;
  readonly priceCents: number;
  readonly color: string;
  readonly status: 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';
  readonly tag: 'NONE' | 'ACCESSIBLE' | 'MAINTENANCE';
}

interface SeatResponse {
  readonly gridRows: number;
  readonly gridCols: number;
  readonly seats: readonly SeatOption[];
}

interface OrderResponse {
  readonly order: { readonly order_id: number };
}

/** A GA event's ticket tiers, e.g. cheaper "General Admission" alongside a
 * pricier "VIP" zone — see `GET /events/:eventId/zones` in the inventory
 * service. */
interface ZoneOption {
  readonly inventoryItemId: number;
  readonly name: string;
  readonly priceCents: number;
  readonly color: string;
  readonly remaining: number;
}

interface ZonesResponse {
  readonly zones: readonly ZoneOption[];
}

interface ZoneSummary {
  readonly seatCount: number;
  readonly soldCount: number;
}

interface InventoryResponse {
  readonly zones: readonly ZoneSummary[];
  readonly seats: readonly unknown[];
}

interface InventorySummary {
  readonly zoneCount: number;
  readonly totalSeats: number;
  readonly soldCount: number;
}

const SEAT_STATUS_LABELS: Record<Exclude<SeatOption['status'], 'AVAILABLE'>, string> = {
  SOLD: 'sold',
  HELD: 'on hold',
  BLOCKED: 'unavailable',
};

function seatKey(row: number, col: number): string {
  return `${row},${col}`;
}

interface QueueManagementResponse {
  readonly queue: {
    readonly eventId: number;
    readonly admissionBatchSize: number;
    readonly status: 'CLOSED' | 'OPEN' | 'DRAINED';
    readonly waitingCount: number;
  };
}

interface OwnedTicketsResponse {
  readonly tickets: readonly {
    readonly event_id: number;
    readonly order_id: number;
    readonly status: string;
  }[];
}

interface OwnedOrdersResponse {
  readonly orders: readonly {
    readonly order_id: number;
    readonly event_id: number;
    readonly status: string;
  }[];
}

/** What the signed-in customer already holds for this event. */
interface Ownership {
  readonly tickets: number;
  readonly checkedIn: number;
  readonly pendingOrders: number;
}

interface AdmissionResponse {
  readonly admitted: number;
  readonly remaining: number | null;
  readonly reason?: 'sold_out' | 'capacity_reached';
}

@Component({
  selector: 'app-event-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LowerCasePipe, ReactiveFormsModule, RouterLink, WorkspaceShell],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.css',
})
export class EventDetail {
  private readonly api = inject(ApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);
  private readonly queue = inject(QueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly organiserMode = this.route.snapshot.data['workspace'] === 'organiser';

  readonly id = input('');
  protected readonly event = signal<EventDetailData | null>(null);
  protected readonly members = signal<readonly TeamMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly updatingStatus = signal(false);
  protected readonly inviting = signal(false);
  protected readonly changingRoleFor = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly seats = signal<readonly SeatOption[]>([]);
  protected readonly displaySeats = computed(() => seatsWithFallbackLayout(this.seats()));
  protected readonly gridRows = computed(() => occupiedGridAxis(this.displaySeats(), 'gridRow'));
  protected readonly gridCols = computed(() => occupiedGridAxis(this.displaySeats(), 'gridCol'));
  protected readonly seatsByKey = computed(() => {
    const map = new Map<string, SeatOption>();
    for (const seat of this.displaySeats()) map.set(seatKey(seat.gridRow, seat.gridCol), seat);
    return map;
  });
  protected readonly quantity = signal(1);
  protected readonly selectedSeatIds = signal<readonly number[]>([]);
  protected readonly zoneOptions = signal<readonly ZoneOption[]>([]);
  protected readonly selectedZoneId = signal<number | null>(null);
  /** A single-zone GA event needs no picker — the order service already
   * defaults to that zone. Only show a choice once there's actually a
   * choice to make, cheapest-tier-first like an airline fare table. */
  protected readonly sortedZoneOptions = computed(() =>
    [...this.zoneOptions()].sort((a, b) => a.priceCents - b.priceCents),
  );
  protected readonly hasZoneChoice = computed(() => this.zoneOptions().length > 1);
  protected readonly purchasing = signal(false);
  protected readonly purchaseError = signal('');
  protected readonly queueAccess = signal<QueueAccess>('checking');
  protected readonly queuePosition = signal<number | null>(null);
  protected readonly admissionExpiresAt = signal<number | null>(null);
  protected readonly admissionSecondsRemaining = signal<number | null>(null);
  protected readonly leavingQueue = signal(false);
  protected readonly queueManagement = signal<QueueManagementResponse['queue'] | null>(null);
  protected readonly queueActionBusy = signal(false);
  protected readonly queueActionMessage = signal('');
  protected readonly queueActionError = signal('');
  protected readonly ownership = signal<Ownership | null>(null);
  protected readonly buyingMore = signal(false);
  /**
   * Existing ticket holders see their tickets first, but anyone actively in the
   * queue for more (waiting, admitted or mid-checkout) goes straight to buying.
   */
  protected readonly showPurchaseFlow = computed(
    () =>
      !this.ownership() ||
      this.buyingMore() ||
      ['waiting', 'admitted', 'checkout'].includes(this.queueAccess()),
  );
  protected readonly admissionTimeLabel = computed(() => {
    const seconds = this.admissionSecondsRemaining();
    if (seconds === null) return '';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });
  protected readonly needsQueue = () =>
    this.event()?.tier === 'TIER2_SEATED' && this.queueAccess() !== 'admitted';
  /**
   * Organiser access is per-event, owned by the backend's event_team_memberships
   * table — not a global Cognito group. This reflects whether loading this
   * event's team roster succeeded, which the backend only allows for that
   * event's organisers.
   */
  protected readonly isOrganiser = signal(false);
  protected readonly inventorySummary = signal<InventorySummary | null>(null);
  protected readonly checkinStats = signal<CheckinStatsResponse | null>(null);
  protected readonly imagePreviewUrl = signal<string | null>(null);
  private selectedImageBase64: string | null = null;
  private selectedImageMimeType: string | null = null;
  protected readonly customerMode = !this.organiserMode;
  protected readonly shellWorkspace = () =>
    this.organiserMode ? ('organiser' as const) : ('customer' as const);
  protected readonly backLink = this.organiserMode ? '/organiser/events' : '/events';
  protected readonly buyerCapacity = buyerCapacity;
  protected readonly isOwner = () => this.event()?.organiser_sub === this.auth.user()?.sub;
  /** An event that has started is completed: its tickets can no longer be bought. */
  protected readonly completed = computed(() => {
    const event = this.event();
    return !!event && isCompleted(event.starts_at);
  });
  /** A completed event stays viewable to its organisers, but nothing on it can be changed. */
  protected readonly readOnly = computed(() => this.organiserMode && this.completed());
  /** Once an event is no longer a DRAFT (published, or cancelled), the event
   * service rejects any edit to its own details (see PUT /events/:eventId's
   * `event_not_editable` guard) — mirror that here. Deliberately narrower
   * than `readOnly()`: it only locks this event's own detail form and
   * inventory, not team management, the waiting room, or the status-change
   * actions that are how an organiser gets a published event back to DRAFT-like
   * flexibility in the first place. */
  protected readonly detailsLocked = computed(() => {
    const event = this.event();
    return !!event && event.status !== 'DRAFT';
  });
  protected readonly form = this.fb.group({
    title: this.fb.control('', Validators.required),
    description: this.fb.control(''),
    venue: this.fb.control('', Validators.required),
    startsAt: this.fb.control('', Validators.required),
    totalSeats: this.fb.control(1, [
      Validators.required,
      Validators.min(1),
      Validators.max(1_000_000),
    ]),
    availableBuyers: this.fb.control<number | null>(null, [
      Validators.min(1),
      Validators.max(1_000_000),
    ]),
    tier: this.fb.control<EventTier>('TIER1_GA', Validators.required),
  });
  protected readonly inviteForm = this.fb.group({
    email: this.fb.control('', [Validators.required, Validators.email]),
    role: this.fb.control<'ORGANISER' | 'HELPER'>('HELPER', Validators.required),
  });

  constructor() {
    effect(() => {
      const eventId = Number(this.id());
      if (Number.isSafeInteger(eventId) && eventId > 0) void this.load(eventId);
    });
    timer(0, 1_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateAdmissionCountdown());
  }

  protected async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      this.error.set('Please choose a JPEG, PNG or WebP image.');
      input.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.error.set('Image must be 5MB or smaller.');
      input.value = '';
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    this.selectedImageMimeType = file.type;
    this.selectedImageBase64 = dataUrl;
    this.imagePreviewUrl.set(dataUrl);
  }

  protected async save(): Promise<void> {
    const event = this.event();
    if (!event || this.readOnly() || this.detailsLocked() || this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.put('event', `/events/${event.event_id}`, this.form.getRawValue()),
      );
      if (this.selectedImageBase64 && this.selectedImageMimeType) {
        await firstValueFrom(
          this.api.put('event', `/events/${event.event_id}/image`, {
            imageBase64: this.selectedImageBase64,
            mimeType: this.selectedImageMimeType,
          }),
        );
        this.selectedImageBase64 = null;
        this.selectedImageMimeType = null;
        this.imagePreviewUrl.set(null);
      }
      await this.load(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, 'save changes'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async invite(): Promise<void> {
    const event = this.event();
    if (!event || this.readOnly() || this.inviteForm.invalid || this.inviting()) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    this.inviting.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.post(
          'event',
          `/events/${event.event_id}/invitations`,
          this.inviteForm.getRawValue(),
        ),
      );
      this.inviteForm.reset({ email: '', role: 'HELPER' });
      await this.loadMembers(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, 'send the invitation'));
    } finally {
      this.inviting.set(false);
    }
  }

  protected async deleteEvent(): Promise<void> {
    const event = this.event();
    if (
      !event ||
      this.readOnly() ||
      event.status !== 'DRAFT' ||
      this.deleting() ||
      !window.confirm('Delete this draft event? This cannot be undone.')
    )
      return;
    this.deleting.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.delete('event', `/events/${event.event_id}`));
      await this.router.navigateByUrl('/organiser/events');
    } catch (error) {
      this.error.set(describeError(error, 'delete this event'));
    } finally {
      this.deleting.set(false);
    }
  }

  protected async changeStatus(status: 'PUBLISHED' | 'CANCELLED'): Promise<void> {
    const event = this.event();
    if (!event || this.readOnly() || this.updatingStatus()) return;
    const enabling = status === 'PUBLISHED';
    if (
      enabling &&
      !(await this.confirmDialog.ask({
        title: 'Re-publish this event?',
        message: ['Are you sure you want to enable this event and put it back on sale?'],
        confirmLabel: 'Yes, re-publish',
        cancelLabel: 'No',
        tone: 'positive',
      }))
    )
      return;

    this.updatingStatus.set(true);
    this.error.set('');
    try {
      if (enabling) {
        await firstValueFrom(this.api.post('event', `/events/${event.event_id}/publish`, {}));
      } else if (!(await cancelEventWithConfirmation(this.api, event.event_id, (options) => this.confirmDialog.ask(options)))) {
        return;
      }
      await this.load(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, enabling ? 'enable this event' : 'cancel this event'));
    } finally {
      this.updatingStatus.set(false);
    }
  }

  protected async remove(member: TeamMember): Promise<void> {
    const event = this.event();
    if (
      !event ||
      this.readOnly() ||
      !window.confirm(`Remove ${member.user_email} from this event?`)
    )
      return;
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.delete(
          'event',
          `/events/${event.event_id}/team-members/${encodeURIComponent(member.user_sub)}`,
        ),
      );
      await this.loadMembers(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, 'remove this team member'));
    }
  }

  protected async changeRole(member: TeamMember, role: 'ORGANISER' | 'HELPER'): Promise<void> {
    const event = this.event();
    if (!event || this.readOnly() || role === member.role || this.changingRoleFor()) return;
    const action = role === 'ORGANISER' ? 'promote' : 'demote';
    if (
      !window.confirm(
        `${action === 'promote' ? 'Promote' : 'Demote'} ${member.user_email} to ${role === 'ORGANISER' ? 'Organizer' : 'Helper'}?`,
      )
    )
      return;
    this.changingRoleFor.set(member.user_sub);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.patch(
          'event',
          `/events/${event.event_id}/team-members/${encodeURIComponent(member.user_sub)}`,
          { role },
        ),
      );
      await this.loadMembers(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, `${action} this team member`));
    } finally {
      this.changingRoleFor.set(null);
    }
  }

  protected canChangeRole(member: TeamMember): boolean {
    return this.isOwner() && member.user_sub !== this.auth.user()?.sub && !this.readOnly();
  }

  /** Built from the `event` service's own image endpoint (not a static asset), so
   * this falls back to the placeholder on 404 rather than going through
   * NgOptimizedImage, which only covers bundled static images per this repo's
   * Angular conventions. */
  protected eventImageUrl(eventId: number): string {
    return this.api.url('event', `/events/${eventId}/image`);
  }

  protected useFallbackImage(target: EventTarget | null): void {
    if (target instanceof HTMLImageElement) target.src = 'images/hero-concert.jpg';
  }

  protected async openQueue(): Promise<void> {
    const event = this.event();
    if (!event || this.readOnly() || this.queueActionBusy()) return;
    this.queueActionBusy.set(true);
    this.queueActionMessage.set('');
    this.queueActionError.set('');
    try {
      await firstValueFrom(
        this.api.put('queue', `/events/${event.event_id}/queue/config`, {
          opensAt: new Date().toISOString(),
          admissionBatchSize:
            event.available_buyers ?? Math.max(1, Math.ceil(event.total_seats * 0.1)),
          admissionIntervalSec: 60,
        }),
      );
      await this.loadQueueManagement(event.event_id);
      this.queueActionMessage.set('The waiting room is open. Customers can join now.');
    } catch (error) {
      this.queueActionError.set(describeError(error, 'open the waiting room'));
    } finally {
      this.queueActionBusy.set(false);
    }
  }

  protected async admitNext(): Promise<void> {
    const event = this.event();
    if (!event || this.readOnly() || this.queueActionBusy()) return;
    this.queueActionBusy.set(true);
    this.queueActionMessage.set('');
    this.queueActionError.set('');
    try {
      const result = await firstValueFrom(
        this.api.post<AdmissionResponse>('queue', `/events/${event.event_id}/queue/admit-next`, {}),
      );
      await this.loadQueueManagement(event.event_id);
      this.queueActionMessage.set(
        result.admitted > 0
          ? `${result.admitted} customer${result.admitted === 1 ? '' : 's'} admitted.`
          : result.reason === 'capacity_reached'
            ? 'No admission slot is available yet.'
            : result.reason === 'sold_out'
              ? 'No customers admitted because the event is sold out.'
              : 'There are no waiting customers to admit.',
      );
    } catch (error) {
      this.queueActionError.set(describeError(error, 'admit the next customer'));
    } finally {
      this.queueActionBusy.set(false);
    }
  }

  protected canBuy(): boolean {
    return (
      this.customerMode &&
      this.event()?.status === 'PUBLISHED' &&
      !this.completed()
    );
  }

  protected seatAt(row: number, col: number): SeatOption | undefined {
    return this.seatsByKey().get(seatKey(row, col));
  }

  protected isSeatSelected(seat: SeatOption): boolean {
    return this.selectedSeatIds().includes(seat.seatId);
  }

  /** "Name — email", leaving out whichever part is missing so no dash dangles. */
  protected memberLabel(member: TeamMember): string {
    return [member.name, member.user_email].filter(Boolean).join(' — ') || 'Team member';
  }

  /** Accessible name; a seat that can't be chosen says why, since disabled alone doesn't. */
  protected seatName(seat: SeatOption): string {
    const name = `${seat.seatLabel} — ${seat.sectionName} — ${this.priceLabel(seat.priceCents)}`;
    return seat.status === 'AVAILABLE' ? name : `${name} — ${SEAT_STATUS_LABELS[seat.status]}`;
  }

  protected seatBackground(seat: SeatOption): string {
    return this.isSeatSelected(seat) ? 'var(--brand-600)' : seat.color;
  }

  protected toggleSeat(seat: SeatOption): void {
    if (seat.status !== 'AVAILABLE') return;
    this.selectedSeatIds.update((ids) => {
      if (ids.includes(seat.seatId)) return ids.filter((id) => id !== seat.seatId);
      if (ids.length >= this.quantity()) return [...ids.slice(1), seat.seatId];
      return [...ids, seat.seatId];
    });
  }

  protected selectZone(zone: ZoneOption): void {
    if (zone.remaining <= 0) return;
    this.selectedZoneId.set(zone.inventoryItemId);
  }

  protected goToQueue(): void {
    if (this.completed()) return;
    void this.router.navigate(['/events', this.id(), 'queue']);
  }

  protected async leaveQueue(): Promise<void> {
    const event = this.event();
    if (!event || this.leavingQueue() || !['waiting', 'admitted'].includes(this.queueAccess()))
      return;

    this.leavingQueue.set(true);
    this.purchaseError.set('');
    try {
      await this.queue.leave(event.event_id);
      this.clearAdmissionWindow();
      this.selectedSeatIds.set([]);
      this.queueAccess.set('not-joined');
    } catch {
      this.purchaseError.set('Unable to leave the waiting room. Please try again.');
    } finally {
      this.leavingQueue.set(false);
    }
  }

  protected async buy(): Promise<void> {
    const event = this.event();
    if (!event || this.purchasing()) return;

    if (this.completed()) {
      this.purchaseError.set(EVENT_COMPLETED_MESSAGE);
      return;
    }

    if (!this.auth.isAuthenticated()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    if (event.tier === 'TIER2_SEATED' && this.selectedSeatIds().length !== this.quantity()) {
      this.purchaseError.set(`Select ${this.quantity()} seat(s) to continue.`);
      return;
    }

    this.purchasing.set(true);
    this.purchaseError.set('');
    try {
      const created = await firstValueFrom(
        this.api.post<OrderResponse>('order', '/orders', {
          eventId: event.event_id,
          quantity: this.quantity(),
          seatIds: event.tier === 'TIER2_SEATED' ? this.selectedSeatIds() : undefined,
          admissionToken:
            event.tier === 'TIER2_SEATED'
              ? this.queue.admissionTokenFor(event.event_id)
              : undefined,
          inventoryItemId:
            event.tier === 'TIER1_GA' ? (this.selectedZoneId() ?? undefined) : undefined,
          customerEmail: this.auth.user()?.email ?? '',
          customerName: this.auth.user()?.name ?? '',
        }),
      );
      await this.router.navigate(['/checkout', created.order.order_id]);
    } catch (error) {
      if (queueAdmissionRequired(error)) {
        this.queue.clear(event.event_id);
        this.clearAdmissionWindow();
        this.queueAccess.set('not-joined');
      }
      this.purchaseError.set(describeError(error, 'complete your purchase'));
    } finally {
      this.purchasing.set(false);
    }
  }

  protected canRemove(member: TeamMember): boolean {
    if (member.user_sub === this.auth.user()?.sub) return false;
    return member.role === 'HELPER' || this.isOwner();
  }

  protected statusLabel(status: EventStatus): string {
    return status === 'PUBLISHED' ? 'On sale' : status === 'DRAFT' ? 'Draft' : 'Cancelled';
  }

  protected priceLabel(priceCents: number | null): string {
    return `$${((priceCents ?? 0) / 100).toFixed(2)}`;
  }

  protected inventorySummaryLabel(): string {
    const summary = this.inventorySummary();
    if (!summary) return 'Not configured yet';
    const label = `${summary.zoneCount} zone${summary.zoneCount === 1 ? '' : 's'} · ${summary.totalSeats} seats`;
    return summary.soldCount > 0 ? `${label}, ${summary.soldCount} sold` : label;
  }

  protected checkinStatsLabel(): string {
    const stats = this.checkinStats();
    if (!stats) return 'Not available yet';
    return `${stats.checkedIn} of ${stats.issued} checked in`;
  }

  private async load(eventId: number): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.clearAdmissionWindow();
    try {
      const result = await firstValueFrom(
        this.api.get<EventDetailResponse>('event', `/events/${eventId}`),
      );
      this.event.set(result.event);
      this.form.reset({
        title: result.event.title,
        description: result.event.description ?? '',
        venue: result.event.venue,
        startsAt: result.event.starts_at.replace(' ', 'T').slice(0, 16),
        totalSeats: result.event.total_seats,
        availableBuyers: result.event.available_buyers,
        tier: result.event.tier,
      });
      if (this.readOnly() || this.detailsLocked()) {
        this.form.disable();
      } else {
        this.form.enable();
        // Seats come from the zones in Configure inventory, whatever the status.
        this.form.controls.totalSeats.disable();
      }
      if (this.readOnly()) {
        this.inviteForm.disable();
      } else {
        this.inviteForm.enable();
      }
      if (this.organiserMode) {
        await this.loadMembers(eventId);
        await this.loadInventorySummary(eventId);
        await this.loadCheckinStats(eventId);
      }
      if (this.wantsSeatMap(result.event)) await this.loadSeats(eventId);
      if (this.organiserMode && result.event.tier === 'TIER2_SEATED') {
        await this.loadQueueManagement(eventId);
      }
      await this.loadCustomerPurchaseState(result.event);
    } catch (error) {
      this.event.set(null);
      this.error.set(describeError(error, 'load this event'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Organisers manage the seat map; customers only need it while the event can still be bought. */
  private wantsSeatMap(event: EventDetailData): boolean {
    if (event.tier !== 'TIER2_SEATED') return false;
    return this.organiserMode || this.canBuy();
  }

  /** What a customer already holds, and their waiting-room place. A completed event needs no queue place. */
  private async loadCustomerPurchaseState(event: EventDetailData): Promise<void> {
    if (!this.customerMode) return;
    if (this.auth.isAuthenticated()) await this.loadOwnership(event.event_id);
    if (event.tier === 'TIER1_GA' && !this.completed()) await this.loadZones(event.event_id);
    if (event.tier !== 'TIER2_SEATED' || this.completed()) return;
    if (this.auth.isAuthenticated()) await this.loadQueueAccess(event.event_id);
    else this.queueAccess.set('not-joined');
  }

  private async loadMembers(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<TeamResponse>('event', `/events/${eventId}/team-members`),
      );
      this.members.set(result.members);
      this.isOrganiser.set(true);
    } catch {
      this.members.set([]);
      this.isOrganiser.set(false);
    }
  }

  private async loadInventorySummary(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<InventoryResponse>('inventory', `/events/${eventId}/inventory`),
      );
      this.inventorySummary.set({
        zoneCount: result.zones.length,
        // TIER1_GA zones have no per-seat rows, so `seats.length` is always 0 for
        // them — total seats must come from each zone's own seatCount instead.
        totalSeats: result.zones.reduce((sum, zone) => sum + Number(zone.seatCount), 0),
        // `sold_count` is a MySQL SUM()/COALESCE() aggregate, which mysql2 returns
        // as a string — without Number(), `sum + zone.soldCount` silently degrades
        // into string concatenation (e.g. "0" + "2" + "0" -> "020" instead of 2).
        soldCount: result.zones.reduce((sum, zone) => sum + Number(zone.soldCount), 0),
      });
    } catch {
      this.inventorySummary.set(null);
    }
  }

  /**
   * Check-in progress on event day (OR-09) — lets the organiser see this
   * without asking door staff. Not every organiser account is granted
   * this route (it's the same event-team-membership check as the roster),
   * so a failed load just hides the section rather than showing an error.
   */
  private async loadCheckinStats(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<CheckinStatsResponse>('ticket', `/events/${eventId}/checkin-stats`),
      );
      this.checkinStats.set(result);
    } catch {
      this.checkinStats.set(null);
    }
  }

  /** Ticket tiers for a GA event. Auto-selects the cheapest one that still
   * has capacity, so checkout never blocks a customer just because a
   * cheaper tier sold out — they can still see and pick a pricier one. */
  private async loadZones(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<ZonesResponse>('inventory', `/events/${eventId}/zones`),
      );
      this.zoneOptions.set(result.zones);
      const cheapestAvailable = [...result.zones]
        .sort((a, b) => a.priceCents - b.priceCents)
        .find((zone) => zone.remaining > 0);
      this.selectedZoneId.set(cheapestAvailable?.inventoryItemId ?? null);
    } catch {
      this.zoneOptions.set([]);
      this.selectedZoneId.set(null);
    }
  }

  private async loadSeats(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<SeatResponse>('inventory', `/events/${eventId}/seats`),
      );
      this.seats.set(result.seats);
    } catch {
      this.seats.set([]);
    }
  }

  /**
   * A customer who already bought (or checked in) should see their tickets, not
   * a fresh waiting-room prompt. Paid orders still awaiting ticket issuance count
   * too. Failures leave the normal purchase flow in place.
   */
  private async loadOwnership(eventId: number): Promise<void> {
    this.ownership.set(null);
    this.buyingMore.set(false);
    const [tickets, orders] = await Promise.all([
      firstValueFrom(this.api.get<OwnedTicketsResponse>('ticket', '/customers/me/tickets')).catch(
        () => ({ tickets: [] }) as OwnedTicketsResponse,
      ),
      firstValueFrom(this.api.get<OwnedOrdersResponse>('order', '/customers/me/orders')).catch(
        () => ({ orders: [] }) as OwnedOrdersResponse,
      ),
    ]);
    const held = tickets.tickets.filter(
      (ticket) => Number(ticket.event_id) === eventId && ticket.status !== 'VOID',
    );
    const issuedOrderIds = new Set(held.map((ticket) => Number(ticket.order_id)));
    const pendingOrders = orders.orders.filter(
      (order) =>
        Number(order.event_id) === eventId &&
        order.status === 'PAID' &&
        !issuedOrderIds.has(Number(order.order_id)),
    ).length;
    if (!held.length && !pendingOrders) return;
    this.ownership.set({
      tickets: held.length,
      checkedIn: held.filter((ticket) => ticket.status === 'CHECKED_IN').length,
      pendingOrders,
    });
  }

  private async loadQueueManagement(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<QueueManagementResponse>('queue', `/events/${eventId}/queue`),
      );
      this.queueManagement.set(result.queue);
    } catch {
      this.queueManagement.set(null);
    }
  }

  private async loadQueueAccess(eventId: number): Promise<void> {
    this.queueAccess.set('checking');
    try {
      this.applyQueueStatus(await this.queue.status(eventId));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.queueAccess.set('not-joined');
      } else {
        this.queueAccess.set('unavailable');
      }
    }
  }

  private applyQueueStatus(status: QueueStatus): void {
    this.queuePosition.set(status.position ?? null);
    switch (status.status) {
      case 'WAITING':
        this.clearAdmissionWindow();
        this.queueAccess.set('waiting');
        break;
      case 'ADMITTED': {
        const expiresAt = status.tokenExpiresAt ? Date.parse(status.tokenExpiresAt) : Number.NaN;
        if (status.admissionToken && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
          this.admissionExpiresAt.set(expiresAt);
          this.queueAccess.set('admitted');
          this.updateAdmissionCountdown();
        } else {
          const eventId = this.event()?.event_id;
          if (eventId) this.queue.clear(eventId);
          this.clearAdmissionWindow();
          this.queueAccess.set('expired');
        }
        break;
      }
      case 'IN_CHECKOUT':
        this.clearAdmissionWindow();
        this.queueAccess.set('checkout');
        break;
      case 'EXPIRED':
      case 'LEFT':
        this.clearAdmissionWindow();
        this.queueAccess.set('expired');
        break;
    }
  }

  private clearAdmissionWindow(): void {
    this.admissionExpiresAt.set(null);
    this.admissionSecondsRemaining.set(null);
  }

  private updateAdmissionCountdown(): void {
    const expiresAt = this.admissionExpiresAt();
    if (this.queueAccess() !== 'admitted' || expiresAt === null) {
      this.admissionSecondsRemaining.set(null);
      return;
    }

    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000));
    this.admissionSecondsRemaining.set(remaining);
    if (remaining === 0) {
      const eventId = this.event()?.event_id;
      if (eventId) this.queue.clear(eventId);
      this.admissionExpiresAt.set(null);
      this.queueAccess.set('expired');
    }
  }
}

function occupiedGridAxis(
  seats: readonly SeatOption[],
  coordinate: 'gridRow' | 'gridCol',
): readonly number[] {
  return [...new Set(seats.map((seat) => seat[coordinate]))].sort((a, b) => a - b);
}

/**
 * A seated event created before its inventory is saved has purchasable seat
 * rows with null coordinates. Only that case receives a compact fallback;
 * configured events retain the organiser's exact placement.
 */
export function seatsWithFallbackLayout(seats: readonly SeatOption[]): readonly SeatOption[] {
  const configured = seats.every(
    (seat) =>
      Number.isInteger(seat.gridRow) &&
      seat.gridRow >= 0 &&
      Number.isInteger(seat.gridCol) &&
      seat.gridCol >= 0,
  );
  if (configured || seats.length === 0) return seats;

  const columns = defaultSeatGridColumns(seats.length);
  const orderedSeats = [...seats].sort(
    (left, right) =>
      left.seatLabel.localeCompare(right.seatLabel, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) || left.seatId - right.seatId,
  );
  return orderedSeats.map((seat, index) => ({
    ...seat,
    color: seat.color || '#059669',
    gridRow: Math.floor(index / columns),
    gridCol: index % columns,
  }));
}

/** Picks a compact landscape grid, preferring a fully filled rectangle. */
export function defaultSeatGridColumns(seatCount: number): number {
  const count = Math.max(0, Math.floor(seatCount));
  if (count === 0) return 0;

  const firstCandidate = Math.ceil(Math.sqrt(count));
  const lastCandidate = Math.max(firstCandidate, Math.ceil(Math.sqrt(count * 2)));
  let bestColumns = firstCandidate;
  let bestEmptyCells = Number.POSITIVE_INFINITY;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let columns = firstCandidate; columns <= lastCandidate; columns += 1) {
    const rows = Math.ceil(count / columns);
    const emptyCells = rows * columns - count;
    const score = emptyCells + Math.abs(columns - rows);
    if (score < bestScore || (score === bestScore && emptyCells < bestEmptyCells)) {
      bestColumns = columns;
      bestEmptyCells = emptyCells;
      bestScore = score;
    }
  }
  return bestColumns;
}

export function buyerCapacity(totalSeats: number, configuredBuyers: number | null): number {
  const seats = Math.max(0, Math.floor(totalSeats));
  if (configuredBuyers !== null && Number.isSafeInteger(configuredBuyers) && configuredBuyers > 0) {
    return Math.min(configuredBuyers, seats);
  }
  return seats === 0 ? 0 : Math.max(1, Math.ceil(seats * 0.1));
}

function queueAdmissionRequired(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.error as { error?: string } | null)?.error === 'queue_admission_required'
  );
}

const EVENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  queue_admission_required: 'Your waiting-room admission has expired. Rejoin the queue to continue.',
  event_not_editable: 'This event has already been published — its details can no longer be edited.',
  only_draft_events_can_be_deleted: 'Only draft events can be deleted. Cancel a published event instead.',
  event_has_reservation_history:
    'This event has reservation history, so it cannot be deleted. Cancel it instead.',
  inventory_not_configured:
    'Configure inventory before publishing: the event has no seats until you add at least one zone.',
  available_buyers_above_total_seats: 'Available buyers cannot be more than the total seats.',
  invited_user_not_found:
    'No OneStage account uses that email. Ask them to sign up first, then invite them again.',
  already_invited_or_member:
    "That person is already on this event's team or has a pending invitation.",
  invited_user_missing_identity:
    "That account isn't fully set up, so it can't be invited yet. Ask them to finish signing up, then invite them again.",
  team_member_not_found:
    "That person is no longer on this event's team. Refresh the page to see the current team.",
  event_owner_required: "Only the event's owner can do that.",
  cannot_change_owner_role: "The event owner's role can't be changed.",
};

function describeError(error: unknown, action: string): string {
  if (error instanceof HttpErrorResponse) {
    if (action === 'complete your purchase') {
      const purchaseMessage = purchaseErrorMessage(error);
      if (purchaseMessage) return purchaseMessage;
    }
    const code = (error.error as { error?: string } | null)?.error;
    if (code && Object.hasOwn(EVENT_ERROR_MESSAGES, code)) return EVENT_ERROR_MESSAGES[code];
    if (error.status === 401) return 'Please sign in again before managing this event.';
    if (error.status === 403) return 'You do not have permission to manage this event.';
    if (error.status === 404) {
      return action === 'complete your purchase'
        ? 'Ticket purchasing is unavailable right now. Please try again later.'
        : 'This event was not found.';
    }
  }
  return `Unable to ${action}. Please try again.`;
}

export function purchaseErrorMessage(error: HttpErrorResponse): string | null {
  const code = (error.error as { error?: string } | null)?.error;
  if (code === 'inventory_unavailable') {
    return 'Tickets are currently unavailable or sold out. Refresh the event before trying again.';
  }
  if (code === 'hold_not_active') {
    return 'Your ticket hold has expired. Select your tickets again.';
  }
  if (code === 'hold_has_no_inventory') {
    return 'Ticket inventory has not been configured for this event.';
  }
  if (code === 'event_not_on_sale') return 'This event is no longer on sale.';
  if (code === 'event_completed') return EVENT_COMPLETED_MESSAGE;
  if (code === 'order_not_payable') return 'This order can no longer be paid.';
  return null;
}
