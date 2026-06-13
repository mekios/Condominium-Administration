import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';

import { finalize, forkJoin, of, Subscription, switchMap } from 'rxjs';

import { AppDataService, Apartment, Invoice, Me } from '../core/app-data.service';
import { AdminModeService } from '../core/admin-mode.service';
import { API_BASE, DEFAULT_BUILDING_ID } from '../core/api.constants';
import { EuroPipe } from '../core/euro.pipe';
import { MonthFormatPipe } from '../core/month-format.pipe';
import {
  getCategoryIconColor,
  getCategoryIconGlow,
  getDisplayLabel,
  getIconPath,
  isFundIncreaseCategory,
} from '../core/expense-categories';

type ExpenseItem = {
  id: number;
  building: number;
  expense_category: string;
  expense_date: string;
  month: string;
  amount: string;
  description: string;
};

type Building = {
  id: number;
  name: string;
  fund_balance: string;
};

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [NgIf, NgFor, FormsModule, EuroPipe, MonthFormatPipe],
  template: `
    <section class="stats">
      <article class="stat-card welcome-card">
        <p class="welcome-kicker">Dashboard</p>
        <h1 class="welcome-title">
          {{ greetingPrefix }}, <span class="welcome-name">{{ me?.username || 'Χρήστη' }}</span>
        </h1>
        <p class="welcome-sub">
          {{ greetingSubtitle }}
        </p>
        <p class="welcome-apts" *ngIf="!loading && apartmentGreetingText">
          {{ apartmentGreetingText }}
        </p>
      </article>
      <article class="stat-card finance-card" [class.negative]="buildingFinanceBalance < 0">
        <p class="label">Υπόλοιπο ταμείου κτιρίου</p>
        <p class="value">{{ buildingFinanceBalance | euro }}</p>
        <div class="finance-breakdown">
          <div class="fund-row">
            <span>Αποθεματικό</span>
            <div class="fund-value" *ngIf="!editingFund">
              <strong>{{ openingBalance | euro }}</strong>
              <button
                class="fund-edit-btn"
                *ngIf="canManage"
                type="button"
                (click)="startFundEdit()"
                aria-label="Επεξεργασία αποθεματικού"
              >
                ✎
              </button>
            </div>
            <div class="fund-edit" *ngIf="editingFund">
              <input type="number" step="0.01" [(ngModel)]="fundDraft" />
              <button class="fund-save-btn" type="button" (click)="saveFundBalance()" [disabled]="fundSaving">
                {{ fundSaving ? '...' : 'OK' }}
              </button>
              <button class="fund-cancel-btn" type="button" (click)="cancelFundEdit()" [disabled]="fundSaving">✕</button>
            </div>
          </div>
          <div><span>- Έξοδα</span><strong>{{ latestExpensesTotal | euro }}</strong></div>
          <div><span>- Ανεξόφλητα</span><strong>{{ unpaidTotal | euro }}</strong></div>
        </div>
        <div class="finance-meter" role="presentation">
          <span class="fill" [style.width.%]="balanceFillPercent"></span>
        </div>
      </article>
    </section>

    <section class="panel">
      <h2>{{ unpaidInvoices.length ? 'Ανεξόφλητοι λογαριασμοί' : 'Τελευταίοι λογαριασμοί' }}</h2>
      <p class="hint" *ngIf="loading">Φόρτωση δεδομένων...</p>
      <p class="hint" *ngIf="message">{{ message }}</p>

      <div class="invoice-grid" *ngIf="!loading && displayInvoices.length; else emptyUnpaid">
        <article class="invoice-card" *ngFor="let inv of displayInvoices">
          <header class="card-head">
            <div>
              <h3>{{ inv.apartment_unit_code }}</h3>
              <p>Μήνας {{ inv.month | monthFormat }}</p>
            </div>
            <span class="status" [class.status-open]="inv.outstanding_balance !== '0.00'">
              {{ inv.status === 'paid' ? 'Εξοφλημένο' : 'Εκδομένο' }}
            </span>
          </header>
          <div class="totals">
            <div><span>Σύνολο</span><strong>{{ inv.invoice_total | euro }}</strong></div>
            <div><span>Υπόλοιπο</span><strong>{{ inv.outstanding_balance | euro }}</strong></div>
          </div>
          <button class="download-btn" (click)="downloadInvoicePdf(inv)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
            <span>PDF</span>
          </button>
        </article>
      </div>

      <ng-template #emptyUnpaid>
        <p class="hint" *ngIf="!loading">Δεν υπάρχουν λογαριασμοί για εμφάνιση.</p>
      </ng-template>
    </section>

    <section class="panel">
      <h2>Έξοδα τελευταίου εκδομένου μήνα</h2>
      <div class="panel-actions">
        <button class="analysis-btn" (click)="openFullAnalysis()">Πλήρης ανάλυση ανά διαμέρισμα</button>
      </div>
      <p class="hint" *ngIf="latestIssuedMonth">
        Μήνας: {{ latestIssuedMonth | monthFormat }}
      </p>
      <p class="hint" *ngIf="!latestIssuedMonth">Δεν υπάρχουν εκδομένοι λογαριασμοί ακόμα.</p>
      <div class="table-wrap" *ngIf="latestExpenses.length; else emptyExpenses">
        <table class="expenses-table">
          <thead>
            <tr>
              <th>Κατηγορία</th>
              <th>Ποσό</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let expense of latestExpenses">
              <td class="cat-cell">
                <span class="cat-inner">
                  <svg
                    *ngIf="getIconPath(expense.expense_category)"
                    class="cat-icon"
                    [style.stroke]="getCategoryIconColor(expense.expense_category)"
                    [style.filter]="getCategoryIconGlow(expense.expense_category)"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path [attr.d]="getIconPath(expense.expense_category)" />
                  </svg>
                  <span>{{ getDisplayLabel(expense) }}</span>
                </span>
              </td>
              <td>{{ expense.amount | euro }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Σύνολο μήνα</td>
              <td>{{ latestExpensesTotal | euro }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ng-template #emptyExpenses>
        <p class="hint">Δεν υπάρχουν έξοδα για τον μήνα.</p>
      </ng-template>
    </section>
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.85fr);
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .stat-card {
      border: 1px solid #243152;
      background: #101a33;
      border-radius: 12px;
      padding: 0.8rem;
    }
    .label { font-size: 0.82rem; color: #8ea6de; margin-bottom: 0.2rem; }
    .value { font-size: 1.4rem; color: #fff; font-weight: 700; }
    .sub { margin: 0.3rem 0 0; color: #9db1e2; font-size: 0.78rem; }
    .welcome-card {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      min-height: 108px;
      border: 0;
      background: transparent;
      box-shadow: none;
      padding: 0.15rem 0.1rem 0.35rem;
    }
    .welcome-kicker {
      margin: 0;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.11em;
      color: #86a5ff;
      font-weight: 700;
    }
    .welcome-title {
      margin: 0.35rem 0 0;
      font-family: "Roboto Condensed", "Roboto", "Segoe UI", Arial, sans-serif;
      font-size: clamp(1.36rem, 2.5vw, 2.05rem);
      line-height: 1.08;
      color: #f8fbff;
      font-weight: 700;
      letter-spacing: -0.015em;
    }
    .welcome-name {
      background: linear-gradient(90deg, #8eb1ff 0%, #c39dff 55%, #7ce8ff 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .welcome-sub {
      margin: 0.45rem 0 0;
      color: #a9bee9;
      font-size: 0.94rem;
      line-height: 1.55;
      max-width: 62ch;
      font-weight: 450;
    }
    .welcome-apts {
      margin: 0.35rem 0 0;
      color: #8ea6de;
      font-size: 0.86rem;
      line-height: 1.4;
      font-weight: 500;
    }
    .finance-card {
      border-color: #2f4f8a;
      background: linear-gradient(165deg, #122346 0%, #1b2050 52%, #12193a 100%);
      padding: 0.85rem 0.95rem;
    }
    .finance-card .label {
      font-size: 0.98rem;
      margin-bottom: 0.35rem;
    }
    .finance-card .value {
      font-size: 2rem;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .finance-card.negative {
      border-color: #91556a;
      background: linear-gradient(165deg, #2a1630 0%, #301a36 52%, #1b1328 100%);
    }
    .finance-breakdown {
      margin-top: 0.5rem;
      display: grid;
      gap: 0.35rem;
      font-size: 0.95rem;
    }
    .finance-breakdown > div {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dashed rgba(145, 175, 234, 0.22);
      padding-bottom: 0.15rem;
    }
    .fund-row {
      align-items: center;
      gap: 0.5rem;
    }
    .fund-value {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .fund-edit-btn,
    .fund-save-btn,
    .fund-cancel-btn {
      border: 1px solid #4c66a8;
      background: rgba(36, 68, 127, 0.55);
      color: #eef3ff;
      border-radius: 6px;
      padding: 0.15rem 0.4rem;
      font-size: 0.82rem;
      cursor: pointer;
      line-height: 1.2;
    }
    .fund-edit {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .fund-edit input {
      width: 6.5rem;
      border: 1px solid #395f9c;
      background: #0f1a35;
      color: #eef3ff;
      border-radius: 6px;
      padding: 0.15rem 0.35rem;
      font-size: 0.92rem;
    }
    .finance-breakdown span { color: #adc0ea; }
    .finance-breakdown strong {
      color: #e8f0ff;
      font-size: 1.05rem;
      font-weight: 700;
    }
    .finance-meter {
      margin-top: 0.45rem;
      height: 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.14);
      overflow: hidden;
    }
    .finance-meter .fill {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #4f84ff, #8e68ff);
    }
    .finance-card.negative .finance-meter .fill {
      background: linear-gradient(90deg, #ff8ba9, #ff6b8f);
    }
    .analysis-btn {
      border: 1px solid #5c74b7;
      background: linear-gradient(135deg, #2a4587, #3f4292);
      color: #f2f6ff;
      border-radius: 10px;
      padding: 0.46rem 0.72rem;
      font-weight: 600;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .panel-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 0.4rem;
    }
    .panel {
      border: 1px solid #243152;
      background: #101a33;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    h2 { margin: 0 0 0.65rem; font-size: 1.05rem; }
    .invoice-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.7rem;
      align-items: start;
    }
    .invoice-card {
      border: 1px solid #2a3b65;
      background: linear-gradient(160deg, #111a3f 0%, #171a45 46%, #111531 100%);
      border-radius: 12px;
      padding: 0.75rem;
      display: grid;
      gap: 0.7rem;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 0.6rem;
    }
    .card-head h3 { margin: 0; font-size: 0.95rem; }
    .card-head p { margin: 0.15rem 0 0; color: #9db3e9; font-size: 0.8rem; }
    .totals { display: grid; gap: 0.3rem; }
    .totals div {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dashed #24355f;
      padding-bottom: 0.2rem;
      font-size: 0.86rem;
    }
    .download-btn {
      margin-top: 0.2rem;
      border: 1px solid #4c66a8;
      background: linear-gradient(135deg, #24447f, #2a3c75);
      color: #eef3ff;
      border-radius: 8px;
      padding: 0.28rem 0.5rem;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      width: fit-content;
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      line-height: 1;
    }
    .download-btn svg {
      width: 0.78rem;
      height: 0.78rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .status {
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      border: 1px solid #395f9c;
      background: #1a2f55;
      color: #bdd6ff;
    }
    .status-open {
      border: 1px solid #9e7840;
      background: #3b2f1a;
      color: #ffd38a;
    }
    .hint {
      margin-top: 0.5rem;
      color: #9db1e2;
    }
    .table-wrap {
      overflow: auto;
      margin-top: 0.6rem;
    }
    .expenses-table {
      width: 100%;
      min-width: 360px;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .expenses-table th,
    .expenses-table td {
      border-bottom: 1px solid #243152;
      padding: 0.5rem;
      text-align: left;
      vertical-align: middle;
    }
    .expenses-table th {
      color: #9fb6e8;
      font-weight: 600;
    }
    .expenses-table tfoot td {
      font-weight: 700;
      color: #e8f1ff;
      border-top: 1px solid #3a4f82;
      border-bottom: 0;
      background: rgba(85, 104, 166, 0.2);
    }
    .cat-inner {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
    }
    .cat-icon {
      width: 1.08rem;
      height: 1.08rem;
      flex-shrink: 0;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    @media (max-width: 1023px) {
      .stats { grid-template-columns: 1fr; }
    }
    @media (max-width: 1300px) {
      .invoice-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .invoice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .invoice-grid { grid-template-columns: 1fr; }
    }
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  me: Me | null = null;
  apartments: Apartment[] = [];
  invoices: Invoice[] = [];
  unpaidInvoices: Invoice[] = [];
  displayInvoices: Invoice[] = [];
  latestInvoices: Invoice[] = [];
  latestExpenses: ExpenseItem[] = [];
  month = new Date().toISOString().slice(0, 7);
  openingBalance = 0;
  latestIssuedMonth = '';
  latestExpensesTotal = 0;
  unpaidTotal = 0;
  buildingFinanceBalance = 0;
  balanceFillPercent = 100;
  canManage = false;
  editingFund = false;
  fundDraft = '';
  fundSaving = false;
  message = '';
  loading = true;
  greetingPrefix = 'Καλημέρα';
  greetingSubtitle = 'Επισκόπηση οικονομικών, λογαριασμών και κινήσεων της πολυκατοικίας σε μία ματιά.';
  readonly getDisplayLabel = getDisplayLabel;
  readonly getIconPath = getIconPath;
  readonly getCategoryIconColor = getCategoryIconColor;
  readonly getCategoryIconGlow = getCategoryIconGlow;
  private adminModeSub?: Subscription;

  constructor(
    private readonly data: AppDataService,
    private readonly http: HttpClient,
    private readonly router: Router,
    private readonly adminMode: AdminModeService,
  ) {}

  ngOnInit(): void {
    this.setGreetingByCurrentTime();
    this.adminModeSub = this.adminMode.adminModeActive$.subscribe(() => this.refreshCanManage());
    this.loading = true;
    this.message = '';
    this.data
      .getMe()
      .pipe(
        switchMap((me) =>
          forkJoin({
            me: of(me),
            apartments: this.data.getLinkedApartments(),
            personalInvoices: this.http.get<Invoice[]>(`${API_BASE}/api/invoices/?personal_scope=1`),
            buildingInvoices: this.http.get<Invoice[]>(this.buildingInvoicesUrl(me)),
            building: this.http.get<Building>(`${API_BASE}/api/buildings/${DEFAULT_BUILDING_ID}/`),
          }),
        ),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: ({ me, apartments, personalInvoices, buildingInvoices, building }) => {
          this.me = me;
          this.refreshCanManage();
          this.apartments = apartments;
          this.invoices = personalInvoices;
          this.openingBalance = Number(building.fund_balance || 0);
          this.unpaidInvoices = personalInvoices.filter((inv) => Number(inv.outstanding_balance) > 0);
          this.latestInvoices = this.findLatestInvoices(personalInvoices);
          this.displayInvoices = this.unpaidInvoices.length ? this.unpaidInvoices : this.latestInvoices;
          this.unpaidTotal = buildingInvoices
            .filter((inv) => Number(inv.outstanding_balance) > 0)
            .reduce((sum, inv) => sum + Number(inv.outstanding_balance || 0), 0);
          this.latestIssuedMonth = this.findLatestIssuedMonth(buildingInvoices);
          if (this.latestIssuedMonth) {
            this.loadLatestExpenses(this.latestIssuedMonth);
          } else {
            this.recomputeBuildingBalance();
          }
        },
        error: () => {
          this.message = 'Αποτυχία φόρτωσης δεδομένων πίνακα ελέγχου.';
        },
      });
  }

  ngOnDestroy(): void {
    this.adminModeSub?.unsubscribe();
  }

  private refreshCanManage(): void {
    this.canManage = this.adminMode.canManage(this.me);
    if (!this.canManage) {
      this.editingFund = false;
    }
  }

  startFundEdit(): void {
    this.fundDraft = this.openingBalance.toFixed(2);
    this.editingFund = true;
  }

  cancelFundEdit(): void {
    this.editingFund = false;
  }

  saveFundBalance(): void {
    if (!this.canManage || this.fundSaving) return;
    const amount = Number(this.fundDraft);
    if (!Number.isFinite(amount) || amount < 0) {
      this.message = 'Μη έγκυρο ποσό αποθεματικού.';
      return;
    }
    this.fundSaving = true;
    this.message = '';
    this.http
      .patch<Building>(`${API_BASE}/api/buildings/${DEFAULT_BUILDING_ID}/`, {
        fund_balance: amount.toFixed(2),
      })
      .subscribe({
        next: (building) => {
          this.openingBalance = Number(building.fund_balance || 0);
          this.editingFund = false;
          this.fundSaving = false;
          this.recomputeBuildingBalance();
        },
        error: () => {
          this.fundSaving = false;
          this.message = 'Αποτυχία αποθήκευσης αποθεματικού.';
        },
      });
  }

  private buildingInvoicesUrl(me: Me): string {
    if (me.role === 'superadmin' || me.role === 'administrator') {
      return `${API_BASE}/api/invoices/`;
    }
    return `${API_BASE}/api/invoices/?building_scope=1`;
  }

  private loadLatestExpenses(month: string): void {
    this.http.get<ExpenseItem[]>(`${API_BASE}/api/accounting/expenses/?month=${month}`).subscribe({
      next: (expenses) => {
        this.latestExpenses = expenses;
        this.latestExpensesTotal = expenses
          .filter((expense) => !isFundIncreaseCategory(expense.expense_category))
          .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        this.recomputeBuildingBalance();
      },
      error: () => {
        this.latestExpenses = [];
        this.latestExpensesTotal = 0;
        this.recomputeBuildingBalance();
      },
    });
  }

  private findLatestIssuedMonth(invoices: Invoice[]): string {
    const issuedMonths = invoices
      .filter((invoice) => invoice.status === 'issued' || invoice.status === 'paid')
      .map((invoice) => invoice.month);
    if (!issuedMonths.length) return '';
    return [...issuedMonths].sort().reverse()[0];
  }

  private findLatestInvoices(invoices: Invoice[]): Invoice[] {
    return [...invoices]
      .sort((a, b) => {
        if (a.month === b.month) {
          return a.apartment_unit_code.localeCompare(b.apartment_unit_code, 'el');
        }
        return a.month < b.month ? 1 : -1;
      })
      .slice(0, 4);
  }

  private recomputeBuildingBalance(): void {
    this.buildingFinanceBalance = this.openingBalance - this.latestExpensesTotal - this.unpaidTotal;
    const ratio = this.openingBalance > 0 ? (this.buildingFinanceBalance / this.openingBalance) * 100 : 0;
    this.balanceFillPercent = Math.max(0, Math.min(100, ratio));
  }

  downloadInvoicePdf(invoice: Invoice): void {
    this.http.get(`${API_BASE}/api/invoices/${invoice.id}/download-pdf/`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${invoice.month}-${invoice.apartment_unit_code}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.message = 'Αποτυχία λήψης PDF λογαριασμού.';
      },
    });
  }

  openFullAnalysis(): void {
    this.router.navigateByUrl('/app/analysis');
  }

  get apartmentGreetingText(): string {
    if (!this.apartments.length) return '';
    const labels = this.apartments.map((apt) => apt.apartment_label);
    if (labels.length === 1) return `Διαμέρισμα ${labels[0]}`;
    return `Διαμερίσματα ${labels.join(', ')}`;
  }

  private setGreetingByCurrentTime(): void {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      this.greetingPrefix = 'Καλημέρα';
      this.greetingSubtitle = 'Καλή αρχή! Δες τις σημερινές οικονομικές εκκρεμότητες με μια ματιά.';
      return;
    }
    if (hour >= 12 && hour < 18) {
      this.greetingPrefix = 'Καλό μεσημέρι';
      this.greetingSubtitle = 'Γρήγορος έλεγχος λογαριασμών και πληρωμών για πλήρη εικόνα.';
      return;
    }
    this.greetingPrefix = 'Καλησπέρα';
    this.greetingSubtitle = 'Ολοκλήρωσε την ημέρα με μια γρήγορη επισκόπηση υπολοίπων και κινήσεων.';
  }
}
