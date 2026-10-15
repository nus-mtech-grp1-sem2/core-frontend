import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { QueueService } from './queue';

/** Ticket selection is available only after the server grants queue admission. */
export const queueAdmissionGuard: CanActivateFn = async (route) => {
  const queue = inject(QueueService);
  const router = inject(Router);
  const eventId = Number(route.paramMap.get('id'));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return router.createUrlTree(['/events']);

  try {
    const status = await queue.status(eventId);
    if (status.status === 'IN_CHECKOUT') return router.createUrlTree(['/my-events']);
    if (
      status.status === 'ADMITTED' &&
      status.admissionToken &&
      Date.parse(status.tokenExpiresAt ?? '') > Date.now()
    ) {
      return true;
    }
  } catch {
    // The queue page owns missing entries and connection-error recovery.
  }
  return router.createUrlTree(['/events', eventId, 'queue']);
};
