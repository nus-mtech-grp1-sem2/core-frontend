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
  templateUrl: './backend-health.html',
  styleUrl: './backend-health.css',
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
