import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';

import { AppDataService } from '../core/app-data.service';
import { AuthService } from '../core/auth.service';
import { AuthShellComponent } from '../core/auth-shell.component';
import { PasswordFieldComponent } from '../core/password-field.component';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [ReactiveFormsModule, NgIf, RouterLink, AuthShellComponent, PasswordFieldComponent],
  template: `
    <app-auth-shell title="Σύνδεση" subtitle="Ασφαλής πρόσβαση για διαχείριση πολυκατοικίας.">
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        <label>Όνομα χρήστη</label>
        <input type="text" formControlName="username" placeholder="admin_a1" autocomplete="username" />

        <label>Κωδικός πρόσβασης</label>
        <app-password-field
          formControlName="password"
          placeholder="••••••••"
          autocomplete="current-password"
        />

        <button class="primary" type="submit" [disabled]="loading || form.invalid">
          {{ loading ? 'Σύνδεση...' : 'Σύνδεση' }}
        </button>
      </form>

      <p *ngIf="error" class="error">Μη έγκυρα στοιχεία σύνδεσης. Παρακαλώ δοκιμάστε ξανά.</p>

      <div class="auth-links">
        <a routerLink="/forgot-password">Ξεχάσατε τον κωδικό;</a>
      </div>
    </app-auth-shell>
  `,
})
export class LoginComponent implements OnInit {
  loading = false;
  error = false;
  form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor(
    private readonly auth: AuthService,
    private readonly data: AppDataService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.auth.ensureSession().subscribe((valid) => {
      if (valid) {
        void this.redirectAfterAuth();
      }
    });
  }

  submit(): void {
    this.error = false;
    if (this.form.invalid) return;
    this.loading = true;
    this.auth.login(this.form.value.username!, this.form.value.password!).subscribe({
      next: () => this.redirectAfterAuth(),
      error: () => {
        this.loading = false;
        this.error = true;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  private redirectAfterAuth(): void {
    this.data.getMe(true).subscribe({
      next: (me) => {
        void this.router.navigateByUrl(me.must_change_password ? '/set-password' : '/app/dashboard');
      },
      error: () => {
        void this.router.navigateByUrl('/app/dashboard');
      },
    });
  }
}
