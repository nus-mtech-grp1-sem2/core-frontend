import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import jsQR from 'jsqr';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  of,
  switchMap,
  timeout,
  TimeoutError,
} from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../core/auth';
import { ApiService } from '../core/api';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';
import {
  ConfirmDialogService,
  type ConfirmOptions,
} from '../shared/components/confirm-dialog/confirm-dialog.service';
import { ActivatedRoute } from '@angular/router';
import { recoverSmallQr } from './qr-small-recovery';

const qrDecodeHints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

/** A door scanner must fail visibly rather than hang, so every call is bounded. */
const STATS_REQUEST_TIMEOUT_MS = 8000;

type ScanOutcome = 'VALID' | 'ALREADY_USED' | 'INVALID' | 'WRONG_EVENT';
type TicketOutcome = 'SUCCESS' | 'DUPLICATE' | 'INVALID' | 'WRONG_EVENT';

interface ScanResult {
  readonly outcome: ScanOutcome;
  readonly at: string;
}

interface EventOption {
  readonly event_id: number;
  readonly title: string;
  readonly starts_at?: string;
  readonly event_start_datetime?: string;
}

interface EventsResponse {
  readonly events: readonly EventOption[];
}

interface CheckinStats {
  readonly checkedIn: number;
  readonly total: number;
}

interface ScannerSessionResponse {
  readonly sessionToken: string;
}

interface SearchResult {
  readonly ticket_id: number;
  readonly customer_name: string;
  readonly customer_email: string;
  readonly seat_id: number | null;
  readonly status: string;
}

interface SearchResponse {
  readonly tickets: readonly SearchResult[];
}

/**
 * Door workspace for event helpers. The ticket service owns validity and the
 * single-use transition; this component only submits opaque identifiers and
 * renders stable outcomes.
 */
@Component({
  selector: 'app-checkin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, WorkspaceShell],
  templateUrl: './checkin.html',
  styleUrl: './checkin.css',
})
export class Checkin implements OnDestroy {
  @ViewChild('cameraPreview', { static: true })
  private readonly cameraPreview!: ElementRef<HTMLVideoElement>;

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly qrReader = new BrowserQRCodeReader(qrDecodeHints, {
    delayBetweenScanAttempts: 200,
    delayBetweenScanSuccess: 1000,
  });
  private scannerControls: IScannerControls | null = null;
  private scannerSessionToken = '';
  private acceptingCameraResult = false;
  private statsTimer: number | null = null;
  private lastSubmission: { readonly qrToken?: string; readonly ticketId?: number } | null = null;
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
  protected readonly requestError = signal('');
  protected readonly searchStatus = signal('');
  protected readonly muted = signal(false);

  protected readonly searchForm = this.fb.nonNullable.group({
    query: [''],
  });

