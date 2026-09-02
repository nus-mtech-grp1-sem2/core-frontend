import { DatePipe, LowerCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';

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

@Component({
  selector: 'app-event-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LowerCasePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.css',
})
export class EventDetail {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);

  readonly id = input('');
  protected readonly event = signal<EventDetailData | null>(null);
  protected readonly members = signal<readonly TeamMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly inviting = signal(false);
  protected readonly error = signal('');
  protected readonly isOrganiser = () => this.auth.hasRole('organiser');
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
      await this.router.navigateByUrl('/events');
    } catch (error) {
      this.error.set(describeError(error, 'delete this event'));
    } finally {
      this.deleting.set(false);
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
}

function describeError(error: unknown, action: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Please sign in again before managing this event.';
    if (error.status === 403) return 'You do not have permission to manage this event.';
    if (error.status === 404) return 'This event was not found.';
  }
  return `Unable to ${action}. Please try again.`;
}
