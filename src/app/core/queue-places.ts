import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, map, timer } from 'rxjs';

import { ApiService } from './api';
import { AuthService } from './auth';
import { QueueService } from './queue';

interface QueuePlace {
  readonly eventId: number;
  readonly title: string;
  readonly admitted: boolean;
  readonly position: number | undefined;
  readonly countdown: string;
  readonly link: (string | number)[];
}

/** Started once by App; routed pages render the same retained queue state. */
@Injectable({ providedIn: 'root' })
export class QueuePlacesService {
  private readonly queue = inject(QueueService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly browser = inject(DOCUMENT).defaultView;
  private readonly now = signal(Date.now());
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  private readonly titles = signal<ReadonlyMap<number, string>>(new Map());
  private readonly requestedTitles = new Set<number>();
  private readonly polling = new Set<number>();
  private readonly restoring = signal<ReadonlySet<number>>(new Set());
  private account: string | null = null;
  private started = false;
  private lastSaved = '';
  readonly places = signal<readonly QueuePlace[]>([]);
  readonly releasing = signal<ReadonlySet<number>>(new Set());
  readonly errors = signal<ReadonlyMap<number, string>>(new Map());

  private readonly visiblePlaces = computed<readonly QueuePlace[]>(() => {
    if (!this.auth.isAuthenticated()) return [];
    const path = this.url().split(/[?#]/)[0];
    if (!/^\/(?:events|my-events)?\/?$/.test(path)) return [];
    const now = this.now();
    return this.queue.activePlaces().flatMap(({ eventId, entry }) => {
      const admitted = entry.status === 'ADMITTED';
      const expiresAt = Date.parse(entry.tokenExpiresAt ?? '');
      if (admitted && (!entry.admissionToken || !Number.isFinite(expiresAt) || expiresAt <= now))
        return [];
      const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
      return [
        {
          eventId,
          title: this.titles().get(eventId) ?? `Event #${eventId}`,
          admitted,
          position: entry.position,
          countdown: admitted
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : '',
          link: ['/events', eventId, admitted ? 'tickets' : 'queue'],
        },
      ];
    });
  });

  /** Called from the root injection context, never restarted by page navigation. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.account = this.auth.user()?.sub ?? null;
    this.restorePlaces();
    effect(() => {
      const account = this.auth.user()?.sub ?? null;
      if (account !== this.account) {
        this.forgetSavedPlaces();
        this.account = account;
        this.queue.clearAll();
        this.titles.set(new Map());
        this.requestedTitles.clear();
        this.releasing.set(new Set());
        this.errors.set(new Map());
        this.restoring.set(new Set());
        this.lastSaved = '';
        untracked(() => this.restorePlaces());
      }
    });
    effect(() => {
      const account = this.auth.user()?.sub;
      const ids = new Set([
        ...this.restoring(),
        ...this.queue.activePlaces().map((place) => place.eventId),
      ]);
      if (!account || account !== this.account) return;
      const saved = JSON.stringify([...ids]);
      if (saved === this.lastSaved) return;
      this.lastSaved = saved;
      try {
        if (ids.size) this.browser?.sessionStorage.setItem(this.storageKey(account), saved);
        else this.browser?.sessionStorage.removeItem(this.storageKey(account));
      } catch {
        // Queue navigation still works when browser storage is unavailable.
      }
    });
    effect(() => {
      const places = this.visiblePlaces();
      this.places.set(places);
      untracked(() => {
        for (const place of places) void this.loadTitle(place.eventId);
      });
    });
    timer(1000, 1000)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((tick) => {
        this.now.set(Date.now());
        if (tick % 5 === 0) {
          const ids = new Set([
            ...this.restoring(),
            ...this.visiblePlaces().map((place) => place.eventId),
          ]);
          for (const eventId of ids) void this.refresh(eventId);
        }
      });
  }

  async release(eventId: number): Promise<void> {
    if (this.releasing().has(eventId)) return;
    const account = this.account;
    this.releasing.update((current) => new Set(current).add(eventId));
    this.errors.update((current) => {
      const next = new Map(current);
      next.delete(eventId);
      return next;
    });
    try {
      await this.queue.leave(eventId);
    } catch {
      if (account === this.account) {
        this.errors.update((current) =>
          new Map(current).set(eventId, 'Could not release your place. Please try again.'),
        );
      }
    } finally {
      if (account === this.account) {
        this.releasing.update((current) => {
          const next = new Set(current);
          next.delete(eventId);
          return next;
        });
      }
    }
  }

  /** Clear this account's local reminders before Cognito redirects away to sign out. */
  forgetLocalPlaces(): void {
    this.forgetSavedPlaces();
    this.queue.clearAll();
    this.restoring.set(new Set());
    this.places.set([]);
    this.lastSaved = '[]';
  }

  private async loadTitle(eventId: number): Promise<void> {
    if (this.requestedTitles.has(eventId)) return;
    this.requestedTitles.add(eventId);
    const account = this.account;
    try {
      const response = await firstValueFrom(
        this.api.get<{ event: { title: string } }>('event', `/events/${eventId}`),
      );
      if (account === this.account)
        this.titles.update((current) => new Map(current).set(eventId, response.event.title));
    } catch {
      // The fallback event ID keeps the return and release controls usable.
    }
  }

  private async refresh(eventId: number): Promise<void> {
    if (this.polling.has(eventId) || this.releasing().has(eventId)) return;
    this.polling.add(eventId);
    const account = this.account;
    try {
      await this.queue.status(eventId);
      if (account === this.account) this.finishRestore(eventId);
    } catch (error) {
      if (account === this.account && error instanceof HttpErrorResponse && error.status === 404) {
        this.queue.clear(eventId);
        this.finishRestore(eventId);
      }
      // Temporary network failures do not discard a retained place or reset its timer.
    } finally {
      this.polling.delete(eventId);
    }
  }

  private storageKey(account: string): string {
    return `onestage:queue-places:${encodeURIComponent(account)}`;
  }

  private restorePlaces(): void {
    if (!this.account) return;
    try {
      const saved: unknown = JSON.parse(
        this.browser?.sessionStorage.getItem(this.storageKey(this.account)) ?? '[]',
      );
      if (!Array.isArray(saved)) return;
      const ids = new Set<number>(
        saved.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, 100),
      );
      this.restoring.set(ids);
      for (const eventId of ids) void this.refresh(eventId);
    } catch {
      // Ignore invalid or unavailable storage; never restore admission tokens from it.
    }
  }

  private finishRestore(eventId: number): void {
    if (!this.restoring().has(eventId)) return;
    this.restoring.update((current) => {
      const next = new Set(current);
      next.delete(eventId);
      return next;
    });
  }

  private forgetSavedPlaces(): void {
    if (!this.account) return;
    try {
      this.browser?.sessionStorage.removeItem(this.storageKey(this.account));
    } catch {
      // No persisted state to clear when storage is blocked.
    }
  }
}