  constructor() {
    void this.loadEvents();
    this.searchForm.controls.query.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => this.searchTickets(query.trim())),
      )
      .subscribe(({ tickets, status }) => {
        this.searchResults.set(tickets);
        this.searchStatus.set(status);
      });
  }

  ngOnDestroy(): void {
    this.stopCamera();
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
  }

  protected selectEvent(eventId: number): void {
    this.stopCamera();
    this.eventId.set(eventId);
    this.scannerSessionToken = '';
    // A lookup belongs to one event, so another event starts with an empty search.
    this.searchForm.reset();
    this.searchResults.set([]);
    this.searchStatus.set('');
    void this.startScannerSession(eventId);
    this.startStatsPolling();
  }

  protected async startCamera(): Promise<void> {
    if (this.eventId() === null) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set(
        'Camera scanning is not supported by this browser. Enter the QR token manually.',
      );
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

  protected async checkInSearchResult(result: SearchResult): Promise<void> {
    if (!canCheckIn(result.status) || this.checkingIn()) return;
    if (!(await this.confirmDialog.ask(checkInPrompt(result)))) return;
    const outcome = await this.submit({ ticketId: result.ticket_id });
    // Either way the ticket is now used, so its row stops offering a check-in.
    if (outcome === 'VALID' || outcome === 'ALREADY_USED') {
      this.searchResults.update((results) =>
        results.map((row) =>
          row.ticket_id === result.ticket_id ? { ...row, status: 'CHECKED_IN' } : row,
        ),
      );
    }
  }

  protected canCheckIn(status: string): boolean {
    return canCheckIn(status);
  }

  protected describe(outcome: ScanOutcome): string {
    return outcomeDescription(outcome);
  }

  protected outcomeIcon(outcome: ScanOutcome): string {
    return outcomeIcon(outcome);
  }

  protected toggleMute(): void {
    this.muted.update((muted) => !muted);
  }

  protected retryLast(): void {
    if (this.lastSubmission) void this.submit(this.lastSubmission);
  }

  private async loadEvents(): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.get<EventsResponse>('event', '/helper/shifts'));
      const events = currentAndFutureEvents(result.events, new Date());
      this.events.set(events);
      if (events.length > 0) {
        const routeEventId = Number(this.route.snapshot.paramMap.get('eventId'));
        const selectedEvent = events.find((event) => event.event_id === routeEventId);
        this.selectEvent(selectedEvent?.event_id ?? events[0].event_id);
      }
    } catch {
      this.events.set([]);
    }
  }

  private async startScannerSession(eventId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.post<ScannerSessionResponse>('ticket', '/scanner/sessions', { eventId }),
      );
      this.scannerSessionToken = result.sessionToken;
      await this.loadStats(eventId);
    } catch (error) {
      this.requestError.set(
        error instanceof HttpErrorResponse && error.status === 403
          ? 'This event is not assigned to your helper account.'
          : 'The check-in service is unavailable. Try again.',
      );
    }
  }

  private async acceptCameraResult(code: string): Promise<void> {
    if (this.checkingIn()) return;
    const token = code.trim();
    if (!isTicketToken(token)) {
      this.stopCamera();
      console.warn('QR decoded to an unusable ticket token', {
        length: token.length,
        preview: token.slice(0, 80),
      });
      this.cameraError.set(
        token
          ? `That QR code holds ${token.length} characters, which is not a ticket token.`
          : 'No ticket QR code could be read. Try a clearer image or scan again.',
      );
      return;
    }
    this.acceptingCameraResult = true;
    this.stopCamera();
    try {
      await this.submit({ qrToken: token });
    } finally {
      this.acceptingCameraResult = false;
    }
  }

  private async decodeImage(image: File): Promise<void> {
    if (this.eventId() === null || this.decodingImage()) return;
    if (image.size > 12 * 1024 * 1024) {
      this.cameraError.set('That image is too large. Upload a QR image smaller than 12 MB.');
      return;
    }
    this.stopCamera();
    this.decodingImage.set(true);
    this.cameraError.set('');
    try {
      const code = await decodeUploadedQr(image, this.qrReader);
      await this.acceptCameraResult(code);
    } catch (error) {
      const trace = error instanceof QrDecodeError ? error.trace : [describeError(error)];
      console.warn('QR decode failed', {
        file: image.name,
        type: image.type,
        bytes: image.size,
        trace,
      });
      this.cameraError.set(uploadErrorMessage(error));
    } finally {
      this.decodingImage.set(false);
    }
  }

  private async loadStats(eventId: number): Promise<void> {
    if (!this.scannerSessionToken) return;
    try {
      const result = await firstValueFrom(
        this.api
          .get<{ checkedIn: number; issued: number }>(
            'ticket',
            `/events/${eventId}/checkin-stats`,
            { headers: { Authorization: `Bearer ${this.scannerSessionToken}` } },
          )
          .pipe(timeout(STATS_REQUEST_TIMEOUT_MS)),
      );
      this.stats.set({ checkedIn: result.checkedIn, total: result.issued });
    } catch {
      this.stats.set(null);
    }
  }

  private searchTickets(query: string) {
    const eventId = this.eventId();
    if (eventId === null || !isSearchableQuery(query))
      return of({ tickets: [] as readonly SearchResult[], status: '' });
    this.searchStatus.set('Searching…');
    return this.api
      .get<SearchResponse>('ticket', `/tickets/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${this.scannerSessionToken}` },
      })
      .pipe(
        map((result) => ({
          tickets: result.tickets,
          status: `${result.tickets.length} result${result.tickets.length === 1 ? '' : 's'}`,
        })),
        catchError(() =>
          of({ tickets: [] as readonly SearchResult[], status: 'Search unavailable. Try again.' }),
        ),
        // A reply that lands after the helper switched event is for the old event.
        filter(() => this.eventId() === eventId),
      );
  }

  private async submit(input: {
    readonly qrToken?: string;
    readonly ticketId?: number;
  }): Promise<ScanOutcome | null> {
    const eventId = this.eventId();
    if (this.checkingIn() || eventId === null) return null;
    this.lastSubmission = input;
    this.checkingIn.set(true);
    this.requestError.set('');
    try {
      const response = await firstValueFrom(
        this.api
          .post<{ outcome: TicketOutcome }>('ticket', '/tickets/validate', input, {
            headers: { Authorization: `Bearer ${this.scannerSessionToken}` },
          })
          .pipe(timeout(STATS_REQUEST_TIMEOUT_MS)),
      );
      const outcome = mapTicketOutcome(response.outcome);
      this.record({ outcome, at: timestamp() });
      this.playTone(outcome);
      return outcome;
    } catch (error) {
      this.requestError.set(checkinErrorMessage(error));
      return null;
    } finally {
      this.checkingIn.set(false);
      void this.loadStats(eventId);
    }
  }

  private startStatsPolling(): void {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = window.setInterval(() => {
      const eventId = this.eventId();
      if (eventId !== null && document.visibilityState === 'visible') void this.loadStats(eventId);
    }, 10000);
  }

  private playTone(outcome: ScanOutcome): void {
    if (this.muted()) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = outcome === 'VALID' ? 880 : 220;
    oscillator.type = outcome === 'VALID' ? 'sine' : 'square';
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.16);
    void context.close();
  }

  private record(result: ScanResult): void {
    this.scans.update((scans) => [result, ...scans]);
    this.last.set(result);
  }
}

