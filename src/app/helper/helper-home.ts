import { formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Current event-service response used as the helper's read-only shift list. */
interface HelperEventDto {
  readonly event_id: number;
  readonly title?: string;
  readonly event_name?: string;
  readonly venue: string;
  readonly starts_at?: string;
  readonly event_start_datetime?: string;
  readonly total_seats: number;
}

interface HelperEventsResponse {
  readonly events: readonly HelperEventDto[];
}

interface ShiftView {
  readonly id: number;
  readonly event: string;
  readonly venue: string;
  readonly gate: string;
  readonly date: string;
  readonly doorsOpen: string;
  readonly expected: number;
  readonly today: boolean;
  readonly past: boolean;
}

/**
 * Home page for an event helper: the shift they are working now, the ones
 * coming up, then the ones already worked. Backed by the event service's staffing endpoint — see
 * `backend-repo/API_DESIGN.md` §1 ("Event-helper" / `event_staff`).
 */
@Component({
  selector: 'app-helper-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WorkspaceShell],
  templateUrl: './helper-home.html',
  styleUrl: './helper-home.css',
})
export class HelperHome {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly status = signal<LoadStatus>('loading');
  private readonly shifts = signal<readonly ShiftView[]>([]);

  protected readonly today = computed(() => this.shifts().find((shift) => shift.today) ?? null);
  protected readonly upcoming = computed(() =>
    this.shifts().filter((shift) => !shift.today && !shift.past),
  );
  // The service returns shifts oldest-first; completed ones read best most-recent-first.
  protected readonly completed = computed(() =>
    this.shifts()
      .filter((shift) => !shift.today && shift.past)
      .reverse(),
  );

  protected readonly greeting = computed(() => {
    const email = this.auth.user()?.email ?? '';
    const name = email.split('@')[0];
    return name ? `Welcome, ${name}` : 'Welcome';
  });

  constructor() {
    this.loadShifts();
  }

  protected loadShifts(): void {
    this.status.set('loading');
    const now = new Date();

    this.api.get<HelperEventsResponse>('event', '/helper/shifts').subscribe({
      next: (result) => {
        this.shifts.set(result.events.map((event) => toShiftView(event, now)));
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }
}

function toShiftView(dto: HelperEventDto, now: Date): ShiftView {
  const eventStart = new Date(dto.starts_at ?? dto.event_start_datetime ?? '');
  const doorsOpen = new Date(eventStart.getTime() - 60 * 60 * 1000);

  return {
    id: dto.event_id,
    event: dto.title ?? dto.event_name ?? `Event ${dto.event_id}`,
    venue: dto.venue,
    gate: 'Gate TBC',
    date: formatDate(eventStart, 'EEE d MMM yyyy', 'en-SG'),
    doorsOpen: formatDate(doorsOpen, 'h:mm a', 'en-SG'),
    expected: dto.total_seats,
    today: isSameDay(eventStart, now),
    past: eventStart.getTime() < now.getTime(),
  };
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
