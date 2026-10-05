import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiService } from '../core/api';
import type { ConfirmOptions } from '../shared/components/confirm-dialog/confirm-dialog.service';

/** The confirmation shown before deleting a draft event. */
export const DELETE_DRAFT_PROMPT: ConfirmOptions = {
  title: 'Delete this draft event?',
  message: ['This cannot be undone.'],
  confirmLabel: 'Yes, delete draft',
  cancelLabel: 'No, keep draft',
};

/** Who a cancellation would affect: customers with paid orders, and the tickets they bought. */
export interface CancellationImpact {
  readonly customers: number;
  readonly ticketsSold: number;
}

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

/** The confirmation shown before cancelling; it warns about customers once anyone has bought tickets. */
export function cancellationPrompt(impact: CancellationImpact | null): ConfirmOptions {
  const labels = { confirmLabel: 'Yes, cancel event', cancelLabel: 'No, keep event' };
  if (!impact || impact.ticketsSold <= 0) {
    return {
      title: 'Cancel this event?',
      message: ['The event will be taken off sale.'],
      ...labels,
    };
  }
  return {
    title: 'Customers have bought tickets',
    message: [
      `${count(impact.customers, 'customer')} ${impact.customers === 1 ? 'has' : 'have'} already purchased ${count(impact.ticketsSold, 'ticket')} for this event.`,
      'Cancelling will void their tickets and email them that the event is cancelled and their payment will be refunded.',
      'Do you still want to cancel this event?',
    ],
    ...labels,
  };
}

/** The up-to-date numbers from a cancel refused for want of confirmation, or null for any other failure. */
function confirmationRequired(error: unknown): CancellationImpact | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const body = error.error as { error?: string; customers?: number; ticketsSold?: number } | null;
  if (body?.error !== 'cancellation_confirmation_required') return null;
  return { customers: Number(body.customers ?? 0), ticketsSold: Number(body.ticketsSold ?? 0) };
}

/**
 * Asks the organiser to confirm, then cancels the event. Resolves false when they
 * back out, and rejects when the cancel itself fails. If tickets were bought after
 * the prompt was shown (or the numbers could not be loaded), the service refuses
 * the cancel and the organiser is asked again with the real numbers.
 */
export async function cancelEventWithConfirmation(
  api: ApiService,
  eventId: number,
  confirm: (options: ConfirmOptions) => Promise<boolean>,
): Promise<boolean> {
  const impact = await firstValueFrom(
    api.get<CancellationImpact>('event', `/events/${eventId}/cancellation-impact`),
  ).catch(() => null);
  if (!(await confirm(cancellationPrompt(impact)))) return false;
  try {
    await firstValueFrom(
      api.post('event', `/events/${eventId}/cancel`, { confirm: (impact?.ticketsSold ?? 0) > 0 }),
    );
  } catch (error) {
    const latest = confirmationRequired(error);
    if (!latest) throw error;
    if (!(await confirm(cancellationPrompt(latest)))) return false;
    await firstValueFrom(api.post('event', `/events/${eventId}/cancel`, { confirm: true }));
  }
  return true;
}
