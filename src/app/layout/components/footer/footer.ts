import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Site footer with brand and contact details. */
@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './footer.html',
  styleUrl: './footer.css',
})
export class Footer {}
