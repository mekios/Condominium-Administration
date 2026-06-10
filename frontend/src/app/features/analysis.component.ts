import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { catchError, finalize, forkJoin, of } from 'rxjs';

import { API_BASE } from '../core/api.constants';
import { Invoice } from '../core/app-data.service';
import { EuroPipe } from '../core/euro.pipe';
import { MonthFormatPipe } from '../core/month-format.pipe';
import { MonthPickerComponent } from '../core/month-picker/month-picker.component';
import { getDisplayLabel } from '../core/expense-categories';

type ExpenseItem = {
  id: number;
  expense_category: string;
  amount: string;
  expense_date: string;
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
        <p class="hint">Δεν υπάρχουν λογαριασμοί για αυτόν τον μήνα.</p>
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
export class AnalysisComponent implements OnInit {
  readonly getDisplayLabel = getDisplayLabel;
  selectedMonth = new Date().toISOString().slice(0, 7);
  expenses: ExpenseItem[] = [];
  invoices: Invoice[] = [];
  analysisRows: ApartmentAnalysisRow[] = [];
  totalExpenses = 0;
  totalInvoices = 0;
  loading = false;
  message = '';

  constructor(
    private readonly http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.initializeMonthAndLoad();
  }

  onMonthChange(month: string): void {
    if (!month) return;
    this.selectedMonth = month;
    this.loadAnalysisForMonth(month);
  }

  private initializeMonthAndLoad(): void {
    this.loading = true;
    this.http
      .get<Invoice[]>(`${API_BASE}/api/invoices/?building_scope=1`)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (allInvoices) => {
          const months = allInvoices
            .filter((invoice) => invoice.status === 'issued' || invoice.status === 'paid')
            .map((invoice) => invoice.month)
            .sort()
            .reverse();
          if (months.length) {
            this.selectedMonth = months[0];
          }
          this.loadAnalysisForMonth(this.selectedMonth);
        },
        error: () => {
          this.message = 'Αποτυχία φόρτωσης δεδομένων ανάλυσης.';
        },
      });
  }

  private loadAnalysisForMonth(month: string): void {
    this.loading = true;
    this.message = '';
    const expenses$ = this.http
      .get<ExpenseItem[]>(`${API_BASE}/api/accounting/expenses/?month=${month}`)
      .pipe(catchError(() => of([] as ExpenseItem[])));

    forkJoin({
      expenses: expenses$,
      invoices: this.http
        .get<Invoice[]>(`${API_BASE}/api/invoices/?month=${month}&building_scope=1`)
        .pipe(catchError(() => of([] as Invoice[]))),
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ expenses, invoices }) => {
          this.expenses = expenses;
          this.invoices = [...invoices].sort((a, b) => a.apartment_unit_code.localeCompare(b.apartment_unit_code, 'el'));
          this.totalExpenses = this.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
          this.totalInvoices = this.invoices.reduce((sum, inv) => sum + Number(inv.invoice_total || 0), 0);
          this.analysisRows = this.invoices.map((inv) => {
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
              sharePercent: this.totalInvoices > 0 ? (amount / this.totalInvoices) * 100 : 0,
            };
          });

          if (!this.analysisRows.length && !this.expenses.length) {
            this.message = 'No data for this month.';
          } else if (!this.analysisRows.length && this.expenses.length) {
            this.message = 'No building-wide invoices were found for this month.';
          }
        },
        error: () => {
          this.expenses = [];
          this.invoices = [];
          this.analysisRows = [];
          this.totalExpenses = 0;
          this.totalInvoices = 0;
          this.message = 'Failed to load full analysis.';
        },
      });
  }
}
