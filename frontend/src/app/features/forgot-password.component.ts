import { Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';

import { API_BASE } from '../core/api.constants';
import { AuthShellComponent } from '../core/auth-shell.component';

@Component({
  standalone: true,
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, NgIf, RouterLink, AuthShellComponent],
  template: `
    <app-auth-shell
      title="Ξεχάσατε τον κωδικό;"
      subtitle="Εισάγετε το email ή το όνομα χρήστη και θα σας στείλουμε σύνδεσμο επαναφοράς."
    >
      <form *ngIf="!done" [formGroup]="form" (ngSubmit)="submit()" class="form">
        <label>Email ή όνομα χρήστη</label>
        <input type="text" formControlName="identifier" autocomplete="username" />

        <button class="primary" type="submit" [disabled]="loading || form.invalid">
          {{ loading ? 'Αποστολή...' : 'Αποστολή συνδέσμου' }}
        </button>
      </form>

      <p *ngIf="done" class="success">{{ message }}</p>
      <p *ngIf="error" class="error">{{ error }}</p>

      <div class="auth-links">
        <a routerLink="/login">Επιστροφή στη σύνδεση</a>
      </div>
    </app-auth-shell>
  `,
})
export class ForgotPasswordComponent {
  loading = false;
  done = false;
  message = '';
  error = '';

  form = new FormGroup({
    identifier: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor(private readonly http: HttpClient) {}

  submit(): void {
    this.error = '';
    if (this.form.invalid) return;
    this.loading = true;
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/auth/forgot-password/`, this.form.getRawValue())
      .subscribe({
        next: (response) => {
          this.done = true;
          this.message = response.detail;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.detail || 'Αποτυχία αποστολής αιτήματος.';
        },
      });
  }
}
