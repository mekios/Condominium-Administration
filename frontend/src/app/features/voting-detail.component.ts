import { Component, OnInit } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { API_BASE, DEFAULT_BUILDING_ID } from '../core/api.constants';
import { AdminModeService } from '../core/admin-mode.service';
import { Apartment, AppDataService, Me } from '../core/app-data.service';

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

type VoteItem = {
  id: number;
  apartment: number;
  apartment_label: string;
  voter_username: string;
  vote_value: string;
  updated_at: string;
};

type VoteResults = {
  vote_options: string[];
  eligible_apartments: number;
  submitted_votes: number;
  counts: Record<string, number>;
  permille?: {
    [key: string]: number | string;
    submitted_total: number | string;
    eligible_total: number | string;
  };
};

@Component({
  standalone: true,
  selector: 'app-voting-detail',
  imports: [NgIf, NgFor, FormsModule, DatePipe, RouterLink],
  template: `
    <section class="panel">
      <div class="head">
        <a class="back-link" routerLink="/app/voting">← Πίσω στη λίστα ψηφοφοριών</a>
        <button class="btn btn-ghost" (click)="load()" [disabled]="loading">{{ loading ? 'Φόρτωση...' : 'Ανανέωση' }}</button>
      </div>
      <h2 *ngIf="session">{{ session.title }}</h2>
      <p *ngIf="session">{{ getSessionTypeLabel(session.session_type) }} - {{ getStatusLabel(session.status) }}</p>
      <p class="hint error" *ngIf="message">{{ message }}</p>
    </section>

    <section class="panel" *ngIf="session">
      <h3>Καταχώριση ψήφου</h3>
      <div class="vote-form">
        <label>
          Διαμέρισμα
          <select [(ngModel)]="selectedApartmentId">
            <option [ngValue]="null">Επιλογή διαμερίσματος...</option>
            <option *ngFor="let apt of availableApartments" [ngValue]="apt.id">{{ apt.apartment_label || apt.unit_code }}</option>
          </select>
        </label>
        <label>
          Ψήφος
          <select [(ngModel)]="selectedVoteValue">
            <option *ngFor="let option of voteOptions" [value]="option">{{ getVoteLabel(option) }}</option>
          </select>
        </label>
        <button class="btn btn-primary" (click)="submitVote()" [disabled]="voteSaving || !selectedApartmentId">
          {{ voteSaving ? 'Καταχώριση...' : 'Καταχώριση ψήφου' }}
        </button>
      </div>
      <p class="hint warning" *ngIf="!availableApartments.length">Όλα τα διαμερίσματα έχουν ήδη ψηφίσει.</p>
      <p class="hint" *ngIf="voteMessage">{{ voteMessage }}</p>
    </section>

    <section class="panel" *ngIf="session && writeEnabled">
      <h3>Διαχείριση συνεδρίας</h3>
      <div class="status-actions">
        <button class="btn btn-ghost" (click)="setStatus('draft')" [disabled]="adminSaving || !canSetStatus('draft')">Πρόχειρη</button>
        <button class="btn btn-ghost" (click)="setStatus('active')" [disabled]="adminSaving || !canSetStatus('active')">Ενεργή</button>
        <button class="btn btn-ghost" (click)="setStatus('closed')" [disabled]="adminSaving || !canSetStatus('closed')">Κλειστή</button>
      </div>
    </section>

    <section class="panel" *ngIf="session">
      <div class="head">
        <h3>Ψήφοι</h3>
        <button class="btn btn-ghost" (click)="loadVotes()" [disabled]="votesLoading">{{ votesLoading ? 'Φόρτωση...' : 'Ανανέωση' }}</button>
      </div>
      <div class="table-wrap" *ngIf="votes.length; else noVotes">
        <table>
          <thead><tr><th>Διαμέρισμα</th><th>Ψήφος</th><th>Χρήστης</th><th>Ενημέρωση</th></tr></thead>
          <tbody>
            <tr *ngFor="let row of votes">
              <td>{{ row.apartment_label }}</td>
              <td>{{ getVoteLabel(row.vote_value) }}</td>
              <td>{{ row.voter_username || '-' }}</td>
              <td>{{ row.updated_at | date: 'dd/MM/yyyy HH:mm' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ng-template #noVotes><p class="hint">Δεν υπάρχουν ψήφοι.</p></ng-template>
    </section>

    <section class="panel" *ngIf="session">
      <div class="head">
        <h3>Αποτελέσματα</h3>
        <button class="btn btn-ghost" (click)="loadResults()" [disabled]="resultsLoading">{{ resultsLoading ? 'Φόρτωση...' : 'Ανανέωση' }}</button>
      </div>
      <div class="results-layout" *ngIf="results; else noResults">
        <div class="pie-wrap" *ngIf="optionResults.length">
          <div class="results-pie" [style.background]="pieBackground"></div>
          <div class="pie-legend">
            <div *ngFor="let row of optionResults; index as i">
              <span class="dot" [style.background]="optionColor(i)"></span>
              {{ row.label }} - {{ row.permille.toFixed(1) }} χιλιοστά
            </div>
          </div>
        </div>

        <div class="results-table-wrap">
          <table class="results-table">
            <thead>
              <tr>
                <th>Επιλογή</th>
                <th>Ψήφοι</th>
                <th>Χιλιοστά</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of optionResults">
                <td>{{ row.label }}</td>
                <td>{{ row.count }}</td>
                <td>{{ row.permille.toFixed(1) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>Επιλέξιμα διαμερίσματα</td>
                <td colspan="2">{{ results.eligible_apartments }}</td>
              </tr>
              <tr>
                <td>Συνολικές ψήφοι</td>
                <td colspan="2">{{ results.submitted_votes }}</td>
              </tr>
              <tr>
                <td>Σύνολο κατατεθειμένων χιλιοστών</td>
                <td colspan="2">{{ submittedPermille.toFixed(1) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <ng-template #noResults>
        <p class="hint">Δεν υπάρχουν ακόμα διαθέσιμα αποτελέσματα.</p>
        <p class="hint error" *ngIf="resultsMessage">{{ resultsMessage }}</p>
      </ng-template>
    </section>
  `,
  styles: `
    .panel { border: 1px solid #243152; background: #101a33; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 0.7rem; margin-bottom: 0.55rem; }
    .back-link { color: #b9cbf3; text-decoration: none; font-weight: 600; }
    h2, h3 { margin: 0; color: #eef3ff; }
    p { margin: 0.2rem 0 0; color: #9db1e2; }
    .hint { color: #9db1e2; margin-top: 0.4rem; }
    .error { color: #ffb7c8; }
    .btn { border: 0; border-radius: 10px; padding: 0.55rem 0.9rem; color: #fff; font-weight: 600; cursor: pointer; }
    .btn-ghost { border: 1px solid #2c3e70; background: #0d1632; }
    .btn-primary { border: 1px solid #4d62a5; background: linear-gradient(135deg, #4e65b9, #617edf); }
    .vote-form { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); align-items: end; }
    .status-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    label { color: #d7e2fb; font-size: 0.86rem; display: grid; gap: 0.35rem; }
    select { border: 1px solid #2a395f; border-radius: 10px; padding: 0.52rem 0.65rem; color: #ecf3ff; background: #0f1830; }
    .table-wrap { overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th, td { text-align: left; padding: 0.52rem; border-bottom: 1px solid #243152; color: #d5e1ff; font-size: 0.87rem; }
    th { color: #a7bce8; font-weight: 600; }
    .results-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.85rem;
      align-items: stretch;
    }
    .pie-wrap {
      border-radius: 11px;
      border: 1px solid #2d406f;
      background: #0e1730;
      padding: 0.7rem;
      display: grid;
      gap: 0.5rem;
      align-content: start;
    }
    .results-pie {
      width: min(100%, 260px);
      aspect-ratio: 1 / 1;
      border-radius: 50%;
      margin: 0 auto;
      border: 1px solid #2d406f;
      box-shadow: inset 0 0 0 1px rgba(8, 14, 30, 0.4);
    }
    .pie-legend { display: grid; gap: 0.22rem; color: #c9d8fb; font-size: 0.82rem; }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 0.4rem;
    }
    .results-table-wrap {
      border-radius: 11px;
      border: 1px solid #2d406f;
      background: #0e1730;
      padding: 0.4rem;
      overflow: auto;
    }
    .results-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 360px;
    }
    .results-table th,
    .results-table td {
      text-align: left;
      padding: 0.5rem 0.55rem;
      border-bottom: 1px solid #243152;
      color: #d5e1ff;
      font-size: 0.85rem;
    }
    .results-table th {
      color: #a7bce8;
      font-weight: 600;
    }
    .results-table tfoot td {
      color: #eef4ff;
      font-weight: 600;
      background: rgba(84, 108, 174, 0.14);
    }
    @media (max-width: 980px) {
      .results-layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class VotingDetailComponent implements OnInit {
  me: Me | null = null;
  writeEnabled = false;
  apartments: Apartment[] = [];
  eligibleApartments: Apartment[] = [];
  session: VoteSession | null = null;
  votes: VoteItem[] = [];
  results: VoteResults | null = null;
  selectedApartmentId: number | null = null;
  selectedVoteValue = 'yes';
  loading = false;
  votesLoading = false;
  resultsLoading = false;
  voteSaving = false;
  adminSaving = false;
  message = '';
  voteMessage = '';
  resultsMessage = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly http: HttpClient,
    private readonly data: AppDataService,
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
    const sessionId = Number(this.route.snapshot.paramMap.get('id'));
    if (!sessionId) {
      this.message = 'Μη έγκυρη συνεδρία.';
      return;
    }
    this.loading = true;
    this.message = '';
    this.data.getMe().subscribe({
      next: (me) => {
        this.me = me;
        this.refreshWriteEnabled();
      },
    });
    this.data.getApartments().subscribe({
      next: (rows) => {
        this.apartments = rows;
        if (this.session) {
          this.eligibleApartments = this.apartments.filter((a) => a.building === DEFAULT_BUILDING_ID);
        }
      },
    });
    this.http
      .get<VoteSession>(`${API_BASE}/api/voting/sessions/${sessionId}/`)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (session) => {
          this.session = session;
          this.eligibleApartments = this.apartments.filter((a) => a.building === DEFAULT_BUILDING_ID);
          this.loadVotes();
          this.loadResults();
        },
        error: (err) => (this.message = err?.error?.detail || 'Αποτυχία φόρτωσης ψηφοφορίας.'),
      });
  }

  loadVotes(): void {
    if (!this.session) return;
    this.votesLoading = true;
    this.http
      .get<{ items: VoteItem[] }>(`${API_BASE}/api/voting/sessions/${this.session.id}/votes/`)
      .pipe(finalize(() => (this.votesLoading = false)))
      .subscribe({ next: (res) => (this.votes = res?.items || []), error: () => (this.votes = []) });
  }

  loadResults(): void {
    if (!this.session) return;
    this.resultsLoading = true;
    this.resultsMessage = '';
    this.http
      .get<VoteResults>(`${API_BASE}/api/voting/sessions/${this.session.id}/results/`)
      .pipe(finalize(() => (this.resultsLoading = false)))
      .subscribe({
        next: (res) => (this.results = res),
        error: (err) => {
          this.results = null;
          this.resultsMessage = err?.error?.detail || 'Αποτυχία φόρτωσης αποτελεσμάτων.';
        },
      });
  }

  submitVote(): void {
    if (!this.session || !this.selectedApartmentId) return;
    this.voteSaving = true;
    this.voteMessage = '';
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/voting/sessions/${this.session.id}/votes/`, {
        apartment_id: this.selectedApartmentId,
        vote_value: this.selectedVoteValue,
      })
      .pipe(finalize(() => (this.voteSaving = false)))
      .subscribe({
        next: (res) => {
          this.voteMessage = res?.detail || 'Η ψήφος καταχωρίστηκε.';
          this.loadVotes();
          this.loadResults();
        },
        error: (err) => (this.voteMessage = err?.error?.detail || 'Αποτυχία καταχώρισης ψήφου.'),
      });
  }

  setStatus(status: VoteSession['status']): void {
    if (!this.session || !this.writeEnabled || !this.canSetStatus(status)) return;
    this.adminSaving = true;
    this.http
      .patch<VoteSession>(`${API_BASE}/api/voting/sessions/${this.session.id}/`, { status })
      .pipe(finalize(() => (this.adminSaving = false)))
      .subscribe({
        next: (updated) => {
          this.session = updated;
          this.loadResults();
        },
        error: () => (this.message = 'Αποτυχία ενημέρωσης κατάστασης.'),
      });
  }

  canSetStatus(nextStatus: VoteSession['status']): boolean {
    if (!this.session) return false;
    const current = this.session.status;
    if (current === nextStatus) return false;
    if (current === 'draft' && (nextStatus === 'active' || nextStatus === 'closed')) return true;
    if (current === 'active' && nextStatus === 'closed') return true;
    return false;
  }

  getSessionTypeLabel(sessionType: VoteSession['session_type']): string {
    return sessionType === 'administrator_election' ? 'Εκλογή διαχειριστή' : 'Θέμα';
  }

  getStatusLabel(status: VoteSession['status']): string {
    if (status === 'active') return 'Ενεργή';
    if (status === 'closed') return 'Κλειστή';
    return 'Πρόχειρη';
  }

  getVoteLabel(value: VoteItem['vote_value']): string {
    if (value === 'yes') return 'Ναι';
    if (value === 'no') return 'Όχι';
    if (value === 'abstain') return 'Αποχή';
    return value;
  }

  get voteOptions(): string[] {
    const options = this.session?.vote_options_json?.length
      ? this.session.vote_options_json
      : ['yes', 'no', 'abstain'];
    if (!options.includes(this.selectedVoteValue)) {
      this.selectedVoteValue = options[0];
    }
    return options;
  }

  get optionResults(): Array<{ label: string; count: number; permille: number }> {
    const options = this.results?.vote_options?.length
      ? this.results.vote_options
      : this.voteOptions;
    return options.map((option) => ({
      label: this.getVoteLabel(option),
      count: this.results?.counts?.[option] ?? 0,
      permille: this.readPermille(option),
    }));
  }

  get pieBackground(): string {
    if (!this.optionResults.length) return '#1a2748';
    const total = Math.max(this.optionResults.reduce((acc, item) => acc + item.permille, 0), 1);
    let cursor = 0;
    const segments = this.optionResults.map((row, index) => {
      const start = cursor;
      const span = (row.permille / total) * 360;
      cursor += span;
      return `${this.optionColor(index)} ${start}deg ${cursor}deg`;
    });
    return `conic-gradient(${segments.join(', ')})`;
  }

  optionColor(index: number): string {
    const palette = ['#44b287', '#b36286', '#7a67c7', '#4c8ee8', '#d19a49', '#61b8c4', '#b57edd', '#6ac06f'];
    return palette[index % palette.length];
  }

  get availableApartments(): Apartment[] {
    const alreadyVoted = new Set(this.votes.map((vote) => vote.apartment));
    const options = this.eligibleApartments.filter((apartment) => !alreadyVoted.has(apartment.id));
    if (this.selectedApartmentId && !options.some((apartment) => apartment.id === this.selectedApartmentId)) {
      this.selectedApartmentId = null;
    }
    if (!this.selectedApartmentId && options.length === 1) {
      this.selectedApartmentId = options[0].id;
    }
    return options;
  }

  get submittedPermille(): number {
    const fallback = this.optionResults.reduce((acc, item) => acc + item.permille, 0);
    return this.readPermille('submitted_total', fallback);
  }

  private clampPermille(value: number | string): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, numeric);
  }

  private readPermille(key: string, fallback = 0): number {
    if (!this.results?.permille) return fallback;
    return this.clampPermille(this.results.permille[key]);
  }
}
