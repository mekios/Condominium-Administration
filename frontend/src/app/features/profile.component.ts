import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { AppDataService, Apartment, Me } from '../core/app-data.service';
import { PasswordFieldComponent } from '../core/password-field.component';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('new_password')?.value;
  const confirm = group.get('new_password_confirm')?.value;
  if (!password || !confirm) return null;
  return password === confirm ? null : { passwordsMismatch: true };
}

@Component({
  standalone: true,
  selector: 'app-profile',
  imports: [NgIf, NgFor, ReactiveFormsModule, PasswordFieldComponent],
  template: `
    <section class="panel">
      <header class="head">
        <h2>Προφίλ χρήστη</h2>
        <p>Στοιχεία λογαριασμού και διαμερίσματα πρόσβασης.</p>
      </header>

      <p class="hint" *ngIf="loading">Φόρτωση στοιχείων...</p>

      <ng-container *ngIf="!loading && me as user">
        <div class="profile-grid">
          <article class="card">
            <h3>Στοιχεία λογαριασμού</h3>
            <div class="kv"><span>Όνομα χρήστη</span><strong>{{ user.username }}</strong></div>
            <div class="kv"><span>Email</span><strong>{{ user.email || '-' }}</strong></div>
            <div class="kv"><span>Ρόλος</span><strong>{{ roleLabel(user.role) }}</strong></div>
            <div class="kv"><span>Γλώσσα</span><strong>{{ languageLabel(user.preferred_language) }}</strong></div>
          </article>

          <article class="card">
            <h3>Διαμερίσματα πρόσβασης</h3>
            <p class="hint tight" *ngIf="!apartments.length">Δεν υπάρχουν συνδεδεμένα διαμερίσματα.</p>
            <ul *ngIf="apartments.length">
              <li *ngFor="let apt of apartments">
                {{ apt.apartment_label }} <span>{{ apt.ownership_permille }}‰</span>
              </li>
            </ul>
          </article>
        </div>

        <article class="card security">
          <div class="security-head">
            <div>
              <h3>Ασφάλεια</h3>
              <p class="hint tight">Αλλάξτε τον κωδικό πρόσβασης του λογαριασμού σας.</p>
            </div>
            <button
              *ngIf="!passwordEditorOpen"
              type="button"
              class="btn btn-secondary"
              (click)="openPasswordEditor()"
            >
              Αλλαγή κωδικού
            </button>
          </div>

          <form
            *ngIf="passwordEditorOpen"
            [formGroup]="passwordForm"
            (ngSubmit)="changePassword()"
            class="password-form"
            autocomplete="off"
          >
            <label class="full">
              Τρέχων κωδικός
              <app-password-field formControlName="current_password" autocomplete="current-password" />
            </label>

            <label>
              Νέος κωδικός
              <app-password-field formControlName="new_password" autocomplete="new-password" />
              <span class="field-hint">Τουλάχιστον 8 χαρακτήρες</span>
            </label>

            <label>
              Επιβεβαίωση νέου κωδικού
              <app-password-field formControlName="new_password_confirm" autocomplete="new-password" />
              <span class="field-error" *ngIf="passwordForm.hasError('passwordsMismatch') && passwordForm.touched">
                Οι κωδικοί δεν ταιριάζουν.
              </span>
            </label>

            <div class="actions full">
              <button
                class="btn btn-primary"
                type="submit"
                [disabled]="passwordSaving || passwordForm.invalid"
              >
                {{ passwordSaving ? 'Αποθήκευση...' : 'Αποθήκευση κωδικού' }}
              </button>
              <button type="button" class="btn btn-secondary" (click)="closePasswordEditor()" [disabled]="passwordSaving">
                Ακύρωση
              </button>
            </div>
          </form>

          <p *ngIf="passwordSuccess" class="success">{{ passwordSuccess }}</p>
          <p *ngIf="passwordError" class="error">{{ passwordError }}</p>
        </article>
      </ng-container>
    </section>
  `,
  styles: `
    .panel { border: 1px solid #243152; background: #101a33; border-radius: 12px; padding: 1rem; }
    .head h2 { margin: 0; font-size: 1.05rem; }
    .head p, .hint { margin: 0.35rem 0 0.8rem; color: #93a8da; font-size: 0.9rem; }
    .hint.tight { margin: 0; }
    .profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.8rem; }
    .card { border: 1px solid #2a3a63; background: #0f1730; border-radius: 12px; padding: 0.85rem; }
    .security { margin-top: 0.8rem; }
    .security-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.8rem;
    }
    h3 { margin: 0 0 0.7rem; font-size: 0.95rem; color: #dce8ff; }
    .security-head h3 { margin-bottom: 0.25rem; }
    .kv {
      display: flex;
      justify-content: space-between;
      gap: 0.6rem;
      padding: 0.38rem 0;
      border-bottom: 1px dashed #25365f;
    }
    .kv span { color: #96aede; font-size: 0.84rem; }
    .kv strong { color: #f3f7ff; font-size: 0.88rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
    li {
      border: 1px solid #28395f;
      border-radius: 10px;
      padding: 0.45rem 0.55rem;
      display: flex;
      justify-content: space-between;
    }
    li span { color: #9fbae9; }
    .password-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
      margin-top: 0.95rem;
      max-width: 640px;
    }
    .full { grid-column: 1 / -1; }
    label { display: grid; gap: 0.3rem; color: #b5c9f5; font-size: 0.86rem; }
    :host ::ng-deep .password-field input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #31416c;
      border-radius: 10px;
      background: #0d1430;
      color: #fff;
      padding: 0.55rem 2.6rem 0.55rem 0.65rem;
      outline: none;
    }
    :host ::ng-deep .password-field input:focus {
      border-color: #4f78ff;
      box-shadow: 0 0 0 3px rgba(79, 120, 255, 0.2);
    }
    .field-hint { color: #7f93bf; font-size: 0.78rem; }
    .field-error { color: #ff9fa5; font-size: 0.78rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.15rem; }
    .btn {
      border: 0;
      border-radius: 10px;
      padding: 0.58rem 0.95rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.65; cursor: default; }
    .btn-primary {
      background: linear-gradient(135deg, #4f78ff, #6d62ff);
      box-shadow: 0 8px 18px rgba(70, 95, 255, 0.35);
    }
    .btn-secondary { border: 1px solid #30457d; background: #132247; }
    .success { color: #b5f0cf; margin: 0.75rem 0 0; font-size: 0.9rem; }
    .error { color: #ff9fa5; margin: 0.75rem 0 0; font-size: 0.9rem; white-space: pre-wrap; }
    @media (max-width: 900px) {
      .profile-grid,
      .password-form { grid-template-columns: 1fr; }
      .security-head { flex-direction: column; align-items: stretch; }
    }
  `,
})
export class ProfileComponent implements OnInit {
  me: Me | null = null;
  apartments: Apartment[] = [];
  loading = true;
  passwordEditorOpen = false;
  passwordSaving = false;
  passwordSuccess = '';
  passwordError = '';

