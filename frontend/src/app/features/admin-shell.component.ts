import { Component, OnDestroy, OnInit } from '@angular/core';
import { AsyncPipe, NgIf } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Observable } from 'rxjs';

import { AdminModeService } from '../core/admin-mode.service';
import { AppDataService, Me } from '../core/app-data.service';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  selector: 'app-admin-shell',
  imports: [NgIf, AsyncPipe, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="layout" [class.sidebar-collapsed]="sidebarCollapsed && !isTabletMobile">
      <div class="sidebar-backdrop" *ngIf="isTabletMobile && mobileMenuOpen" (click)="closeMobileMenu()"></div>
      <aside class="sidebar" [class.collapsed]="sidebarCollapsed && !isTabletMobile" [class.open]="isTabletMobile && mobileMenuOpen">
        <button
          *ngIf="!isTabletMobile"
          class="sidebar-tab-btn"
          (click)="toggleSidebar()"
          [attr.aria-label]="sidebarCollapsed ? 'Επέκταση μενού' : 'Σύμπτυξη μενού'"
        >
          <svg *ngIf="!sidebarCollapsed" viewBox="0 0 24 24" class="icon arrow-icon" aria-hidden="true">
            <path d="M14 7 9 12l5 5" />
          </svg>
          <svg *ngIf="sidebarCollapsed" viewBox="0 0 24 24" class="icon arrow-icon" aria-hidden="true">
            <path d="m10 7 5 5-5 5" />
          </svg>
        </button>
        <div class="brand">
          <img src="logo.png" alt="Μεταμόρφωσεως 5 — Χαλάνδρι, Αττική" class="brand-logo" />
        </div>
        <nav>
          <a routerLink="/app/dashboard" routerLinkActive="active" (click)="closeMobileMenu()">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19V5m0 14h16M9 16V9m5 7V7m5 9v-4" />
            </svg>
            <span>Πίνακας ελέγχου</span>
          </a>
          <a routerLink="/app/invoices" routerLinkActive="active" (click)="closeMobileMenu()">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 1v4h4" />
            </svg>
            <span>Λογαριασμοί</span>
          </a>
          <a routerLink="/app/expenses" routerLinkActive="active" (click)="closeMobileMenu()">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h4" />
            </svg>
            <span>Έξοδα</span>
          </a>
          <a routerLink="/app/measurements" routerLinkActive="active" (click)="closeMobileMenu()">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 16.5 16.5 3 21 7.5 7.5 21H3v-4.5ZM11 7l6 6" />
            </svg>
            <span>Μετρήσεις</span>
          </a>          
          <a routerLink="/app/voting" routerLinkActive="active" (click)="closeMobileMenu()">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h10M4 18h7M17 15l2 2 3-4" />
            </svg>
            <span>Ψηφοφορίες</span>
          </a>
        </nav>

        <a class="profile-link" routerLink="/app/profile" routerLinkActive="active" (click)="closeMobileMenu()">
          <div class="avatar" *ngIf="me">{{ getInitials(me.username) }}</div>
          <div class="profile-meta">
            <strong>{{ me?.username || 'Χρήστης' }}</strong>
            <span>{{ me?.role || '' }}</span>
          </div>
        </a>
      </aside>

      <section class="content">
        <header class="topbar">
          <div class="topbar-left">
            <button *ngIf="isTabletMobile" class="btn btn-ghost icon-btn" (click)="toggleSidebar()" aria-label="Άνοιγμα μενού">
              <svg viewBox="0 0 24 24" class="icon burger-icon" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div>
            <h1>Διαχείριση Πολυκατοικίας</h1>
            <p *ngIf="me">Χρήστης: {{ me.username }} ({{ me.role }})</p>
            </div>
          </div>
          <div class="topbar-actions">
            <span class="superadmin-badge" *ngIf="adminMode.isSuperadmin(me)">Διαχείριση</span>
            <button
              class="btn btn-admin-mode"
              *ngIf="adminMode.isAdministratorRole(me)"
              (click)="toggleAdminMode()"
            >
              {{ (adminModeActive$ | async) ? 'Έξοδος διαχείρισης' : 'Λειτουργία διαχειριστή' }}
            </button>
            <button class="btn btn-ghost" (click)="logout()">Αποσύνδεση</button>
          </div>
        </header>
        <div class="admin-mode-banner" *ngIf="adminMode.isAdministratorRole(me) && (adminModeActive$ | async)">
          Βρίσκεστε σε λειτουργία διαχειριστή
        </div>
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
      position: relative;
      transition: grid-template-columns 180ms ease;
    }
    .layout.sidebar-collapsed {
      grid-template-columns: 82px 1fr;
    }
    .sidebar {
      border-right: 1px solid #1f2b4b;
      background: #0e1427;
      padding: 1rem;
      transition: width 180ms ease, padding 180ms ease, transform 180ms ease;
      z-index: 15;
      position: relative;
    }
    .sidebar-tab-btn {
      position: absolute;
      top: 50%;
      right: -0.82rem;
      width: 1.7rem;
      height: 4.2rem;
      transform: translateY(-50%);
      border: 1px solid #2d406f;
      border-left: 0;
      border-radius: 0 999px 999px 0;
      background: #111b36;
      color: #cfddfb;
      box-shadow: 4px 8px 12px rgba(6, 10, 24, 0.24);
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: right 140ms ease, background-color 140ms ease, border-color 140ms ease;
      z-index: 18;
    }
    .sidebar-tab-btn:hover {
      right: -0.74rem;
      background: #152244;
      border-color: #3f5c98;
    }
    .sidebar-tab-btn::before {
      content: '';
      width: 2px;
      height: 1.4rem;
      border-radius: 999px;
      background: rgba(170, 194, 241, 0.36);
      position: absolute;
      left: 0.32rem;
    }
    .sidebar.collapsed nav a span,
    .sidebar.collapsed .profile-meta {
      display: none;
    }
    .sidebar.collapsed nav a {
      justify-content: center;
      padding-left: 0.4rem;
      padding-right: 0.4rem;
    }
    .sidebar.collapsed .profile-link {
      justify-content: center;
      padding: 0.5rem;
    }
    .sidebar-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 8, 18, 0.58);
      z-index: 12;
    }
    .brand {
      margin: 0 0 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      border-radius: 14px;
      padding: 0.65rem 0.75rem;
      background: rgba(245, 248, 255, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: 0 8px 20px rgba(8, 12, 28, 0.28);
      backdrop-filter: blur(6px);
    }
    .brand-logo {
      display: block;
      width: 100%;
      height: auto;
      max-height: 96px;
      object-fit: contain;
    }
    .sidebar.collapsed .brand {
      display: none;
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
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    .topbar-left > div {
      display: grid;
      align-content: center;
    }
    .icon-btn {
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      display: inline-grid;
      place-items: center;
      flex-shrink: 0;
      border: 1px solid #3a4f86;
      border-radius: 12px;
      background: linear-gradient(145deg, #17264a, #132042);
      box-shadow: 0 8px 18px rgba(31, 52, 105, 0.35);
      transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, filter 140ms ease;
    }
    .icon-btn .icon {
      width: 1.25rem;
      height: 1.25rem;
      color: #d9e7ff;
      display: block;
    }
    .icon-btn .burger-icon { stroke-width: 2.1; }
    .icon-btn .arrow-icon { stroke-width: 2.3; }
    .sidebar-tab-btn .icon {
      width: 0.95rem;
      height: 0.95rem;
      color: #e2ecff;
      stroke-width: 2.35;
      margin-left: 0.16rem;
    }
    .icon-btn:hover {
      transform: translateY(-1px);
      border-color: #6b8fd8;
      box-shadow: 0 12px 24px rgba(56, 86, 167, 0.42);
      filter: brightness(1.06);
    }
    .icon-btn:active {
      transform: translateY(0);
      box-shadow: 0 6px 14px rgba(43, 68, 131, 0.35);
    }
    h1 {
      margin: 0;
      font-size: 1.3rem;
      line-height: 1.1;
    }
    p {
      margin: 0.1rem 0 0;
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
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }
    .btn-admin-mode {
      border: 1px solid #8a6a1e;
      background: linear-gradient(135deg, #6b4f12, #8a6218);
      white-space: nowrap;
    }
    .btn-admin-mode:hover {
      filter: brightness(1.08);
    }
    .superadmin-badge {
      border: 1px solid #3a5a9a;
      border-radius: 999px;
      padding: 0.35rem 0.7rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: #c8dcff;
      background: rgba(58, 90, 154, 0.25);
      white-space: nowrap;
    }
    .admin-mode-banner {
      margin: -0.35rem 0 1rem;
      padding: 0.55rem 0.85rem;
      border-radius: 10px;
      border: 1px solid #8a6a1e;
      background: rgba(138, 106, 30, 0.22);
      color: #f5e6b8;
      font-size: 0.88rem;
      font-weight: 600;
    }
    @media (max-width: 1023px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        width: min(320px, 85vw);
        transform: translateX(-100%);
        border-right: 1px solid #1f2b4b;
        border-bottom: 0;
        box-shadow: 8px 0 24px rgba(0, 0, 0, 0.35);
      }
      .sidebar.open {
        transform: translateX(0);
      }
      nav {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AdminShellComponent implements OnInit, OnDestroy {
  me: Me | null = null;
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  isTabletMobile = false;
  readonly adminModeActive$: Observable<boolean>;

  constructor(
    private readonly data: AppDataService,
    private readonly auth: AuthService,
    private readonly router: Router,
    readonly adminMode: AdminModeService,
  ) {
    this.adminModeActive$ = this.adminMode.adminModeActive$;
  }

  ngOnInit(): void {
    this.updateViewportFlags();
    window.addEventListener('resize', this.handleResize);

    this.data.getMe().subscribe({
      next: (me) => {
        this.me = me;
      },
      error: (err) => {
        if (err?.status === 401 || err?.status === 403) {
          this.logout();
        }
      },
    });
    // Warm the apartment cache but do not block shell rendering.
    this.data.getApartments().subscribe({ error: () => {} });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.handleResize);
  }

  logout(): void {
    this.adminMode.exit();
    this.data.clearCache();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  toggleAdminMode(): void {
    this.adminMode.toggle();
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

  toggleSidebar(): void {
    if (this.isTabletMobile) {
      this.mobileMenuOpen = !this.mobileMenuOpen;
      return;
    }
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  closeMobileMenu(): void {
    if (!this.isTabletMobile) return;
    this.mobileMenuOpen = false;
  }

  private readonly handleResize = (): void => {
    this.updateViewportFlags();
  };

  private updateViewportFlags(): void {
    const wasTabletMobile = this.isTabletMobile;
    this.isTabletMobile = window.innerWidth <= 1023;
    if (this.isTabletMobile !== wasTabletMobile) {
      this.mobileMenuOpen = false;
    }
  }

}
