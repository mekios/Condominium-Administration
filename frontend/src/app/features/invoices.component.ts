import { Component, HostListener, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { MonthFormatPipe } from '../core/month-format.pipe';
import { EuroPipe } from '../core/euro.pipe';
import { HttpClient } from '@angular/common/http';
import { combineLatest, finalize } from 'rxjs';

import { AdminModeService } from '../core/admin-mode.service';
import { AppDataService, Invoice, Me } from '../core/app-data.service';
import { API_BASE } from '../core/api.constants';

type DraftInvoiceItem = {
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
  selector: 'app-invoices',
  imports: [NgIf, NgFor, FormsModule, MonthFormatPipe, EuroPipe, MatDatepickerModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h2>Μηνιαίοι λογαριασμοί</h2>
        <p>Δημιουργία και έλεγχος λογαριασμών διαμερισμάτων ανά μήνα.</p>
      </div>

      <div class="actions">
        <mat-form-field class="field">
          <mat-label>Ακριβής μήνας</mat-label>
          <input matInput [matDatepicker]="exactMonthPicker" [value]="monthToDate(filterExactMonth)" (click)="exactMonthPicker.open()" readonly />
          <mat-datepicker-toggle matIconSuffix [for]="exactMonthPicker"></mat-datepicker-toggle>
          <mat-datepicker #exactMonthPicker startView="multi-year" (monthSelected)="selectMonth($event, exactMonthPicker, 'exact')"></mat-datepicker>
        </mat-form-field>
        <mat-form-field class="field">
          <mat-label>Από μήνα</mat-label>
          <input matInput [matDatepicker]="fromMonthPicker" [value]="monthToDate(filterFromMonth)" (click)="fromMonthPicker.open()" readonly />
          <mat-datepicker-toggle matIconSuffix [for]="fromMonthPicker"></mat-datepicker-toggle>
          <mat-datepicker #fromMonthPicker startView="multi-year" (monthSelected)="selectMonth($event, fromMonthPicker, 'from')"></mat-datepicker>
        </mat-form-field>
        <mat-form-field class="field">
          <mat-label>Έως μήνα</mat-label>
          <input matInput [matDatepicker]="toMonthPicker" [value]="monthToDate(filterToMonth)" (click)="toMonthPicker.open()" readonly />
          <mat-datepicker-toggle matIconSuffix [for]="toMonthPicker"></mat-datepicker-toggle>
          <mat-datepicker #toMonthPicker startView="multi-year" (monthSelected)="selectMonth($event, toMonthPicker, 'to')"></mat-datepicker>
        </mat-form-field>
        <button class="btn btn-ghost" (click)="clearFilters()">Καθαρισμός φίλτρων</button>
        <button class="btn btn-primary" (click)="load()">Ανανέωση</button>
        <button class="btn btn-danger action-right" *ngIf="writeEnabled" (click)="recallMonth()">
          Ανάκληση λογαριασμών μήνα
        </button>
        <button class="btn btn-generate" *ngIf="writeEnabled" (click)="openGeneratePopup()">
          Δημιουργία λογαριασμών
        </button>
      </div>

      <p class="hint" *ngIf="message">{{ message }}</p>
      <p class="hint" *ngIf="loading">Φόρτωση λογαριασμών...</p>

      <div class="invoice-grid" *ngIf="!loading && pagedInvoices.length; else empty">
        <article class="invoice-card" [class.invoice-card-paid]="isPaid(inv)" *ngFor="let inv of pagedInvoices">
          <header class="card-head">
            <div>
              <h3>{{ getApartmentCode(inv.apartment_unit_code) }}</h3>
              <p *ngIf="getApartmentOwner(inv.apartment_unit_code)" class="owner-name">
                {{ getApartmentOwner(inv.apartment_unit_code) }}
              </p>
              <p>Μήνας {{ inv.month | monthFormat }}</p>
            </div>
            <div class="head-actions">
              <span class="status" [class.status-paid]="isPaid(inv)" [class.status-open]="!isPaid(inv)">
                {{ getStatusLabel(inv.status) }}
              </span>
              <div class="kebab-wrap">
                <button class="kebab-btn" (click)="toggleActionMenu(inv.id, $event)" aria-label="Ενέργειες λογαριασμού">
                  ⋮
                </button>
                <div class="kebab-menu" *ngIf="isActionMenuOpen(inv.id)">
                  <button (click)="runAndClose(() => downloadInvoicePdf(inv))">Λήψη λογαριασμού PDF</button>
                  <button *ngIf="isPaid(inv)" (click)="runAndClose(() => downloadReceipt(inv))">Λήψη απόδειξης PDF</button>
                  <button *ngIf="writeEnabled && !isPaid(inv)" (click)="runAndClose(() => openPaymentPopup(inv))">
                    Καταχώριση πληρωμής
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div class="totals">
            <div><span>Καλοριφέρ</span><strong>{{ inv.heating_radiators_total | euro }}</strong></div>
            <div><span>Ζεστό νερό</span><strong>{{ inv.heated_water_energy_total | euro }}</strong></div>
            <div><span>Νερό</span><strong>{{ inv.water_consumption_total | euro }}</strong></div>
            <div><span>Κοινόχρηστα</span><strong>{{ inv.common_recurring_total | euro }}</strong></div>
            <div><span>Έκτακτα</span><strong>{{ inv.common_non_recurring_total | euro }}</strong></div>
            <div><span>Μόνο ιδιοκτ.</span><strong>{{ (inv.owners_only_total || '0.00') | euro }}</strong></div>
          </div>

          <footer class="card-footer">
            <div class="summary">
              <p>Σύνολο: <strong>{{ inv.invoice_total | euro }}</strong></p>
              <p>Υπόλοιπο: <strong>{{ inv.outstanding_balance | euro }}</strong></p>
            </div>
          </footer>
        </article>
      </div>
      <ng-template #empty>
        <p class="hint" *ngIf="!loading">Δεν υπάρχουν λογαριασμοί για τα επιλεγμένα φίλτρα.</p>
      </ng-template>

      <div class="pagination" *ngIf="!loading && totalPages > 1">
        <button class="btn btn-ghost btn-sm" [disabled]="currentPage === 1" (click)="goToPage(currentPage - 1)">
          Προηγούμενη
        </button>
        <span>Σελίδα {{ currentPage }} / {{ totalPages }} ({{ filteredInvoices.length }} λογαριασμοί)</span>
        <button class="btn btn-ghost btn-sm" [disabled]="currentPage === totalPages" (click)="goToPage(currentPage + 1)">
          Επόμενη
        </button>
      </div>

      <div class="modal-backdrop" *ngIf="showGeneratePopup" (click)="closeGeneratePopup()">
        <section class="modal generate-modal" (click)="$event.stopPropagation()">
          <header class="modal-head">
            <div>
              <h3>Δημιουργία λογαριασμών μήνα</h3>
              <p class="modal-subtitle">Επίλεξε μήνα και κάνε προεπισκόπηση κατανομής πριν τη δημιουργία.</p>
            </div>
            <button class="icon-btn" aria-label="Κλείσιμο" (click)="closeGeneratePopup()">✕</button>
          </header>

          <div class="generate-controls">
            <mat-form-field>
              <mat-label>Μήνας</mat-label>
              <input matInput [matDatepicker]="generateMonthPicker" [value]="monthToDate(month)" (click)="generateMonthPicker.open()" readonly />
              <mat-datepicker-toggle matIconSuffix [for]="generateMonthPicker"></mat-datepicker-toggle>
              <mat-datepicker #generateMonthPicker startView="multi-year" (monthSelected)="selectGenerationMonth($event, generateMonthPicker)"></mat-datepicker>
            </mat-form-field>
            <button class="btn btn-secondary" (click)="previewGenerateMonth()" [disabled]="previewLoading">
              {{ previewLoading ? 'Προεπισκόπηση...' : 'Προεπισκόπηση κατανομής' }}
            </button>
          </div>

          <p class="hint error" *ngIf="previewError">{{ previewError }}</p>
          <div *ngIf="previewWarnings.length">
            <p class="hint warning" *ngFor="let warn of previewWarnings">{{ warn }}</p>
          </div>
          <div class="table-wrap" *ngIf="previewItems.length">
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
                  <th>Προβλεπόμενο σύνολο</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of previewItems">
                  <td>{{ row.apartment_unit_code }}</td>
                  <td>{{ row.heating_radiators_total | euro }}</td>
                  <td>{{ row.heated_water_energy_total | euro }}</td>
                  <td>{{ row.water_consumption_total | euro }}</td>
                  <td>{{ row.common_recurring_total | euro }}</td>
                  <td>{{ row.common_non_recurring_total | euro }}</td>
                  <td>{{ row.owners_only_total | euro }}</td>
                  <td>{{ row.invoice_total | euro }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="actions">
            <button class="btn btn-primary" (click)="generate()" [disabled]="generationSaving">
              {{ generationSaving ? 'Δημιουργία...' : 'Επιβεβαίωση δημιουργίας' }}
            </button>
            <button class="btn btn-ghost" (click)="closeGeneratePopup()">Ακύρωση</button>
          </div>
        </section>
      </div>

      <div class="modal-backdrop" *ngIf="showPaymentPopup && selectedInvoice" (click)="closePaymentPopup()">
        <section class="modal" (click)="$event.stopPropagation()">
          <header class="modal-head">
            <div>
              <h3>Καταχώριση πληρωμής</h3>
              <p class="modal-subtitle">
                {{ getApartmentCode(selectedInvoice.apartment_unit_code) }}
                <span *ngIf="getApartmentOwner(selectedInvoice.apartment_unit_code)">
                  - {{ getApartmentOwner(selectedInvoice.apartment_unit_code) }}
                </span>
              </p>
            </div>
            <button class="icon-btn" aria-label="Κλείσιμο" (click)="closePaymentPopup()">✕</button>
          </header>

          <section class="payment-summary">
            <div>
              <span>Σύνολο λογαριασμού</span>
              <strong>{{ selectedInvoice.invoice_total | euro }}</strong>
            </div>
            <div>
              <span>Πληρωμένο</span>
              <strong>{{ selectedInvoice.paid_total | euro }}</strong>
            </div>
            <div class="balance">
              <span>Υπόλοιπο</span>
              <strong>{{ selectedInvoice.outstanding_balance | euro }}</strong>
            </div>
          </section>

          <div class="quick-amounts">
            <button class="chip" (click)="setPaymentAmount(selectedInvoice.outstanding_balance)">Πλήρης εξόφληση</button>
            <button class="chip" (click)="setHalfPaymentAmount(selectedInvoice.outstanding_balance)">50%</button>
            <button class="chip" (click)="setPaymentAmount('0')">Καθαρισμός</button>
          </div>

          <div class="payment-form">
            <label>
              Ποσό πληρωμής
              <input type="number" step="0.01" [(ngModel)]="paymentForm.amount" />
            </label>
            <mat-form-field>
              <mat-label>Ημερομηνία πληρωμής</mat-label>
              <input matInput [matDatepicker]="payDatePicker" [value]="dateToDate(paymentForm.payment_date)" (click)="payDatePicker.open()" (dateChange)="onPaymentDateChange($event.value)" />
              <mat-datepicker-toggle matIconSuffix [for]="payDatePicker"></mat-datepicker-toggle>
              <mat-datepicker #payDatePicker></mat-datepicker>
            </mat-form-field>
            <label>
              Μέθοδος
              <div class="select-wrap">
                <select [(ngModel)]="paymentForm.method">
                  <option value="bank_transfer">Τραπεζική μεταφορά</option>
                  <option value="cash">Μετρητά</option>
                  <option value="card">Κάρτα</option>
                  <option value="other">Άλλο</option>
                </select>
                <span class="select-chevron" aria-hidden="true">▾</span>
              </div>
            </label>
            <label>
              Αναφορά
              <input type="text" [(ngModel)]="paymentForm.reference" />
            </label>
          </div>
          <p class="field-hint">Η απόδειξη δημιουργείται αυτόματα και αποστέλλεται με email μετά την αποθήκευση.</p>
          <div class="actions">
            <button class="btn btn-primary" (click)="submitPayment()" [disabled]="paymentSaving">
              {{ paymentSaving ? 'Αποθήκευση...' : 'Αποθήκευση πληρωμής' }}
            </button>
            <button class="btn btn-ghost" (click)="closePaymentPopup()">Ακύρωση</button>
          </div>
        </section>
      </div>
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
    .panel-head p {
      margin: 0.3rem 0 0.8rem;
      color: #93a8da;
      font-size: 0.9rem;
    }
    .actions {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin-bottom: 0.7rem;
      align-items: end;
    }
    .field {
      display: grid;
      gap: 0.25rem;
      font-size: 0.78rem;
      color: #9db1e2;
    }
    .field input:not([matInput]) {
      min-width: 170px;
    }
    .invoice-grid {
      margin-top: 0.8rem;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.8rem;
      align-items: start;
    }
    .btn-generate {
      font-size: 0.98rem;
      padding: 0.82rem 1.2rem;
      border: 1px solid #7a84df;
      background: linear-gradient(135deg, #5f71ff, #8e5fff);
      box-shadow: 0 14px 26px rgba(109, 81, 233, 0.42);
    }
    .action-right {
      margin-left: auto;
    }
    .invoice-card {
      border: 1px solid #27385f;
      border-radius: 10px;
      padding: 0.75rem;
      display: grid;
      gap: 0.75rem;
      color: #d9e6ff;
      background: linear-gradient(160deg, #111a3f 0%, #171a45 46%, #111531 100%);
      box-shadow: 0 14px 30px rgba(21, 16, 54, 0.38);
    }
    .invoice-card-paid {
      background: linear-gradient(160deg, #1a1f53 0%, #26205f 45%, #161744 100%);
      border-color: #6c74d8;
      box-shadow: inset 0 0 0 1px rgba(161, 148, 255, 0.22);
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      gap: 0.6rem;
      align-items: flex-start;
    }
    .head-actions {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .kebab-wrap {
      position: relative;
    }
    .kebab-btn {
      border: 1px solid #355080;
      background: #132247;
      color: #dbe7ff;
      border-radius: 8px;
      width: 1.9rem;
      height: 1.9rem;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .kebab-menu {
      position: absolute;
      top: 2.1rem;
      right: 0;
      z-index: 5;
      min-width: 210px;
      border: 1px solid #3a4f82;
      border-radius: 10px;
      background: #101c3e;
      box-shadow: 0 16px 30px rgba(6, 10, 24, 0.55);
      padding: 0.32rem;
      display: grid;
      gap: 0.22rem;
    }
    .kebab-menu button {
      text-align: left;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #e2ecff;
      padding: 0.46rem 0.55rem;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .kebab-menu button:hover {
      background: #1a2d5a;
    }
    .card-head h3 {
      margin: 0;
      font-size: 1rem;
    }
    .card-head p {
      margin: 0.15rem 0 0;
      color: #9fb3e5;
      font-size: 0.82rem;
    }
    .owner-name {
      font-size: 0.74rem;
      color: #7f96c8;
      letter-spacing: 0.01em;
    }
    .totals {
      display: grid;
      gap: 0.25rem;
    }
    .totals > div {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dashed #223258;
      padding-bottom: 0.2rem;
      font-size: 0.86rem;
    }
    .card-footer {
      display: flex;
      justify-content: space-between;
      gap: 0.7rem;
      align-items: flex-end;
    }
    .summary p {
      margin: 0.1rem 0;
      font-size: 0.86rem;
    }
    .summary p strong {
      font-size: inherit;
    }
    .summary p:first-child {
      font-size: 1.06rem;
    }
    .summary p:first-child strong {
      font-size: 1.34rem;
      letter-spacing: 0.01em;
    }
    .status {
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      border: 1px solid #30457d;
      background: linear-gradient(135deg, rgba(102, 121, 255, 0.25), rgba(149, 101, 255, 0.24));
      color: #d4d8ff;
      box-shadow: 0 8px 16px rgba(85, 62, 176, 0.24);
    }
    .status-paid {
      border-color: #7084e7;
      background: linear-gradient(135deg, rgba(92, 117, 255, 0.3), rgba(158, 102, 255, 0.28));
      color: #ebe5ff;
    }
    .status-open {
      border-color: #8b6a37;
      background: linear-gradient(135deg, rgba(161, 120, 56, 0.26), rgba(88, 64, 31, 0.22));
      color: #ffd38a;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 8, 18, 0.72);
      display: grid;
      place-items: center;
      padding: 1rem;
      z-index: 30;
    }
    .modal {
      width: min(620px, 100%);
      border: 1px solid #33497a;
      border-radius: 12px;
      background: radial-gradient(circle at 8% 2%, rgba(126, 110, 255, 0.23), transparent 43%),
        radial-gradient(circle at 92% 96%, rgba(94, 149, 255, 0.2), transparent 45%),
        linear-gradient(165deg, #12153a, #191a46 60%, #11142f);
      padding: 1.35rem;
      color: #e6efff;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
    }
    .generate-modal {
      width: min(980px, 100%);
    }
    .generate-controls {
      display: flex;
      align-items: end;
      gap: 0.7rem;
      flex-wrap: wrap;
      margin-bottom: 0.8rem;
    }
    .generate-controls label {
      display: grid;
      gap: 0.35rem;
      color: #b8cbf5;
      font-size: 0.84rem;
    }
    .generate-controls input:not([matInput]) {
      border: 1px solid #385089;
      border-radius: 10px;
      background: #101d3d;
      color: #f4f8ff;
      padding: 0.6rem 0.75rem;
      min-height: 44px;
    }
    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 0.6rem;
      margin-bottom: 0.8rem;
    }
    .modal h3 {
      margin: 0;
      font-size: 1.02rem;
    }
    .modal-subtitle {
      margin: 0.2rem 0 0;
      color: #a2b8eb;
      font-size: 0.8rem;
    }
    .icon-btn {
      border: 1px solid #334a7c;
      background: #122043;
      color: #dce8ff;
      border-radius: 8px;
      width: 2rem;
      height: 2rem;
      cursor: pointer;
    }
    .payment-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.8rem;
      margin-bottom: 1rem;
    }
    .payment-summary > div {
      border: 1px solid #2d3f6a;
      border-radius: 10px;
      padding: 0.68rem 0.72rem;
      background: #101c3b;
      display: grid;
      gap: 0.28rem;
    }
    .payment-summary span {
      color: #9fb5e8;
      font-size: 0.77rem;
    }
    .payment-summary strong {
      font-size: 1.06rem;
      color: #f1f6ff;
    }
    .payment-summary .balance {
      border-color: #7f87ec;
      background: linear-gradient(135deg, rgba(99, 118, 255, 0.32), rgba(148, 97, 255, 0.3));
    }
    .quick-amounts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.62rem;
      margin-bottom: 1rem;
    }
    .chip {
      border: 1px solid #385087;
      background: linear-gradient(135deg, rgba(106, 122, 255, 0.3), rgba(151, 102, 255, 0.28));
      color: #f1edff;
      border-radius: 999px;
      padding: 0.46rem 0.82rem;
      font-size: 0.88rem;
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .chip:hover {
      transform: translateY(-1px);
      border-color: #8b89f0;
      box-shadow: 0 12px 22px rgba(113, 83, 215, 0.34);
    }
    .payment-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.15rem 1rem;
      margin-top: 0.35rem;
    }
    .payment-form label {
      display: grid;
      gap: 0.4rem;
      color: #b8cbf5;
      font-size: 0.84rem;
      letter-spacing: 0.01em;
    }
    .payment-form input:not([matInput]),
    .payment-form select {
      border: 1px solid #385089;
      border-radius: 10px;
      background: #101d3d;
      color: #f4f8ff;
      padding: 0.76rem 0.8rem;
      min-height: 46px;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .payment-form input:not([matInput]):focus,
    .payment-form select:focus {
      outline: none;
      border-color: #6d8dce;
      box-shadow: 0 0 0 2px rgba(109, 141, 206, 0.25);
    }
    .select-wrap {
      position: relative;
    }
    .select-wrap select {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      padding-right: 2rem;
    }
    .select-chevron {
      position: absolute;
      right: 0.7rem;
      top: 50%;
      transform: translateY(-50%);
      color: #9cb3e8;
      pointer-events: none;
      font-size: 0.9rem;
    }
    .field-hint {
      margin: 1rem 0 0;
      color: #88a1d8;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    .actions input:not([matInput]) {
      border: 1px solid #31416c;
      border-radius: 10px;
      background: #0d1430;
      color: #fff;
      padding: 0.55rem;
    }
    .btn {
      border: 0;
      border-radius: 10px;
      padding: 0.7rem 1.05rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
    }
    .modal .actions {
      margin-top: 1rem;
      margin-bottom: 0;
      gap: 0.75rem;
    }
    .btn-primary {
      background: linear-gradient(135deg, #5d79ff, #7a5fff 55%, #a15aff);
      box-shadow: 0 12px 24px rgba(108, 82, 235, 0.44);
    }
    .btn-secondary {
      border: 1px solid #6a74cc;
      background: linear-gradient(135deg, #2a3f96, #453ea5);
    }
    .btn-ghost {
      border: 1px solid #6169b9;
      background: linear-gradient(135deg, rgba(81, 102, 196, 0.32), rgba(112, 74, 187, 0.28));
    }
    .btn-sm {
      padding: 0.48rem 0.78rem;
      font-size: 0.8rem;
    }
    .btn:hover {
      transform: translateY(-1px);
      filter: brightness(1.05);
    }
    .btn-primary:hover {
      box-shadow: 0 16px 30px rgba(127, 90, 245, 0.5);
    }
    .btn-secondary:hover,
    .btn-ghost:hover {
      box-shadow: 0 12px 24px rgba(103, 77, 198, 0.36);
    }
    .hint {
      color: #9db1e2;
      margin: 0.4rem 0 0;
    }
    .pagination {
      margin-top: 0.8rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.8rem;
      color: #b7c9ee;
      font-size: 0.86rem;
      flex-wrap: wrap;
    }
    @media (max-width: 900px) {
      .invoice-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .payment-form {
        grid-template-columns: 1fr;
      }
      .payment-summary {
        grid-template-columns: 1fr;
      }
      .card-footer {
        flex-direction: column;
        align-items: stretch;
      }
    }
    @media (max-width: 1300px) {
      .invoice-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (max-width: 640px) {
      .invoice-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class InvoicesComponent implements OnInit {
  month = new Date().toISOString().slice(0, 7);
  invoices: Invoice[] = [];
  filteredInvoices: Invoice[] = [];
  pagedInvoices: Invoice[] = [];
  filterExactMonth = '';
  filterFromMonth = '';
  filterToMonth = '';
  currentPage = 1;
  readonly pageSize = 16;
  me: Me | null = null;
  writeEnabled = false;
  message = '';
  loading = false;
  showPaymentPopup = false;
  paymentSaving = false;
  showGeneratePopup = false;
  previewLoading = false;
  generationSaving = false;
  previewError = '';
  previewWarnings: string[] = [];
  previewItems: DraftInvoiceItem[] = [];
  openActionMenuInvoiceId: number | null = null;
  selectedInvoice: Invoice | null = null;
  paymentForm = {
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'bank_transfer',
    reference: '',
  };

  constructor(
    private readonly data: AppDataService,
    private readonly http: HttpClient,
    private readonly adminMode: AdminModeService,
  ) {}

  ngOnInit(): void {
    combineLatest([this.data.getMe(), this.adminMode.adminModeActive$]).subscribe(([me]) => {
      this.me = me;
      this.refreshWriteEnabled();
      this.load();
    });
  }

  private refreshWriteEnabled(): void {
    this.writeEnabled = this.adminMode.canManage(this.me);
  }

  load(): void {
    this.loading = true;
    this.message = '';
    const url = this.writeEnabled
      ? `${API_BASE}/api/invoices/`
      : `${API_BASE}/api/invoices/?personal_scope=1`;
    this.http
      .get<Invoice[]>(url)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (invoices) => {
          this.invoices = [...invoices].sort((a, b) => {
            if (a.month === b.month) return a.apartment_unit_code.localeCompare(b.apartment_unit_code, 'el');
            return a.month < b.month ? 1 : -1;
          });
          this.applyFilters();
        },
        error: () => {
          this.message = 'Δεν ήταν δυνατή η φόρτωση λογαριασμών.';
          this.invoices = [];
          this.filteredInvoices = [];
          this.pagedInvoices = [];
        },
      });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredInvoices.length / this.pageSize));
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }

  clearFilters(): void {
    this.filterExactMonth = '';
    this.filterFromMonth = '';
    this.filterToMonth = '';
    this.currentPage = 1;
    this.applyFilters();
  }

  goToPage(page: number): void {
    this.currentPage = Math.max(1, Math.min(this.totalPages, page));
    this.updatePagedInvoices();
  }

  generate(): void {
    if (!this.month) {
      this.message = 'Συμπλήρωσε μήνα για δημιουργία λογαριασμών.';
      return;
    }
    this.generationSaving = true;
    this.message = '';
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/invoices/generate/`, { month: this.month })
      .pipe(finalize(() => (this.generationSaving = false)))
      .subscribe({
        next: (response) => {
          this.message = response.detail;
          this.closeGeneratePopup();
          this.load();
        },
        error: () => {
          this.message = 'Αποτυχία δημιουργίας λογαριασμών.';
        },
      });
  }

  isPaid(invoice: Invoice): boolean {
    return Number(invoice.outstanding_balance) <= 0 || invoice.status === 'paid';
  }

  getStatusLabel(status: string): string {
    if (status === 'paid') return 'Εξοφλημένο';
    if (status === 'issued') return 'Εκδομένο';
    return 'Πρόχειρο';
  }

  openPaymentPopup(invoice: Invoice): void {
    this.selectedInvoice = invoice;
    this.paymentForm.amount = invoice.outstanding_balance;
    this.paymentForm.payment_date = new Date().toISOString().slice(0, 10);
    this.paymentForm.method = 'bank_transfer';
    this.paymentForm.reference = '';
    this.showPaymentPopup = true;
  }

  closePaymentPopup(): void {
    this.showPaymentPopup = false;
    this.selectedInvoice = null;
  }

  submitPayment(): void {
    if (!this.selectedInvoice) return;
    this.paymentSaving = true;
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/invoices/${this.selectedInvoice.id}/mark-paid/`, {
        amount: this.paymentForm.amount,
        payment_date: this.paymentForm.payment_date,
        method: this.paymentForm.method,
        reference: this.paymentForm.reference,
      })
      .subscribe({
        next: (response) => {
          this.message = response.detail;
          this.paymentSaving = false;
          this.closePaymentPopup();
          this.load();
        },
        error: () => {
          this.message = 'Αποτυχία καταχώρισης πληρωμής.';
          this.paymentSaving = false;
        },
      });
  }

  recallMonth(): void {
    const month = this.filterExactMonth;
    if (!month) {
      this.message = 'Επίλεξε ακριβή μήνα στα φίλτρα για να ανακληθούν οι λογαριασμοί του.';
      return;
    }

    const monthInvoices = this.invoices.filter((inv) => inv.month === month);
    if (!monthInvoices.length) {
      this.message = `Δεν υπάρχουν λογαριασμοί για τον μήνα ${month}.`;
      return;
    }
    const hasPayments = monthInvoices.some((inv) => Number(inv.paid_total || 0) > 0);
    const warning = hasPayments ? 'Θα διαγραφούν και οι καταχωρημένες πληρωμές. ' : '';
    const confirmed = window.confirm(
      `${warning}Να ανακληθούν και οι ${monthInvoices.length} λογαριασμοί για τον μήνα ${month};`,
    );
    if (!confirmed) return;

    this.http.post<{ detail: string }>(`${API_BASE}/api/invoices/recall-month/`, { month, confirm: true }).subscribe({
      next: (response) => {
        this.message = response.detail;
        this.load();
      },
      error: (error) => {
        this.message = error?.error?.detail || 'Αποτυχία ανάκλησης λογαριασμών.';
      },
    });
  }

  downloadReceipt(invoice: Invoice): void {
    this.message = '';
    this.http
      .get(`${API_BASE}/api/invoices/${invoice.id}/download-receipt/`, {
        observe: 'response',
        responseType: 'blob',
      })
      .subscribe({
        next: (response) => {
          const blob = response.body;
          if (!blob) {
            this.message = 'Αποτυχία λήψης απόδειξης.';
            return;
          }
          const disposition = response.headers.get('content-disposition') || '';
          const matched = disposition.match(/filename="([^"]+)"/i);
          const filename = matched?.[1] || `receipt-${invoice.month}-${this.getApartmentCode(invoice.apartment_unit_code)}.pdf`;
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
        },
        error: () => {
          this.message = 'Δεν βρέθηκε απόδειξη PDF για αυτόν τον λογαριασμό.';
        },
      });
  }

  downloadInvoicePdf(invoice: Invoice): void {
    this.message = '';
    this.http
      .get(`${API_BASE}/api/invoices/${invoice.id}/download-pdf/`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `invoice-${invoice.month}-${this.getApartmentCode(invoice.apartment_unit_code)}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
        },
        error: () => {
          this.message = 'Δεν βρέθηκε λογαριασμός PDF για αυτόν τον λογαριασμό.';
        },
      });
  }

  setPaymentAmount(value: string): void {
    this.paymentForm.amount = value;
  }

  setHalfPaymentAmount(outstanding: string): void {
    const half = Number(outstanding) / 2;
    this.paymentForm.amount = half.toFixed(2);
  }

  getApartmentCode(apartmentLabel: string): string {
    const idx = apartmentLabel.indexOf('-');
    return idx === -1 ? apartmentLabel : apartmentLabel.slice(0, idx);
  }

  getApartmentOwner(apartmentLabel: string): string {
    const idx = apartmentLabel.indexOf('-');
    if (idx === -1) return '';
    return apartmentLabel.slice(idx + 1).trim();
  }

  openGeneratePopup(): void {
    this.previewError = '';
    this.previewWarnings = [];
    this.previewItems = [];
    this.showGeneratePopup = true;
  }

  closeGeneratePopup(): void {
    this.showGeneratePopup = false;
    this.previewError = '';
    this.previewWarnings = [];
    this.previewItems = [];
  }

  previewGenerateMonth(): void {
    if (!this.month) {
      this.previewError = 'Επίλεξε μήνα για προεπισκόπηση.';
      return;
    }
    this.previewLoading = true;
    this.previewError = '';
    this.previewWarnings = [];
    this.http
      .get<{ month: string; items: DraftInvoiceItem[]; warnings?: string[] }>(`${API_BASE}/api/invoices/preview/?month=${this.month}`)
      .pipe(finalize(() => (this.previewLoading = false)))
      .subscribe({
        next: (response) => {
          this.previewItems = response.items;
          this.previewWarnings = response.warnings || [];
          if (!this.previewItems.length) {
            this.previewError = 'Δεν προέκυψαν στοιχεία κατανομής για αυτόν τον μήνα.';
          }
        },
        error: () => {
          this.previewItems = [];
          this.previewWarnings = [];
          this.previewError = 'Αποτυχία φόρτωσης προεπισκόπησης.';
        },
      });
  }

  private applyFilters(): void {
    this.filteredInvoices = this.invoices.filter((invoice) => {
      if (this.filterExactMonth && invoice.month !== this.filterExactMonth) return false;
      if (this.filterFromMonth && invoice.month < this.filterFromMonth) return false;
      if (this.filterToMonth && invoice.month > this.filterToMonth) return false;
      return true;
    });
    this.updatePagedInvoices();
  }

  private updatePagedInvoices(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    this.pagedInvoices = this.filteredInvoices.slice(start, start + this.pageSize);
  }

  monthToDate(month: string): Date | null {
    if (!month) return null;
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return null;
    return new Date(y, m - 1, 1);
  }

  dateToDate(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  onPaymentDateChange(value: Date | null): void {
    if (!value) return;
    this.paymentForm.payment_date = this.toIsoDate(value);
  }

  selectMonth(value: Date, picker: MatDatepicker<Date>, target: 'exact' | 'from' | 'to'): void {
    const month = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
    if (target === 'exact') this.filterExactMonth = month;
    if (target === 'from') this.filterFromMonth = month;
    if (target === 'to') this.filterToMonth = month;
    this.onFilterChange();
    picker.close();
  }

  selectGenerationMonth(value: Date, picker: MatDatepicker<Date>): void {
    this.month = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
    picker.close();
  }

  private toIsoDate(value: Date): string {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  toggleActionMenu(invoiceId: number, event?: MouseEvent): void {
    event?.stopPropagation();
    this.openActionMenuInvoiceId = this.openActionMenuInvoiceId === invoiceId ? null : invoiceId;
  }

  isActionMenuOpen(invoiceId: number): boolean {
    return this.openActionMenuInvoiceId === invoiceId;
  }

  runAndClose(action: () => void): void {
    this.openActionMenuInvoiceId = null;
    action();
  }

  @HostListener('document:click')
  closeActionMenuOnOutsideClick(): void {
    this.openActionMenuInvoiceId = null;
  }
}
