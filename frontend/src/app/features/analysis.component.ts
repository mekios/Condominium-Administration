import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Subject,
  catchError,
  forkJoin,
  map,
  of,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';

import { API_BASE } from '../core/api.constants';
import { Invoice } from '../core/app-data.service';
import { EuroPipe } from '../core/euro.pipe';
import { MonthFormatPipe } from '../core/month-format.pipe';
import { MonthPickerComponent } from '../core/month-picker/month-picker.component';
import { currentMonth } from '../core/month.utils';
import { getDisplayLabel } from '../core/expense-categories';

type ExpenseItem = {
  id: number;
  expense_category: string;
  amount: string;
  expense_date: string;
  month: string;
};

type DraftInvoiceItem = {
  apartment_unit_code: string;
  heating_radiators_total: string;
  heated_water_energy_total: string;
  water_consumption_total: string;
  common_recurring_total: string;
  common_non_recurring_total: string;
  owners_only_total: string;
  invoice_total: string;
};

type ApartmentAnalysisRow = {
  apartmentUnitCode: string;
  heatingRadiatorsTotal: string;
  heatedWaterEnergyTotal: string;
  waterConsumptionTotal: string;
  commonRecurringTotal: string;
  commonNonRecurringTotal: string;
  ownersOnlyTotal: string;
  invoiceTotal: string;
  sharePercent: number;
};

type MonthLoadResult = {
  month: string;
  expenses: ExpenseItem[];
  analysisRows: ApartmentAnalysisRow[];
  totalExpenses: number;
  totalInvoices: number;
  isPreview: boolean;
  previewError: string | null;
};

@Component({
  standalone: true,
  selector: 'app-analysis',
  imports: [NgIf, NgFor, EuroPipe, MonthFormatPipe, MonthPickerComponent],
  template: `
    <section class="panel">
      <header class="head">
        <div>
          <h2>Πλήρης ανάλυση ανά διαμέρισμα</h2>
          <p class="hint">Έξοδα μήνα και μερίδιο ανά διαμέρισμα για όλη την πολυκατοικία.</p>
        </div>
        <div class="toolbar">
          <app-month-picker [value]="selectedMonth" (valueChange)="onMonthChange($event)" />
        </div>
      </header>

      <p class="hint" *ngIf="loading">Φόρτωση ανάλυσης...</p>
      <p class="hint error" *ngIf="!loading && message">{{ message }}</p>
      <p class="hint preview-note" *ngIf="!loading && isPreview && analysisRows.length">
        Προεπισκόπηση κατανομής — δεν έχουν εκδοθεί επίσημοι λογαριασμοί για αυτόν τον μήνα.
      </p>
    </section>

    <section class="panel">
      <h3>Έξοδα μήνα {{ selectedMonth | monthFormat }}</h3>
      <div class="table-wrap" *ngIf="expenses.length; else noExpenses">
        <table>
          <thead>
            <tr>
              <th>Κατηγορία</th>
              <th>Ημερομηνία</th>
              <th>Ποσό</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of expenses">
              <td>{{ getDisplayLabel(item) }}</td>
              <td>{{ item.expense_date }}</td>
              <td>{{ item.amount | euro }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">Σύνολο εξόδων μήνα</td>
              <td>{{ totalExpenses | euro }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ng-template #noExpenses>
        <p class="hint">Δεν υπάρχουν έξοδα για αυτόν τον μήνα.</p>
      </ng-template>
    </section>

    <section class="panel">
      <h3>Μερίδιο ανά διαμέρισμα (όλα τα διαμερίσματα)</h3>
      <div class="table-wrap" *ngIf="analysisRows.length; else noShares">
        <table>
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
              <th>Μερίδιο</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of analysisRows">
              <td>{{ row.apartmentUnitCode }}</td>
              <td>{{ row.heatingRadiatorsTotal | euro }}</td>
              <td>{{ row.heatedWaterEnergyTotal | euro }}</td>
              <td>{{ row.waterConsumptionTotal | euro }}</td>
              <td>{{ row.commonRecurringTotal | euro }}</td>
              <td>{{ row.commonNonRecurringTotal | euro }}</td>
              <td>{{ row.ownersOnlyTotal | euro }}</td>
              <td>{{ row.invoiceTotal | euro }}</td>
              <td>{{ row.sharePercent.toFixed(2) }}%</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7">Σύνολο λογαριασμών μήνα</td>
              <td>{{ totalInvoices | euro }}</td>
              <td>100.00%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ng-template #noShares>
        <p class="hint">Δεν υπάρχουν λογαριασμοί ή προεπισκόπηση κατανομής για αυτόν τον μήνα.</p>
      </ng-template>
    </section>
  `,
  styles: `
    .panel {
      border: 1px solid #243152;
      background: #101a33;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: 0.8rem;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .toolbar {
      min-width: min(100%, 20rem);
      flex: 1 1 20rem;
    }
    h2, h3 {
      margin: 0 0 0.55rem;
      color: #edf3ff;
    }
    .hint {
      margin: 0.25rem 0 0;
      color: #9db1e2;
    }
    .preview-note {
      color: #ffd37d;
    }
    .error {
      color: #ffb8c9;
    }
    .table-wrap {
      overflow: auto;
      margin-top: 0.5rem;
    }
    table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      text-align: left;
      padding: 0.5rem;
      border-bottom: 1px solid #243152;
    }
    th {
      color: #a7bce8;
      font-weight: 600;
    }
    tbody tr {
      transition: background-color 0.15s ease;
    }
    tbody tr:hover {
      background: rgba(92, 120, 196, 0.22);
    }
    tfoot td {
      font-weight: 700;
      color: #eef3ff;
      border-top: 1px solid #38518b;
      border-bottom: 0;
      background: rgba(82, 104, 166, 0.2);
    }
    @media (max-width: 900px) {
      .head {
        flex-direction: column;
      }
    }
  `,
})
export class AnalysisComponent implements OnInit, OnDestroy {
  readonly getDisplayLabel = getDisplayLabel;
  selectedMonth = currentMonth();
  expenses: ExpenseItem[] = [];
  analysisRows: ApartmentAnalysisRow[] = [];
  totalExpenses = 0;
  totalInvoices = 0;
  loading = false;
  isPreview = false;
  message = '';

