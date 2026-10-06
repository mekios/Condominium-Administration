import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';

import { finalize, forkJoin, of, Subscription, switchMap, catchError } from 'rxjs';

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
import { invoiceComputedTotal, invoiceHasAdjustment, invoiceAdjustmentLabel } from '../core/invoice.utils';
import { userDisplayName } from '../core/user.utils';

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

type MonthExpenseBar = {
  month: string;
  monthLabel: string;
  tenant: number;
  owner: number;
  total: number;
  tenantPct: number;
  ownerPct: number;
};

type ApartmentExpenseChart = {
  apartmentId: number;
  label: string;
  bars: MonthExpenseBar[];
};

type HeatingMeasurementRow = {
  apartment: number;
  measurement_date: string;
  units_counted: string;
};

type HeatedWaterMeasurementRow = {
  apartment: number;
  measurement_date: string;
  computed_heating_water_volume: string;
};

type MeasurementPoint = {
  month: string;
  monthLabel: string;
  value: number;
  x: number;
  y: number;
};

type ApartmentMeasurementChart = {
  apartmentId: number;
  label: string;
  points: MeasurementPoint[];
  path: string;
  yTicks: { value: number; y: number; label: string }[];
};

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [NgIf, NgFor, NgTemplateOutlet, FormsModule, EuroPipe, MonthFormatPipe],
  template: `
    <section class="stats">
      <article class="stat-card welcome-card">
        <p class="welcome-kicker">Dashboard</p>
        <h1 class="welcome-title">
          {{ greetingPrefix }}, <span class="welcome-name">{{ getDisplayName() }}</span>
        </h1>
        <p class="welcome-sub">
          {{ greetingSubtitle }}
        </p>
        <p class="welcome-apts" *ngIf="!loading && apartmentGreetingText">
          {{ apartmentGreetingText }}
        </p>
      </article>
      <article class="stat-card finance-card" [class.negative]="buildingFinanceBalance < 0">
        <h2>Υπόλοιπο ταμείου κτιρίου</h2>
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
            <div *ngIf="hasAdjustment(inv)">
              <span>Υπολογ. σύνολο</span><strong>{{ getComputedTotal(inv) | euro }}</strong>
            </div>
            <div *ngIf="hasAdjustment(inv)">
              <span>{{ getAdjustmentLabel(inv) }}</span><strong>{{ inv.custom_adjustment | euro }}</strong>
            </div>
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

    <section class="panel" *ngIf="!loading && apartmentCharts.length">
      <div class="chart-head">
        <div>
          <h2>Μηνιαία έξοδα ανά διαμέρισμα</h2>
          <p class="hint chart-sub">
            Στοίβα ανά μήνα: ποσά ενοίκου (κοινόχρηστα/κατανάλωση) και ιδιοκτήτη (μόνο ιδιοκτητών).
          </p>
        </div>
        <div class="chart-legend" aria-hidden="true">
          <span class="legend-item"><i class="swatch tenant"></i> Ένοικος</span>
          <span class="legend-item"><i class="swatch owner"></i> Ιδιοκτήτης</span>
        </div>
      </div>

      <div class="apt-charts">
        <article class="apt-chart" *ngFor="let chart of apartmentCharts">
          <header class="apt-chart-head">
            <h3>{{ chart.label }}</h3>
            <p>{{ chart.bars.length }} μήνες</p>
          </header>
          <div class="bars">
            <div class="bar-col" *ngFor="let bar of chart.bars">
              <span class="bar-total">{{ bar.total | euro }}</span>
              <div class="bar-stack" [attr.title]="barTooltip(bar)">
                <div
                  class="seg tenant"
                  *ngIf="bar.tenantPct > 0"
                  [style.height.%]="bar.tenantPct"
                ></div>
                <div
                  class="seg owner"
                  *ngIf="bar.ownerPct > 0"
                  [style.height.%]="bar.ownerPct"
                ></div>
              </div>
              <span class="bar-label">{{ bar.monthLabel }}</span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="panel" *ngIf="!loading && heatingMeasurementCharts.length">
      <div class="chart-head">
        <div>
          <h2>Θέρμανση ανά διαμέρισμα</h2>
          <p class="hint chart-sub">Μηνιαία κατανάλωση θέρμανσης (kWh) από τις καταχωρημένες μετρήσεις.</p>
        </div>
        <div class="chart-legend" aria-hidden="true">
          <span class="legend-item"><i class="swatch heating"></i> kWh</span>
        </div>
      </div>

      <div class="apt-charts">
        <article class="apt-chart" *ngFor="let chart of heatingMeasurementCharts">
          <header class="apt-chart-head">
            <h3>{{ chart.label }}</h3>
            <p>{{ chart.points.length }} μήνες · kWh</p>
          </header>
          <ng-container
            *ngTemplateOutlet="measurementLineChart; context: { $implicit: chart, series: 'heating', seriesLabel: 'Θέρμανση', unit: 'kWh' }"
          />
        </article>
      </div>
    </section>

    <section class="panel" *ngIf="!loading && waterMeasurementCharts.length">
      <div class="chart-head">
        <div>
          <h2>Ζεστό νερό ανά διαμέρισμα</h2>
          <p class="hint chart-sub">Μηνιαία κατανάλωση ζεστού νερού (m³) από τις καταχωρημένες μετρήσεις.</p>
        </div>
        <div class="chart-legend" aria-hidden="true">
          <span class="legend-item"><i class="swatch water"></i> m³</span>
        </div>
      </div>

      <div class="apt-charts">
        <article class="apt-chart" *ngFor="let chart of waterMeasurementCharts">
          <header class="apt-chart-head">
            <h3>{{ chart.label }}</h3>
            <p>{{ chart.points.length }} μήνες · m³</p>
          </header>
          <ng-container
            *ngTemplateOutlet="measurementLineChart; context: { $implicit: chart, series: 'water', seriesLabel: 'Ζεστό νερό', unit: 'm³' }"
          />
        </article>
      </div>
    </section>

    <ng-template #measurementLineChart let-chart let-series="series" let-seriesLabel="seriesLabel" let-unit="unit">
      <div class="line-chart-wrap">
        <div class="y-axis">
          <span *ngFor="let tick of chart.yTicks" [style.top.%]="(tick.y / 56) * 100">{{ tick.label }}</span>
        </div>
        <div class="line-chart-main">
          <svg viewBox="0 0 100 56" preserveAspectRatio="none" class="line-svg" aria-hidden="true">
            <line
              *ngFor="let tick of chart.yTicks"
              x1="0"
              x2="100"
              [attr.y1]="tick.y"
              [attr.y2]="tick.y"
              class="grid-line"
            />
            <polyline
              *ngIf="chart.path"
              [attr.points]="chart.path"
              class="series-line"
              [class.heating]="series === 'heating'"
              [class.water]="series === 'water'"
              fill="none"
            />
          </svg>
          <div class="point-layer">
            <div
              class="point-wrap"
              *ngFor="let point of chart.points"
              [style.left.%]="point.x"
              [style.top.%]="(point.y / 56) * 100"
            >
              <span class="point-value" [class.heating]="series === 'heating'" [class.water]="series === 'water'">
                {{ formatMeasurementValue(point.value) }} {{ unit }}
              </span>
              <button
                type="button"
                class="point"
                [class.heating]="series === 'heating'"
                [class.water]="series === 'water'"
                [attr.title]="measurementTooltip(point, seriesLabel, unit)"
                [attr.aria-label]="measurementTooltip(point, seriesLabel, unit)"
              ></button>
            </div>
          </div>
          <div class="x-axis">
            <span *ngFor="let point of chart.points" [style.left.%]="point.x">{{ point.monthLabel }}</span>
          </div>
        </div>
      </div>
    </ng-template>

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
    .chart-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.8rem;
      flex-wrap: wrap;
    }
    .chart-sub {
      margin-top: 0.25rem;
      margin-bottom: 0.35rem;
    }
    .chart-legend {
      display: flex;
      gap: 0.85rem;
      align-items: center;
      flex-wrap: wrap;
      padding-top: 0.15rem;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: #b7c8ef;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .swatch {
      display: inline-block;
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 3px;
    }
    .swatch.tenant {
      background: linear-gradient(180deg, #5b8dff, #3d6adf);
    }
    .swatch.owner {
      background: linear-gradient(180deg, #ffd37d, #e8a93a);
    }
    .swatch.heating {
      background: linear-gradient(180deg, #ff8f7a, #e4573d);
    }
    .swatch.water {
      background: linear-gradient(180deg, #6ad7ff, #2f9fd4);
    }
    .line-chart-wrap {
      display: grid;
      grid-template-columns: 2.6rem 1fr;
      gap: 0.35rem;
      align-items: stretch;
      min-height: 190px;
    }
    .y-axis {
      position: relative;
      height: 150px;
      margin-top: 0.2rem;
    }
    .y-axis span {
      position: absolute;
      right: 0;
      transform: translateY(-50%);
      color: #8096c8;
      font-size: 0.68rem;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .line-chart-main {
      position: relative;
      min-width: 0;
    }
    .line-svg {
      width: 100%;
      height: 150px;
      display: block;
      background: rgba(12, 20, 42, 0.55);
      border: 1px solid #2a3c66;
      border-radius: 10px;
    }
    .grid-line {
      stroke: rgba(120, 145, 200, 0.18);
      stroke-width: 0.35;
    }
    .series-line {
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .series-line.heating {
      stroke: #ff7a62;
    }
    .series-line.water {
      stroke: #4fc4ef;
    }
    .point-layer {
      position: absolute;
      inset: 0 0 auto 0;
      height: 150px;
      pointer-events: none;
    }
    .point-wrap {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.18rem;
      pointer-events: none;
    }
    .point-value {
      font-size: 0.68rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 1px 2px rgba(8, 14, 30, 0.85);
      transform: translateY(-0.15rem);
    }
    .point-value.heating {
      color: #ffb3a4;
    }
    .point-value.water {
      color: #9adfff;
    }
    .point {
      position: relative;
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      border: 2px solid #0c142a;
      transform: none;
      padding: 0;
      pointer-events: auto;
      cursor: default;
    }
    .point.heating {
      background: #ff7a62;
    }
    .point.water {
      background: #4fc4ef;
    }
    .x-axis {
      position: relative;
      height: 1.5rem;
      margin-top: 0.35rem;
    }
    .x-axis span {
      position: absolute;
      transform: translateX(-50%);
      color: #91a6d6;
      font-size: 0.68rem;
      white-space: nowrap;
      line-height: 1.15;
      text-align: center;
    }
    .apt-charts {
      display: grid;
      gap: 0.85rem;
      margin-top: 0.55rem;
    }
    .apt-chart {
      border: 1px solid #27385f;
      border-radius: 12px;
      background: #0f1933;
      padding: 0.8rem 0.85rem 0.7rem;
    }
    .apt-chart-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.55rem;
    }
    .apt-chart-head h3 {
      margin: 0;
      font-size: 0.95rem;
      color: #e8f0ff;
    }
    .apt-chart-head p {
      margin: 0;
      color: #8aa0d0;
      font-size: 0.78rem;
    }
    .bars {
      display: flex;
      align-items: flex-end;
      gap: 0.45rem;
      overflow-x: auto;
      padding: 0.15rem 0.1rem 0.2rem;
      min-height: 180px;
    }
    .bar-col {
      flex: 0 0 auto;
      width: 3.1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.28rem;
    }
    .bar-total {
      font-size: 0.68rem;
      color: #c5d4f5;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .bar-stack {
      width: 100%;
      height: 140px;
      display: flex;
      flex-direction: column-reverse;
      justify-content: flex-start;
      border-radius: 8px 8px 4px 4px;
      overflow: hidden;
      background: rgba(18, 28, 55, 0.85);
      border: 1px solid #2a3c66;
    }
    .seg {
      width: 100%;
      min-height: 2px;
      transition: height 0.25s ease;
    }
    .seg.tenant {
      background: linear-gradient(180deg, #6a97ff 0%, #3d6adf 100%);
    }
    .seg.owner {
      background: linear-gradient(180deg, #ffe09a 0%, #e8a93a 100%);
    }
    .bar-label {
      font-size: 0.68rem;
      color: #91a6d6;
      text-align: center;
      line-height: 1.15;
      max-width: 100%;
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
  apartmentCharts: ApartmentExpenseChart[] = [];
  heatingMeasurementCharts: ApartmentMeasurementChart[] = [];
  waterMeasurementCharts: ApartmentMeasurementChart[] = [];
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
            heating: this.http
              .get<HeatingMeasurementRow[]>(`${API_BASE}/api/accounting/heating-inputs/`)
              .pipe(catchError(() => of([] as HeatingMeasurementRow[]))),
            heatedWater: this.http
              .get<HeatedWaterMeasurementRow[]>(`${API_BASE}/api/accounting/heated-water-inputs/`)
              .pipe(catchError(() => of([] as HeatedWaterMeasurementRow[]))),
          }),
        ),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: ({ me, apartments, personalInvoices, buildingInvoices, building, heating, heatedWater }) => {
          this.me = me;
          this.refreshCanManage();
          this.apartments = apartments;
          this.invoices = personalInvoices;
          this.apartmentCharts = this.buildApartmentCharts(apartments, personalInvoices);
          this.heatingMeasurementCharts = this.buildSingleMeasurementCharts(
            apartments,
            heating,
            (row) => Number(row.units_counted || 0),
          );
          this.waterMeasurementCharts = this.buildSingleMeasurementCharts(
            apartments,
            heatedWater,
            (row) => Number(row.computed_heating_water_volume || 0),
          );
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

  hasAdjustment(inv: Invoice): boolean {
    return invoiceHasAdjustment(inv);
  }

  getComputedTotal(inv: Invoice): number {
    return invoiceComputedTotal(inv);
  }

  getAdjustmentLabel(inv: Invoice): string {
    const note = invoiceAdjustmentLabel(inv);
    return note ? `Προσαρμογή (${note})` : 'Προσαρμογή';
  }

  getDisplayName(): string {
    return userDisplayName(this.me);
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

  barTooltip(bar: MonthExpenseBar): string {
    return `${bar.monthLabel}: ένοικος ${bar.tenant.toFixed(2)}€ · ιδιοκτήτης ${bar.owner.toFixed(2)}€ · σύνολο ${bar.total.toFixed(2)}€`;
  }

  measurementTooltip(point: MeasurementPoint, series: string, unit: string): string {
    return `${point.monthLabel}: ${series} ${this.formatMeasurementValue(point.value)} ${unit}`;
  }

  formatMeasurementValue(value: number): string {
    if (!Number.isFinite(value)) return '-';
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(1);
    return value.toFixed(1);
  }

  private buildApartmentCharts(apartments: Apartment[], invoices: Invoice[]): ApartmentExpenseChart[] {
    if (!apartments.length) return [];

    const issued = invoices.filter((inv) => inv.status === 'issued' || inv.status === 'paid');
    return apartments.map((apt) => {
      const byMonth = new Map<string, { tenant: number; owner: number }>();
      for (const inv of issued) {
        if (inv.apartment !== apt.id) continue;
        const owner = Number(inv.owners_only_total || 0);
        const total = Number(inv.invoice_total || 0);
        const tenant = Math.max(0, total - owner);
        const current = byMonth.get(inv.month) ?? { tenant: 0, owner: 0 };
        current.tenant += tenant;
        current.owner += owner;
        byMonth.set(inv.month, current);
      }

      const months = [...byMonth.keys()].sort().slice(-12);
      const maxTotal = Math.max(
        1,
        ...months.map((month) => {
          const row = byMonth.get(month)!;
          return row.tenant + row.owner;
        }),
      );

      const bars: MonthExpenseBar[] = months.map((month) => {
        const row = byMonth.get(month)!;
        const total = row.tenant + row.owner;
        return {
          month,
          monthLabel: this.formatShortMonth(month),
          tenant: row.tenant,
          owner: row.owner,
          total,
          tenantPct: (row.tenant / maxTotal) * 100,
          ownerPct: (row.owner / maxTotal) * 100,
        };
      });

      return {
        apartmentId: apt.id,
        label: apt.apartment_label || apt.unit_code,
        bars,
      };
    }).filter((chart) => chart.bars.length > 0);
  }

  private formatShortMonth(month: string): string {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthNo = Number(monthStr);
    if (!year || !monthNo) return month;
    const label = new Intl.DateTimeFormat('el', { month: 'short' }).format(new Date(year, monthNo - 1, 1));
    const shortYear = String(year).slice(2);
    return `${label.replace('.', '')} '${shortYear}`;
  }

  private buildSingleMeasurementCharts<T extends { apartment: number; measurement_date: string }>(
    apartments: Apartment[],
    rows: T[],
    valueOf: (row: T) => number,
  ): ApartmentMeasurementChart[] {
    if (!apartments.length) return [];

    const chartPadX = 4;
    const chartPadTop = 4;
    const chartPadBottom = 4;
    const chartHeight = 56;
    const plotHeight = chartHeight - chartPadTop - chartPadBottom;

    return apartments
      .map((apt) => {
        // First reading is a baseline (delta from 0 = full meter value) — skip it.
        const aptRows = rows
          .filter((row) => row.apartment === apt.id)
          .sort((a, b) => a.measurement_date.localeCompare(b.measurement_date))
          .slice(1);

        const byMonth = new Map<string, number>();
        for (const row of aptRows) {
          const month = row.measurement_date.slice(0, 7);
          byMonth.set(month, (byMonth.get(month) ?? 0) + valueOf(row));
        }

        const months = [...byMonth.keys()].sort().slice(-12);
        if (!months.length) return null;

        const maxValue = Math.max(1, ...months.map((month) => byMonth.get(month) ?? 0));

        const points: MeasurementPoint[] = months.map((month, index) => {
          const value = byMonth.get(month) ?? 0;
          const x =
            months.length === 1
              ? 50
              : chartPadX + (index / (months.length - 1)) * (100 - chartPadX * 2);
          const y = chartPadTop + plotHeight * (1 - value / maxValue);
          return {
            month,
            monthLabel: this.formatShortMonth(month),
            value,
            x,
            y,
          };
        });

        const yTicks = [0, 0.5, 1].map((ratio) => {
          const value = maxValue * (1 - ratio);
          return {
            value,
            y: chartPadTop + plotHeight * ratio,
            label: value >= 10 ? value.toFixed(0) : value.toFixed(1),
          };
        });

        return {
          apartmentId: apt.id,
          label: apt.apartment_label || apt.unit_code,
          points,
          path: points.map((p) => `${p.x},${p.y}`).join(' '),
          yTicks,
        };
      })
      .filter((chart): chart is ApartmentMeasurementChart => chart !== null);
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
