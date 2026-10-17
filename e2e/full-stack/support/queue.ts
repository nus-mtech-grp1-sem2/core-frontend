import { expect, type APIRequestContext } from '@playwright/test';

import { accessToken } from './auth';
import type { Role } from './users';

// Every purchase goes through the event's queue: the first customer to join creates it (admitting
// as many buyers at a time as the event's available buyers, at most once every 60 seconds), and an
// order needs a live admission token. The local stack runs with automatic admission off, so these
// helpers admit customers the way an organiser can through the API.

export interface QueueStatus {
  readonly status: 'WAITING' | 'ADMITTED' | 'IN_CHECKOUT' | 'EXPIRED' | 'LEFT';
  readonly position?: number;
  readonly admissionToken?: string;
}

const as = (role: Role) => ({ Authorization: `Bearer ${accessToken(role)}` });

/** Joins the event's queue as `role` (joining again keeps the same place). */
export async function joinQueue(
  request: APIRequestContext,
  role: Role,
  eventId: number,
): Promise<QueueStatus> {
  const joined = await request.post(`/api/queue/events/${eventId}/queue/join`, {
    headers: as(role),
    data: {},
  });
  expect(joined.ok(), `queue join (${role}) -> ${joined.status()} ${await joined.text()}`).toBe(
    true,
  );
  return (await joined.json()) as QueueStatus;
}

/** The queue entry of `role` for the event. */
export async function queueStatus(
  request: APIRequestContext,
  role: Role,
  eventId: number,
): Promise<QueueStatus> {
  const me = await request.get(`/api/queue/events/${eventId}/queue/me`, { headers: as(role) });
  expect(me.ok(), `queue status (${role}) -> ${me.status()} ${await me.text()}`).toBe(true);
  return (await me.json()) as QueueStatus;
}

/** The event's queue as customers see it. */
export async function queueSummary(
  request: APIRequestContext,
  eventId: number,
): Promise<{ readonly waitingCount: number; readonly admissionIntervalSec: number }> {
  const summary = await request.get(`/api/queue/events/${eventId}/queue`, {
    headers: as('customer'),
  });
  expect(summary.ok(), `queue summary -> ${summary.status()} ${await summary.text()}`).toBe(true);
  return (
    (await summary.json()) as { queue: { waitingCount: number; admissionIntervalSec: number } }
  ).queue;
}

/** The organiser admits the next batch of waiting customers. */
export async function admitNext(
  request: APIRequestContext,
  eventId: number,
): Promise<{ readonly admitted: number; readonly remaining: number | null }> {
  const admitted = await request.post(`/api/queue/events/${eventId}/queue/admit-next`, {
    headers: as('organiser'),
    data: {},
  });
  expect(admitted.ok(), `admit-next -> ${admitted.status()} ${await admitted.text()}`).toBe(true);
  return (await admitted.json()) as { admitted: number; remaining: number | null };
}

/**
 * Admits all of `roles` together: each joins the queue, then the organiser admits the next batch
 * (retrying while the queue's admission interval has not passed). Returns their admission tokens.
 * The event's available buyers must be at least `roles.length`.
 */
export async function admit(
  request: APIRequestContext,
  eventId: number,
  roles: readonly Role[],
): Promise<Record<Role, string>> {
  for (const role of roles) await joinQueue(request, role, eventId);

  const tokens: Partial<Record<Role, string>> = {};
  await expect(async () => {
    const statuses = await Promise.all(roles.map((role) => queueStatus(request, role, eventId)));
    if (statuses.some((status) => status.status !== 'ADMITTED')) {
      const admitted = await request.post(`/api/queue/events/${eventId}/queue/admit-next`, {
        headers: as('organiser'),
        data: {},
      });
      // 429 means the last admission was too recent; the next attempt tries again.
      expect([200, 429], `admit-next -> ${admitted.status()}`).toContain(admitted.status());
    }
    for (const role of roles) {
      const status = await queueStatus(request, role, eventId);
      expect(status.status, `${role} admitted`).toBe('ADMITTED');
      tokens[role] = status.admissionToken;
    }
  }).toPass({ intervals: [1_000], timeout: 90_000 });
  return tokens as Record<Role, string>;
}

/**
 * Lets the organiser admit again a second after the last admission instead of after 60 seconds,
 * for specs that admit several customers to one event at different times.
 */
export async function shortenAdmissionInterval(
  request: APIRequestContext,
  eventId: number,
): Promise<void> {
  const configured = await request.put(`/api/queue/events/${eventId}/queue/config`, {
    headers: as('organiser'),
    data: {
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      admissionBatchSize: 1, // ignored: the batch is the event's available buyers
      admissionIntervalSec: 1,
    },
  });
  expect(
    configured.ok(),
    `queue config PUT -> ${configured.status()} ${await configured.text()}`,
  ).toBe(true);
}
