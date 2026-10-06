import { Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIf } from '@angular/common';

import { AppDataService } from '../core/app-data.service';
import { AuthShellComponent } from '../core/auth-shell.component';
import { PasswordFieldComponent } from '../core/password-field.component';

@Component({
  standalone: true,
  selector: 'app-set-password',
  imports: [ReactiveFormsModule, NgIf, AuthShellComponent, PasswordFieldComponent],
  template: `
    <app-auth-shell
      title="Νέος κωδικός πρόσβασης"
      subtitle="Για λόγους ασφαλείας, ορίστε ισχυρό κωδικό πριν συνεχίσετε."
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        <label>Τρέχων κωδικός (προσωρινός)</label>
        <app-password-field formControlName="current_password" autocomplete="current-password" />

        <label>Νέος κωδικός</label>
        <app-password-field formControlName="new_password" autocomplete="new-password" />

        <label>Επιβεβαίωση νέου κωδικού</label>
        <app-password-field formControlName="new_password_confirm" autocomplete="new-password" />

        <button class="primary" type="submit" [disabled]="loading || form.invalid">
          {{ loading ? 'Αποθήκευση...' : 'Αποθήκευση κωδικού' }}
        </button>
      </form>

      <p *ngIf="error" class="error">{{ error }}</p>
    </app-auth-shell>
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
