import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  readonly title: string;
  /** Each entry is shown as its own paragraph. */
  readonly message: readonly string[];
  /** The action that goes ahead: red for a destructive action, green for a positive one. */
  readonly confirmLabel: string;
  /** The way back out, focused first: green beside a destructive action, red beside a positive one. */
  readonly cancelLabel: string;
  /** Whether going ahead destroys something (the default) or is a positive step such as publishing. */
  readonly tone?: 'destructive' | 'positive';
}

interface PendingConfirm {
  readonly options: ConfirmOptions;
  readonly resolve: (confirmed: boolean) => void;
}

/** Asks the user to confirm an action in the app's own dialog, in place of window.confirm. */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly pendingConfirm = signal<PendingConfirm | null>(null);
  readonly pending = this.pendingConfirm.asReadonly();

  /** Resolves true when the user confirms, false when they decline or dismiss the dialog. */
  ask(options: ConfirmOptions): Promise<boolean> {
    // Only one question is open at a time: a new one declines whatever was still showing.
    this.pendingConfirm()?.resolve(false);
    return new Promise((resolve) => this.pendingConfirm.set({ options, resolve }));
  }

  answer(confirmed: boolean): void {
    const current = this.pendingConfirm();
    if (!current) return;
    this.pendingConfirm.set(null);
    current.resolve(confirmed);
  }
}
