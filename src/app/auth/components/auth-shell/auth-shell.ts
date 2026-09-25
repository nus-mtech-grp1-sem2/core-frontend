import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Two-column frame shared by the login and register pages. */
@Component({
  selector: 'app-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  templateUrl: './auth-shell.html',
  styleUrl: './auth-shell.css',
})
export class AuthShell {
  readonly heading = input.required<string>();
  readonly lead = input.required<string>();
  readonly image = input('images/hero-concert.jpg');
  readonly alt = input('Crowd at a live concert');
  readonly quote = input('Front row seats to the moments worth queueing for.');
}
