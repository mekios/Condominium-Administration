import { Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-auth-shell',
  imports: [NgIf],
  template: `
    <main class="page">
      <section class="panel">
        <div class="brand">
          <img src="logo.png" alt="Μεταμόρφωσεως 5 — Χαλάνδρι, Αττική" class="brand-logo" />
          <h1>{{ title }}</h1>
          <p class="subtitle" *ngIf="subtitle">{{ subtitle }}</p>
        </div>
        <ng-content></ng-content>
      </section>
    </main>
  `,
  styles: `
    .page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: radial-gradient(circle at 10% 10%, #1f2a44, #0b1020 45%);
    }

    .panel {
      width: min(100%, 460px);
      padding: 1.5rem;
      border-radius: 18px;
      background: #11182b;
      border: 1px solid #27314f;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
    }

    .brand { margin-bottom: 1.1rem; text-align: center; }
    .brand-logo {
      display: block;
      width: 100%;
      max-width: 300px;
      height: auto;
      margin: 0 auto 0.9rem;
      padding: 0.75rem 0.95rem;
      border-radius: 16px;
      background: rgba(245, 248, 255, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: 0 12px 26px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(6px);
    }
    h1 { margin: 0.15rem 0 0.35rem; color: #f8fbff; font-size: 1.7rem; }
    .subtitle { margin: 0; color: #9cb0df; font-size: 0.92rem; }

    :host ::ng-deep .form { display: flex; flex-direction: column; gap: 0.55rem; }
    :host ::ng-deep label { color: #b8c8ed; font-size: 0.86rem; }
    :host ::ng-deep input {
      border: 1px solid #2e3a5d;
      border-radius: 10px;
      background: #0c1223;
      color: #fff;
      padding: 0.72rem 0.75rem;
      outline: none;
    }
    :host ::ng-deep .password-field input {
      padding-right: 2.6rem;
    }
    :host ::ng-deep input:focus {
      border-color: #4f78ff;
      box-shadow: 0 0 0 3px rgba(79, 120, 255, 0.2);
    }
    :host ::ng-deep button.primary {
      margin-top: 0.6rem;
      border: 0;
      border-radius: 10px;
      background: linear-gradient(135deg, #4f78ff, #6e64ff);
      color: #fff;
      padding: 0.78rem;
      font-weight: 600;
      cursor: pointer;
    }
    :host ::ng-deep button.primary:disabled { opacity: 0.65; cursor: default; }
    :host ::ng-deep .error { color: #ff9fa5; margin-top: 0.85rem; font-size: 0.9rem; white-space: pre-wrap; }
    :host ::ng-deep .success { color: #b5f0cf; margin-top: 0.85rem; font-size: 0.9rem; }
    :host ::ng-deep .auth-links {
      margin-top: 1rem;
      text-align: center;
      font-size: 0.88rem;
    }
    :host ::ng-deep .auth-links a {
      color: #8eb1ff;
      text-decoration: none;
    }
    :host ::ng-deep .auth-links a:hover { text-decoration: underline; }
  `,
})
export class AuthShellComponent {
  @Input({ required: true }) title = '';
  @Input() subtitle = '';
}
