import { Component, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AppDataService, Me } from '../core/app-data.service';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  selector: 'app-admin-shell',
  imports: [NgIf, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span class="brand-ring">
              <svg viewBox="0 0 24 24" class="brand-icon">
                <path d="M4 21V6l8-3 8 3v15M9 21v-4h6v4M8 9h0M12 9h0M16 9h0M8 13h0M12 13h0M16 13h0" />
              </svg>
            </span>
          </div>
          <div class="brand-meta">
            <h2>ΕΦΑΡΜΟΓΗ ΔΙΑΧΕΙΡΙΣΗΣ</h2>
            <p>ΜΕΤΑΜΟΡΦΩΣΕΩΣ 5</p>
          </div>
        </div>
        <nav>
          <a routerLink="/app/invoices" routerLinkActive="active">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 1v4h4" />
            </svg>
            <span>Λογαριασμοί</span>
          </a>
          <a routerLink="/app/expenses" routerLinkActive="active">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h4" />
            </svg>
            <span>Έξοδα</span>
          </a>
          <a routerLink="/app/measurements" routerLinkActive="active">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 16.5 16.5 3 21 7.5 7.5 21H3v-4.5ZM11 7l6 6" />
            </svg>
            <span>Μετρήσεις</span>
          </a>
          <a routerLink="/app/dashboard" routerLinkActive="active">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19V5m0 14h16M9 16V9m5 7V7m5 9v-4" />
            </svg>
            <span>Πίνακας ελέγχου</span>
          </a>
        </nav>

        <a class="profile-link" routerLink="/app/profile" routerLinkActive="active">
          <div class="avatar" *ngIf="me">{{ getInitials(me.username) }}</div>
          <div class="profile-meta">
            <strong>{{ me?.username || 'Χρήστης' }}</strong>
            <span>{{ me?.role || '' }}</span>
          </div>
        </a>
      </aside>

      <section class="content">
        <header class="topbar">
          <div>
            <h1>Διαχείριση Πολυκατοικίας</h1>
            <p *ngIf="me">Χρήστης: {{ me.username }} ({{ me.role }})</p>
          </div>
          <button class="btn btn-ghost" (click)="logout()">Αποσύνδεση</button>
        </header>
        <router-outlet />
      </section>
    </main>
  `,
  styles: `
    .layout {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 250px 1fr;
      background: #0a0f1f;
      color: #e9efff;
    }
    .sidebar {
      border-right: 1px solid #1f2b4b;
      background: #0e1427;
      padding: 1rem;
    }
    .brand {
      margin: 0 0 1rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      border-radius: 14px;
      padding: 0.62rem 0.68rem;
      background: linear-gradient(135deg, rgba(71, 103, 177, 0.18), rgba(117, 77, 163, 0.16));
      backdrop-filter: blur(8px);
    }
    .brand-mark {
      position: relative;
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 999px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .brand-ring {
      width: 100%;
      height: 100%;
      border-radius: inherit;
      display: grid;
      place-items: center;
      background: linear-gradient(140deg, #6082ff, #8c61ff 58%, #5ec2ff);
      box-shadow: 0 10px 22px rgba(88, 86, 193, 0.4);
    }
    .brand-icon {
      width: 1.2rem;
      height: 1.2rem;
      fill: none;
      stroke: #f6f8ff;
      stroke-width: 1.65;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .brand-meta {
      min-width: 0;
    }
    .brand-meta h2 {
      margin: 0;
      font-size: 0.72rem;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      line-height: 1.15;
      color: #eff4ff;
      font-weight: 700;
      font-family: "Roboto Condensed", "Roboto", Arial, sans-serif;
    }
    .brand-meta p {
      margin: 0.14rem 0 0;
      color: #aabce6;
      font-size: 0.66rem;
      letter-spacing: 0.08em;
      font-family: "Roboto Condensed", "Roboto", Arial, sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    nav {
      display: grid;
      gap: 0.45rem;
    }
    nav a {
      color: #a9bde9;
      border: 1px solid transparent;
      border-radius: 10px;
      text-decoration: none;
      padding: 0.55rem 0.65rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    nav a:hover {
      border-color: #2a3962;
      background: #111b36;
      color: #fff;
    }
    nav a.active {
      background: #17264a;
      border-color: #30457d;
      color: #fff;
    }
    .profile-link {
      margin-top: 1rem;
      border: 1px solid #324a7f;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(92, 117, 255, 0.2), rgba(152, 98, 255, 0.2));
      padding: 0.62rem;
      display: flex;
      align-items: center;
      gap: 0.58rem;
      text-decoration: none;
      color: #e8f0ff;
    }
    .profile-link.active {
      border-color: #6d80dd;
      box-shadow: 0 10px 20px rgba(91, 81, 184, 0.25);
    }
    .avatar {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      display: grid;
      place-items: center;
      font-size: 0.84rem;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #6281ff, #9a62ff);
      border: 1px solid rgba(255, 255, 255, 0.2);
      flex-shrink: 0;
    }
    .profile-meta {
      min-width: 0;
      display: grid;
      gap: 0.1rem;
    }
    .profile-meta strong {
      font-size: 0.86rem;
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .profile-meta span {
      color: #bacef7;
      font-size: 0.74rem;
      text-transform: capitalize;
      line-height: 1.1;
    }
    .icon {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .content {
      padding: 1rem;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0;
      font-size: 1.3rem;
    }
    p {
      margin: 0.2rem 0 0;
      color: #9db1e2;
      font-size: 0.9rem;
    }
    .btn {
      border: 0;
      border-radius: 10px;
      padding: 0.6rem 0.95rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-ghost {
      border: 1px solid #2c3e70;
      background: #0d1632;
    }
    .btn-ghost:hover {
      background: #13214a;
    }
    @media (max-width: 1023px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid #1f2b4b;
      }
      nav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
})
export class AdminShellComponent implements OnInit {
  me: Me | null = null;

  constructor(
    private readonly data: AppDataService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.data.getMe().subscribe({
      next: (me) => {
        this.me = me;
      },
      error: () => {
        this.logout();
      },
    });
    // Warm the apartment cache but do not block shell rendering.
    this.data.getApartments().subscribe({ error: () => {} });
  }

  logout(): void {
    this.data.clearCache();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  getInitials(username: string): string {
    const clean = (username || '').trim();
    if (!clean) return '??';
    const chunks = clean.split(/[\s._-]+/).filter(Boolean);
    if (chunks.length === 1) {
      return clean.slice(0, 2).toUpperCase();
    }
    return (chunks[0][0] + chunks[1][0]).toUpperCase();
  }

}
