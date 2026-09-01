import { Routes } from '@angular/router';

import { authGuard } from './core/auth-guard';

export const routes: Routes = [
  {
    path: '',
    title: 'OneStage — Live events, concerts and sports tickets',
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    path: 'events',
    title: 'Events — OneStage',
    loadComponent: () => import('./events/events').then((m) => m.Events),
  },
  {
    path: 'events/:id',
    title: 'Event — OneStage',
    loadComponent: () =>
      import('./events/event-detail/event-detail').then((m) => m.EventDetail),
  },
  {
    path: 'tickets',
    title: 'Tickets — OneStage',
    loadComponent: () => import('./tickets/tickets').then((m) => m.Tickets),
  },
  {
    path: 'my-events',
    title: 'My events — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./my-events/my-events').then((m) => m.MyEvents),
  },
  {
    path: 'login',
    title: 'Sign in — OneStage',
    loadComponent: () => import('./auth/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    title: 'Create an account — OneStage',
    loadComponent: () => import('./auth/register/register').then((m) => m.Register),
  },
  {
    path: 'organiser',
    title: 'Organiser workspace — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./organiser/organiser').then((m) => m.Organiser),
  },
  {
    path: 'organiser/create',
    title: 'Create event — OneStage',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./organiser/create-event/create-event').then((m) => m.CreateEvent),
  },
  {
    path: 'organiser/sales',
    title: 'Sales — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./organiser/sales/sales').then((m) => m.Sales),
  },
  {
    path: 'organiser/attendees',
    title: 'Attendees — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./organiser/attendees/attendees').then((m) => m.Attendees),
  },
  {
    path: 'organiser/events/:id/edit',
    title: 'Update event — OneStage',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./organiser/update-event/update-event').then((m) => m.UpdateEvent),
  },
  {
    path: 'organiser/events/:id/team',
    title: 'Event team — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./organiser/event-team/event-team').then((m) => m.EventTeam),
  },
  {
    path: 'helper',
    title: 'Helper workspace — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./helper/helper-home').then((m) => m.HelperHome),
  },
  {
    path: 'checkin',
    title: 'Door check-in — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./checkin/checkin').then((m) => m.Checkin),
  },
  {
    path: 'confirm',
    title: 'Confirm your email — OneStage',
    loadComponent: () => import('./auth/confirm/confirm').then((m) => m.Confirm),
  },
  {
    path: 'health',
    title: 'Backend health — OneStage',
    loadComponent: () => import('./backend-health/backend-health').then((m) => m.BackendHealth),
  },
  { path: '**', redirectTo: '' },
];
