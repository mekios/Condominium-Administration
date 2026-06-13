import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';

import { API_BASE } from './api.constants';

type TokenResponse = { access: string; refresh: string };
type RefreshResponse = { access: string; refresh?: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly accessKey = 'access_token';
  private readonly refreshKey = 'refresh_token';
  private readonly rawHttp: HttpClient;
  private refreshInFlight: Observable<string> | null = null;

  constructor(
    private readonly http: HttpClient,
    httpBackend: HttpBackend,
  ) {
    this.rawHttp = new HttpClient(httpBackend);
  }

  login(username: string, password: string): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(`${this.apiBase}/api/token/`, { username, password })
      .pipe(
        tap((tokens) => {
          this.storeTokens(tokens);
        }),
      );
  }

  logout(): void {
    localStorage.removeItem(this.accessKey);
    localStorage.removeItem(this.refreshKey);
    this.refreshInFlight = null;
  }

  getAccessToken(): string | null {
    return localStorage.getItem(this.accessKey);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.refreshKey);
  }

  isAuthenticated(): boolean {
    const access = this.getAccessToken();
    if (access && !this.isAccessTokenExpired(access)) {
      return true;
    }
    return !!this.getRefreshToken();
  }

  isAccessTokenExpired(token: string, skewSeconds = 30): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
      if (!payload.exp) {
        return true;
      }
      return Date.now() >= (payload.exp - skewSeconds) * 1000;
    } catch {
      return true;
    }
  }

  ensureSession(): Observable<boolean> {
    const access = this.getAccessToken();
    if (access && !this.isAccessTokenExpired(access)) {
      return of(true);
    }

    const refresh = this.getRefreshToken();
    if (!refresh) {
      this.logout();
      return of(false);
    }

    return this.refreshAccessToken().pipe(
      map(() => true),
      catchError(() => {
        this.logout();
        return of(false);
      }),
    );
  }

  refreshAccessToken(): Observable<string> {
    const refresh = this.getRefreshToken();
    if (!refresh) {
      return throwError(() => new Error('No refresh token'));
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.rawHttp
        .post<RefreshResponse>(`${this.apiBase}/api/token/refresh/`, { refresh })
        .pipe(
          tap((tokens) => {
            localStorage.setItem(this.accessKey, tokens.access);
            if (tokens.refresh) {
              localStorage.setItem(this.refreshKey, tokens.refresh);
            }
          }),
          map((tokens) => tokens.access),
          finalize(() => {
            this.refreshInFlight = null;
          }),
          shareReplay(1),
        );
    }

    return this.refreshInFlight;
  }

  get apiBase(): string {
    return API_BASE;
  }

  private storeTokens(tokens: TokenResponse): void {
    localStorage.setItem(this.accessKey, tokens.access);
    localStorage.setItem(this.refreshKey, tokens.refresh);
  }
}
