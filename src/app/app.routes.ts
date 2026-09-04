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
    data: { workspace: 'customer' },
    loadComponent: () => import('./events/events').then((m) => m.Events),
  },
  {
    path: 'events/:id',
    title: 'Event — OneStage',
    data: { workspace: 'customer' },
    loadComponent: () => import('./events/event-detail/event-detail').then((m) => m.EventDetail),
  },
  {
    path: 'tickets',
    redirectTo: 'events',
  },
  {
    path: 'events/:id/queue',
    title: 'Waiting room — OneStage',
    canActivate: [authGuard],
    loadComponent: () => import('./events/event-queue/event-queue').then((m) => m.EventQueue),
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
    path: 'organiser/events',
    title: 'Manage events — OneStage',
    canActivate: [authGuard],
    data: { workspace: 'organiser' },
    loadComponent: () => import('./events/events').then((m) => m.Events),
  },
  {
    path: 'organiser/events/:id',
    title: 'Manage event — OneStage',
    canActivate: [authGuard],
    data: { workspace: 'organiser' },
    loadComponent: () => import('./events/event-detail/event-detail').then((m) => m.EventDetail),
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
    redirectTo: 'login',
  },
  {
    path: 'health',
    title: 'Backend health — OneStage',
    loadComponent: () => import('./backend-health/backend-health').then((m) => m.BackendHealth),
  },
  { path: '**', redirectTo: '' },
];
