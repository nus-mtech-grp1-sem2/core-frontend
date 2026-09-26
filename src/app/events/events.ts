import { LowerCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom, map, timer } from 'rxjs';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { isCompleted } from '../core/event-time';
import { hasSubmittedPayment } from '../core/payment-processing';
import { QueueService } from '../core/queue';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';
import { EventCard } from './components/event-card/event-card';
import { EventStatus, EventTier, ManagedEvent } from './event.models';
import { ReservationCard } from '../shared/components/reservation-card/reservation-card';

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

interface EventApiRecord {
  readonly event_id: number;
  readonly title?: string;
  readonly event_name?: string;
  readonly description?: string | null;
  readonly venue?: string | null;
  readonly starts_at?: string;
  readonly event_start_datetime?: string;
  readonly total_seats: number;
  readonly available_buyers?: number | null;
  readonly tier?: EventTier;
  readonly event_type?: EventTier;
  readonly status: EventStatus;
  readonly price_cents?: number | null;
  readonly remaining_qty?: number;
}
interface EventResponse {
  readonly events: readonly EventApiRecord[];
}
interface PublicEventDetailResponse {
  readonly event: EventApiRecord;
}
interface CognitoUser {
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
}
interface CognitoUserResponse {
  readonly users: readonly CognitoUser[];
}
interface Invitation {
  readonly membership_id: number;
  readonly event_id: number;
  readonly role: 'ORGANISER' | 'HELPER';
  readonly title: string;
  readonly venue: string;
  readonly starts_at: string;
}
interface InvitationResponse {
  readonly invitations: readonly Invitation[];
}
interface CustomerOrder {
  readonly order_id: number;
  readonly event_id: number;
  readonly status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  readonly created_at?: string;
  readonly reservation_expires_at?: string;
  readonly event_title: string;
  readonly ticket_count: number;
}
interface CustomerOrdersResponse {
  readonly orders: readonly CustomerOrder[];
}

