import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  viewChild,
} from '@angular/core';

import { ConfirmDialogService } from './confirm-dialog.service';

/** The one confirmation dialog for the whole app; ConfirmDialogService decides what it asks. */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
})
export class ConfirmDialog {
  protected readonly confirmDialog = inject(ConfirmDialogService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly decline = viewChild<ElementRef<HTMLButtonElement>>('decline');
  private readonly accept = viewChild<ElementRef<HTMLButtonElement>>('accept');
  /** A positive action swaps the colours: going ahead is green and backing out is red. */
  protected readonly positive = computed(
    () => this.confirmDialog.pending()?.options.tone === 'positive',
  );

  constructor() {
    // After render, so the buttons of a newly asked question exist before focus moves to them.
    afterRenderEffect(() => {
      const dialog = this.dialog().nativeElement;
      const pending = this.confirmDialog.pending();
      const open = pending !== null;
      if (open && !dialog.open) {
        dialog.showModal();
        // The safe choice has focus, so Enter never confirms by accident — unless
        // the question asks for yes as its default.
        const focused =
          pending.options.defaultChoice === 'confirm' ? this.accept() : this.decline();
        focused?.nativeElement.focus();
      } else if (!open && dialog.open) {
        dialog.close();
      }
    });
  }

  protected answer(confirmed: boolean): void {
    this.confirmDialog.answer(confirmed);
  }

  /** Escape closes a modal dialog by itself; that counts as declining. */
  protected dismissed(event: Event): void {
    event.preventDefault();
    this.answer(false);
  }
}
