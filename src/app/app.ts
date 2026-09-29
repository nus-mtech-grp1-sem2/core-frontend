import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Footer } from './layout/components/footer/footer';
import { Header } from './layout/components/header/header';
import { ConfirmDialog } from './shared/components/confirm-dialog/confirm-dialog';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Header, Footer, ConfirmDialog],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
