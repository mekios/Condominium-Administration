import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';

import { API_BASE } from '../core/api.constants';
import { AuthShellComponent } from '../core/auth-shell.component';
import { PasswordFieldComponent } from '../core/password-field.component';

@Component({
  standalone: true,
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, NgIf, RouterLink, AuthShellComponent, PasswordFieldComponent],
  template: `
    <app-auth-shell
      title="Νέος κωδικός"
      subtitle="Ορίστε νέο ισχυρό κωδικό πρόσβασης για τον λογαριασμό σας."
    >
      <p *ngIf="invalidLink" class="error">
        Ο σύνδεσμος επαναφοράς δεν είναι έγκυρος ή έχει λήξει.
      </p>

      <form *ngIf="!invalidLink && !done" [formGroup]="form" (ngSubmit)="submit()" class="form">
        <label>Νέος κωδικός</label>
        <app-password-field formControlName="new_password" autocomplete="new-password" />

        <label>Επιβεβαίωση νέου κωδικού</label>
        <app-password-field formControlName="new_password_confirm" autocomplete="new-password" />

        <button class="primary" type="submit" [disabled]="loading || form.invalid">
          {{ loading ? 'Αποθήκευση...' : 'Αποθήκευση κωδικού' }}
        </button>
      </form>

      <p *ngIf="done" class="success">{{ message }}</p>
      <p *ngIf="error" class="error">{{ error }}</p>

      <div class="auth-links">
        <a routerLink="/login">Μετάβαση στη σύνδεση</a>
      </div>
    </app-auth-shell>
  `,
})
export class ResetPasswordComponent implements OnInit {
  loading = false;
  done = false;
  invalidLink = false;
  message = '';
  error = '';
  uid = '';
  token = '';

  form = new FormGroup({
    new_password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
    new_password_confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor(
    private readonly http: HttpClient,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.uid = this.route.snapshot.queryParamMap.get('uid') || '';
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    this.invalidLink = !this.uid || !this.token;
  }

  submit(): void {
    this.error = '';
    if (this.invalidLink || this.form.invalid) return;

    const { new_password, new_password_confirm } = this.form.getRawValue();
    if (new_password !== new_password_confirm) {
      this.error = 'Οι κωδικοί δεν ταιριάζουν.';
      return;
    }

    this.loading = true;
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/auth/reset-password/`, {
        uid: this.uid,
        token: this.token,
        new_password,
        new_password_confirm,
      })
      .subscribe({
        next: (response) => {
          this.done = true;
          this.message = response.detail;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          const body = err?.error;
          if (typeof body?.detail === 'string') {
            this.error = body.detail;
            return;
          }
          const messages = [...(body?.new_password ?? []), ...(body?.new_password_confirm ?? [])];
          this.error = messages.length ? messages.join('\n') : 'Αποτυχία αποθήκευσης κωδικού.';
        },
      });
  }
}