@Component({
  selector: 'app-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EventCard, ReservationCard, LowerCasePipe, ReactiveFormsModule, WorkspaceShell],
  templateUrl: './events.html',
  styleUrl: './events.css',
})
export class Events {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly queue = inject(QueueService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly organiserMode = this.route.snapshot.data['workspace'] === 'organiser';
  protected readonly searchTerm = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('q')?.trim().toLowerCase() ?? '')),
    { initialValue: this.route.snapshot.queryParamMap.get('q')?.trim().toLowerCase() ?? '' },
  );
  protected readonly allEvents = signal<readonly ManagedEvent[]>([]);
  protected readonly visibleEvents = computed(() => {
    const query = this.searchTerm();
    let events = this.allEvents();
    if (!this.includeCancelled()) events = events.filter((event) => event.status !== 'CANCELLED');
    if (!this.includeCompleted()) {
      events = events.filter((event) => !isCompleted(event.starts_at));
    }
    if (!query) return events;
    return events.filter((event) =>
      [event.title, event.venue, event.description].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    );
  });
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly submitting = signal(false);
  protected readonly shellWorkspace = () =>
    this.organiserMode ? ('organiser' as const) : ('customer' as const);
  protected readonly editingEventId = signal<number | null>(null);
  protected readonly isAdmin = computed(() => this.organiserMode);
  protected readonly includeCancelled = signal(false);
  protected readonly includeCompleted = signal(false);
  protected readonly canViewEventDetails = this.auth.isAuthenticated;
  protected readonly showEventForm = signal(false);
  protected readonly teamEventId = signal<number | null>(null);
  protected readonly userSearch = signal('');
  protected readonly userResults = signal<readonly CognitoUser[]>([]);
  protected readonly inviteRole = signal<'ORGANISER' | 'HELPER'>('HELPER');
  protected readonly invitations = signal<readonly Invitation[]>([]);
  protected readonly imagePreviewUrl = signal<string | null>(null);
  private selectedImageBase64: string | null = null;
  private selectedImageMimeType: string | null = null;
  protected readonly savedVenues = computed(() => {
    const venues = new Set<string>();
    for (const event of this.allEvents()) { if (event.venue) venues.add(event.venue); }
    return Array.from(venues).sort((a, b) => a.localeCompare(b));
  });
  protected readonly customerOrders = signal<readonly CustomerOrder[]>([]);
  protected readonly now = signal(Date.now());
  protected readonly cancellingOrderIds = signal<ReadonlySet<number>>(new Set());
  protected readonly reservationError = signal('');
  protected readonly unpaidOrders = computed(() =>
    this.customerOrders().filter(
      (order) =>
        order.status === 'PENDING' && !hasSubmittedPayment(order.order_id, order.created_at),
    ),
  );
  protected readonly processingOrders = computed(() =>
    this.customerOrders().filter(
      (order) =>
        order.status === 'PENDING' && hasSubmittedPayment(order.order_id, order.created_at),
    ),
  );
  protected readonly eventForm = this.fb.group({
    title: this.fb.control('', Validators.required),
    description: this.fb.control(''),
    venue: this.fb.control('', Validators.required),
    startsAt: this.fb.control('', Validators.required),
    // No total seats or available buyers here: seats come from the zones drawn
    // in Configure inventory, and available buyers is set on the event page
    // once there are seats to cap it.
    tier: this.fb.control<EventTier>('TIER1_GA', Validators.required),
  });

  constructor() {
    effect(() => {
      if (this.auth.status() === 'unknown') return;
      void this.loadEvents(this.isAdmin());
      if (this.auth.isAuthenticated()) {
        void this.loadInvitations();
        if (!this.isAdmin()) void this.loadReservations();
      } else {
        this.invitations.set([]);
        this.customerOrders.set([]);
      }
    });
    timer(0, 1_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(Date.now());
        for (const order of this.unpaidOrders()) {
          if (this.reservationSeconds(order) === 0 && !this.isCancelling(order.order_id)) {
            void this.cancelReservation(order, true);
          }
        }
      });
  }

  protected reservationTimeLabel(order: CustomerOrder): string {
    const seconds = this.reservationSeconds(order);
    if (seconds === null) return 'soon';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected isCancelling(orderId: number): boolean {
    return this.cancellingOrderIds().has(orderId);
  }

  protected async cancelReservation(order: CustomerOrder, expired = false): Promise<void> {
    if (this.isCancelling(order.order_id)) return;
    if (hasSubmittedPayment(order.order_id, order.created_at)) {
      this.reservationError.set(
        'Payment has already been submitted, so this order can no longer be cancelled.',
      );
      return;
    }
    this.cancellingOrderIds.update((ids) => new Set(ids).add(order.order_id));
    this.reservationError.set('');
    try {
      await firstValueFrom(
        this.api.post<void>(
          'order',
          `/orders/${order.order_id}/cancel`,
          expired ? { reason: 'expired' } : {},
        ),
      );
      this.customerOrders.update((orders) =>
        orders.filter((item) => item.order_id !== order.order_id),
      );
      this.queue.clear(order.event_id);
    } catch {
      if (expired) await this.loadReservations();
      else this.reservationError.set('Unable to cancel this reservation. Please try again.');
    } finally {
      this.cancellingOrderIds.update((ids) => {
        const next = new Set(ids);
        next.delete(order.order_id);
        return next;
      });
    }
  }

  protected toggleEventForm(): void {
    this.resetForm();
    this.showEventForm.update((open) => !open);
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

  protected async saveEvent(): Promise<void> {
    if (this.eventForm.invalid || this.submitting()) {
      this.eventForm.markAllAsTouched();
      return;
    }
    this.error.set('');
    this.submitting.set(true);
    try {
      const eventId = this.editingEventId();
      const body = this.eventForm.getRawValue();
      let targetEventId = eventId;
      if (eventId === null) {
        const created = await firstValueFrom(this.api.post<{ eventId: number }>('event', '/events', body));
        targetEventId = created.eventId;
      } else {
        await firstValueFrom(this.api.put('event', `/events/${eventId}`, body));
      }
      if (targetEventId !== null && this.selectedImageBase64 && this.selectedImageMimeType) {
        await firstValueFrom(this.api.put('event', `/events/${targetEventId}/image`, {
          imageBase64: this.selectedImageBase64,
          mimeType: this.selectedImageMimeType,
        }));
      }
      this.resetForm(); this.showEventForm.set(false); await this.loadEvents(this.isAdmin());
    } catch (error) { this.error.set(describeEventError(error, 'save the event')); }
    finally { this.submitting.set(false); }
  }

  protected async publishEvent(eventId: number): Promise<void> {
    if (!window.confirm('Are you sure you want to publish this event?')) return;
    await this.performAction(`/events/${eventId}/publish`);
  }
  protected async cancelEvent(eventId: number): Promise<void> {
    await this.performAction(`/events/${eventId}/cancel`);
  }
  protected async deleteEvent(eventId: number): Promise<void> {
    if (!window.confirm('Delete this draft event? This cannot be undone.')) return;
    try {
      await firstValueFrom(this.api.delete('event', `/events/${eventId}`));
      await this.loadEvents(this.isAdmin());
    } catch (error) {
      this.error.set(describeEventError(error, 'delete the event'));
    }
  }
  protected openTeam(eventId: number): void {
    this.teamEventId.update((current) => (current === eventId ? null : eventId));
    this.userSearch.set('');
    this.userResults.set([]);
  }
  protected async searchUsers(value: string): Promise<void> {
    const search = value.trim();
    this.userSearch.set(value);
    if (search.length < 2 || this.teamEventId() === null) {
      this.userResults.set([]);
      return;
    }
    try {
      const result = await firstValueFrom(
        this.api.get<CognitoUserResponse>(
          'event',
          `/events/${this.teamEventId()}/users?search=${encodeURIComponent(search)}`,
        ),
      );
      this.userResults.set(result.users);
    } catch (error) {
      this.userResults.set([]);
      this.error.set(describeEventError(error, 'search users'));
    }
  }
  protected async invite(user: CognitoUser): Promise<void> {
    const eventId = this.teamEventId();
    if (eventId === null) return;
    try {
      await firstValueFrom(
        this.api.post('event', `/events/${eventId}/invitations`, {
          username: user.username,
          role: this.inviteRole(),
        }),
      );
      this.userResults.set([]);
      this.userSearch.set('');
    } catch (error) {
      this.error.set(describeEventError(error, 'send that invitation'));
    }
  }
  protected async decideInvitation(
    invitation: Invitation,
    decision: 'accept' | 'reject',
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.api.post('event', `/team-invitations/${invitation.membership_id}/${decision}`, {}),
      );
      await this.loadInvitations();
      await this.loadEvents(this.isAdmin());
    } catch (error) {
      this.error.set(describeEventError(error, 'update the invitation'));
    }
  }
  protected eventDetailLink(eventId: number): readonly (string | number)[] {
    return this.organiserMode ? ['/organiser/events', eventId] : ['/events', eventId];
  }

  /** Built from the `event` service's own image endpoint (not a static asset), so
   * `EventCard` falls back to the placeholder on 404 rather than going through
   * NgOptimizedImage, which only covers bundled static images per this repo's
   * Angular conventions. */
  protected eventImageUrl(eventId: number): string {
    return this.api.url('event', `/events/${eventId}/image`);
  }

  /** A completed event can still be opened, but nothing on it can be changed. */
  protected isEventCompleted(event: ManagedEvent): boolean {
    return isCompleted(event.starts_at);
  }

  private async performAction(path: string): Promise<void> {
    try {
      await firstValueFrom(this.api.post('event', path, {}));
      await this.loadEvents(this.isAdmin());
    } catch (error) {
      this.error.set(describeEventError(error, 'update the event'));
    }
  }
  private async loadEvents(isOrganiser: boolean): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(
        this.api.get<EventResponse>('event', isOrganiser ? '/events/manage' : '/events'),
      );
      const events = result.events.map(toManagedEvent);
      this.allEvents.set(
        isOrganiser
          ? events
          : await Promise.all(events.map((event) => this.loadPublicEventDetails(event))),
      );
    } catch {
      this.error.set('Events are unavailable right now.');
    } finally {
      this.loading.set(false);
    }
  }
  private async loadPublicEventDetails(event: ManagedEvent): Promise<ManagedEvent> {
    try {
      const result = await firstValueFrom(
        this.api.get<PublicEventDetailResponse>('event', `/events/${event.event_id}`),
      );
      return { ...event, ...toManagedEvent(result.event), remaining_qty: event.remaining_qty };
    } catch {
      return event;
    }
  }
  private async loadInvitations(): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<InvitationResponse>('event', '/team-invitations'),
      );
      this.invitations.set(result.invitations);
    } catch {
      this.invitations.set([]);
    }
  }
  private async loadReservations(): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.get<CustomerOrdersResponse>('order', '/customers/me/orders'),
      );
      this.customerOrders.set(result.orders.filter((order) => order.status === 'PENDING'));
    } catch {
      this.customerOrders.set([]);
    }
  }
  private reservationSeconds(order: CustomerOrder): number | null {
    const expiresAt = Date.parse(order.reservation_expires_at ?? '');
    if (!Number.isFinite(expiresAt)) return null;
    return Math.max(0, Math.ceil((expiresAt - this.now()) / 1_000));
  }
  private resetForm(): void {
    this.editingEventId.set(null);
    this.eventForm.reset({
      title: '',
      description: '',
      venue: '',
      startsAt: '',
      tier: 'TIER1_GA',
    });
    this.selectedImageBase64 = null;
    this.selectedImageMimeType = null;
    this.imagePreviewUrl.set(null);
  }
}