  passwordForm = new FormGroup(
    {
      current_password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      new_password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8)],
      }),
      new_password_confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: passwordsMatch },
  );

  constructor(private readonly data: AppDataService) {}

  ngOnInit(): void {
    this.loading = true;
    this.data.getMe().subscribe({
      next: (me) => (this.me = me),
      error: () => (this.me = null),
    });
    this.data.getLinkedApartments().subscribe({
      next: (apartments) => {
        this.apartments = apartments;
        this.loading = false;
      },
      error: () => {
        this.apartments = [];
        this.loading = false;
      },
    });
  }

  roleLabel(role: string): string {
    switch (role) {
      case 'administrator':
        return 'Διαχειριστής';
      case 'owner':
        return 'Ιδιοκτήτης';
      case 'tenant':
        return 'Ένοικος';
      default:
        return role;
    }
  }

  languageLabel(language: string): string {
    switch (language) {
      case 'el':
        return 'Ελληνικά';
      case 'en':
        return 'English';
      default:
        return language;
    }
  }

  openPasswordEditor(): void {
    this.passwordEditorOpen = true;
    this.passwordSuccess = '';
    this.passwordError = '';
    this.passwordForm.reset();
  }

  closePasswordEditor(): void {
    this.passwordEditorOpen = false;
    this.passwordError = '';
    this.passwordForm.reset();
  }

  changePassword(): void {
    this.passwordSuccess = '';
    this.passwordError = '';
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid) return;

    this.passwordSaving = true;
    this.data.setPassword(this.passwordForm.getRawValue()).subscribe({
      next: (response) => {
        this.passwordSuccess = response.detail;
        this.passwordEditorOpen = false;
        this.passwordForm.reset();
        this.passwordSaving = false;
      },
      error: (err) => {
        this.passwordSaving = false;
        const body = err?.error;
        if (typeof body?.detail === 'string') {
          this.passwordError = body.detail;
          return;
        }
        const messages = [
          ...(body?.current_password ?? []),
          ...(body?.new_password ?? []),
          ...(body?.new_password_confirm ?? []),
        ];
        this.passwordError = messages.length ? messages.join('\n') : 'Αποτυχία αλλαγής κωδικού.';
      },
    });
  }
}
