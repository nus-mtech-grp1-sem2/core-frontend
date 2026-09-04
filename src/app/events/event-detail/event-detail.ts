import { DatePipe, LowerCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { QueueService } from '../../core/queue';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

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
  readonly seat_id: number;
  readonly seat_label: string;
  readonly status: 'AVAILABLE' | 'HELD' | 'SOLD';
}

interface SeatResponse {
  readonly seats: readonly SeatOption[];
}

interface OrderResponse {
  readonly order: { readonly order_id: number };
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
  protected readonly error = signal('');
  protected readonly seats = signal<readonly SeatOption[]>([]);
  protected readonly quantity = signal(1);
  protected readonly selectedSeatIds = signal<readonly number[]>([]);
  protected readonly purchasing = signal(false);
  protected readonly purchaseError = signal('');
  protected readonly needsQueue = () => this.event()?.tier === 'TIER2_SEATED' && !this.queue.admissionToken();
  protected readonly isOrganiser = () => this.organiserMode && this.auth.hasRole('organiser');
  protected readonly shellWorkspace = () => this.organiserMode ? 'organiser' as const : 'customer' as const;
  protected readonly backLink = this.organiserMode ? '/organiser/events' : '/events';
  protected readonly isOwner = () => this.event()?.organiser_sub === this.auth.user()?.sub;
  protected readonly form = this.fb.group({
    title: this.fb.control('', Validators.required),
    description: this.fb.control(''),
    venue: this.fb.control('', Validators.required),
    startsAt: this.fb.control('', Validators.required),
    totalSeats: this.fb.control(1, [Validators.required, Validators.min(1), Validators.max(1_000_000)]),
    price: this.fb.control(0, [Validators.required, Validators.min(0)]),
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

  protected eventImageUrl(eventId: number): string {
    return this.api.url('event', `/events/${eventId}/image`);
  }

  protected useFallbackImage(target: EventTarget | null): void {
    if (target instanceof HTMLImageElement) target.src = 'images/hero-concert.jpg';
  }

  protected canBuy(): boolean {
    return !this.organiserMode && this.event()?.status === 'PUBLISHED';
  }

  protected toggleSeat(seat: SeatOption): void {
    if (seat.status !== 'AVAILABLE') return;
    this.selectedSeatIds.update((ids) => {
      if (ids.includes(seat.seat_id)) return ids.filter((id) => id !== seat.seat_id);
      if (ids.length >= this.quantity()) return ids;
      return [...ids, seat.seat_id];
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
        price: (result.event.price_cents ?? 0) / 100,
        tier: result.event.tier,
      });
      if (this.isOrganiser()) await this.loadMembers(eventId);
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
    } catch {
      this.members.set([]);
    }
  }

  private async loadSeats(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.get<SeatResponse>('event', `/events/${eventId}/seats`));
      this.seats.set(result.seats);
    } catch {
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