interface BarcodeDetectorResult {
  readonly rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<readonly BarcodeDetectorResult[]>;
}

type BarcodeDetectorConstructor = new (options: {
  formats: readonly string[];
}) => BarcodeDetectorInstance;

interface QrImageSource {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/** Longest edge a decode canvas is allowed to reach before the image is scaled down. */
const QR_MAX_DECODE_EDGE = 2400;
/** Longest edge of the base canvas the window sweep reads from. */
const QR_SWEEP_EDGE = 1600;
/** Upper bound on sweep time so a large photo cannot freeze the check-in screen. */
const QR_SWEEP_BUDGET_MS = 4000;
/** Images at or below this edge are too small for decoders and get grid recovery. */
const QR_SMALL_RECOVERY_EDGE = 400;

type UploadFailureReason =
  'qr_not_found' | 'qr_image_load_failed' | 'qr_image_empty' | 'qr_canvas_unavailable';

/** Carries the failure category and per-stage notes for an uploaded QR image. */
class QrDecodeError extends Error {
  constructor(
    readonly trace: readonly string[],
    readonly reason: UploadFailureReason = 'qr_not_found',
  ) {
    super(reason);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function decodeUploadedQr(file: File, reader: BrowserQRCodeReader): Promise<string> {
  const trace: string[] = [];
  let source: QrImageSource;
  try {
    source = await loadQrSource(file);
  } catch (error) {
    throw new QrDecodeError([`load image: ${describeError(error)}`], uploadFailureReason(error));
  }
  trace.push(`image ${source.width}x${source.height}`);
  try {
    const text = await readQrSource(source, reader, trace);
    if (!text) throw new QrDecodeError(trace);
    return text;
  } catch (error) {
    if (error instanceof QrDecodeError) throw error;
    throw new QrDecodeError(
      [...trace, `decode image: ${describeError(error)}`],
      uploadFailureReason(error),
    );
  } finally {
    if (typeof ImageBitmap !== 'undefined' && source.image instanceof ImageBitmap) {
      source.image.close();
    }
  }
}

async function readQrSource(
  source: QrImageSource,
  reader: BrowserQRCodeReader,
  trace: string[],
): Promise<string> {
  const NativeBarcodeDetector = (
    globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector;
  if (NativeBarcodeDetector) {
    try {
      const results = await new NativeBarcodeDetector({ formats: ['qr_code'] }).detect(
        source.image,
      );
      const value = results[0]?.rawValue.trim();
      if (value) return value;
      trace.push(`BarcodeDetector: ${results.length} code(s), no text`);
    } catch (error) {
      // Browser support varies; ZXing below remains the cross-browser fallback.
      trace.push(`BarcodeDetector: ${describeError(error)}`);
    }
  } else {
    trace.push('BarcodeDetector: not supported by this browser');
  }

  const canvas = createQrDecodeCanvas(source);
  const pixelResult = decodeQrCanvasPixels(canvas);
  if (pixelResult) return pixelResult;
  trace.push(`jsQR full frame (${canvas.width}x${canvas.height}): no match`);

  // Tiny screenshots blur modules into grey; rebuild the grid from the pixels instead.
  if (Math.max(source.width, source.height) <= QR_SMALL_RECOVERY_EDGE) {
    const recovered = recoverSmallQrSource(source);
    if (recovered) return recovered;
    trace.push('small-QR grid recovery: no match');
  }

  // A QR that fills only a small part of a screenshot is invisible to a whole-frame
  // pass, so re-read the image window by window at a few zoom levels.
  const sweptResult = sweepQrImage(source, trace);
  if (sweptResult) return sweptResult;

  try {
    return reader.decodeFromCanvas(canvas).getText();
  } catch (error) {
    trace.push(`ZXing full frame: ${describeError(error)}`);
    for (const threshold of [112, 160, 208]) {
      try {
        return reader.decodeFromCanvas(thresholdQrCanvas(canvas, threshold)).getText();
      } catch (thresholdError) {
        // Try the next contrast level before reporting the image as unreadable.
        trace.push(`ZXing threshold ${threshold}: ${describeError(thresholdError)}`);
      }
    }
  }
  return '';
}

/**
 * Decodes the picked file to drawable pixels. `createImageBitmap` reads the file
 * directly, which avoids the blob-URL `<img>` path that can resolve with a
 * zero-sized image and leave every decoder staring at a blank canvas.
 */
async function loadQrSource(file: File): Promise<QrImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { image: bitmap, width: bitmap.width, height: bitmap.height };
      }
      bitmap.close();
    } catch {
      // Fall back to the <img> loader for formats createImageBitmap rejects.
    }
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await loadQrImage(imageUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('qr_image_empty');
    return { image, width, height };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadQrImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('qr_image_load_failed'));
    image.src = imageUrl;
  });
}

