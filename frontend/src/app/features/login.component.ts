import { Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIf } from '@angular/common';

import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [ReactiveFormsModule, NgIf],
  template: `
    <main class="page">
      <section class="panel">
        <div class="brand">
          <p class="kicker">Block-of-Flats Admin</p>
          <h1>Σύνδεση</h1>
          <p class="subtitle">Ασφαλής πρόσβαση για διαχείριση πολυκατοικίας.</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <label>Όνομα χρήστη</label>
          <input type="text" formControlName="username" placeholder="admin_a1" />

          <label>Κωδικός πρόσβασης</label>
          <input type="password" formControlName="password" placeholder="••••••••" />

          <button type="submit" [disabled]="loading || form.invalid">
            {{ loading ? 'Σύνδεση...' : 'Σύνδεση' }}
          </button>
        </form>

        <p *ngIf="error" class="error">Μη έγκυρα στοιχεία σύνδεσης. Παρακαλώ δοκιμάστε ξανά.</p>
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

    .brand { margin-bottom: 1.1rem; }
    .kicker { margin: 0; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: #6f86c9; }
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
    .error { color: #ff9fa5; margin-top: 0.85rem; font-size: 0.9rem; }
  `,
})
export class LoginComponent {
  loading = false;
  error = false;
  form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  submit(): void {
    this.error = false;
    if (this.form.invalid) return;
    this.loading = true;
    this.auth.login(this.form.value.username!, this.form.value.password!).subscribe({
      next: () => this.router.navigateByUrl('/app/dashboard'),
      error: () => {
        this.loading = false;
        this.error = true;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}
