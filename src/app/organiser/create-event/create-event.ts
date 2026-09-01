import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

/**
 * Create a new event and its ticket types.
 * Persists event, venue and ticket details through the event service.
 */
@Component({
  selector: 'app-create-event',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="organiser">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Organiser</p>
          <h1>Create event</h1>
          <p class="lead">Add a new event and configure its tickets.</p>
        </div>
      </section>

      <section class="shell body">
        <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <h2>Event details</h2>

          <div class="field">
            <label for="name">Event name</label>
            <input id="name" type="text" formControlName="name" placeholder="Neon Skyline Tour" />
          </div>

          <div class="row">
            <div class="field">
              <label for="eventType">Event type</label>
              <select id="eventType" formControlName="eventType">
                <option value="concert">Concert</option><option value="sports">Sports</option>
                <option value="theater">Theatre</option><option value="conference">Conference</option>
                <option value="festival">Festival</option><option value="other">Other</option>
              </select>
            </div>
            <div class="field">
              <label for="venue">Venue name</label>
              <input id="venue" type="text" formControlName="venue" placeholder="Marina Bay Arena" />
            </div>
          </div>

          <div class="row">
            <div class="field"><label for="start">Starts</label><input id="start" type="datetime-local" formControlName="startDateTime" /></div>
            <div class="field"><label for="end">Ends</label><input id="end" type="datetime-local" formControlName="endDateTime" /></div>
          </div>
          <div class="field"><label for="address">Venue address</label><input id="address" type="text" formControlName="address" /></div>
          <div class="row">
            <div class="field"><label for="city">City</label><input id="city" type="text" formControlName="city" /></div>
            <div class="field"><label for="country">Country</label><input id="country" type="text" formControlName="country" /></div>
          </div>
          <div class="row">
            <div class="field"><label for="postalCode">Postal code</label><input id="postalCode" type="text" formControlName="postalCode" /></div>
            <div class="field"><label for="capacity">Venue capacity</label><input id="capacity" type="number" min="1" formControlName="capacity" /></div>
          </div>

          <div class="field">
            <label for="description">Description</label>
            <textarea
              id="description"
              formControlName="description"
              rows="3"
              placeholder="Tell attendees what to expect at this event…"
            ></textarea>
          </div>

          <div class="field">
            <label for="image">Event image <span class="optional">(optional)</span></label>
            <input id="image" type="file" accept="image/jpeg,image/png,image/webp" (change)="chooseImage($event)" />
            <p class="note">JPEG, PNG or WebP, up to 4 MB. Category artwork is used if omitted.</p>
            @if (imagePreview()) { <img class="image-preview" [src]="imagePreview()" alt="Selected event image preview" /> }
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
            <button type="button" class="btn btn-ghost" (click)="cancel()">Save as draft</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Publishing…' : 'Publish event' }}</button>
          </div>
        </form>

        @if (error()) { <p class="note form-error-banner" role="alert">{{ error() }}</p> }
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
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .note {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .optional { color: var(--text-muted); font-weight: 400; }
    .image-preview { display: block; width: min(100%, 30rem); aspect-ratio: 2 / 1; object-fit: cover; border-radius: var(--radius-sm); margin-top: .75rem; }

    @media (max-width: 560px) {
      .row,
      .ticket-header,
      .ticket-row {
        grid-template-columns: 1fr;
      }

      .ticket-header {
        display: none;
      }
    }
  `,
})
export class CreateEvent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly imagePreview = signal('');
  private image: { mimeType: string; data: string } | undefined;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    eventType: ['concert', Validators.required],
    venue: ['', Validators.required],
    startDateTime: ['', Validators.required],
    endDateTime: ['', Validators.required],
    address: [''], city: ['', Validators.required], country: ['Singapore', Validators.required],
    postalCode: [''], capacity: [1, [Validators.required, Validators.min(1)]],
    description: [''],
    tickets: this.fb.nonNullable.array([this.newTicket(), this.newTicket()]),
  });

  protected get tickets() {
    return this.form.controls.tickets;
  }

  private newTicket() {
    return this.fb.nonNullable.group({
      name: ['', Validators.required],
      price: ['', Validators.required],
      quantity: ['', Validators.required],
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
    this.image = undefined; this.imagePreview.set(''); this.error.set('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      this.error.set('Choose a JPEG, PNG or WebP image no larger than 4 MB.');
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
    this.saving.set(true);
    this.error.set('');
    this.api.post('event', '/events', {
      organizerEmail: this.auth.user()?.email,
      name: value.name, description: value.description, eventType: value.eventType,
      startDateTime: value.startDateTime, endDateTime: value.endDateTime,
      venue: { name: value.venue, address: value.address, city: value.city, country: value.country,
        postalCode: value.postalCode, capacity: Number(value.capacity), venueType: 'indoor' },
      tickets: value.tickets.map((ticket) => ({ name: ticket.name, price: Number(ticket.price), quantity: Number(ticket.quantity) })),
      image: this.image,
    }).subscribe({
      next: () => void this.router.navigateByUrl('/organiser'),
      error: () => { this.saving.set(false); this.error.set('Could not publish this event. Check the details and try again.'); },
    });
  }

  protected async cancel(): Promise<void> {
    await this.router.navigateByUrl('/organiser');
  }
}
