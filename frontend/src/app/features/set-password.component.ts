import { Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIf } from '@angular/common';

import { AppDataService } from '../core/app-data.service';

@Component({
  standalone: true,
  selector: 'app-set-password',
  imports: [ReactiveFormsModule, NgIf],
  template: `
    <main class="page">
      <section class="panel">
        <div class="brand">
          <img src="logo.png" alt="Μεταμόρφωσεως 5 — Χαλάνδρι, Αττική" class="brand-logo" />
          <h1>Νέος κωδικός πρόσβασης</h1>
          <p class="subtitle">Για λόγους ασφαλείας, ορίστε ισχυρό κωδικό πριν συνεχίσετε.</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <label>Τρέχων κωδικός (προσωρινός)</label>
          <input type="password" formControlName="current_password" autocomplete="current-password" />

          <label>Νέος κωδικός</label>
          <input type="password" formControlName="new_password" autocomplete="new-password" />

          <label>Επιβεβαίωση νέου κωδικού</label>
          <input type="password" formControlName="new_password_confirm" autocomplete="new-password" />

          <button type="submit" [disabled]="loading || form.invalid">
            {{ loading ? 'Αποθήκευση...' : 'Αποθήκευση κωδικού' }}
          </button>
        </form>

        <p *ngIf="error" class="error">{{ error }}</p>
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

    .form { display: flex; flex-direction: column; gap: 0.55rem; }
    label { color: #b8c8ed; font-size: 0.86rem; }
    input {
      border: 1px solid #2e3a5d;
      border-radius: 10px;
      background: #0c1223;
      color: #fff;
      padding: 0.72rem 0.75rem;
      outline: none;
    }
    input:focus { border-color: #4f78ff; box-shadow: 0 0 0 3px rgba(79, 120, 255, 0.2); }

    button {
      margin-top: 0.6rem;
      border: 0;
      border-radius: 10px;
      background: linear-gradient(135deg, #4f78ff, #6e64ff);
      color: #fff;
      padding: 0.78rem;
      font-weight: 600;
    }
    button:disabled { opacity: 0.65; }
    .error { color: #ff9fa5; margin-top: 0.85rem; font-size: 0.9rem; white-space: pre-wrap; }
  `,
})
export class SetPasswordComponent {
  loading = false;
  error = '';

  form = new FormGroup({
    current_password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    new_password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
    new_password_confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor(
    private readonly data: AppDataService,
    private readonly router: Router,
  ) {}

  submit(): void {
    this.error = '';
    if (this.form.invalid) return;

    const { new_password, new_password_confirm } = this.form.getRawValue();
    if (new_password !== new_password_confirm) {
      this.error = 'Οι κωδικοί δεν ταιριάζουν.';
      return;
    }

    this.loading = true;
    this.data.setPassword(this.form.getRawValue()).subscribe({
      next: () => {
        this.data.getMe(true).subscribe(() => {
          void this.router.navigateByUrl('/app/dashboard');
        });
      },
      error: (err) => {
        this.loading = false;
        const body = err?.error;
        if (typeof body?.detail === 'string') {
          this.error = body.detail;
          return;
        }
        const messages = [
          ...(body?.current_password ?? []),
          ...(body?.new_password ?? []),
          ...(body?.new_password_confirm ?? []),
        ];
        this.error = messages.length ? messages.join('\n') : 'Αποτυχία αποθήκευσης κωδικού.';
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}
