import { ChangeDetectionStrategy, Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../core/auth';
import { ApiService } from '../core/api';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

type ScanOutcome = 'SUCCESS' | 'DUPLICATE' | 'INVALID' | 'WRONG_EVENT';

interface ScanResult {
  readonly code: string;
  readonly outcome: ScanOutcome;
  readonly at: string;
}

interface EventOption {
  readonly event_id: number;
  readonly title: string;
}

interface EventsResponse {
  readonly events: readonly EventOption[];
}

interface CheckinStats {
  readonly checkedIn: number;
  readonly total: number;
}

interface SearchResult {
  readonly ticket_id: number;
  readonly customer_email: string;
  readonly seat_label: string | null;
  readonly status: string;
}

interface SearchResponse {
  readonly tickets: readonly SearchResult[];
}

/**
 * Door workspace for event helpers: pick the event on the door, then scan or
 * search for a ticket. Validation and duplicate detection are the ticket
 * service's job — this page just calls it and shows the verdict.
 */
@Component({
  selector: 'app-checkin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="event-helper">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Event helper</p>
          <h1>Door check-in</h1>
          <p class="lead">Signed in as {{ auth.user()?.email }}.</p>
        </div>
      </section>

      <section class="shell body">
        <div class="field">
          <label for="event">Event</label>
          <select id="event" [value]="eventId()" (change)="selectEvent(+$any($event.target).value)">
            @for (event of events(); track event.event_id) {
              <option [value]="event.event_id">{{ event.title }}</option>
            }
          </select>
          @if (stats(); as stats) {
            <p class="stats">{{ stats.checkedIn }} of {{ stats.total }} checked in</p>
          }
        </div>

        <section class="camera" aria-labelledby="camera-heading">
          <div class="camera-head">
            <div>
              <h2 id="camera-heading">Scan with camera</h2>
              <p>Point the camera at the ticket QR code.</p>
            </div>
            <div class="camera-actions">
              <label class="btn btn-ghost upload" [class.disabled]="eventId() === null || decodingImage()">
                {{ decodingImage() ? 'Reading…' : 'Upload QR image' }}
                <input type="file" accept="image/*" capture="environment" [disabled]="eventId() === null || decodingImage()" (change)="scanImage($event)" />
              </label>
              @if (cameraActive()) {
                <button class="btn btn-ghost" type="button" (click)="stopCamera()">Stop camera</button>
              } @else {
                <button class="btn btn-primary" type="button" [disabled]="eventId() === null || checkingIn()" (click)="startCamera()">Open camera</button>
              }
            </div>
          </div>
          <div class="preview" [class.hidden]="!cameraActive()">
            <video #cameraPreview autoplay muted playsinline aria-label="Camera preview"></video>
            <span class="scan-guide" aria-hidden="true"></span>
          </div>
          @if (cameraError()) {
            <p class="camera-error" role="alert">{{ cameraError() }}</p>
          }
          <p class="camera-note">Camera access requires HTTPS or localhost. You can upload a QR screenshot if camera access is unavailable.</p>
        </section>

        @if (last(); as result) {
          <p
            class="verdict"
            role="status"
            [class.ok]="result.outcome === 'SUCCESS'"
            [class.warn]="result.outcome === 'DUPLICATE' || result.outcome === 'WRONG_EVENT'"
            [class.bad]="result.outcome === 'INVALID'"
          >
            {{ describe(result) }}
          </p>
        }

        <h2>This session</h2>
        @if (scans().length) {
          <ul class="log">
            @for (scan of scans(); track scan.code + scan.at) {
              <li>
                <span class="code">{{ scan.code }}</span>
                <span class="outcome">{{ describe(scan) }}</span>
                <span class="at">{{ scan.at }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No tickets scanned yet.</p>
        }

        <h2>Manual lookup</h2>
        <form [formGroup]="searchForm" (ngSubmit)="search()" novalidate class="scan">
          <div class="field">
            <label for="query">Name, email or order ID</label>
            <input id="query" type="text" formControlName="query" autocomplete="off" />
          </div>
          <button class="btn btn-ghost" type="submit" [disabled]="eventId() === null">Search</button>
        </form>
        @if (searchResults().length) {
          <ul class="log">
            @for (result of searchResults(); track result.ticket_id) {
              <li>
                <span class="code">{{ result.customer_email }}</span>
                <span class="outcome">{{ result.seat_label ?? 'General admission' }} · {{ result.status }}</span>
              </li>
            }
          </ul>
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
      max-width: 44rem;
    }

    .field {
      margin-bottom: 1rem;
    }

    .field label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 600;
      margin-bottom: 0.375rem;
    }

    .field select,
    .field input {
      width: 100%;
      font: inherit;
      padding: 0.6875rem 0.875rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--bg);
      color: inherit;
    }

    .stats {
      margin: 0.375rem 0 0;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .scan {
      display: flex;
      align-items: flex-end;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .camera {
      margin-block: 1.5rem;
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg);
    }

    .camera-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .camera-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .upload {
      position: relative;
      cursor: pointer;
    }

    .upload input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    .upload.disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .camera h2 {
      margin: 0;
    }

    .camera-head p,
    .camera-note,
    .camera-error {
      margin: 0.25rem 0 0;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .camera-error {
      color: #8c1d18;
    }

    .preview {
      position: relative;
      overflow: hidden;
      margin-top: 1rem;
      border-radius: var(--radius);
      background: #050508;
      aspect-ratio: 4 / 3;
    }

    .preview.hidden {
      display: none;
    }

    .preview video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .scan-guide {
      position: absolute;
      inset: 16%;
      border: 3px solid rgba(255, 255, 255, 0.9);
      border-radius: 1rem;
      box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.18);
      pointer-events: none;
    }

    .scan .field {
      flex: 1 1 14rem;
      margin-bottom: 0;
    }

    .verdict {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.9375rem;
    }

    .verdict.ok {
      background: var(--success-bg);
      color: var(--success-fg);
    }

    .verdict.warn {
      background: var(--warn-bg);
      color: var(--warn-fg);
    }

    .verdict.bad {
      background: #fdeceb;
      color: #8c1d18;
    }

    h2 {
      margin-top: 2rem;
      font-size: 1.125rem;
    }

    .log {
      list-style: none;
      margin: 0.75rem 0 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .log li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
    }

    .log li + li {
      border-top: 1px solid var(--border);
    }

    .code {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .at,
    .empty {
      color: var(--text-muted);
    }

    .empty {
      margin-top: 0.75rem;
      font-size: 0.875rem;
    }

    @media (max-width: 700px) {
      .camera-head {
        align-items: stretch;
        flex-direction: column;
      }

      .camera-actions {
        justify-content: stretch;
      }

      .camera-actions .btn {
        flex: 1;
        text-align: center;
      }
    }
  `,
})
export class Checkin implements OnDestroy {
  @ViewChild('cameraPreview', { static: true }) private readonly cameraPreview!: ElementRef<HTMLVideoElement>;

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly qrReader = new BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: 200,
    delayBetweenScanSuccess: 1000,
  });
  private scannerControls: IScannerControls | null = null;
  private acceptingCameraResult = false;
  protected readonly auth = inject(AuthService);

  protected readonly events = signal<readonly EventOption[]>([]);
  protected readonly eventId = signal<number | null>(null);
  protected readonly stats = signal<CheckinStats | null>(null);
  protected readonly scans = signal<readonly ScanResult[]>([]);
  protected readonly last = signal<ScanResult | null>(null);
  protected readonly searchResults = signal<readonly SearchResult[]>([]);
  protected readonly cameraActive = signal(false);
  protected readonly cameraError = signal('');
  protected readonly checkingIn = signal(false);
  protected readonly decodingImage = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required]],
  });

  protected readonly searchForm = this.fb.nonNullable.group({
    query: [''],
  });

  constructor() {
    void this.loadEvents();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  protected selectEvent(eventId: number): void {
    this.stopCamera();
    this.eventId.set(eventId);
    void this.loadStats(eventId);
  }

  protected async startCamera(): Promise<void> {
    if (this.eventId() === null) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('Camera scanning is not supported by this browser. Enter the QR token manually.');
      return;
    }

    this.stopCamera();
    this.cameraError.set('');
    this.cameraActive.set(true);
    try {
      this.scannerControls = await this.qrReader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        this.cameraPreview.nativeElement,
        (result) => {
          if (result && !this.acceptingCameraResult) void this.acceptCameraResult(result.getText());
        },
      );
    } catch (error) {
      this.stopCamera();
      this.cameraError.set(cameraErrorMessage(error));
    }
  }

  protected stopCamera(): void {
    this.scannerControls?.stop();
    this.scannerControls = null;
    this.cameraActive.set(false);
  }

  protected scanImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const image = input.files?.[0];
    input.value = '';
    if (image) void this.decodeImage(image);
  }

  protected async scan(): Promise<void> {
    const eventId = this.eventId();
    const code = this.form.controls.code.value.trim();
    if (!code || eventId === null) {
      return;
    }

    this.checkingIn.set(true);
    try {
      const response = await firstValueFrom(
        this.api.post<{ result: ScanOutcome }>('ticket', '/tickets/validate', { eventId, qrToken: code }),
      );
      this.record({ code, outcome: response.result, at: timestamp() });
    } catch {
      this.record({ code, outcome: 'INVALID', at: timestamp() });
    } finally {
      this.checkingIn.set(false);
    }
    void this.loadStats(eventId);
  }

  protected async search(): Promise<void> {
    const eventId = this.eventId();
    const query = this.searchForm.controls.query.value.trim();
    if (!query || eventId === null) {
      this.searchResults.set([]);
      return;
    }

    try {
      const result = await firstValueFrom(
        this.api.get<SearchResponse>('ticket', `/tickets/search?eventId=${eventId}&query=${encodeURIComponent(query)}`),
      );
      this.searchResults.set(result.tickets);
    } catch {
      this.searchResults.set([]);
    }
  }

  protected describe(result: ScanResult): string {
    switch (result.outcome) {
      case 'SUCCESS':
        return `${result.code} admitted`;
      case 'DUPLICATE':
        return `${result.code} was already scanned`;
      case 'WRONG_EVENT':
        return `${result.code} is for a different event`;
      default:
        return `${result.code} is not a valid ticket`;
    }
  }

  private async loadEvents(): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.get<EventsResponse>('event', '/events'));
      this.events.set(result.events);
      if (result.events.length > 0) {
        this.selectEvent(result.events[0].event_id);
      }
    } catch {
      this.events.set([]);
    }
  }

  private async acceptCameraResult(code: string): Promise<void> {
    this.acceptingCameraResult = true;
    this.stopCamera();
    this.form.controls.code.setValue(code);
    try {
      await this.scan();
    } finally {
      this.acceptingCameraResult = false;
    }
  }

  private async decodeImage(image: File): Promise<void> {
    if (this.eventId() === null || this.decodingImage()) return;
    this.stopCamera();
    this.decodingImage.set(true);
    this.cameraError.set('');
    const imageUrl = URL.createObjectURL(image);
    try {
      const result = await this.qrReader.decodeFromImageUrl(imageUrl);
      await this.acceptCameraResult(result.getText());
    } catch {
      this.cameraError.set('No readable QR code was found in that image. Try a sharper image or paste the token text.');
    } finally {
      URL.revokeObjectURL(imageUrl);
      this.decodingImage.set(false);
    }
  }

  private async loadStats(eventId: number): Promise<void> {
    try {
      this.stats.set(await firstValueFrom(this.api.get<CheckinStats>('ticket', `/events/${eventId}/checkin-stats`)));
    } catch {
      this.stats.set(null);
    }
  }

  private record(result: ScanResult): void {
    this.scans.update((scans) => [result, ...scans]);
    this.last.set(result);
    this.form.reset();
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No usable camera was found on this device.';
  }
  return 'The camera could not be started. Close other camera apps or enter the QR token manually.';
}
