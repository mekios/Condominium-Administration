import { Component, OnInit } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { API_BASE, DEFAULT_BUILDING_ID } from '../core/api.constants';
import { AdminModeService } from '../core/admin-mode.service';
import { AppDataService, Me } from '../core/app-data.service';

type VoteSession = {
  id: number;
  building: number;
  building_name: string;
  session_type: 'motion' | 'administrator_election';
  title: string;
  description: string;
  vote_options_json: string[];
  start_at: string;
  end_at: string;
  status: 'draft' | 'active' | 'closed';
};

type SessionFormModel = {
  session_type: 'motion' | 'administrator_election';
  title: string;
  description: string;
  vote_options_csv: string;
  start_local: string;
  end_local: string;
  status: 'draft' | 'active' | 'closed';
};

@Component({
  standalone: true,
  selector: 'app-voting',
  imports: [NgIf, NgFor, FormsModule, DatePipe, RouterLink],
  template: `
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Λίστα ψηφοφοριών</h2>
          <p>Επίλεξε συνεδρία για ψήφο/διαχείριση σε ξεχωριστή σελίδα.</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-ghost" (click)="load()" [disabled]="loading">
            {{ loading ? 'Φόρτωση...' : 'Ανανέωση' }}
          </button>
          <button class="btn btn-primary" *ngIf="writeEnabled" (click)="openCreatePopup()">Νέα ψηφοφορία</button>
        </div>
      </header>
      <p class="hint error" *ngIf="message">{{ message }}</p>
    </section>

    <section class="panel">
      <h3>Ενεργές ψηφοφορίες</h3>
      <div class="session-grid" *ngIf="activeSessions.length; else noActive">
        <article class="session-card" *ngFor="let session of activeSessions">
          <div class="card-head">
            <strong class="card-title">{{ session.title }}</strong>
            <span class="status status-active">Ενεργή</span>
          </div>
          <p class="meta">{{ getSessionTypeLabel(session.session_type) }}</p>
          <p class="meta">Λήξη: {{ session.end_at | date: 'dd/MM/yyyy HH:mm' }}</p>
          <p class="meta" *ngIf="session.vote_options_json.length">Επιλογές: {{ session.vote_options_json.join(' / ') }}</p>
          <p class="desc" *ngIf="session.description">{{ session.description }}</p>
          <footer class="card-footer">
            <button class="btn btn-primary btn-sm" [routerLink]="['/app/voting', session.id]">Άνοιγμα</button>
          </footer>
        </article>
      </div>
      <ng-template #noActive><p class="hint">Δεν υπάρχουν ενεργές ψηφοφορίες.</p></ng-template>
    </section>

    <section class="panel">
      <h3>Πρόχειρες & κλειστές</h3>
      <div class="session-grid" *ngIf="inactiveSessions.length; else noInactive">
        <article class="session-card session-card-muted" *ngFor="let session of inactiveSessions">
          <div class="card-head">
            <strong class="card-title">{{ session.title }}</strong>
            <span class="status" [class.status-draft]="session.status === 'draft'" [class.status-closed]="session.status === 'closed'">
              {{ getStatusLabel(session.status) }}
            </span>
          </div>
          <p class="meta">{{ getSessionTypeLabel(session.session_type) }}</p>
          <p class="meta">Λήξη: {{ session.end_at | date: 'dd/MM/yyyy HH:mm' }}</p>
          <p class="meta" *ngIf="session.vote_options_json.length">Επιλογές: {{ session.vote_options_json.join(' / ') }}</p>
          <p class="desc" *ngIf="session.description">{{ session.description }}</p>
          <footer class="card-footer">
            <button class="btn btn-ghost btn-sm" [routerLink]="['/app/voting', session.id]">Άνοιγμα</button>
          </footer>
        </article>
      </div>
      <ng-template #noInactive><p class="hint">Δεν υπάρχουν πρόχειρες ή κλειστές ψηφοφορίες.</p></ng-template>
    </section>

    <div class="modal-backdrop" *ngIf="showCreatePopup" (click)="closeCreatePopup()">
      <section class="modal" (click)="$event.stopPropagation()">
        <header class="modal-head">
          <h3>Δημιουργία νέας ψηφοφορίας</h3>
          <button class="icon-btn" aria-label="Κλείσιμο" (click)="closeCreatePopup()">✕</button>
        </header>

        <div class="admin-grid">
          <label>
            Τύπος
            <select [(ngModel)]="createForm.session_type">
              <option value="motion">Θέμα</option>
              <option value="administrator_election">Εκλογή διαχειριστή</option>
            </select>
          </label>
          <label>
            Τίτλος
            <input type="text" [(ngModel)]="createForm.title" placeholder="Π.χ. Έγκριση δαπάνης" />
          </label>
          <label>
            Επιλογές ψήφου (προαιρετικό)
            <input type="text" [(ngModel)]="createForm.vote_options_csv" placeholder="π.χ. Προσφορά Α, Προσφορά Β, Λευκό" />
          </label>
          <label>
            Κατάσταση
            <select [(ngModel)]="createForm.status">
              <option value="draft">Πρόχειρη</option>
              <option value="active">Ενεργή</option>
              <option value="closed">Κλειστή</option>
            </select>
          </label>
          <label>
            Έναρξη
            <input type="datetime-local" [(ngModel)]="createForm.start_local" />
          </label>
          <label>
            Λήξη
            <input type="datetime-local" [(ngModel)]="createForm.end_local" />
          </label>
        </div>
        <label class="full-width">
          Περιγραφή
          <textarea rows="2" [(ngModel)]="createForm.description"></textarea>
        </label>
        <div class="actions">
          <button class="btn btn-primary" (click)="createSession()" [disabled]="adminSaving">
            {{ adminSaving ? 'Αποθήκευση...' : 'Δημιουργία' }}
          </button>
          <button class="btn btn-ghost" (click)="closeCreatePopup()">Ακύρωση</button>
        </div>
        <p class="hint" *ngIf="adminMessage">{{ adminMessage }}</p>
      </section>
    </div>
  `,
  styles: `
    .panel { border: 1px solid #243152; background: #101a33; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    .panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.55rem; }
    .head-actions { display: flex; gap: 0.55rem; align-items: center; }
    h2, h3 { margin: 0; color: #eef3ff; }
    p { margin: 0.2rem 0 0; color: #9db1e2; }
    .hint { margin-top: 0.4rem; color: #9db1e2; }
    .error { color: #ffb7c8; }
    .btn { border: 0; border-radius: 10px; padding: 0.55rem 0.9rem; color: #fff; font-weight: 600; cursor: pointer; }
    .btn-sm { padding: 0.4rem 0.65rem; font-size: 0.82rem; }
    .btn-ghost { border: 1px solid #2c3e70; background: #0d1632; }
    .btn-primary { border: 1px solid #4d62a5; background: linear-gradient(135deg, #4e65b9, #617edf); }
    .admin-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 0.75rem; }
    .session-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .session-card {
      border: 1px solid #2a395f;
      border-radius: 14px;
      padding: 0.85rem;
      background: linear-gradient(150deg, #121e3f, #0f1830);
      display: grid;
      gap: 0.45rem;
      box-shadow: 0 12px 24px rgba(11, 21, 46, 0.28);
    }
    .session-card-muted {
      background: linear-gradient(150deg, #101a33, #0d152c);
    }
    .card-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; color: #eff4ff; }
    .card-title { font-size: 0.98rem; }
    .status { border-radius: 999px; font-size: 0.74rem; padding: 0.22rem 0.52rem; border: 1px solid #38528e; color: #b9c8eb; background: #112040; }
    .status-active { border-color: #3b8b68; background: rgba(53,153,105,.2); color: #b9f0d4; }
    .status-draft { border-color: #5a6da7; background: rgba(90, 109, 167, 0.18); color: #d0ddff; }
    .status-closed { border-color: #7c5ab0; background: rgba(124, 90, 176, 0.18); color: #e5d6ff; }
    .meta { font-size: 0.82rem; }
    .desc { color: #c4d5fb; font-size: 0.84rem; line-height: 1.35; }
    .card-footer { margin-top: 0.2rem; }
    label { color: #d7e2fb; font-size: 0.86rem; display: grid; gap: 0.35rem; }
    select, input, textarea { border: 1px solid #2a395f; border-radius: 10px; padding: 0.52rem 0.65rem; color: #ecf3ff; background: #0f1830; font: inherit; }
    textarea { resize: vertical; }
    .full-width { display: grid; gap: 0.35rem; margin-bottom: 0.75rem; }
    .actions { display: flex; gap: 0.55rem; flex-wrap: wrap; }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 30;
      background: rgba(5, 10, 22, 0.72);
      display: grid;
      place-items: center;
      padding: 1rem;
    }
    .modal {
      width: min(860px, 100%);
      border: 1px solid #334b84;
      border-radius: 14px;
      background: linear-gradient(160deg, #121f42, #0f1832);
      padding: 1rem;
      box-shadow: 0 24px 44px rgba(9, 15, 35, 0.45);
    }
    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.85rem;
    }
    .icon-btn {
      border: 1px solid #3e548f;
      background: #112048;
      color: #dbe8ff;
      border-radius: 10px;
      width: 2rem;
      height: 2rem;
      cursor: pointer;
      font-size: 0.95rem;
      line-height: 1;
    }
    @media (max-width: 1200px) {
      .session-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (max-width: 900px) {
      .session-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 640px) {
      .session-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class VotingComponent implements OnInit {
  me: Me | null = null;
  writeEnabled = false;
  sessions: VoteSession[] = [];
  loading = false;
  adminSaving = false;
  message = '';
  adminMessage = '';
  showCreatePopup = false;
  createForm: SessionFormModel = this.buildEmptySessionForm();

  constructor(
    private readonly http: HttpClient,
    private readonly data: AppDataService,
    private readonly router: Router,
    private readonly adminMode: AdminModeService,
  ) {}

  ngOnInit(): void {
    this.adminMode.adminModeActive$.subscribe(() => this.refreshWriteEnabled());
    this.load();
  }

  private refreshWriteEnabled(): void {
    this.writeEnabled = this.adminMode.canManage(this.me);
  }

  load(): void {
    this.loading = true;
    this.message = '';
    this.data.getMe().subscribe({
      next: (me) => {
        this.me = me;
        this.refreshWriteEnabled();
      },
    });
    this.http
      .get<VoteSession[]>(`${API_BASE}/api/voting/sessions/`)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (items) => (this.sessions = items || []),
        error: (err) => (this.message = err?.error?.detail || 'Αποτυχία φόρτωσης λίστας ψηφοφοριών.'),
      });
  }

  createSession(): void {
    if (!this.writeEnabled) return;
    const payload = this.toSessionPayload(this.createForm);
    if (!payload) {
      this.adminMessage = 'Συμπλήρωσε όλα τα υποχρεωτικά πεδία.';
      return;
    }
    this.adminSaving = true;
    this.adminMessage = '';
    this.http
      .post<VoteSession>(`${API_BASE}/api/voting/sessions/`, payload)
      .pipe(finalize(() => (this.adminSaving = false)))
      .subscribe({
        next: (created) => {
          this.adminMessage = 'Η συνεδρία δημιουργήθηκε.';
          this.showCreatePopup = false;
          this.load();
          this.router.navigate(['/app/voting', created.id]);
        },
        error: (err) => (this.adminMessage = err?.error?.detail || 'Αποτυχία δημιουργίας συνεδρίας.'),
      });
  }

  openCreatePopup(): void {
    this.createForm = this.buildEmptySessionForm();
    this.adminMessage = '';
    this.showCreatePopup = true;
  }

  closeCreatePopup(): void {
    this.showCreatePopup = false;
  }

  get activeSessions(): VoteSession[] {
    return this.sessions.filter((x) => x.status === 'active');
  }

  get inactiveSessions(): VoteSession[] {
    return this.sessions.filter((x) => x.status !== 'active');
  }

  getSessionTypeLabel(sessionType: VoteSession['session_type']): string {
    return sessionType === 'administrator_election' ? 'Εκλογή διαχειριστή' : 'Θέμα';
  }

  getStatusLabel(status: VoteSession['status']): string {
    if (status === 'active') return 'Ενεργή';
    if (status === 'closed') return 'Κλειστή';
    return 'Πρόχειρη';
  }

  private buildEmptySessionForm(): SessionFormModel {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return {
      session_type: 'motion',
      title: '',
      description: '',
      vote_options_csv: '',
      start_local: this.toDatetimeLocal(now.toISOString()),
      end_local: this.toDatetimeLocal(tomorrow.toISOString()),
      status: 'draft',
    };
  }

  private toSessionPayload(form: SessionFormModel): Record<string, unknown> | null {
    if (!form.title.trim() || !form.start_local || !form.end_local) return null;
    return {
      building: DEFAULT_BUILDING_ID,
      session_type: form.session_type,
      title: form.title.trim(),
      description: form.description?.trim() || '',
      vote_options_json: (form.vote_options_csv || '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x.length > 0),
      start_at: new Date(form.start_local).toISOString(),
      end_at: new Date(form.end_local).toISOString(),
      status: form.status,
    };
  }

  private toDatetimeLocal(iso: string): string {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const mins = `${date.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${mins}`;
  }
}