export function qrCanvasPlan(
  width: number,
  height: number,
): {
  readonly scale: number;
  readonly padding: number;
  readonly width: number;
  readonly height: number;
} {
  const longestEdge = Math.max(width, height);
  const shortestEdge = Math.min(width, height);
  const scale = Math.max(1, Math.min(8, Math.floor(960 / longestEdge)));
  const padding = Math.max(32, Math.round(shortestEdge * scale * 0.08));
  return {
    scale,
    padding,
    width: width * scale + padding * 2,
    height: height * scale + padding * 2,
  };
}

function createQrDecodeCanvas(source: QrImageSource): HTMLCanvasElement {
  const capped = capQrSource(source, QR_MAX_DECODE_EDGE);
  const plan = qrCanvasPlan(capped.width, capped.height);
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('qr_canvas_unavailable');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    capped.image,
    plan.padding,
    plan.padding,
    capped.width * plan.scale,
    capped.height * plan.scale,
  );
  return canvas;
}

/**
 * Scales an oversized photo down onto a canvas. Phone cameras routinely produce
 * images larger than any decoder wants to binarise in one pass.
 */
function capQrSource(source: QrImageSource, maxEdge: number): QrImageSource {
  const longestEdge = Math.max(source.width, source.height);
  if (longestEdge <= maxEdge) return source;
  const ratio = maxEdge / longestEdge;
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('qr_canvas_unavailable');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.drawImage(source.image, 0, 0, width, height);
  return { image: canvas, width, height };
}

