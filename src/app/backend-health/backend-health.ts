import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { ApiService } from '../core/api';
import { BackendService } from '../core/api-config';

type ProbeState = 'checking' | 'up' | 'down';

interface Probe {
  readonly service: BackendService;
  readonly state: ProbeState;
  readonly detail: string;
}

const SERVICES: readonly BackendService[] = [
  'event',
  'inventory',
  'queue',
  'order',
  'ticket',
  'notification',
];

/** Calls `/health` on every backend service to confirm the wiring works. */
@Component({
  selector: 'app-backend-health',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2>Backend connectivity</h2>
      <button type="button" (click)="check()">Re-check</button>
      <ul aria-live="polite">
        @for (probe of probes(); track probe.service) {
          <li>
            <span class="name">{{ probe.service }}</span>
            <span
              class="state"
              [class.up]="probe.state === 'up'"
              [class.down]="probe.state === 'down'"
            >
              {{ probe.detail }}
            </span>
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    .panel {
      max-width: 32rem;
      margin: 1rem auto;
      padding: 1rem;
      border: 1px solid #767676;
      border-radius: 0.5rem;
      font-family: system-ui, sans-serif;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.125rem;
    }
    ul {
      list-style: none;
      margin: 0.75rem 0 0;
      padding: 0;
    }
    li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.25rem 0;
    }
    .name {
      font-weight: 600;
    }
    .state.up {
      color: #1a7f37;
    }
    .state.down {
      color: #b3261e;
    }
  `,
})
export class BackendHealth {
  private readonly api = inject(ApiService);

  protected readonly probes = signal<readonly Probe[]>(
    SERVICES.map((service) => ({ service, state: 'checking' as const, detail: 'checking…' })),
  );

  constructor() {
    this.check();
  }

  protected check(): void {
    this.probes.set(
      SERVICES.map((service) => ({ service, state: 'checking' as const, detail: 'checking…' })),
    );

    for (const service of SERVICES) {
      this.api.health(service).subscribe({
        next: (res) => this.update(service, 'up', `${res.status} (${res.service})`),
        error: (err: unknown) => this.update(service, 'down', describeError(err)),
      });
    }
  }

  private update(service: BackendService, state: ProbeState, detail: string): void {
    this.probes.update((probes) =>
      probes.map((probe) => (probe.service === service ? { service, state, detail } : probe)),
    );
  }
}

function describeError(err: unknown): string {
  const status = (err as { status?: number }).status;
  return status ? `unreachable (HTTP ${status})` : 'unreachable';
}
