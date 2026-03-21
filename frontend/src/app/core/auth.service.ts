import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { API_BASE } from './api.constants';

type TokenResponse = { access: string; refresh: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly accessKey = 'access_token';
  private readonly refreshKey = 'refresh_token';

  constructor(private readonly http: HttpClient) {}

  login(username: string, password: string): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(`${this.apiBase}/api/token/`, { username, password })
      .pipe(
        tap((tokens) => {
          localStorage.setItem(this.accessKey, tokens.access);
          localStorage.setItem(this.refreshKey, tokens.refresh);
        }),
      );
  }

  logout(): void {
    localStorage.removeItem(this.accessKey);
    localStorage.removeItem(this.refreshKey);
  }

  getAccessToken(): string | null {
    return localStorage.getItem(this.accessKey);
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  get apiBase(): string {
    return API_BASE;
  }
}
