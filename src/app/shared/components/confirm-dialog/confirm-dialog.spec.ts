import { TestBed } from '@angular/core/testing';

import { ConfirmDialog } from './confirm-dialog';
import { ConfirmDialogService, type ConfirmOptions } from './confirm-dialog.service';

const options: ConfirmOptions = {
  title: 'Customers have bought tickets',
  message: [
    '2 customers have already purchased 3 tickets for this event.',
    'Do you still want to cancel this event?',
  ],
  confirmLabel: 'Yes, cancel event',
  cancelLabel: 'No, keep event',
};

describe('ConfirmDialog', () => {
  let service: ConfirmDialogService;
  let host: HTMLElement;

  beforeEach(async () => {
    // jsdom has <dialog> but not its modal methods; browsers do. Stand in with the open attribute.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    await TestBed.configureTestingModule({ imports: [ConfirmDialog] }).compileComponents();
    const fixture = TestBed.createComponent(ConfirmDialog);
    service = TestBed.inject(ConfirmDialogService);
    host = fixture.nativeElement as HTMLElement;
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
  const button = (label: string) =>
    Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('stays closed until something asks', () => {
    expect(dialog().open).toBe(false);
    expect(host.querySelector('button')).toBeNull();
  });

  it('shows the title, each paragraph, a red confirm and a green decline that has focus', async () => {
    void service.ask(options);
    await settle();

    expect(dialog().open).toBe(true);
    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Customers have bought tickets');
    expect(Array.from(host.querySelectorAll('p')).map((p) => p.textContent?.trim())).toEqual(
      options.message,
    );
    expect(button('Yes, cancel event')?.classList).toContain('confirm-dialog__button--confirm');
    expect(button('No, keep event')?.classList).toContain('confirm-dialog__button--decline');
    expect(document.activeElement).toBe(button('No, keep event'));
  });

  it('swaps the colours for a positive action, keeping focus on the way back out', async () => {
    void service.ask({
      ...options,
      confirmLabel: 'Yes, publish',
      cancelLabel: 'No',
      tone: 'positive',
    });
    await settle();

    expect(dialog().classList).toContain('confirm-dialog--positive');
    expect(host.querySelector('.confirm-dialog__icon')?.textContent?.trim()).toBe('?');
    expect(document.activeElement).toBe(button('No'));
  });

  it('keeps the destructive colours by default', async () => {
    void service.ask(options);
    await settle();

    expect(dialog().classList).not.toContain('confirm-dialog--positive');
  });

  it('resolves true on Yes, and closes', async () => {
    const answer = service.ask(options);
    await settle();

    button('Yes, cancel event')?.click();

    expect(await answer).toBe(true);
    await settle();
    expect(dialog().open).toBe(false);
  });

  it('resolves false on No', async () => {
    const answer = service.ask(options);
    await settle();

    button('No, keep event')?.click();

    expect(await answer).toBe(false);
  });

  it('treats Escape as No', async () => {
    const answer = service.ask(options);
    await settle();

    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(await answer).toBe(false);
  });

  it('declines a question still open when a new one is asked', async () => {
    const first = service.ask(options);
    const second = service.ask({ ...options, title: 'Second' });
    await settle();

    expect(await first).toBe(false);
    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Second');
    button('Yes, cancel event')?.click();
    expect(await second).toBe(true);
  });
});
