import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiService } from '../../core/api';
import { EventListing } from '../../core/catalog';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

type TicketGroup = FormGroup<{
  id: FormControl<string>;
  name: FormControl<string>;
  price: FormControl<string>;
  quantity: FormControl<string>;
}>;

interface EventTicketType {
  readonly id: string;
  readonly name: string;
  readonly section: string;
  readonly price: number;
  readonly quantity: number;
  readonly status: 'On sale' | 'Few left' | 'Sold out';
}

type EventDetailDto = EventListing & {
  eventType: string; startDateTime: string; endDateTime: string;
  venueDetails: { id: number; name: string; address: string; city: string; country: string; postalCode: string; capacity: number };
  ticketTypes: readonly EventTicketType[];
};
type LoadStatus = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Edit an existing event and its ticket types, pre-filled from the event
 * service and saves all edits back to MySQL.
 */
@Component({
  selector: 'app-update-event',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="organiser">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Organiser</p>
          <h1>Update event</h1>
          <p class="lead">Edit event details and manage its tickets.</p>
        </div>
      </section>

      <section class="shell body">
        @switch (status()) {
          @case ('loading') {
            <p class="status-message" role="status">Loading event…</p>
          }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load this event.
              <button type="button" class="retry" (click)="loadEvent()">Try again</button>
            </p>
          }
          @case ('not-found') {
            <p class="not-found">
              That event could not be found. <a routerLink="/organiser">Back to your events</a>.
            </p>
          }
          @case ('ready') {
        @if (event(); as event) {
          <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <h2>Event details</h2>

            <div class="field">
              <label for="name">Event name</label>
              <input id="name" type="text" formControlName="name" />
            </div>

            <div class="row">
              <div class="field">
                <label for="eventType">Event type</label>
                <select id="eventType" formControlName="eventType"><option value="concert">Concert</option><option value="sports">Sports</option><option value="theater">Theatre</option><option value="conference">Conference</option><option value="festival">Festival</option><option value="other">Other</option></select>
              </div>
              <div class="field">
                <label for="venue">Venue name</label><input id="venue" type="text" formControlName="venue" />
              </div>
            </div>
            <div class="row"><div class="field"><label for="start">Starts</label><input id="start" type="datetime-local" formControlName="startDateTime" /></div><div class="field"><label for="end">Ends</label><input id="end" type="datetime-local" formControlName="endDateTime" /></div></div>
            <div class="field"><label for="address">Venue address</label><input id="address" type="text" formControlName="address" /></div>
            <div class="row"><div class="field"><label for="city">City</label><input id="city" type="text" formControlName="city" /></div><div class="field"><label for="country">Country</label><input id="country" type="text" formControlName="country" /></div></div>
            <div class="row"><div class="field"><label for="postalCode">Postal code</label><input id="postalCode" type="text" formControlName="postalCode" /></div><div class="field"><label for="capacity">Venue capacity</label><input id="capacity" type="number" min="1" formControlName="capacity" /></div></div>

            <div class="field">
              <label for="description">Description</label>
              <textarea id="description" formControlName="description" rows="3"></textarea>
            </div>
            <div class="field">
              <label for="image">Replace event image <span class="optional">(optional)</span></label>
              <input id="image" type="file" accept="image/jpeg,image/png,image/webp" (change)="chooseImage($event)" />
              <p class="note">JPEG, PNG or WebP, up to 4 MB. Leave empty to keep the current image.</p>
              @if (imagePreview()) { <img class="image-preview" [src]="imagePreview()" alt="Event image preview" /> }
            </div>

            <hr />

            <h2>Ticket types</h2>

            <div class="ticket-header">
              <span>Ticket name</span>
              <span>Price</span>
              <span>Quantity</span>
              <span class="visually-hidden">Remove</span>
            </div>

            <div formArrayName="tickets" class="ticket-rows">
              @for (ticket of tickets.controls; track $index) {
                <div class="ticket-row" [formGroupName]="$index">
                  <input type="text" formControlName="name" placeholder="General admission" />
                  <input type="text" formControlName="price" placeholder="S$45" />
                  <input type="text" formControlName="quantity" placeholder="200" />
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm remove"
                    (click)="removeTicket($index)"
                    [disabled]="tickets.length <= 1"
                  >
                    <span class="visually-hidden">Remove ticket type</span>
                    ✕
                  </button>
                </div>
              }
            </div>

            <button type="button" class="btn btn-ghost btn-sm" (click)="addTicket()">
              + Add ticket type
            </button>

            <hr />

            <div class="actions">
              <a class="link" [routerLink]="['/organiser/events', event.id, 'team']">Manage event team</a>
              <div class="buttons">
                <button type="button" class="btn btn-ghost" (click)="cancel()">Cancel</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : 'Save changes' }}
                </button>
              </div>
            </div>
          </form>

          @if (saveError()) { <p class="note form-error-banner" role="alert">{{ saveError() }}</p> }
        }
          }
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
      max-width: 44rem;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg);
      padding: clamp(1.25rem, 3vw, 2rem);
    }

    h2 {
      font-size: 1.125rem;
      margin: 0 0 1rem;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    textarea, select {
      font: inherit;
      font-size: 0.9375rem;
      padding: 0.6875rem 0.875rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      resize: vertical;
    }

    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 1.5rem 0;
    }

    .ticket-header {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 2rem;
      gap: 0.75rem;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .ticket-rows {
      display: grid;
      gap: 0.625rem;
      margin-bottom: 1rem;
    }

    .ticket-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 2rem;
      gap: 0.75rem;
      align-items: center;
    }

    .ticket-row input {
      font: inherit;
      font-size: 0.9375rem;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
    }

    .remove {
      padding: 0.375rem;
      border-radius: var(--radius-sm);
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .buttons {
      display: flex;
      gap: 0.75rem;
    }

    .link {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--brand-600);
      text-decoration: none;
    }

    .link:hover {
      text-decoration: underline;
    }

    .note {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .optional { color: var(--text-muted); font-weight: 400; }
    .image-preview { display: block; width: min(100%, 30rem); aspect-ratio: 2 / 1; object-fit: cover; border-radius: var(--radius-sm); margin-top: .75rem; }

    .not-found {
      color: var(--text-muted);
    }

    .not-found a {
      color: var(--brand-600);
    }

    @media (max-width: 560px) {
      .row,
      .ticket-header,
      .ticket-row {
        grid-template-columns: 1fr;
      }

      .ticket-header {
        display: none;
      }

      .actions {
        flex-direction: column;
        align-items: stretch;
      }
    }
  `,
})
export class UpdateEvent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  /** Bound from the `:id` route segment (see `withComponentInputBinding`). */
  readonly id = input('');

  protected readonly status = signal<LoadStatus>('loading');
  protected readonly event = signal<EventDetailDto | null>(null);
  protected readonly saveError = signal('');
  protected readonly saving = signal(false);
  protected readonly imagePreview = signal('');
  private image: { mimeType: string; data: string } | undefined;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    eventType: ['concert', Validators.required],
    venue: ['', Validators.required],
    startDateTime: ['', Validators.required], endDateTime: ['', Validators.required],
    address: [''], city: ['', Validators.required], country: ['', Validators.required],
    postalCode: [''], capacity: [1, [Validators.required, Validators.min(1)]],
    description: [''],
    tickets: this.fb.nonNullable.array<TicketGroup>([]),
  });

  constructor() {
    // The `:id` route param is bound as a signal input, which is not
    // guaranteed to hold its routed value until after construction — so the
    // fetch happens reactively once `id()` resolves, rather than here.
    effect(() => {
      const eventId = this.id();
      if (eventId) {
        this.loadEvent();
      }
    });
  }

  protected loadEvent(): void {
    this.status.set('loading');
    this.api.get<EventDetailDto>('event', `/events/${this.id()}`).subscribe({
      next: (event) => {
        this.event.set(event);
        this.status.set('ready');
        this.fillForm(event);
      },
      error: (err: HttpErrorResponse) => this.status.set(err.status === 404 ? 'not-found' : 'error'),
    });
  }

  private fillForm(event: EventDetailDto): void {
    const venue = event.venueDetails;
    this.imagePreview.set(event.image);
    this.form.patchValue({ name: event.title, description: event.description, eventType: event.eventType,
      venue: venue.name, address: venue.address, city: venue.city, country: venue.country,
      postalCode: venue.postalCode, capacity: venue.capacity,
      startDateTime: toLocalInput(event.startDateTime), endDateTime: toLocalInput(event.endDateTime) });

    const rows = event.ticketTypes.length
      ? event.ticketTypes.map((ticket) => ({ id: ticket.id, name: ticket.name, price: String(ticket.price), quantity: String(ticket.quantity) }))
      : [{ name: '', price: '', quantity: '' }];

    this.tickets.clear();
    for (const row of rows) {
      this.tickets.push(this.newTicket(row));
    }
  }

  protected get tickets() {
    return this.form.controls.tickets;
  }

  private newTicket(initial?: { id?: string; name: string; price: string; quantity: string }) {
    return this.fb.nonNullable.group({
      id: [initial?.id ?? ''],
      name: [initial?.name ?? '', Validators.required],
      price: [initial?.price ?? '', Validators.required],
      quantity: [initial?.quantity ?? '', Validators.required],
    });
  }

  protected addTicket(): void {
    this.tickets.push(this.newTicket());
  }

  protected removeTicket(index: number): void {
    if (this.tickets.length > 1) {
      this.tickets.removeAt(index);
    }
  }

  protected chooseImage(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.image = undefined; this.saveError.set('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      this.saveError.set('Choose a JPEG, PNG or WebP image no larger than 4 MB.');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      this.imagePreview.set(result);
      this.image = { mimeType: file.type, data: result.split(',', 2)[1] ?? '' };
    };
    reader.readAsDataURL(file);
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.saveError.set('');
    this.saving.set(true);
    const venueId = this.event()?.venueDetails.id;
    this.api.put('event', `/events/${this.id()}`, {
      name: value.name, description: value.description, eventType: value.eventType,
      startDateTime: value.startDateTime, endDateTime: value.endDateTime,
      venue: { id: venueId, name: value.venue, address: value.address, city: value.city, country: value.country,
        postalCode: value.postalCode, capacity: Number(value.capacity), venueType: 'indoor' },
      tickets: value.tickets.map((ticket) => ({ id: ticket.id, name: ticket.name, price: Number(ticket.price), quantity: Number(ticket.quantity) })),
      image: this.image,
    }).subscribe({
      next: () => void this.router.navigateByUrl('/organiser'),
      error: () => { this.saving.set(false); this.saveError.set('Could not save these changes. Try again.'); },
    });
  }

  protected async cancel(): Promise<void> {
    await this.router.navigateByUrl('/organiser');
  }
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
