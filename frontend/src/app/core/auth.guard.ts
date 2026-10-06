import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminModeService } from './admin-mode.service';
import { AuthService } from './auth.service';
import { AppDataService } from './app-data.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.ensureSession().pipe(
    map((valid) => (valid ? true : router.parseUrl('/login'))),
  );
};

export const passwordChangeGuard: CanActivateFn = () => {
  const data = inject(AppDataService);
  const router = inject(Router);

  return data.getMe().pipe(
    map((me) => (me.must_change_password ? router.parseUrl('/set-password') : true)),
    catchError(() => of(router.parseUrl('/login'))),
  );
};

export const setPasswordPageGuard: CanActivateFn = () => {
  const data = inject(AppDataService);
  const router = inject(Router);

  return data.getMe().pipe(
    map((me) => (me.must_change_password ? true : router.parseUrl('/app/dashboard'))),
    catchError(() => of(router.parseUrl('/login'))),
  );
};

export const adminOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const data = inject(AppDataService);
  const adminMode = inject(AdminModeService);

  return auth.ensureSession().pipe(
    switchMap((valid) => {
      if (!valid) {
        return of(router.parseUrl('/login'));
      }

      return data.getMe().pipe(
        map((me) => (adminMode.canManage(me) ? true : router.parseUrl('/app/invoices'))),
        catchError((err) => {
          if (err?.status === 401 || err?.status === 403) {
            auth.logout();
            return of(router.parseUrl('/login'));
          }
          return of(router.parseUrl('/app/invoices'));
        }),
      );
    }),
  );
};
