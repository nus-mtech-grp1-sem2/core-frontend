import { Routes } from '@angular/router';

import { roleGuard } from './core/auth-guard';

export const routes: Routes = [
  {
    path: '',
    title: 'OneStage — Live events, concerts and sports tickets',
    loadComponent: () => import('./home/role-home').then((m) => m.RoleHome),
  },
  {
    path: 'events',
    title: 'Events — OneStage',
    loadComponent: () => import('./events/events').then((m) => m.Events),
  },
  {
    path: 'events/:id',
    title: 'Event — OneStage',
    loadComponent: () => import('./events/event-detail/event-detail').then((m) => m.EventDetail),
  },
  {
    path: 'tickets',
    title: 'Tickets — OneStage',
    loadComponent: () => import('./tickets/tickets').then((m) => m.Tickets),
  },
  {
    path: 'login',
    title: 'Sign in — OneStage',
    loadComponent: () => import('./auth/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    redirectTo: 'login',
  },
  {
    path: 'organiser',
    title: 'Organiser workspace — OneStage',
    canActivate: [roleGuard('organiser')],
    loadComponent: () => import('./organiser/organiser').then((m) => m.Organiser),
  },
  {
    path: 'helper',
    title: 'Helper workspace — OneStage',
    canActivate: [roleGuard('event-helper', 'organiser')],
    loadComponent: () => import('./helper/helper-home').then((m) => m.HelperHome),
  },
  {
    path: 'checkin',
    title: 'Door check-in — OneStage',
    canActivate: [roleGuard('event-helper', 'organiser')],
    loadComponent: () => import('./checkin/checkin').then((m) => m.Checkin),
  },
  {
    path: 'confirm',
    redirectTo: 'login',
  },
  {
    path: 'health',
    title: 'Backend health — OneStage',
    loadComponent: () => import('./backend-health/backend-health').then((m) => m.BackendHealth),
  },
  { path: '**', redirectTo: '' },
];
