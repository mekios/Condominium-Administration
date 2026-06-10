import { Routes } from '@angular/router';
import { adminOnlyGuard, authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-shell.component').then((m) => m.AdminShellComponent),
    children: [
      {
        path: 'invoices',
        loadComponent: () => import('./features/invoices.component').then((m) => m.InvoicesComponent),
      },
      {
        path: 'expenses',
        loadComponent: () => import('./features/expenses.component').then((m) => m.ExpensesComponent),
      },
      {
        path: 'expenses/new',
        canActivate: [adminOnlyGuard],
        loadComponent: () => import('./features/expense-edit.component').then((m) => m.ExpenseEditComponent),
      },
      {
        path: 'expenses/:id',
        canActivate: [adminOnlyGuard],
        loadComponent: () => import('./features/expense-edit.component').then((m) => m.ExpenseEditComponent),
      },
      {
        path: 'measurements',
        loadComponent: () => import('./features/measurements.component').then((m) => m.MeasurementsComponent),
      },
      {
        path: 'payments',
        loadComponent: () => import('./features/payments.component').then((m) => m.PaymentsComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'analysis',
        loadComponent: () => import('./features/analysis.component').then((m) => m.AnalysisComponent),
      },
      {
        path: 'voting',
        loadComponent: () => import('./features/voting.component').then((m) => m.VotingComponent),
      },
      {
        path: 'voting/:id',
        loadComponent: () => import('./features/voting-detail.component').then((m) => m.VotingDetailComponent),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile.component').then((m) => m.ProfileComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: 'dashboard', pathMatch: 'full', redirectTo: 'app/dashboard' },
  { path: '', pathMatch: 'full', redirectTo: 'app/dashboard' },
];
