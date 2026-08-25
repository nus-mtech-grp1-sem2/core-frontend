import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService, HealthResponse } from '../core/api';
import { BackendService } from '../core/api-config';
import { BackendHealth } from './backend-health';

class FakeApi implements Partial<ApiService> {
  down = new Set<BackendService>();

  health(service: BackendService) {
    if (this.down.has(service)) {
      return throwError(() => ({ status: 503 }));
    }
    return of<HealthResponse>({ status: 'ok', service });
  }
}

async function render(api: FakeApi): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [BackendHealth],
    providers: [{ provide: ApiService, useValue: api }],
  });

  const fixture = TestBed.createComponent(BackendHealth);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('BackendHealth', () => {
  it('probes every backend service on load', async () => {
    const host = await render(new FakeApi());
    expect(host.querySelectorAll('li').length).toBe(6);
    expect(host.querySelectorAll('.state.up').length).toBe(6);
  });

  it('reports a service that is unreachable', async () => {
    const api = new FakeApi();
    api.down.add('order');
    const host = await render(api);

    const rows = Array.from(host.querySelectorAll('li'));
    const orderRow = rows.find((li) => li.querySelector('.name')?.textContent === 'order');

    expect(orderRow?.querySelector('.state.down')?.textContent).toContain('HTTP 503');
  });

  it('re-checks every service when the button is pressed', async () => {
    const api = new FakeApi();
    api.down.add('ticket');
    const fixture = TestBed.configureTestingModule({
      imports: [BackendHealth],
      providers: [{ provide: ApiService, useValue: api }],
    }).createComponent(BackendHealth);
    await fixture.whenStable();

    api.down.delete('ticket');
    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();

    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li'));
    const ticketRow = rows.find((li) => li.querySelector('.name')?.textContent === 'ticket');
    expect(ticketRow?.querySelector('.state.up')).not.toBeNull();
  });
});