function toManagedEvent(event: EventApiRecord): ManagedEvent {
  return {
    event_id: event.event_id,
    title: event.title ?? event.event_name ?? '',
    description: event.description ?? null,
    venue: event.venue ?? null,
    starts_at: event.starts_at ?? event.event_start_datetime ?? '',
    total_seats: event.total_seats,
    available_buyers: event.available_buyers ?? null,
    tier: event.tier ?? event.event_type ?? 'TIER1_GA',
    status: event.status,
    price_cents: event.price_cents ?? null,
    remaining_qty: event.remaining_qty,
  };
}

export const INVENTORY_NOT_CONFIGURED =
  'Configure inventory before publishing: the event has no seats until you add at least one zone.';

function describeEventError(error: unknown, action: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Please sign out and sign in again before managing events.';
    if (error.status === 403) return 'You are not an organiser for this event.';
    const code = (error.error as { error?: string } | null)?.error;
    if (code === 'inventory_not_configured') return INVENTORY_NOT_CONFIGURED;
    if (code === 'only_draft_events_can_be_deleted') return 'Only draft events can be deleted. Cancel a published event instead.';
    if (code === 'event_has_reservation_history') return 'This event has reservation history, so it cannot be deleted. Cancel it instead.';
    if (error.status >= 500)
      return 'The Event service cannot reach its database right now. Refresh the AWS MySQL host and try again.';
  }
  return `Unable to ${action}. Check your connection and try again.`;
}
