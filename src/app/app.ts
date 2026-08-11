import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { BackendHealth } from './backend-health/backend-health';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BackendHealth],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('core-frontend');
}
