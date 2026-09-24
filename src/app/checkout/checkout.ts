import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, timeout, timer } from 'rxjs';

import { ApiService } from '../core/api';
import { hasSubmittedPayment, setPaymentProcessing } from '../core/payment-processing';
import { QueueService } from '../core/queue';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';

interface CheckoutOrder {
  readonly order_id: number;
  readonly event_id: number;
  readonly status: string;
  readonly currency: string;
  readonly total_amount_cents: number;
  readonly reservation_expires_at?: string;
  readonly items: readonly {
    readonly order_item_id: number;
    readonly description: string;
    readonly quantity: number;
    readonly unit_price_cents: number;
  }[];
}

interface CheckoutEvent {
  readonly title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly tier: 'TIER1_GA' | 'TIER2_SEATED';
}

/** Format validation only: no card-network lookup or real payment details are needed. */
export const mockExpiryValidator: ValidatorFn = (control) => {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(control.value ?? ''));
  if (!match) return { expiry: true };
  const now = new Date();
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)
    ? null
    : { expiry: true };
};

@Component({
  selector: 'app-checkout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink, WorkspaceShell],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css',
})
export class Checkout {
  private readonly destroyRef = inject(DestroyRef);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private bufferTimer: ReturnType<typeof setTimeout> | undefined;
  private bufferResolve: (() => void) | undefined;
  private pollAttempts = 0;
  private readonly api = inject(ApiService);
  private readonly queue = inject(QueueService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly orderId = input('');
  protected readonly order = signal<CheckoutOrder | null>(null);
  protected readonly event = signal<CheckoutEvent | null>(null);
  protected readonly loading = signal(true);
  protected readonly paying = signal(false);
  protected readonly processing = signal(false);
  protected readonly checking = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly slow = signal(false);
  protected readonly error = signal('');
  protected readonly unavailable = signal(false);
  protected readonly now = signal(Date.now());
  protected readonly form = this.fb.group({
    cardNumber: [
      '',
      [Validators.required, Validators.pattern(/^(?:[0-9]{16}|[0-9]{4}(?: [0-9]{4}){3})$/)],
    ],
    expiry: ['', [Validators.required, mockExpiryValidator]],
    cvc: ['', [Validators.required, Validators.pattern(/^[0-9]{3}$/)]],
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.pollTimer);
      clearTimeout(this.bufferTimer);
      this.bufferResolve?.();
    });
    effect(() => {
      void this.load(this.orderId());
    });
    timer(0, 1_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(Date.now());
        const order = this.order();
        if (
          order?.status === 'PENDING' &&
          this.reservationSecondsRemaining() === 0 &&
          !this.paying() &&
          !this.processing() &&
          !this.cancelling() &&
          !this.unavailable()
        ) {
          void this.cancelReservation(true);
        }
      });
  }

  protected formatCardNumber(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digitsBeforeCursor = input.value
      .slice(0, input.selectionStart ?? input.value.length)
      .replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '').slice(0, 16);
    const formatted = digits.replace(/(.{4})(?=.)/g, '$1 ');
    this.form.controls.cardNumber.setValue(formatted);
    input.value = formatted;
    const position = Math.min(
      formatted.length,
      digitsBeforeCursor + Math.floor(Math.max(0, digitsBeforeCursor - 1) / 4),
    );
    input.setSelectionRange(position, position);
  }

  private markProcessing(orderId: number, processing: boolean): void {
    setPaymentProcessing(orderId, processing);
  }

  private wasProcessing(orderId: number): boolean {
    return hasSubmittedPayment(orderId);
  }

  protected invalid(field: 'cardNumber' | 'expiry' | 'cvc'): boolean {
    const control = this.form.controls[field];
    return control.touched && control.invalid;
  }

  protected async load(id = this.orderId()): Promise<void> {
    clearTimeout(this.pollTimer);
    this.processing.set(false);
    this.slow.set(false);
    this.loading.set(true);
    this.error.set('');
    this.order.set(null);
    this.event.set(null);
    this.unavailable.set(false);
    this.form.reset();
    try {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        this.error.set('This payment link is invalid. Please select your tickets again.');
        return;
      }
      const { order } = await firstValueFrom(
        this.api.get<{ readonly order: CheckoutOrder }>('order', `/orders/${id}`),
      );
      if (id !== this.orderId()) return;
      this.order.set(order);
      if (order.status === 'PAID') {
        this.queue.clear(order.event_id);
      } else if (order.status !== 'PENDING') {
        this.unavailable.set(true);
        this.error.set('This order can no longer be paid. Please select your tickets again.');
      }
      // The order is authoritative; an unavailable event description must not block checkout.
      const details = await firstValueFrom(
        this.api.get<{ readonly event: CheckoutEvent }>('event', `/events/${order.event_id}`),
      ).catch(() => null);
      if (id === this.orderId()) this.event.set(details?.event ?? null);
      if (
        id === this.orderId() &&
        order.status === 'PENDING' &&
        this.wasProcessing(order.order_id)
      ) {
        this.processing.set(true);
        this.pollAttempts = 0;
        this.schedulePoll();
      }
      if (order.status !== 'PENDING') this.markProcessing(order.order_id, false);
    } catch (error) {
      if (id !== this.orderId()) return;
      this.error.set(
        error instanceof HttpErrorResponse && [403, 404].includes(error.status)
          ? 'This order is unavailable or does not belong to your account.'
          : 'Unable to load your order. Please try again.',
      );
    } finally {
      if (id === this.orderId()) this.loading.set(false);
    }
  }

  protected async pay(): Promise<void> {
    const order = this.order();
    if (
      !order ||
      order.status !== 'PENDING' ||
      this.paying() ||
      this.processing() ||
      this.unavailable()
    )
      return;
    // Recheck expiry at submission in case the page was left open across a month boundary.
    this.form.controls.expiry.updateValueAndValidity();
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.host.nativeElement.querySelector<HTMLInputElement>('input.ng-invalid')?.focus();
      return;
    }
    this.paying.set(true);
    this.error.set('');
    // Start the minimum display time alongside the request, not after it.
    const buffer = new Promise<void>((resolve) => {
      this.bufferResolve = resolve;
      this.bufferTimer = setTimeout(resolve, 7_000);
    });
    try {
      // Never transmit, persist, or log the form values. The backend receives only a mock token.
      const response = await firstValueFrom(
        this.api
          .post<{ readonly order: CheckoutOrder; readonly paymentStatus?: string }>(
            'order',
            `/orders/${order.order_id}/payment-requests`,
            {
              paymentToken: 'simulated',
            },
          )
          .pipe(timeout(15_000)),
      );
      // Only an accepted backend response may turn an unpaid reservation into processing.
      this.markProcessing(
        order.order_id,
        response.paymentStatus === 'PROCESSING' || response.order?.status !== 'PAID',
      );
      await buffer;
      if (this.destroyRef.destroyed) return;
      this.form.reset();
      if (response.paymentStatus === 'PROCESSING') {
        this.processing.set(true);
        this.pollAttempts = 0;
        this.schedulePoll();
      } else if (response.order?.status === 'PAID') {
        await this.completePayment(response.order);
      } else {
        this.processing.set(true);
        this.schedulePoll();
      }
    } catch (error) {
      // A rejected or interrupted request is not proof that payment was submitted.
      this.markProcessing(order.order_id, false);
      await buffer;
      if (this.destroyRef.destroyed) return;
      const code =
        error instanceof HttpErrorResponse
          ? (error.error as { error?: string } | null)?.error
          : undefined;
      if (code === 'hold_not_active' || code === 'order_not_payable') {
        this.unavailable.set(true);
        this.markProcessing(order.order_id, false);
        this.form.reset();
        this.queue.clear(order.event_id);
        this.error.set(
          'Your reservation has expired or is no longer available. Please select your tickets again.',
        );
      } else if (
        error instanceof HttpErrorResponse &&
        [400, 401, 403, 404].includes(error.status)
      ) {
        this.markProcessing(order.order_id, false);
        this.error.set(
          'Unable to submit payment. Check your sign-in and reload this order. No real charge has been made.',
        );
      } else {
        // The server may have accepted a request whose response was lost. Do not resubmit automatically.
        this.form.reset();
        this.processing.set(true);
        this.pollAttempts = 0;
        this.error.set(
          'Payment confirmation is delayed. We are checking your order; no real money is charged.',
        );
        this.schedulePoll();
      }
    } finally {
      this.paying.set(false);
    }
  }

  protected reservationTimeLabel(): string {
    const seconds = this.reservationSecondsRemaining();
    if (seconds === null) return 'soon';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private reservationSecondsRemaining(): number | null {
    const expiresAt = Date.parse(this.order()?.reservation_expires_at ?? '');
    if (!Number.isFinite(expiresAt)) return null;
    return Math.max(0, Math.ceil((expiresAt - this.now()) / 1_000));
  }

  protected async cancelReservation(expired = false): Promise<void> {
    const order = this.order();
    if (
      !order ||
      order.status !== 'PENDING' ||
      this.cancelling() ||
      this.paying() ||
      this.processing()
    )
      return;
    this.cancelling.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.post<void>(
          'order',
          `/orders/${order.order_id}/cancel`,
          expired ? { reason: 'expired' } : {},
        ),
      );
      this.form.reset();
      this.queue.clear(order.event_id);
      this.unavailable.set(true);
      if (expired) {
        this.error.set(
          'Your reservation expired. The tickets have been released for other customers.',
        );
      } else {
        await this.router.navigateByUrl('/my-events');
      }
    } catch (error) {
      const code =
        error instanceof HttpErrorResponse
          ? (error.error as { error?: string } | null)?.error
          : undefined;
      if (code === 'reservation_not_cancellable' || code === 'reservation_not_expired') {
        await this.load();
      } else this.error.set('Unable to cancel this reservation. Please try again.');
    } finally {
      this.cancelling.set(false);
    }
  }

  private schedulePoll(): void {
    if (this.destroyRef.destroyed) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      void this.checkPayment();
    }, 2_000);
  }

  protected async checkPayment(): Promise<void> {
    const order = this.order();
    if (!order || this.checking() || this.destroyRef.destroyed) return;
    clearTimeout(this.pollTimer);
    this.checking.set(true);
    try {
      const result = await firstValueFrom(
        this.api
          .get<{ readonly order: CheckoutOrder }>('order', `/orders/${order.order_id}`)
          .pipe(timeout(10_000)),
      );
      if (this.destroyRef.destroyed) return;
      if (result.order.status === 'PAID') {
        await this.completePayment(result.order);
        return;
      }
      if (result.order.status !== 'PENDING') {
        this.processing.set(false);
        this.markProcessing(order.order_id, false);
        this.unavailable.set(true);
        this.queue.clear(order.event_id);
        this.error.set(
          'Payment could not complete. Your reservation may have expired. Please select your tickets again.',
        );
        return;
      }
    } catch {
      if (this.destroyRef.destroyed) return;
      this.error.set('Unable to confirm payment yet. You can safely check the status again.');
    } finally {
      this.checking.set(false);
    }
    this.pollAttempts += 1;
    if (this.pollAttempts >= 30) {
      this.slow.set(true);
    } else {
      this.schedulePoll();
    }
  }

  private async completePayment(order: CheckoutOrder): Promise<void> {
    clearTimeout(this.pollTimer);
    this.markProcessing(order.order_id, false);
    this.processing.set(false);
    this.error.set('');
    this.order.set(order);
    this.queue.clear(order.event_id);
    await this.router.navigate(['/my-events'], { queryParams: { orderId: order.order_id } });
  }
}
