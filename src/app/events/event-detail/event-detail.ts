import { DatePipe, LowerCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { QueueService } from '../../core/queue';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

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

interface EventDetailData {
  readonly event_id: number;
  readonly organiser_sub: string;
  readonly title: string;
  readonly description: string | null;
  readonly venue: string;
  readonly starts_at: string;
  readonly total_seats: number;
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
}

interface TeamResponse {
  readonly members: readonly TeamMember[];
}

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

function seatKey(row: number, col: number): string {
  return `${row},${col}`;
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
  private readonly auth = inject(AuthService);
  private readonly queue = inject(QueueService);
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
  protected readonly gridRowCount = signal(0);
  protected readonly gridColCount = signal(0);
  protected readonly gridRows = computed(() => Array.from({ length: this.gridRowCount() }, (_, i) => i));
  protected readonly gridCols = computed(() => Array.from({ length: this.gridColCount() }, (_, i) => i));
  protected readonly seatsByKey = computed(() => {
    const map = new Map<string, SeatOption>();
    for (const seat of this.seats()) map.set(seatKey(seat.gridRow, seat.gridCol), seat);
    return map;
  });
  protected readonly quantity = signal(1);
  protected readonly selectedSeatIds = signal<readonly number[]>([]);
  protected readonly purchasing = signal(false);
  protected readonly purchaseError = signal('');
  protected readonly needsQueue = () => this.event()?.tier === 'TIER2_SEATED' && !this.queue.admissionToken();
  /**
   * Organiser access is per-event, owned by the backend's event_team_memberships
   * table — not a global Cognito group. This reflects whether loading this
   * event's team roster succeeded, which the backend only allows for that
   * event's organisers.
   */
  protected readonly isOrganiser = signal(false);
  protected readonly inventorySummary = signal<InventorySummary | null>(null);
  protected readonly imagePreviewUrl = signal<string | null>(null);
  private selectedImageBase64: string | null = null;
  private selectedImageMimeType: string | null = null;
  protected readonly shellWorkspace = () => this.organiserMode ? 'organiser' as const : 'customer' as const;
  protected readonly backLink = this.organiserMode ? '/organiser/events' : '/events';
  protected readonly isOwner = () => this.event()?.organiser_sub === this.auth.user()?.sub;
  protected readonly form = this.fb.group({
    title: this.fb.control('', Validators.required),
    description: this.fb.control(''),
    venue: this.fb.control('', Validators.required),
    startsAt: this.fb.control('', Validators.required),
    totalSeats: this.fb.control(1, [Validators.required, Validators.min(1), Validators.max(1_000_000)]),
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
  }

  protected async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { this.error.set('Please choose a JPEG, PNG or WebP image.'); input.value = ''; return; }
    if (file.size > MAX_IMAGE_BYTES) { this.error.set('Image must be 5MB or smaller.'); input.value = ''; return; }
    const dataUrl = await readFileAsDataUrl(file);
    this.selectedImageMimeType = file.type;
    this.selectedImageBase64 = dataUrl;
    this.imagePreviewUrl.set(dataUrl);
  }

  protected async save(): Promise<void> {
    const event = this.event();
    if (!event || this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.put('event', `/events/${event.event_id}`, this.form.getRawValue()));
      if (this.selectedImageBase64 && this.selectedImageMimeType) {
        await firstValueFrom(this.api.put('event', `/events/${event.event_id}/image`, {
          imageBase64: this.selectedImageBase64,
          mimeType: this.selectedImageMimeType,
        }));
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
    if (!event || this.inviteForm.invalid || this.inviting()) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    this.inviting.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.post('event', `/events/${event.event_id}/invitations`, this.inviteForm.getRawValue()));
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
    if (!event || event.status !== 'DRAFT' || this.deleting() || !window.confirm('Delete this draft event? This cannot be undone.')) return;
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
    if (!event || this.updatingStatus()) return;
    const enabling = status === 'PUBLISHED';
    const action = enabling ? 'enable this event and put it back on sale' : 'cancel this event';
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;

    this.updatingStatus.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.post('event', `/events/${event.event_id}/${enabling ? 'publish' : 'cancel'}`, {}),
      );
      await this.load(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, enabling ? 'enable this event' : 'cancel this event'));
    } finally {
      this.updatingStatus.set(false);
    }
  }

  protected async remove(member: TeamMember): Promise<void> {
    const event = this.event();
    if (!event || !window.confirm(`Remove ${member.user_email} from this event?`)) return;
    this.error.set('');
    try {
      await firstValueFrom(this.api.delete('event', `/events/${event.event_id}/team-members/${encodeURIComponent(member.user_sub)}`));
      await this.loadMembers(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, 'remove this team member'));
    }
  }

  protected async changeRole(member: TeamMember, role: 'ORGANISER' | 'HELPER'): Promise<void> {
    const event = this.event();
    if (!event || role === member.role || this.changingRoleFor()) return;
    const action = role === 'ORGANISER' ? 'promote' : 'demote';
    if (!window.confirm(`${action === 'promote' ? 'Promote' : 'Demote'} ${member.user_email} to ${role === 'ORGANISER' ? 'Organizer' : 'Helper'}?`)) return;
    this.changingRoleFor.set(member.user_sub);
    this.error.set('');
    try {
      await firstValueFrom(this.api.patch('event', `/events/${event.event_id}/team-members/${encodeURIComponent(member.user_sub)}`, { role }));
      await this.loadMembers(event.event_id);
    } catch (error) {
      this.error.set(describeError(error, `${action} this team member`));
    } finally {
      this.changingRoleFor.set(null);
    }
  }

  protected canChangeRole(member: TeamMember): boolean {
    return this.isOwner() && member.user_sub !== this.auth.user()?.sub;
  }

  protected eventImageUrl(eventId: number): string {
    return this.api.url('event', `/events/${eventId}/image`);
  }

  protected useFallbackImage(target: EventTarget | null): void {
    if (target instanceof HTMLImageElement) target.src = 'images/hero-concert.jpg';
  }

  protected canBuy(): boolean {
    return !this.organiserMode && this.event()?.status === 'PUBLISHED';
  }

  protected seatAt(row: number, col: number): SeatOption | undefined {
    return this.seatsByKey().get(seatKey(row, col));
  }

  protected isSeatSelected(seat: SeatOption): boolean {
    return this.selectedSeatIds().includes(seat.seatId);
  }

  protected toggleSeat(seat: SeatOption): void {
    if (seat.status !== 'AVAILABLE') return;
    this.selectedSeatIds.update((ids) => {
      if (ids.includes(seat.seatId)) return ids.filter((id) => id !== seat.seatId);
      if (ids.length >= this.quantity()) return ids;
      return [...ids, seat.seatId];
    });
  }

  protected goToQueue(): void {
    void this.router.navigate(['/events', this.id(), 'queue']);
  }

  protected async buy(): Promise<void> {
    const event = this.event();
    if (!event || this.purchasing()) return;

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
          customerEmail: this.auth.user()?.email ?? '',
        }),
      );
      await firstValueFrom(
        this.api.post('order', `/orders/${created.order.order_id}/payment`, { paymentToken: 'simulated' }),
      );
      this.queue.clear();
      await this.router.navigateByUrl('/my-events');
    } catch (error) {
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

  private async load(eventId: number): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(this.api.get<EventDetailResponse>('event', `/events/${eventId}`));
      this.event.set(result.event);
      this.form.reset({
        title: result.event.title,
        description: result.event.description ?? '',
        venue: result.event.venue,
        startsAt: result.event.starts_at.replace(' ', 'T').slice(0, 16),
        totalSeats: result.event.total_seats,
        tier: result.event.tier,
      });
      if (this.organiserMode) {
        await this.loadMembers(eventId);
        await this.loadInventorySummary(eventId);
      }
      if (result.event.tier === 'TIER2_SEATED') await this.loadSeats(eventId);
    } catch (error) {
      this.event.set(null);
      this.error.set(describeError(error, 'load this event'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadMembers(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.get<TeamResponse>('event', `/events/${eventId}/team-members`));
      this.members.set(result.members);
      this.isOrganiser.set(true);
    } catch {
      this.members.set([]);
      this.isOrganiser.set(false);
    }
  }

  private async loadInventorySummary(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.get<InventoryResponse>('inventory', `/events/${eventId}/inventory`));
      this.inventorySummary.set({
        zoneCount: result.zones.length,
        totalSeats: result.seats.length,
        soldCount: result.zones.reduce((sum, zone) => sum + zone.soldCount, 0),
      });
    } catch {
      this.inventorySummary.set(null);
    }
  }

  protected inventorySummaryLabel(): string {
    const summary = this.inventorySummary();
    if (!summary) return 'Not configured yet';
    const label = `${summary.zoneCount} zone${summary.zoneCount === 1 ? '' : 's'} · ${summary.totalSeats} seats`;
    return summary.soldCount > 0 ? `${label}, ${summary.soldCount} sold` : label;
  }

  private async loadSeats(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.get<SeatResponse>('inventory', `/events/${eventId}/seats`));
      this.gridRowCount.set(result.gridRows || 0);
      this.gridColCount.set(result.gridCols || 0);
      this.seats.set(result.seats);
    } catch {
      this.gridRowCount.set(0);
      this.gridColCount.set(0);
      this.seats.set([]);
    }
  }
}

function describeError(error: unknown, action: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Please sign in again before managing this event.';
    if (error.status === 403) return 'You do not have permission to manage this event.';
    if (error.status === 404) return 'This event was not found.';
  }
  return `Unable to ${action}. Please try again.`;
}
