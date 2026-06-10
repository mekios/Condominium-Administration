import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { HttpClient } from '@angular/common/http';

import { API_BASE } from '../core/api.constants';
import { AdminModeService } from '../core/admin-mode.service';
import { AppDataService, Invoice, Me } from '../core/app-data.service';
import { DialogService } from '../core/dialog/dialog.service';
import { EuroPipe } from '../core/euro.pipe';
import { MonthPickerComponent } from '../core/month-picker/month-picker.component';

type PaymentRecord = {
  id: number;
  invoice: number;
  invoice_month: string;
  apartment: number;
  apartment_label: string;
  amount: string;
  payment_date: string;
  method: string;
  reference: string;
  notes: string;
  created_at: string;
};

@Component({
  standalone: true,
  selector: 'app-payments',
  imports: [NgFor, NgIf, FormsModule, EuroPipe, MonthPickerComponent, MatDatepickerModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h2>Πληρωμές και αποδείξεις</h2>
        <p>Καταχώριση εξόφλησης λογαριασμών και ιστορικό πληρωμών.</p>
      </div>

      <div class="toolbar">
        <app-month-picker [value]="month" (valueChange)="onMonthSelected($event)" />
      </div>

      <div class="form-grid" *ngIf="writeEnabled">
        <label>
          Λογαριασμός προς πληρωμή
          <select [(ngModel)]="paymentForm.invoiceId">
            <option [ngValue]="0">Επιλογή λογαριασμού</option>
            <option *ngFor="let inv of payableInvoices" [ngValue]="inv.id">
              {{ inv.apartment_unit_code }} | Υπόλοιπο {{ inv.outstanding_balance | euro }}
            </option>
          </select>
        </label>
        <label>
          Ποσό
          <input type="number" step="0.01" [(ngModel)]="paymentForm.amount" />
        </label>
        <mat-form-field>
          <mat-label>Ημερομηνία πληρωμής</mat-label>
          <input matInput [matDatepicker]="paymentDatePicker" [value]="dateToDate(paymentForm.payment_date)" (click)="paymentDatePicker.open()" (dateChange)="onPaymentDateChange($event.value)" />
          <mat-datepicker-toggle matIconSuffix [for]="paymentDatePicker"></mat-datepicker-toggle>
          <mat-datepicker #paymentDatePicker></mat-datepicker>
        </mat-form-field>
        <label>
          Μέθοδος
          <select [(ngModel)]="paymentForm.method">
            <option value="bank_transfer">Τραπεζική μεταφορά</option>
            <option value="cash">Μετρητά</option>
            <option value="card">Κάρτα</option>
            <option value="other">Άλλο</option>
          </select>
        </label>
        <label class="full">
          Αναφορά / παρατηρήσεις
          <input type="text" [(ngModel)]="paymentForm.reference" />
        </label>
      </div>

      <div class="actions" *ngIf="writeEnabled">
        <button class="btn btn-primary" (click)="submitPayment()">Καταχώριση πληρωμής</button>
      </div>

      <p class="hint" *ngIf="message">{{ message }}</p>

      <div class="table-wrap">
        <table *ngIf="payments.length; else emptyState">
          <thead>
            <tr>
              <th>Ημερομηνία</th>
              <th>Διαμέρισμα</th>
              <th>Μήνας</th>
              <th>Ποσό</th>
              <th>Μέθοδος</th>
              <th>Αναφορά</th>
              <th *ngIf="writeEnabled"></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of payments">
              <td>{{ row.payment_date }}</td>
              <td>{{ row.apartment_label }}</td>
              <td>{{ row.invoice_month }}</td>
              <td>{{ row.amount | euro }}</td>
              <td>{{ paymentMethodLabel(row.method) }}</td>
              <td>{{ row.reference || '-' }}</td>
              <td *ngIf="writeEnabled">
                <button class="btn btn-danger" (click)="deletePayment(row)">Διαγραφή</button>
              </td>
            </tr>
          </tbody>
        </table>
        <ng-template #emptyState>
          <p class="hint">Δεν υπάρχουν πληρωμές για τον επιλεγμένο μήνα.</p>
        </ng-template>
      </div>
    </section>
  `,
  styles: `
    .panel { border: 1px solid #243152; background: #101a33; border-radius: 12px; padding: 1rem; }
    .panel-head h2 { margin: 0; font-size: 1.05rem; }
    .panel-head p, .hint { margin: 0.35rem 0 0.8rem; color: #93a8da; font-size: 0.9rem; }
    .toolbar {
      margin-bottom: 0.85rem;
      max-width: 22rem;
    }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }
    .full { grid-column: 1 / -1; }
    label { display: grid; gap: 0.3rem; color: #b5c9f5; font-size: 0.86rem; }
    input:not([matInput]), select { border: 1px solid #31416c; border-radius: 10px; background: #0d1430; color: #fff; padding: 0.55rem; }
    .actions { margin-top: 0.8rem; }
    .btn { border: 0; border-radius: 10px; padding: 0.58rem 0.95rem; color: #fff; font-weight: 600; cursor: pointer; }
    .btn-primary { background: linear-gradient(135deg, #4f78ff, #6d62ff); box-shadow: 0 8px 18px rgba(70,95,255,.35); }
    .btn-secondary { border: 1px solid #30457d; background: #132247; }
    .btn-danger { padding: 0.35rem 0.65rem; font-size: 0.82rem; }
    .table-wrap { overflow: auto; margin-top: 0.75rem; }
    table { width: 100%; min-width: 720px; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #243152; padding: 0.45rem; text-align: left; white-space: nowrap; font-size: 0.88rem; }
    th { color: #9db2e5; }
    @media (max-width: 900px) { .form-grid { grid-template-columns: 1fr; } }
  `,
})
export class PaymentsComponent implements OnInit {
  me: Me | null = null;
  writeEnabled = false;
  month = new Date().toISOString().slice(0, 7);
  message = '';
  payments: PaymentRecord[] = [];
  invoices: Invoice[] = [];
  paymentForm = {
    invoiceId: 0,
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'bank_transfer',
    reference: '',
  };

  constructor(
    private readonly http: HttpClient,
    private readonly data: AppDataService,
    private readonly adminMode: AdminModeService,
    private readonly dialog: DialogService,
  ) {}

  ngOnInit(): void {
    this.adminMode.adminModeActive$.subscribe(() => this.refreshWriteEnabled());
    this.data.getMe().subscribe((me) => {
      this.me = me;
      this.refreshWriteEnabled();
    });
    this.loadAll();
  }

  private refreshWriteEnabled(): void {
    this.writeEnabled = this.adminMode.canManage(this.me);
  }

  get payableInvoices(): Invoice[] {
    return this.invoices.filter((inv) => Number(inv.outstanding_balance) > 0);
  }

  loadAll(): void {
    this.message = '';
    this.http.get<PaymentRecord[]>(`${API_BASE}/api/accounting/payments/?month=${this.month}`).subscribe({
      next: (rows) => (this.payments = rows),
      error: () => {
        this.payments = [];
        this.message = 'Αποτυχία φόρτωσης πληρωμών.';
      },
    });
    this.data.getInvoices(this.month).subscribe({
      next: (rows) => (this.invoices = rows),
      error: () => (this.invoices = []),
    });
  }

  submitPayment(): void {
    if (!this.paymentForm.invoiceId) {
      this.message = 'Επιλέξτε λογαριασμό.';
      return;
    }
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/invoices/${this.paymentForm.invoiceId}/mark-paid/`, {
        amount: this.paymentForm.amount || undefined,
        payment_date: this.paymentForm.payment_date,
        method: this.paymentForm.method,
        reference: this.paymentForm.reference,
      })
      .subscribe({
        next: (resp) => {
          this.message = resp.detail;
          this.paymentForm.amount = '';
          this.paymentForm.reference = '';
          this.loadAll();
        },
        error: () => {
          this.message = 'Αποτυχία καταχώρισης πληρωμής.';
        },
      });
  }

  deletePayment(row: PaymentRecord): void {
    this.dialog
      .confirm({
        title: 'Διαγραφή πληρωμής',
        message: `Να διαγραφεί η πληρωμή ${row.amount} € (${row.payment_date}) για ${row.apartment_label};`,
        confirmLabel: 'Διαγραφή',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.http.delete(`${API_BASE}/api/accounting/payments/${row.id}/`).subscribe({
          next: () => {
            this.message = 'Η πληρωμή διαγράφηκε.';
            this.loadAll();
          },
          error: (error) => {
            this.message = error?.error?.detail || 'Αποτυχία διαγραφής πληρωμής.';
          },
        });
      });
  }

  paymentMethodLabel(value: string): string {
    if (value === 'bank_transfer') return 'Τραπεζική μεταφορά';
    if (value === 'cash') return 'Μετρητά';
    if (value === 'card') return 'Κάρτα';
    return 'Άλλο';
  }

  onMonthSelected(month: string): void {
    if (!month) return;
    this.month = month;
    this.loadAll();
  }

  dateToDate(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  onPaymentDateChange(value: Date | null): void {
    if (!value) return;
    this.paymentForm.payment_date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
}
