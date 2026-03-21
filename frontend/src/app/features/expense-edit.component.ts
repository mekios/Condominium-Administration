import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { MonthFormatPipe } from '../core/month-format.pipe';
import { EuroPipe } from '../core/euro.pipe';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

import { API_BASE } from '../core/api.constants';
import { AppDataService, Apartment } from '../core/app-data.service';
import { EXPENSE_CATEGORIES, getCategoryConfig } from '../core/expense-categories';

type ExpensePayload = {
  building: number;
  expense_category: string;
  expense_date: string;
  affected_period_start?: string | null;
  affected_period_end?: string | null;
  amount: string;
  description: string;
};

type ExpenseItem = {
  id: number;
  building: number;
  expense_category: string;
  expense_date: string;
  month: string;
  affected_period_start?: string | null;
  affected_period_end?: string | null;
  amount: string;
  description: string;
};

type DraftInvoiceItem = {
  apartment: number;
  apartment_unit_code: string;
  month: string;
  heating_radiators_total: string;
  heated_water_energy_total: string;
  water_consumption_total: string;
  common_recurring_total: string;
  common_non_recurring_total: string;
  owners_only_total: string;
  invoice_total: string;
};

@Component({
  standalone: true,
  selector: 'app-expense-edit',
  imports: [NgIf, NgFor, FormsModule, MonthFormatPipe, EuroPipe, MatDatepickerModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h2>{{ isCreateMode ? 'Νέο έξοδο' : 'Επεξεργασία εξόδου' }}</h2>
        <p *ngIf="expense && !isCreateMode">ID: {{ expense.id }} | Μήνας: {{ expense.month }}</p>
      </div>

      <p class="hint" *ngIf="loading">Φόρτωση εξόδου...</p>
      <p class="hint" *ngIf="message">{{ message }}</p>

      <div class="form-grid" *ngIf="expense && !loading">
        <label>
          Κτίριο
          <select [(ngModel)]="expense.building">
            <option *ngFor="let bid of buildingIds" [ngValue]="bid">Κτίριο #{{ bid }}</option>
          </select>
        </label>
        <label>
          Κατηγορία
          <div class="category-select-wrap">
            <svg
              *ngIf="getIconPath(expense.expense_category)"
              class="cat-icon"
              [class.gardener-icon]="expense.expense_category === 'gardener'"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path [attr.d]="getIconPath(expense.expense_category)" />
            </svg>
            <select [(ngModel)]="expense.expense_category" (ngModelChange)="onCategoryChange()">
              <option *ngFor="let c of categories" [value]="c.value">{{ c.label }}</option>
            </select>
          </div>
        </label>
        <mat-form-field>
          <mat-label>Ημερομηνία εξόδου</mat-label>
          <input matInput [matDatepicker]="expenseDatePicker" [value]="toDate(expense.expense_date)" (click)="expenseDatePicker.open()" (dateChange)="setExpenseDate($event.value)" />
          <mat-datepicker-toggle matIconSuffix [for]="expenseDatePicker"></mat-datepicker-toggle>
          <mat-datepicker #expenseDatePicker></mat-datepicker>
        </mat-form-field>
        <label>
          Ποσό
          <input type="number" step="0.01" [(ngModel)]="expense.amount" />
        </label>
        <mat-form-field *ngIf="requiresMeasurementRange()">
          <mat-label>Έναρξη επηρεαζόμενων μετρήσεων</mat-label>
          <input matInput [matDatepicker]="affectedStartPicker" [value]="toDate(expense.affected_period_start || '')" (click)="affectedStartPicker.open()" (dateChange)="setAffectedPeriodStart($event.value)" />
          <mat-datepicker-toggle matIconSuffix [for]="affectedStartPicker"></mat-datepicker-toggle>
          <mat-datepicker #affectedStartPicker></mat-datepicker>
        </mat-form-field>
        <mat-form-field *ngIf="requiresMeasurementRange()">
          <mat-label>Λήξη επηρεαζόμενων μετρήσεων</mat-label>
          <input matInput [matDatepicker]="affectedEndPicker" [value]="toDate(expense.affected_period_end || '')" (click)="affectedEndPicker.open()" (dateChange)="setAffectedPeriodEnd($event.value)" />
          <mat-datepicker-toggle matIconSuffix [for]="affectedEndPicker"></mat-datepicker-toggle>
          <mat-datepicker #affectedEndPicker></mat-datepicker>
        </mat-form-field>
        <label class="full">
          Περιγραφή
          <input type="text" [(ngModel)]="expense.description" />
        </label>
      </div>

      <div class="actions" *ngIf="expense && !loading">
        <button class="btn btn-primary" (click)="save()" [disabled]="saving">
          {{ saving ? 'Αποθήκευση...' : (isCreateMode ? 'Δημιουργία' : 'Αποθήκευση') }}
        </button>
        <button class="btn btn-ghost" (click)="recalculateDraft()" [disabled]="draftLoading">
          {{ draftLoading ? 'Υπολογισμός...' : 'Επανυπολογισμός προσχεδίου' }}
        </button>
        <button class="btn btn-ghost" (click)="goBack()">Πίσω στη λίστα</button>
      </div>

      <section class="draft-panel" *ngIf="expense && !loading">
        <div class="draft-head">
          <h3>Πρόχειρη χρέωση διαμερισμάτων</h3>
          <p>Μήνας προεπισκόπησης: {{ previewMonth ? (previewMonth | monthFormat) : '-' }}</p>
        </div>
        <p class="hint" *ngIf="draftLoading">Υπολογισμός προσχεδίου...</p>
        <p class="hint" *ngIf="!draftLoading && draftItems.length === 0">Δεν υπάρχουν στοιχεία προσχεδίου για τον μήνα.</p>
        <div class="draft-table-wrap" *ngIf="!draftLoading && draftItems.length">
          <table class="draft-table">
            <thead>
              <tr>
                <th>Διαμέρισμα</th>
                <th>Καλοριφέρ</th>
                <th>Ζεστό νερό</th>
                <th>Νερό</th>
                <th>Κοινόχρηστα</th>
                <th>Έκτακτα</th>
                <th>Μόνο ιδιοκτ.</th>
                <th>Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let item of draftItems">
                <td>{{ item.apartment_unit_code }}</td>
                <td>{{ item.heating_radiators_total | euro }}</td>
                <td>{{ item.heated_water_energy_total | euro }}</td>
                <td>{{ item.water_consumption_total | euro }}</td>
                <td>{{ item.common_recurring_total | euro }}</td>
                <td>{{ item.common_non_recurring_total | euro }}</td>
                <td>{{ (item.owners_only_total || '0.00') | euro }}</td>
                <td>{{ item.invoice_total | euro }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: `
    .panel {
      border: 1px solid #243152;
      background: #101a33;
      border-radius: 12px;
      padding: 1rem;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 1.05rem;
    }
    .panel-head p,
    .hint {
      margin: 0.35rem 0 0.8rem;
      color: #93a8da;
      font-size: 0.9rem;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.7rem;
    }
    label {
      display: grid;
      gap: 0.3rem;
      color: #b5c9f5;
      font-size: 0.86rem;
    }
    label.full {
      grid-column: 1 / -1;
    }
    .category-select-wrap {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .category-select-wrap .cat-icon {
      width: 1.1rem;
      height: 1.1rem;
      flex-shrink: 0;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .category-select-wrap .cat-icon.gardener-icon {
      stroke: #47ff78;
      filter: drop-shadow(0 0 8px rgba(71, 255, 120, 0.65));
    }
    .category-select-wrap select {
      flex: 1;
      min-width: 0;
    }
    input:not([matInput]),
    select {
      border: 1px solid #31416c;
      border-radius: 10px;
      background: #0d1430;
      color: #fff;
      padding: 0.55rem;
    }
    .actions {
      margin-top: 0.9rem;
    }
    .btn {
      border: 0;
      border-radius: 10px;
      padding: 0.58rem 0.95rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary {
      background: linear-gradient(135deg, #4f78ff, #6d62ff);
      box-shadow: 0 8px 18px rgba(70, 95, 255, 0.35);
    }
    .btn-ghost {
      margin-left: 0.6rem;
      background: transparent;
      border: 1px solid #3b4b79;
    }
    .draft-panel {
      margin-top: 1rem;
      border-top: 1px solid #243152;
      padding-top: 1rem;
    }
    .draft-head h3 {
      margin: 0;
      font-size: 0.98rem;
    }
    .draft-head p {
      margin: 0.3rem 0 0.8rem;
      color: #93a8da;
      font-size: 0.84rem;
    }
    .draft-table-wrap {
      overflow: auto;
    }
    .draft-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 780px;
      font-size: 0.85rem;
    }
    .draft-table th,
    .draft-table td {
      border-bottom: 1px solid #243152;
      padding: 0.45rem;
      text-align: left;
      white-space: nowrap;
    }
    .draft-table th {
      color: #9db2e5;
      font-weight: 600;
    }
  `,
})
export class ExpenseEditComponent implements OnInit {
  isCreateMode = false;
  loading = true;
  saving = false;
  draftLoading = false;
  message = '';
  expense: ExpenseItem | null = null;
  apartments: Apartment[] = [];
  buildingIds: number[] = [];
  previewMonth = '';
  draftItems: DraftInvoiceItem[] = [];
  categories = EXPENSE_CATEGORIES;

  constructor(
    private readonly http: HttpClient,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly data: AppDataService,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.isCreateMode = id === 'new' || this.route.snapshot.routeConfig?.path === 'expenses/new';
    this.data.getApartments().subscribe({
      next: (apartments) => {
        this.apartments = apartments;
        this.buildingIds = [...new Set(apartments.map((apartment) => apartment.building))];
        this.loadExpense(id);
      },
      error: () => {
        this.message = 'Δεν ήταν δυνατή η φόρτωση διαμερισμάτων.';
        this.loading = false;
      },
    });
  }

  getIconPath(category: string): string | null {
    return getCategoryConfig(category)?.iconPath ?? null;
  }

  requiresMeasurementRange(): boolean {
    return (
      this.expense?.expense_category === 'gas_heating_bill' ||
      this.expense?.expense_category === 'water_hw_consumption_bill' ||
      this.expense?.expense_category === 'gas_hw_consumption_bill'
    );
  }

  onCategoryChange(): void {
    if (!this.expense || this.requiresMeasurementRange()) return;
    // For non-measurement categories, send null dates instead of empty strings.
    this.expense.affected_period_start = null;
    this.expense.affected_period_end = null;
  }

  save(): void {
    if (!this.expense) return;
    if (this.requiresMeasurementRange() && (!this.expense.affected_period_start || !this.expense.affected_period_end)) {
      this.message = 'Για θέρμανση/ζεστό νερό πρέπει να ορίσετε εύρος ημερομηνιών μετρήσεων.';
      return;
    }
    this.saving = true;
    const payload: ExpensePayload = {
      building: this.expense.building,
      expense_category: this.expense.expense_category,
      expense_date: this.expense.expense_date,
      affected_period_start: this.expense.affected_period_start || null,
      affected_period_end: this.expense.affected_period_end || null,
      amount: this.expense.amount,
      description: this.expense.description || '',
    };
    const request$ = this.isCreateMode
      ? this.http.post<ExpenseItem>(`${API_BASE}/api/accounting/expenses/`, payload)
      : this.http.patch<ExpenseItem>(`${API_BASE}/api/accounting/expenses/${this.expense.id}/`, payload);

    request$.subscribe({
      next: (expense) => {
        this.expense = expense;
        this.isCreateMode = false;
        this.previewMonth = expense.expense_date.slice(0, 7);
        this.message = 'Το έξοδο αποθηκεύτηκε.';
        this.saving = false;
        this.loadDraftPreview();
      },
      error: () => {
        this.message = 'Αποτυχία αποθήκευσης εξόδου.';
        this.saving = false;
      },
    });
  }

  goBack(): void {
    this.router.navigateByUrl('/app/expenses');
  }

  recalculateDraft(): void {
    if (!this.expense) return;
    this.previewMonth = this.expense.expense_date.slice(0, 7);
    this.loadDraftPreview();
  }

  toDate(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  setExpenseDate(value: Date | null): void {
    if (!value || !this.expense) return;
    this.expense.expense_date = this.toIsoDate(value);
  }

  setAffectedPeriodStart(value: Date | null): void {
    if (!value || !this.expense) return;
    this.expense.affected_period_start = this.toIsoDate(value);
  }

  setAffectedPeriodEnd(value: Date | null): void {
    if (!value || !this.expense) return;
    this.expense.affected_period_end = this.toIsoDate(value);
  }

  private loadExpense(id: string | null): void {
    if (this.isCreateMode) {
      const today = new Date().toISOString().slice(0, 10);
      this.expense = {
        id: 0,
        building: this.buildingIds[0] ?? 0,
        expense_category: 'gas_heating_bill',
        expense_date: today,
        month: today.slice(0, 7),
        affected_period_start: '',
        affected_period_end: '',
        amount: '',
        description: '',
      };
      this.previewMonth = this.expense.month;
      this.loading = false;
      this.loadDraftPreview();
      return;
    }

    if (!id) {
      this.message = 'Μη έγκυρο ID εξόδου.';
      this.loading = false;
      return;
    }

    this.http.get<ExpenseItem>(`${API_BASE}/api/accounting/expenses/${id}/`).subscribe({
      next: (expense) => {
        this.expense = {
          ...expense,
          affected_period_start: expense.affected_period_start || null,
          affected_period_end: expense.affected_period_end || null,
        };
        this.previewMonth = expense.expense_date.slice(0, 7);
        this.loading = false;
        this.loadDraftPreview();
      },
      error: () => {
        this.message = 'Δεν ήταν δυνατή η φόρτωση του εξόδου.';
        this.loading = false;
      },
    });
  }

  private loadDraftPreview(): void {
    if (!this.expense || !this.previewMonth || !this.expense.building) {
      this.draftItems = [];
      return;
    }
    this.draftLoading = true;
    this.http.get<{ month: string; items: DraftInvoiceItem[] }>(`${API_BASE}/api/invoices/preview/?month=${this.previewMonth}`).subscribe({
      next: (resp) => {
        this.draftItems = resp.items
          .filter((item) =>
            this.apartments.some((apartment) => apartment.id === item.apartment && apartment.building === this.expense?.building),
          )
          .sort((a, b) => this.extractUnitCode(a.apartment_unit_code).localeCompare(this.extractUnitCode(b.apartment_unit_code), 'el'));
        this.draftLoading = false;
      },
      error: () => {
        this.draftItems = [];
        this.draftLoading = false;
      },
    });
  }

  private extractUnitCode(apartmentLabel: string): string {
    return apartmentLabel.split('-')[0].trim();
  }

  private toIsoDate(value: Date): string {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
