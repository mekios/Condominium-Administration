import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AdminModeService } from './admin-mode.service';
import { AuthService } from './auth.service';
import { AppDataService } from './app-data.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? true : inject(Router).parseUrl('/login');
};

export const adminOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const data = inject(AppDataService);
  const adminMode = inject(AdminModeService);

  if (!auth.isAuthenticated()) {
    return router.parseUrl('/login');
  }

  return data.getMe().pipe(
    map((me) => (adminMode.canManage(me) ? true : router.parseUrl('/app/invoices'))),
    catchError(() => of(router.parseUrl('/app/invoices'))),
  );
};
