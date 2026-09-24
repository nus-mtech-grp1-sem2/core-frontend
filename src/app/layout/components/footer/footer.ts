import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Site footer. Link targets are placeholders until those pages exist. */
@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrl: './footer.css',
})
export class Footer {
  protected readonly columns = [
    {
      title: 'Discover',
      items: [
        { label: 'Concerts', path: '/events' },
        { label: 'Sports', path: '/events' },
        { label: 'Theatre', path: '/events' },
        { label: 'All tickets', path: '/events' },
      ],
    },
    {
      title: 'Account',
      items: [
        { label: 'Sign in', path: '/login' },
        { label: 'Create an account', path: '/register' },
        { label: 'Order status', path: null },
        { label: 'Refunds', path: null },
      ],
    },
    {
      title: 'Company',
      items: [
        { label: 'About', path: null },
        { label: 'Careers', path: null },
        { label: 'Partners', path: null },
        { label: 'Press', path: null },
      ],
    },
  ] as const;
}