/**
 * Slides a window across the image at a few zoom levels, enlarging each window
 * before decoding. This is what finds a ticket QR that occupies a small corner
 * of a full-page screenshot, where a whole-frame pass sees too few pixels per
 * module to lock on.
 */
function sweepQrImage(source: QrImageSource, trace: string[]): string | null {
  const base = capQrSource(source, QR_SWEEP_EDGE);
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = base.width;
  baseCanvas.height = base.height;
  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseContext) {
    trace.push('sweep: canvas unavailable');
    return null;
  }
  baseContext.fillStyle = '#fff';
  baseContext.fillRect(0, 0, base.width, base.height);
  baseContext.drawImage(base.image, 0, 0, base.width, base.height);

  const tile = document.createElement('canvas');
  const tileContext = tile.getContext('2d', { willReadFrequently: true });
  if (!tileContext) {
    trace.push('sweep: canvas unavailable');
    return null;
  }

  const deadline = Date.now() + QR_SWEEP_BUDGET_MS;
  const shortestEdge = Math.min(base.width, base.height);

  let tiles = 0;
  for (const divisor of [2, 4]) {
    const window = Math.round(shortestEdge / divisor);
    if (window < 48) continue;
    const step = Math.max(1, Math.round(window * 0.6));
    const target = Math.min(640, window * 3);
    tile.width = target;
    tile.height = target;
    const lastLeft = Math.max(0, base.width - window);
    const lastTop = Math.max(0, base.height - window);

    for (let top = 0; ; top += step) {
      const y = Math.min(top, lastTop);
      for (let left = 0; ; left += step) {
        const x = Math.min(left, lastLeft);
        if (Date.now() > deadline) {
          trace.push(`sweep: gave up after ${QR_SWEEP_BUDGET_MS}ms (${tiles} tiles)`);
          return null;
        }
        tiles++;
        tileContext.fillStyle = '#fff';
        tileContext.fillRect(0, 0, target, target);
        tileContext.imageSmoothingEnabled = false;
        tileContext.drawImage(baseCanvas, x, y, window, window, 0, 0, target, target);
        const pixels = tileContext.getImageData(0, 0, target, target);
        const found = decodeQrPixels(pixels.data, pixels.width, pixels.height);
        if (found) return found;
        if (x >= lastLeft) break;
      }
      if (y >= lastTop) break;
    }
  }
  trace.push(`sweep (${base.width}x${base.height}): no match in ${tiles} tiles`);
  return null;
}

function recoverSmallQrSource(source: QrImageSource): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source.image, 0, 0);
  const image = context.getImageData(0, 0, source.width, source.height);
  return recoverSmallQr(image.data, image.width, image.height);
}

function decodeQrCanvasPixels(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return decodeQrPixels(image.data, image.width, image.height);
}

export function decodeQrPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  return jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })?.data.trim() || null;
}

