import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { AdminModeService } from './admin-mode.service';
import { AppDataService } from './app-data.service';
import { AuthService } from './auth.service';

function withAuthHeader(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

function isPublicAuthRequest(req: HttpRequest<unknown>): boolean {
  return req.url.includes('/api/token/') || req.url.includes('/api/auth/');
}

function endSession(): void {
  inject(AdminModeService).exit();
  inject(AppDataService).clearCache();
  inject(AuthService).logout();
  void inject(Router).navigateByUrl('/login');
}

function retryWithRefresh(req: HttpRequest<unknown>, next: HttpHandlerFn, auth: AuthService) {
  return auth.refreshAccessToken().pipe(
    switchMap((newToken) => next(withAuthHeader(req, newToken))),
    catchError((refreshError) => {
      endSession();
      return throwError(() => refreshError);
    }),
  );
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (isPublicAuthRequest(req)) {
    return next(req);
  }

  const access = auth.getAccessToken();
  const hasValidAccess = access && !auth.isAccessTokenExpired(access);

  if (hasValidAccess) {
    return next(withAuthHeader(req, access)).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401 && auth.getRefreshToken()) {
          return retryWithRefresh(req, next, auth);
        }
        return throwError(() => error);
      }),
    );
  }

  if (auth.getRefreshToken()) {
    return retryWithRefresh(req, next, auth);
  }

  return next(req);
};
