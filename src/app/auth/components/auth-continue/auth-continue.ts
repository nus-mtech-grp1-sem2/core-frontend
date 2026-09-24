import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-auth-continue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-continue.html',
  styleUrl: './auth-continue.css',
})
export class AuthContinue {
  readonly destination = input.required<string>();
  readonly label = input.required<string>();
  readonly busy = input(false);
  readonly error = input('');
  readonly proceed = output<void>();
}