  private readonly destroy$ = new Subject<void>();
  private readonly monthLoad$ = new Subject<string>();

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.monthLoad$
      .pipe(
        tap(() => {
          this.loading = true;
          this.message = '';
        }),
        switchMap((month) => this.fetchMonthAnalysis(month)),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (result) => this.applyMonthResult(result),
        error: () => {
          this.loading = false;
          this.clearMonthData();
          this.message = 'Αποτυχία φόρτωσης ανάλυσης.';
        },
      });

    this.initializeDefaultMonth();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onMonthChange(month: string): void {
    if (!month || month === this.selectedMonth) return;
    this.selectedMonth = month;
    this.monthLoad$.next(month);
  }

  private initializeDefaultMonth(): void {
    forkJoin({
      invoices: this.http
        .get<Invoice[]>(`${API_BASE}/api/invoices/?building_scope=1`)
        .pipe(catchError(() => of([] as Invoice[]))),
      expenses: this.http
        .get<ExpenseItem[]>(`${API_BASE}/api/accounting/expenses/`)
        .pipe(catchError(() => of([] as ExpenseItem[]))),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ invoices, expenses }) => {
          const months = new Set<string>();
          for (const invoice of invoices) {
            if (invoice.status === 'issued' || invoice.status === 'paid') {
              months.add(invoice.month);
            }
          }
          for (const expense of expenses) {
            if (expense.month) {
              months.add(expense.month);
            }
          }
          const sorted = [...months].sort().reverse();
          if (sorted.length) {
            this.selectedMonth = sorted[0];
          }
          this.monthLoad$.next(this.selectedMonth);
        },
        error: () => {
          this.message = 'Αποτυχία φόρτωσης δεδομένων ανάλυσης.';
          this.monthLoad$.next(this.selectedMonth);
        },
      });
  }

  private fetchMonthAnalysis(month: string) {
    return forkJoin({
      expenses: this.http
        .get<ExpenseItem[]>(`${API_BASE}/api/accounting/expenses/?month=${month}`)
        .pipe(catchError(() => of([] as ExpenseItem[]))),
      invoices: this.http
        .get<Invoice[]>(`${API_BASE}/api/invoices/?month=${month}&building_scope=1`)
        .pipe(catchError(() => of([] as Invoice[]))),
    }).pipe(
      switchMap(({ expenses, invoices }) => {
        const issued = invoices.filter((inv) => inv.status === 'issued' || inv.status === 'paid');
        if (issued.length) {
          return of(this.buildResultFromInvoices(month, expenses, issued, false, null));
        }
        return this.http
          .get<{ items: DraftInvoiceItem[] }>(`${API_BASE}/api/invoices/preview/?month=${month}`)
          .pipe(
            map((preview) =>
              this.buildResultFromPreview(month, expenses, preview.items, null),
            ),
            catchError((err) => {
              const detail = err?.error?.detail as string | undefined;
              return of(
                this.buildResultFromPreview(month, expenses, [], detail || 'Αποτυχία προεπισκόπησης.'),
              );
            }),
          );
      }),
    );
  }

  private buildResultFromInvoices(
    month: string,
    expenses: ExpenseItem[],
    invoices: Invoice[],
    isPreview: boolean,
    previewError: string | null,
  ): MonthLoadResult {
    const sorted = [...invoices].sort((a, b) =>
      a.apartment_unit_code.localeCompare(b.apartment_unit_code, 'el'),
    );
    const totalExpenses = expenses
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalInvoices = sorted.reduce((sum, inv) => sum + Number(inv.invoice_total || 0), 0);
    const analysisRows = sorted.map((inv) => {
      const amount = Number(inv.invoice_total || 0);
      return {
        apartmentUnitCode: inv.apartment_unit_code,
        heatingRadiatorsTotal: inv.heating_radiators_total,
        heatedWaterEnergyTotal: inv.heated_water_energy_total,
        waterConsumptionTotal: inv.water_consumption_total,
        commonRecurringTotal: inv.common_recurring_total,
        commonNonRecurringTotal: inv.common_non_recurring_total,
        ownersOnlyTotal: inv.owners_only_total,
        invoiceTotal: inv.invoice_total,
        sharePercent: totalInvoices > 0 ? (amount / totalInvoices) * 100 : 0,
      };
    });
    return { month, expenses, analysisRows, totalExpenses, totalInvoices, isPreview, previewError };
  }

  private buildResultFromPreview(
    month: string,
    expenses: ExpenseItem[],
    items: DraftInvoiceItem[],
    previewError: string | null,
  ): MonthLoadResult {
    const sorted = [...items].sort((a, b) =>
      a.apartment_unit_code.localeCompare(b.apartment_unit_code, 'el'),
    );
    const totalExpenses = expenses
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalInvoices = sorted.reduce((sum, item) => sum + Number(item.invoice_total || 0), 0);
    const analysisRows = sorted.map((item) => {
      const amount = Number(item.invoice_total || 0);
      return {
        apartmentUnitCode: item.apartment_unit_code,
        heatingRadiatorsTotal: item.heating_radiators_total,
        heatedWaterEnergyTotal: item.heated_water_energy_total,
        waterConsumptionTotal: item.water_consumption_total,
        commonRecurringTotal: item.common_recurring_total,
        commonNonRecurringTotal: item.common_non_recurring_total,
        ownersOnlyTotal: item.owners_only_total,
        invoiceTotal: item.invoice_total,
        sharePercent: totalInvoices > 0 ? (amount / totalInvoices) * 100 : 0,
      };
    });
    return {
      month,
      expenses,
      analysisRows,
      totalExpenses,
      totalInvoices,
      isPreview: sorted.length > 0,
      previewError,
    };
  }

  private applyMonthResult(result: MonthLoadResult): void {
    if (result.month !== this.selectedMonth) {
      return;
    }
    this.expenses = result.expenses;
    this.analysisRows = result.analysisRows;
    this.totalExpenses = result.totalExpenses;
    this.totalInvoices = result.totalInvoices;
    this.isPreview = result.isPreview;
    this.loading = false;
    this.message = '';

    if (!this.analysisRows.length && !this.expenses.length) {
      this.message = 'Δεν υπάρχουν δεδομένα για αυτόν τον μήνα.';
    } else if (!this.analysisRows.length && this.expenses.length) {
      this.message =
        result.previewError ||
        'Υπάρχουν έξοδα αλλά δεν ήταν δυνατός ο υπολογισμός κατανομής. Ελέγξτε μετρήσεις και εκδώστε λογαριασμούς.';
    }
  }

  private clearMonthData(): void {
    this.expenses = [];
    this.analysisRows = [];
    this.totalExpenses = 0;
    this.totalInvoices = 0;
    this.isPreview = false;
  }
}
