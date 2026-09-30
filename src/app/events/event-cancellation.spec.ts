import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import type { ApiService } from '../core/api';
import type { ConfirmOptions } from '../shared/components/confirm-dialog/confirm-dialog.service';
import {
  cancelEventWithConfirmation,
  cancellationPrompt,
  type CancellationImpact,
} from './event-cancellation';

describe('cancellationPrompt', () => {
  it('asks plainly when nobody has bought tickets, or the numbers are unknown', () => {
    const plain = cancellationPrompt({ customers: 0, ticketsSold: 0 });
    expect(plain.title).toBe('Cancel this event?');
    expect(plain.message).toEqual(['The event will be taken off sale.']);
    expect(cancellationPrompt(null)).toEqual(plain);
  });

  it('warns that customers have bought tickets, which will be voided and refunded', () => {
    expect(cancellationPrompt({ customers: 2, ticketsSold: 5 })).toEqual({
      title: 'Customers have bought tickets',
      message: [
        '2 customers have already purchased 5 tickets for this event.',
        'Cancelling will void their tickets and email them that the event is cancelled and their payment will be refunded.',
        'Do you still want to cancel this event?',
      ],
      confirmLabel: 'Yes, cancel event',
      cancelLabel: 'No, keep event',
    });
  });

  it('uses the singular for one customer and one ticket', () => {
    expect(cancellationPrompt({ customers: 1, ticketsSold: 1 }).message[0]).toBe(
      '1 customer has already purchased 1 ticket for this event.',
    );
  });
});

describe('cancelEventWithConfirmation', () => {
  const sold: CancellationImpact = { customers: 2, ticketsSold: 3 };
  const none: CancellationImpact = { customers: 0, ticketsSold: 0 };
  const refusal = (impact: CancellationImpact) =>
    new HttpErrorResponse({
      status: 409,
      error: { error: 'cancellation_confirmation_required', ...impact },
    });
  const answering = (...answers: boolean[]) => {
    const confirm = vi.fn<(options: ConfirmOptions) => Promise<boolean>>();
    for (const answer of answers) confirm.mockResolvedValueOnce(answer);
    return confirm;
  };

  function fakeApi(impact: Observable<unknown>, cancels: Observable<unknown>[]) {
    const posts: { path: string; body: unknown }[] = [];
    const api = {
      get: vi.fn(() => impact),
      post: vi.fn((_service: string, path: string, body: unknown) => {
        posts.push({ path, body });
        return cancels.shift() ?? of(null);
      }),
    } as unknown as ApiService;
    return { api, posts };
  }

  it('cancels without confirming again once the organiser accepts a plain prompt', async () => {
    const { api, posts } = fakeApi(of(none), []);
    const confirm = answering(true);

    expect(await cancelEventWithConfirmation(api, 7, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(cancellationPrompt(none));
    expect(posts).toEqual([{ path: '/events/7/cancel', body: { confirm: false } }]);
  });

  it('warns about customers, and sends confirm once the organiser accepts', async () => {
    const { api, posts } = fakeApi(of(sold), []);
    const confirm = answering(true);

    expect(await cancelEventWithConfirmation(api, 7, confirm)).toBe(true);
    expect(api.get).toHaveBeenCalledWith('event', '/events/7/cancellation-impact');
    expect(confirm).toHaveBeenCalledExactlyOnceWith(cancellationPrompt(sold));
    expect(posts).toEqual([{ path: '/events/7/cancel', body: { confirm: true } }]);
  });

  it('changes nothing when the organiser backs out', async () => {
    const { api, posts } = fakeApi(of(sold), []);

    expect(await cancelEventWithConfirmation(api, 7, answering(false))).toBe(false);
    expect(posts).toEqual([]);
  });

  it('asks again with the real numbers when tickets were bought after the prompt', async () => {
    const { api, posts } = fakeApi(of(none), [throwError(() => refusal(sold))]);
    const confirm = answering(true, true);

    expect(await cancelEventWithConfirmation(api, 7, confirm)).toBe(true);
    expect(confirm.mock.calls.map(([options]) => options)).toEqual([
      cancellationPrompt(none),
      cancellationPrompt(sold),
    ]);
    expect(posts.map((post) => post.body)).toEqual([{ confirm: false }, { confirm: true }]);
  });

  it('still asks, and then warns, when the numbers could not be loaded', async () => {
    const { api, posts } = fakeApi(
      throwError(() => new HttpErrorResponse({ status: 502 })),
      [throwError(() => refusal(sold))],
    );
    const confirm = answering(true, false);

    expect(await cancelEventWithConfirmation(api, 7, confirm)).toBe(false);
    expect(confirm).toHaveBeenLastCalledWith(cancellationPrompt(sold));
    expect(posts).toHaveLength(1);
  });

  it('passes any other failure to the caller', async () => {
    const failure = new HttpErrorResponse({ status: 500, error: { error: 'event_cancel_failed' } });
    const { api } = fakeApi(of(sold), [throwError(() => failure)]);

    await expect(cancelEventWithConfirmation(api, 7, answering(true))).rejects.toBe(failure);
  });
});
