import { DatePipe, LowerCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

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
interface ManagedEvent { readonly event_id: number; readonly title: string; readonly description: string | null; readonly venue: string | null; readonly starts_at: string; readonly total_seats: number; readonly tier: EventTier; readonly status: EventStatus; readonly price_cents: number | null; readonly remaining_qty?: number; }
interface EventApiRecord { readonly event_id: number; readonly title?: string; readonly event_name?: string; readonly description?: string | null; readonly venue?: string | null; readonly starts_at?: string; readonly event_start_datetime?: string; readonly total_seats: number; readonly tier?: EventTier; readonly event_type?: EventTier; readonly status: EventStatus; readonly price_cents?: number | null; readonly remaining_qty?: number; }
interface EventResponse { readonly events: readonly EventApiRecord[]; }
interface PublicEventDetailResponse { readonly event: EventApiRecord; }
interface CognitoUser { readonly username: string; readonly firstName: string; readonly lastName: string; readonly email: string; }
interface CognitoUserResponse { readonly users: readonly CognitoUser[]; }
interface Invitation { readonly membership_id: number; readonly event_id: number; readonly role: 'ORGANISER' | 'HELPER'; readonly title: string; readonly venue: string; readonly starts_at: string; }
interface InvitationResponse { readonly invitations: readonly Invitation[]; }

@Component({ selector: 'app-events', changeDetection: ChangeDetectionStrategy.OnPush, imports: [DatePipe, LowerCasePipe, RouterLink, ReactiveFormsModule, WorkspaceShell], templateUrl: './events.html', styleUrl: './events.css' })
export class Events {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly organiserMode = this.route.snapshot.data['workspace'] === 'organiser';
  protected readonly allEvents = signal<readonly ManagedEvent[]>([]);
  protected readonly visibleEvents = computed(() => {
    const events = this.allEvents();
    return this.includeCancelled() ? events : events.filter((event) => event.status !== 'CANCELLED');
  });
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly submitting = signal(false);
  protected readonly shellWorkspace = () => this.organiserMode ? 'organiser' as const : 'customer' as const;
  protected readonly editingEventId = signal<number | null>(null);
  protected readonly isAdmin = computed(() => this.organiserMode);
  protected readonly includeCancelled = signal(false);
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
  protected readonly eventForm = this.fb.group({
    title: this.fb.control('', Validators.required), description: this.fb.control(''),
    venue: this.fb.control('', Validators.required), startsAt: this.fb.control('', Validators.required),
    totalSeats: this.fb.control(1, [Validators.required, Validators.min(1), Validators.max(1_000_000)]),
    tier: this.fb.control<EventTier>('TIER1_GA', Validators.required),
  });

  constructor() {
    effect(() => {
      if (this.auth.status() === 'unknown') return;
      void this.loadEvents(this.isAdmin());
      if (this.organiserMode && this.auth.isAuthenticated()) void this.loadInvitations();
      else this.invitations.set([]);
    });
  }

  protected toggleEventForm(): void { this.resetForm(); this.showEventForm.update((open) => !open); }

  protected setTier(tier: EventTier): void { this.eventForm.controls.tier.setValue(tier); }

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
    if (this.eventForm.invalid || this.submitting()) { this.eventForm.markAllAsTouched(); return; }
    this.error.set(''); this.submitting.set(true);
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
  protected async cancelEvent(eventId: number): Promise<void> { await this.performAction(`/events/${eventId}/cancel`); }
  protected async deleteEvent(eventId: number): Promise<void> {
    if (!window.confirm('Delete this draft event? This cannot be undone.')) return;
    try { await firstValueFrom(this.api.delete('event', `/events/${eventId}`)); await this.loadEvents(this.isAdmin()); }
    catch (error) { this.error.set(describeEventError(error, 'delete the event')); }
  }
  protected openTeam(eventId: number): void {
    this.teamEventId.update((current) => current === eventId ? null : eventId);
    this.userSearch.set(''); this.userResults.set([]);
  }
  protected async searchUsers(value: string): Promise<void> {
    const search = value.trim(); this.userSearch.set(value);
    if (search.length < 2 || this.teamEventId() === null) { this.userResults.set([]); return; }
    try { const result = await firstValueFrom(this.api.get<CognitoUserResponse>('event', `/events/${this.teamEventId()}/users?search=${encodeURIComponent(search)}`)); this.userResults.set(result.users); }
    catch (error) { this.userResults.set([]); this.error.set(describeEventError(error, 'search users')); }
  }
  protected async invite(user: CognitoUser): Promise<void> {
    const eventId = this.teamEventId(); if (eventId === null) return;
    try {
      await firstValueFrom(this.api.post('event', `/events/${eventId}/invitations`, { username: user.username, role: this.inviteRole() }));
      this.userResults.set([]); this.userSearch.set('');
    } catch (error) { this.error.set(describeEventError(error, 'send that invitation')); }
  }
  protected async decideInvitation(invitation: Invitation, decision: 'accept' | 'reject'): Promise<void> {
    try { await firstValueFrom(this.api.post('event', `/team-invitations/${invitation.membership_id}/${decision}`, {})); await this.loadInvitations(); await this.loadEvents(this.isAdmin()); }
    catch (error) { this.error.set(describeEventError(error, 'update the invitation')); }
  }
  protected eventImageUrl(eventId: number): string {
    return this.api.url('event', `/events/${eventId}/image`);
  }

  protected eventDetailLink(eventId: number): readonly (string | number)[] {
    return this.organiserMode ? ['/organiser/events', eventId] : ['/events', eventId];
  }

  protected useFallbackImage(target: EventTarget | null): void {
    if (target instanceof HTMLImageElement) target.src = 'images/hero-concert.jpg';
  }

  protected statusFor(event: ManagedEvent): string { return event.status === 'PUBLISHED' ? 'On sale' : event.status === 'DRAFT' ? 'Draft' : 'Cancelled'; }
  protected tierFor(event: ManagedEvent): string { return event.tier === 'TIER1_GA' ? 'General admission' : 'Reserved seating'; }
  protected priceFor(event: ManagedEvent): string { return `$${((event.price_cents ?? 0) / 100).toFixed(2)}`; }

  private async performAction(path: string): Promise<void> {
    try { await firstValueFrom(this.api.post('event', path, {})); await this.loadEvents(this.isAdmin()); }
    catch (error) { this.error.set(describeEventError(error, 'update the event')); }
  }
  private async loadEvents(isOrganiser: boolean): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const result = await firstValueFrom(this.api.get<EventResponse>('event', isOrganiser ? '/events/manage' : '/events'));
      const events = result.events.map(toManagedEvent);
      this.allEvents.set(isOrganiser ? events : await Promise.all(events.map((event) => this.loadPublicEventDetails(event))));
    }
    catch { this.error.set('Events are unavailable right now.'); }
    finally { this.loading.set(false); }
  }
  private async loadPublicEventDetails(event: ManagedEvent): Promise<ManagedEvent> {
    try {
      const result = await firstValueFrom(this.api.get<PublicEventDetailResponse>('event', `/events/${event.event_id}`));
      return { ...event, ...toManagedEvent(result.event), remaining_qty: event.remaining_qty };
    } catch { return event; }
  }
  private async loadInvitations(): Promise<void> {
    try { const result = await firstValueFrom(this.api.get<InvitationResponse>('event', '/team-invitations')); this.invitations.set(result.invitations); }
    catch { this.invitations.set([]); }
  }
  private resetForm(): void {
    this.editingEventId.set(null);
    this.eventForm.reset({ title: '', description: '', venue: '', startsAt: '', totalSeats: 1, tier: 'TIER1_GA' });
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
    tier: event.tier ?? event.event_type ?? 'TIER1_GA',
    status: event.status,
    price_cents: event.price_cents ?? null,
    remaining_qty: event.remaining_qty,
  };
}

function describeEventError(error: unknown, action: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Please sign out and sign in again before managing events.';
    if (error.status === 403) return 'You are not an organiser for this event.';
    if (error.status >= 500) return 'The Event service cannot reach its database right now. Refresh the AWS MySQL host and try again.';
  }
  return `Unable to ${action}. Check your connection and try again.`;
}