function thresholdQrCanvas(source: HTMLCanvasElement, threshold: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('qr_canvas_unavailable');
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const luminance =
      image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
    const value = luminance < threshold ? 0 : 255;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Keeps the events a helper can still check people in to: anything starting today
 * (even if it began hours ago — the door is still open) or later. Events from earlier
 * days are dropped. An event with no readable start time is kept, since hiding an
 * assigned event at the door is worse than listing one too many.
 */
export function currentAndFutureEvents(
  events: readonly EventOption[],
  now: Date,
): readonly EventOption[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return events.filter((event) => {
    const startsAt = new Date(event.starts_at ?? event.event_start_datetime ?? '').getTime();
    return Number.isNaN(startsAt) || startsAt >= startOfToday;
  });
}

/** Ticket tokens are short base64url strings; the service rejects empty or over-long values. */
export function isTicketToken(value: string): boolean {
  return value.length > 0 && value.length <= 255;
}

export function checkinErrorMessage(error: unknown): string {
  if (error instanceof TimeoutError) {
    return 'The check-in service did not respond. Check the connection and scan again.';
  }
  if (!(error instanceof HttpErrorResponse)) {
    return 'The check-in service is unavailable. Try again.';
  }
  if (error.status === 403) return 'This event is not assigned to your helper account.';
  const detail: unknown = error.error?.detail;
  if (error.status === 422 && typeof detail === 'string')
    return `Invalid check-in request: ${detail}`;
  return 'The check-in service is unavailable. Try again.';
}

export function uploadErrorMessage(error: unknown): string {
  const reason =
    error instanceof QrDecodeError ? error.reason : error instanceof Error ? error.message : '';
  if (reason === 'qr_image_load_failed' || reason === 'qr_image_empty') {
    return 'That file could not be opened as an image. Save the ticket QR as a PNG or JPG and upload that.';
  }
  if (reason === 'qr_canvas_unavailable') {
    return 'This browser blocked image decoding. Use the camera or enter the QR token manually.';
  }
  return 'No readable QR code was found. Upload the original image or a crop with a clear white border around the whole QR code.';
}

function uploadFailureReason(error: unknown): UploadFailureReason {
  const reason = error instanceof Error ? error.message : '';
  if (
    reason === 'qr_image_load_failed' ||
    reason === 'qr_image_empty' ||
    reason === 'qr_canvas_unavailable'
  ) {
    return reason;
  }
  return 'qr_not_found';
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

/**
 * Asked before checking in a ticket found by manual lookup. Yes is the default so a
 * helper at the door can confirm with Enter; the ticket holder is named so the
 * helper can match them to the person in front of them.
 */
export function checkInPrompt(result: SearchResult): ConfirmOptions {
  const holder =
    result.customer_name && result.customer_email
      ? `${result.customer_name} (${result.customer_email})`
      : result.customer_name || result.customer_email;
  return {
    title: 'Check in this ticket?',
    message: [holder, result.seat_id ? 'Reserved seat' : 'General admission'],
    confirmLabel: 'Yes, check in',
    cancelLabel: 'No',
    tone: 'positive',
    defaultChoice: 'confirm',
  };
}

/** Only an issued ticket can still be checked in: a checked-in one is used, a void one is invalid. */
export function canCheckIn(status: string): boolean {
  return status === 'ISSUED';
}

/** Matches the ticket service: an order ID (digits) of any length, or text of 3+ characters. */
export function isSearchableQuery(query: string): boolean {
  return /^\d+$/.test(query) || query.length >= 3;
}

export function outcomeDescription(outcome: ScanOutcome): string {
  switch (outcome) {
    case 'VALID':
      return 'Valid ticket. Check-in accepted.';
    case 'ALREADY_USED':
      return 'Already used. This ticket was checked in earlier.';
    case 'WRONG_EVENT':
      return 'Wrong event. This ticket is not assigned to this event.';
    default:
      return 'Invalid ticket. It could not be checked in.';
  }
}

export function outcomeIcon(outcome: ScanOutcome): string {
  return outcome === 'VALID'
    ? '✓'
    : outcome === 'ALREADY_USED'
      ? '↺'
      : outcome === 'WRONG_EVENT'
        ? '!'
        : '×';
}

function mapTicketOutcome(outcome: TicketOutcome): ScanOutcome {
  switch (outcome) {
    case 'SUCCESS':
      return 'VALID';
    case 'DUPLICATE':
      return 'ALREADY_USED';
    case 'WRONG_EVENT':
      return 'WRONG_EVENT';
    default:
      return 'INVALID';
  }
}
