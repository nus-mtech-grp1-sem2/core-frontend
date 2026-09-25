import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { QueueService } from '../core/queue';
import { Checkout, mockExpiryValidator } from './checkout';

describe('Mock expiry validation', () => {
  it.each(['', '00/39', '13/39', '1/39', '12/2039', 'ab/cd', '01/00'])(
    'rejects missing, malformed or expired date %s',
    (value) => {
      expect(mockExpiryValidator(new FormControl(value))).toEqual({ expiry: true });
    },
  );

  it('accepts the current month and future dates', () => {
    const now = new Date();
    const current = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
    expect(mockExpiryValidator(new FormControl(current))).toBeNull();
    expect(mockExpiryValidator(new FormControl('12/99'))).toBeNull();
  });
});

describe('Checkout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });
  const paidOrder = {
    order_id: 42,
    event_id: 172,
    status: 'PAID',
    currency: 'SGD',
    total_amount_cents: 4000,
    items: [],
  };
  async function render(
    options: {
      status?: string;
      loadError?: HttpErrorResponse;
      payment?: Observable<unknown>;
      tier?: 'TIER1_GA' | 'TIER2_SEATED';
      expiresInMs?: number;
    } = {},
  ) {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (options.loadError) return throwError(() => options.loadError);
      if (path === '/orders/42')
        return of({
          order: {
            order_id: 42,
            event_id: 172,
            status: options.status ?? 'PENDING',
            currency: 'SGD',
            total_amount_cents: 4000,
            reservation_expires_at: new Date(
              Date.now() + (options.expiresInMs ?? 180_000),
            ).toISOString(),
            items: [
              {
                order_item_id: 1,
                description: 'Standard ticket',
                quantity: 2,
                unit_price_cents: 2000,
              },
            ],
          },
        });
      if (path === '/events/172')
        return of({
          event: {
            title: 'Live at OneStage',
            venue: 'Concert Hall',
            starts_at: '2099-01-01T20:00:00',
            tier: options.tier ?? 'TIER1_GA',
          },
        });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const post = vi.fn(() => options.payment ?? of({ order: paidOrder }));
    const clear = vi.fn();
    await TestBed.configureTestingModule({
      imports: [Checkout],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get, post } },
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
        { provide: QueueService, useValue: { clear } },
      ],
    }).compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Checkout);
    fixture.componentRef.setInput('orderId', '42');
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = (id: string, value: string) => {
      const element = host.querySelector<HTMLInputElement>(`#${id}`)!;
      element.value = value;
      element.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const fill = (card = '1234567890123456', expiry = '12/99', cvc = '123') => {
      input('mock-card-number', card);
      input('mock-expiry', expiry);
      input('mock-cvc', cvc);
    };
    const submit = () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    const settle = async (ms = 7_000) => {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    };
    return { fixture, host, fill, submit, settle, post, get, clear, navigate, navigateByUrl };
  }

  it.each(['TIER1_GA', 'TIER2_SEATED'] as const)(
    'shows the server order and mock notice for %s',
    async (tier) => {
      const { host, post, get } = await render({ tier });
      expect(get).toHaveBeenCalledWith('order', '/orders/42');
      expect(host.textContent).toContain('Live at OneStage');
      expect(host.textContent).toContain(
        tier === 'TIER1_GA' ? 'General admission' : 'Reserved seating',
      );
      expect(host.textContent).toContain('40.00');
      expect(host.textContent).toContain('No real credit card is used');
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('requires all three fields and focuses the first invalid field', async () => {
    const { host, submit, post } = await render();
    submit();
    expect(host.textContent).toContain('Enter exactly 16 digits.');
    expect(host.textContent).toContain('Enter exactly 3 digits.');
    expect(host.textContent).toContain('Enter a valid, unexpired date');
    expect(document.activeElement?.id).toBe('mock-card-number');
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the countdown and cancels the reservation immediately', async () => {
    const { host, post, clear, navigateByUrl, settle } = await render();
    expect(host.textContent).toMatch(/Reservation expires in\s+3:00/);
    host.querySelector<HTMLButtonElement>('.cancel-button')?.click();
    await settle(0);
    expect(post).toHaveBeenCalledExactlyOnceWith('order', '/orders/42/cancel', {});
    expect(clear).toHaveBeenCalledWith(172);
    expect(navigateByUrl).toHaveBeenCalledWith('/my-events');
  });

  it('releases an unpaid reservation when its countdown reaches zero', async () => {
    const { host, post, clear, settle } = await render({ expiresInMs: 2_000 });
    await settle(2_000);
    expect(post).toHaveBeenCalledExactlyOnceWith('order', '/orders/42/cancel', {
      reason: 'expired',
    });
    expect(clear).toHaveBeenCalledWith(172);
    expect(host.textContent).toContain('tickets have been released for other customers');
    expect(host.querySelector('form')).toBeNull();
  });

  it.each([
    ['123456789012345', '12/99', '123'],
    ['123456789012345x', '12/99', '123'],
    ['1234567890123456', '12/99', '12'],
    ['1234567890123456', '12/99', '1234'],
    ['1234567890123456', '12/99', 'abc'],
    ['1234567890123456', '', '123'],
    ['1234567890123456', '01/00', '123'],
  ])('rejects invalid dummy details (%s, %s, %s)', async (card, expiry, cvc) => {
    const { fill, submit, post } = await render();
    fill(card, expiry, cvc);
    submit();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends only the simulated token and redirects after success', async () => {
    const { fill, submit, settle, post, clear, navigate, host } = await render();
    fill();
    submit();
    await settle();
    expect(post).toHaveBeenCalledExactlyOnceWith('order', '/orders/42/payment-requests', {
      paymentToken: 'simulated',
    });
    expect(clear).toHaveBeenCalledWith(172);
    expect(navigate).toHaveBeenCalledWith(['/my-events'], { queryParams: { orderId: 42 } });
    expect(host.querySelector('form')).toBeNull();
  });

  it('blocks duplicate submissions while processing', async () => {
    const payment = new Subject<unknown>();
    const { fill, submit, settle, post, host } = await render({ payment });
    fill();
    submit();
    submit();
    expect(post).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
    payment.next({});
    payment.complete();
    await settle();
  });

  it('does not mark payment as submitted until the backend accepts the request', async () => {
    const payment = new Subject<unknown>();
    const { fill, submit, settle } = await render({ payment });
    fill();
    submit();

    expect(sessionStorage.getItem('onestage.acceptedPayment.42')).toBeNull();

    payment.next({ paymentStatus: 'PROCESSING' });
    await settle(0);
    expect(sessionStorage.getItem('onestage.acceptedPayment.42')).not.toBeNull();
  });

  it('does not mark payment as submitted when checkout is opened and left', async () => {
    const { fixture } = await render();
    fixture.destroy();

    expect(sessionStorage.getItem('onestage.acceptedPayment.42')).toBeNull();
  });

  it('checks status after an ambiguous network failure without submitting another payment', async () => {
    const { fill, submit, settle, post, navigate, host, get } = await render({
      payment: throwError(() => new HttpErrorResponse({ status: 503 })),
    });
    fill();
    submit();
    await settle();
    expect(host.textContent).toContain('Payment confirmation is delayed');
    expect(navigate).not.toHaveBeenCalled();
    get.mockReturnValue(of({ order: paidOrder }));
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(['1234567890123456', '1234 5678 9012 3456'])(
    'formats typed or pasted digits in groups of four: %s',
    async (number) => {
      const { fill, host } = await render();
      fill(number);
      expect(host.querySelector<HTMLInputElement>('#mock-card-number')?.value).toBe(
        '1234 5678 9012 3456',
      );
    },
  );

  it('keeps the processing state visible for at least seven seconds', async () => {
    const { fill, submit, settle, navigate, host } = await render();
    fill();
    submit();
    await settle(6_999);
    expect(navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Processing your mock payment');
    await settle(1);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('polls an accepted queued payment and redirects only after PAID', async () => {
    const { fill, submit, settle, navigate, get, post, host } = await render({
      payment: of({ paymentStatus: 'PROCESSING' }),
    });
    fill();
    submit();
    await settle();
    expect(host.textContent).toContain('Processing your payment');
    await settle(2_000);
    expect(navigate).not.toHaveBeenCalled();
    get.mockReturnValue(of({ order: paidOrder }));
    await settle(2_000);
    expect(navigate).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('resumes status checks after refresh without asking for card details again', async () => {
    sessionStorage.setItem('onestage.acceptedPayment.42', String(Date.now()));
    const { host, get, post, settle, navigate } = await render();
    expect(host.querySelector('form')).toBeNull();
    get.mockReturnValue(of({ order: paidOrder }));
    await settle(2_000);
    expect(navigate).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });

  it('stops automatic polling and offers a status check when processing is slow', async () => {
    const { fill, submit, settle, host, post, navigate } = await render({
      payment: of({ paymentStatus: 'PROCESSING' }),
    });
    fill();
    submit();
    await settle(67_000);
    expect(host.textContent).toContain('Payment is taking longer than usual');
    expect(host.textContent).toContain('Check payment status');
    expect(post).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a terminal queued failure without claiming success', async () => {
    const { fill, submit, settle, get, host, navigate } = await render({
      payment: of({ paymentStatus: 'PROCESSING' }),
    });
    fill();
    submit();
    await settle();
    get.mockReturnValue(of({ order: { ...paidOrder, status: 'FAILED' } }));
    await settle(2_000);
    expect(host.textContent).toContain('Payment could not complete');
    expect(host.querySelector('form')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate or poll after leaving the page during submission', async () => {
    const { fill, submit, settle, fixture, get, navigate } = await render();
    fill();
    submit();
    fixture.destroy();
    const requests = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(navigate).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(requests);
  });

  it.each(['hold_not_active', 'order_not_payable'])(
    'handles %s without offering another payment',
    async (error) => {
      const { fill, submit, settle, host, navigate } = await render({
        payment: throwError(() => new HttpErrorResponse({ status: 409, error: { error } })),
      });
      fill();
      submit();
      await settle();
      expect(host.textContent).toContain('reservation has expired');
      expect(host.querySelector('form')).toBeNull();
      expect(host.querySelector('a[href="/events/172"]')).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it.each(['PAID', 'FAILED', 'CANCELLED'])(
    'does not offer payment for a %s order',
    async (status) => {
      const { host, post } = await render({ status });
      expect(host.querySelector('form')).toBeNull();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('does not expose a payment form when the order cannot be accessed', async () => {
    const { host, post } = await render({ loadError: new HttpErrorResponse({ status: 403 }) });
    expect(host.textContent).toContain('unavailable or does not belong to your account');
    expect(host.querySelector('form')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
