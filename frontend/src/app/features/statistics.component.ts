import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription, catchError, finalize, forkJoin, of } from 'rxjs';

import { API_BASE, DEFAULT_BUILDING_ID } from '../core/api.constants';
import { EuroPipe } from '../core/euro.pipe';
import {
  EXPENSE_CATEGORIES,
  getCategoryConfig,
  getCategoryIconColor,
  getCategoryIconGlow,
  getIconPath,
} from '../core/expense-categories';

type ExpenseItem = {
  expense_category: string;
  expense_date: string;
  month: string;
  amount: string;
};

type LinePoint = {
  month: string;
  monthLabel: string;
  value: number;
  x: number;
  y: number;
};

type LineChart = {
  points: LinePoint[];
  path: string;
  yTicks: { y: number; label: string }[];
};

type BarMonth = {
  month: string;
  monthLabel: string;
  total: number;
  heightPct: number;
};

type StatSection = {
  key: string;
  label: string;
  color: string;
  glow: string;
  iconPath: string | null;
  unit: string;
  kind: 'line' | 'bars';
  line: LineChart | null;
  bars: BarMonth[];
};

type DatedReading = {
  apartment: number;
  measurement_date: string;
};

type BuildingHotWaterReading = {
  building: number;
  measurement_date: string;
  hot_water_heating_units: string;
};

const TOTAL_KEY = '__total';
const TOTAL_COLOR = '#f4f7ff';
const TOTAL_GLOW = 'drop-shadow(0 0 7px rgba(244, 247, 255, 0.55))';
const TOTAL_ICON = 'M18 7V4H6l6 8-6 8h12v-3';
const DAMAGES_KEY = 'damages';
const FUND_KEY = 'fund_increase';
const HEATING_COLOR = '#ff7a62';
const HEATING_GLOW = 'drop-shadow(0 0 7px rgba(255, 122, 98, 0.55))';
const HEATING_ICON = 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z';
const WATER_COLOR = '#4fc4ef';
const WATER_GLOW = 'drop-shadow(0 0 7px rgba(79, 196, 239, 0.55))';
const WATER_ICON = 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z';
const BUILDING_HW_COLOR = '#ffb35a';
const BUILDING_HW_GLOW = 'drop-shadow(0 0 7px rgba(255, 179, 90, 0.55))';
const BUILDING_HW_ICON = 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z';

const CHART_PAD_X = 4;
const CHART_PAD_TOP = 4;
const CHART_PAD_BOTTOM = 4;
const CHART_HEIGHT = 56;
const PLOT_HEIGHT = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;

@Component({
  standalone: true,
  selector: 'app-statistics',
  imports: [NgIf, NgFor, EuroPipe],
  template: `
    <section class="panel intro">
      <h2>Στατιστικά</h2>
      <p class="hint">Σύνολα εξόδων κτιρίου, και η συνολική κατανάλωση θέρμανσης και ζεστού νερού όλων των διαμερισμάτων.</p>
      <p class="hint" *ngIf="loading">Φόρτωση δεδομένων...</p>
      <p class="hint error" *ngIf="!loading && message">{{ message }}</p>
      <p class="hint" *ngIf="!loading && !message && !sections.length">Δεν υπάρχουν έξοδα για στατιστικά.</p>
      <p class="hint" *ngIf="!loading && sections.length">{{ monthCount }} μήνες</p>
    </section>

    <section class="panel" *ngFor="let section of sections">
      <header class="chart-head">
        <h3>
          <svg
            *ngIf="section.iconPath"
            class="cat-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            [attr.stroke]="section.color"
            [style.filter]="section.glow"
          >
            <path [attr.d]="section.iconPath" />
          </svg>
          <span>{{ section.label }}</span>
        </h3>
        <span class="legend-item">
          <i class="swatch" [style.background]="section.color"></i>
          {{ section.unit }}
        </span>
      </header>

      <ng-container *ngIf="section.kind === 'line' && section.line">
        <div class="line-chart-wrap">
          <div class="y-axis">
            <span *ngFor="let tick of section.line.yTicks" [style.top.%]="(tick.y / 56) * 100">{{ tick.label }}</span>
          </div>
          <div class="line-chart-main">
            <svg viewBox="0 0 100 56" preserveAspectRatio="none" class="line-svg" aria-hidden="true">
              <line
                *ngFor="let tick of section.line.yTicks"
                x1="0"
                x2="100"
                [attr.y1]="tick.y"
                [attr.y2]="tick.y"
                class="grid-line"
              />
              <polyline
                *ngIf="section.line.path"
                [attr.points]="section.line.path"
                class="series-line"
                fill="none"
                [attr.stroke]="section.color"
              />
            </svg>
            <div class="point-layer">
              <div
                class="point-wrap"
                *ngFor="let point of section.line.points"
                [style.left.%]="point.x"
                [style.top.%]="(point.y / 56) * 100"
              >
                <span class="point-value" [style.color]="section.color">{{ formatPoint(point.value, section.unit) }}</span>
                <button
                  type="button"
                  class="point"
                  [style.background]="section.color"
                  [attr.title]="pointTooltip(point, section.unit)"
                  [attr.aria-label]="pointTooltip(point, section.unit)"
                ></button>
              </div>
            </div>
            <div class="x-axis">
              <span *ngFor="let point of section.line.points" [style.left.%]="point.x">{{ point.monthLabel }}</span>
            </div>
          </div>
        </div>
      </ng-container>

      <div class="bars" *ngIf="section.kind === 'bars'">
        <div class="bar-col" *ngFor="let bar of section.bars">
          <span class="bar-total">{{ bar.total | euro }}</span>
          <div class="bar-stack" [attr.title]="barTooltip(bar)">
            <div
              class="seg"
              *ngIf="bar.heightPct > 0"
              [style.height.%]="bar.heightPct"
              [style.background]="section.color"
            ></div>
          </div>
          <span class="bar-label">{{ bar.monthLabel }}</span>
        </div>
      </div>
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
    .intro h2 {
      margin: 0 0 0.35rem;
      color: #edf3ff;
      font-size: 1.05rem;
    }
    h3 {
      margin: 0;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: #e8f0ff;
      font-size: 0.95rem;
    }
    .hint {
      margin: 0.25rem 0 0;
      color: #9db1e2;
    }
    .error {
      color: #ffb8c9;
    }
    .chart-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
      flex-wrap: wrap;
      margin-bottom: 0.7rem;
    }
    .cat-icon {
      width: 1.15rem;
      height: 1.15rem;
      flex-shrink: 0;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
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
    .line-chart-wrap {
      display: grid;
      grid-template-columns: 3.4rem 1fr;
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
      white-space: nowrap;
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
    .point {
      position: relative;
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      border: 2px solid #0c142a;
      padding: 0;
      pointer-events: auto;
      cursor: default;
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
    .bars {
      display: flex;
      align-items: flex-end;
      gap: 0.45rem;
      overflow-x: auto;
      padding: 0.15rem 0.1rem 0.2rem;
      min-height: 180px;
    }
    .bar-col {
      flex: 1 1 0;
      min-width: 3.1rem;
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
      max-width: 2.4rem;
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
    }
    .bar-label {
      font-size: 0.68rem;
      color: #91a6d6;
      text-align: center;
      line-height: 1.15;
      max-width: 100%;
    }
    @media (max-width: 1023px) {
      .line-chart-wrap,
      .line-chart-main,
      .point-layer,
      .x-axis,
      .y-axis,
      .bars,
      .panel {
        max-width: 100%;
        overflow: hidden;
      }
      .bars {
        overflow-x: hidden;
      }
      .bar-col {
        flex: 1 1 0;
        min-width: 0;
      }
      .bar-total,
      .bar-label {
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
    }
  `,
})
export class StatisticsComponent implements OnInit, OnDestroy {
  sections: StatSection[] = [];
  monthCount = 0;
  loading = true;
  message = '';
  private sub?: Subscription;

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loading = true;
    this.message = '';
    this.sub = forkJoin({
      expenses: this.http.get<ExpenseItem[]>(`${API_BASE}/api/accounting/expenses/`),
      building: this.http
        .get<{ fund_balance: string }>(`${API_BASE}/api/buildings/${DEFAULT_BUILDING_ID}/`)
        .pipe(catchError(() => of({ fund_balance: '0' }))),
      heating: this.http
        .get<Array<DatedReading & { units_counted: string }>>(`${API_BASE}/api/accounting/heating-inputs/`)
        .pipe(catchError(() => of([]))),
      heatedWater: this.http
        .get<Array<DatedReading & { computed_heating_water_volume: string }>>(
          `${API_BASE}/api/accounting/heated-water-inputs/`,
        )
        .pipe(catchError(() => of([]))),
      buildingHotWater: this.http
        .get<BuildingHotWaterReading[]>(`${API_BASE}/api/accounting/heating-inputs/building-hot-water/`)
        .pipe(catchError(() => of([]))),
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ expenses, building, heating, heatedWater, buildingHotWater }) => {
          const fundBalance = Number(building.fund_balance || 0);
          const expenseSections = this.buildSections(expenses, Number.isFinite(fundBalance) ? fundBalance : 0);
          const heatingByMonth = this.consumptionByMonth(
            heating,
            (row) => row.apartment,
            (row) => Number(row.units_counted || 0),
          );
          const waterByMonth = this.consumptionByMonth(
            heatedWater,
            (row) => row.apartment,
            (row) => Number(row.computed_heating_water_volume || 0),
          );
          const buildingHwByMonth = this.consumptionByMonth(
            buildingHotWater,
            (row) => row.building,
            (row) => Number(row.hot_water_heating_units || 0),
          );
          this.sections = [
            ...expenseSections,
            ...this.buildConsumptionSections(heatingByMonth, waterByMonth, buildingHwByMonth),
          ];
          const first = expenseSections[0] ?? this.sections[0];
          this.monthCount = first?.kind === 'line' ? first.line?.points.length ?? 0 : first?.bars.length ?? 0;
        },
        error: () => {
          this.sections = [];
          this.message = 'Αποτυχία φόρτωσης στατιστικών.';
        },
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  pointTooltip(point: LinePoint, unit: string): string {
    return `${point.monthLabel}: ${this.formatPoint(point.value, unit)}`;
  }

  formatPoint(value: number, unit: string): string {
    if (unit === '€') return this.formatEuro(value);
    return `${this.formatMeasurement(value)} ${unit}`;
  }

  barTooltip(bar: BarMonth): string {
    return `${bar.monthLabel}: ${this.formatEuro(bar.total)}`;
  }

  private buildSections(expenses: ExpenseItem[], fundBalance: number): StatSection[] {
    const byCategory = new Map<string, Map<string, number>>();
    const monthSet = new Set<string>();

    for (const expense of expenses) {
      const month = (expense.month || expense.expense_date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const amount = Number(expense.amount || 0);
      if (!Number.isFinite(amount)) continue;
      monthSet.add(month);
      const categoryMonths = byCategory.get(expense.expense_category) ?? new Map<string, number>();
      categoryMonths.set(month, (categoryMonths.get(month) ?? 0) + amount);
      byCategory.set(expense.expense_category, categoryMonths);
    }

    const months = [...monthSet].sort().slice(-12);
    if (!months.length) return [];

    const fundByMonth = this.fundBalanceByMonth(months, byCategory.get(FUND_KEY), fundBalance);

    const totalByMonth = new Map<string, number>();
    for (const month of months) {
      let total = 0;
      for (const categoryMonths of byCategory.values()) {
        total += categoryMonths.get(month) ?? 0;
      }
      totalByMonth.set(month, total);
    }

    const sections: StatSection[] = [
      this.lineSection(TOTAL_KEY, 'Σύνολο εξόδων', TOTAL_COLOR, TOTAL_GLOW, TOTAL_ICON, months, totalByMonth),
    ];

    const ordered = EXPENSE_CATEGORIES.map((category) => category.value);
    for (const category of byCategory.keys()) {
      if (!ordered.includes(category)) ordered.push(category);
    }

    for (const category of ordered) {
      const color = getCategoryIconColor(category);
      const glow = getCategoryIconGlow(category);
      const iconPath = getIconPath(category);
      if (category === FUND_KEY) {
        if (!this.hasNonZero(fundByMonth, months)) continue;
        sections.push(this.lineSection(FUND_KEY, 'Αποθεματικό', color, glow, iconPath, months, fundByMonth));
        continue;
      }
      const categoryMonths = byCategory.get(category);
      if (!categoryMonths) continue;
      const hasAmount = months.some((month) => (categoryMonths.get(month) ?? 0) !== 0);
      if (!hasAmount) continue;
      const config = getCategoryConfig(category);
      const label = config?.label ?? category;
      if (category === DAMAGES_KEY) {
        sections.push(this.barSection(category, label, color, glow, iconPath, months, categoryMonths));
      } else {
        sections.push(this.lineSection(category, label, color, glow, iconPath, months, categoryMonths));
      }
    }

    return sections;
  }

  private consumptionByMonth<T extends { measurement_date: string }>(
    rows: T[],
    groupOf: (row: T) => number,
    valueOf: (row: T) => number,
  ): Map<string, number> {
    const byGroup = new Map<number, T[]>();
    for (const row of rows) {
      const key = groupOf(row);
      const list = byGroup.get(key) ?? [];
      list.push(row);
      byGroup.set(key, list);
    }

    const totals = new Map<string, number>();
    for (const list of byGroup.values()) {
      // The first reading is a baseline (delta from zero is the full meter). Skip it.
      const counted = [...list].sort((a, b) => a.measurement_date.localeCompare(b.measurement_date)).slice(1);
      for (const row of counted) {
        const month = row.measurement_date.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const value = valueOf(row);
        if (!Number.isFinite(value)) continue;
        totals.set(month, (totals.get(month) ?? 0) + value);
      }
    }
    return totals;
  }

  private buildConsumptionSections(
    heatingByMonth: Map<string, number>,
    waterByMonth: Map<string, number>,
    buildingHwByMonth: Map<string, number>,
  ): StatSection[] {
    const months = [...new Set([
      ...heatingByMonth.keys(),
      ...waterByMonth.keys(),
      ...buildingHwByMonth.keys(),
    ])].sort().slice(-12);
    if (!months.length) return [];

    const sections: StatSection[] = [];
    if (this.hasNonZero(heatingByMonth, months)) {
      sections.push(this.lineSection(
        'heating_kwh',
        'Θέρμανση',
        HEATING_COLOR,
        HEATING_GLOW,
        HEATING_ICON,
        months,
        heatingByMonth,
        'kWh',
      ));
    }
    if (this.hasNonZero(waterByMonth, months)) {
      sections.push(this.lineSection(
        'heated_water',
        'Ζεστό νερό',
        WATER_COLOR,
        WATER_GLOW,
        WATER_ICON,
        months,
        waterByMonth,
        'm³',
      ));
    }
    if (this.hasNonZero(buildingHwByMonth, months)) {
      sections.push(this.lineSection(
        'building_hw_kwh',
        'Θέρμανση ζεστού νερού',
        BUILDING_HW_COLOR,
        BUILDING_HW_GLOW,
        BUILDING_HW_ICON,
        months,
        buildingHwByMonth,
        'kWh',
      ));
    }
    return sections;
  }

  private fundBalanceByMonth(
    months: string[],
    increases: Map<string, number> | undefined,
    fundBalance: number,
  ): Map<string, number> {
    const points = new Map<string, number>();
    for (const month of months) {
      let laterIncreases = 0;
      if (increases) {
        for (const [increaseMonth, amount] of increases) {
          if (increaseMonth > month) laterIncreases += amount;
        }
      }
      points.set(month, fundBalance - laterIncreases);
    }
    return points;
  }

  private hasNonZero(values: Map<string, number>, months: string[]): boolean {
    return months.some((month) => (values.get(month) ?? 0) !== 0);
  }

  private lineSection(
    key: string,
    label: string,
    color: string,
    glow: string,
    iconPath: string | null,
    months: string[],
    valuesByMonth: Map<string, number>,
    unit = '€',
  ): StatSection {
    const values = months.map((month) => valuesByMonth.get(month) ?? 0);
    const maxValue = Math.max(1, ...values);
    const points: LinePoint[] = months.map((month, index) => {
      const value = values[index];
      const x = months.length === 1
        ? 50
        : CHART_PAD_X + (index / (months.length - 1)) * (100 - CHART_PAD_X * 2);
      const y = CHART_PAD_TOP + PLOT_HEIGHT * (1 - value / maxValue);
      return {
        month,
        monthLabel: this.formatShortMonth(month),
        value,
        x,
        y,
      };
    });
    const yTicks = [0, 0.5, 1].map((ratio) => ({
      y: CHART_PAD_TOP + PLOT_HEIGHT * ratio,
      label: this.formatAxis(maxValue * (1 - ratio)),
    }));
    return {
      key,
      label,
      color,
      glow,
      iconPath,
      unit,
      kind: 'line',
      line: {
        points,
        path: points.map((point) => `${point.x},${point.y}`).join(' '),
        yTicks,
      },
      bars: [],
    };
  }

  private barSection(
    key: string,
    label: string,
    color: string,
    glow: string,
    iconPath: string | null,
    months: string[],
    valuesByMonth: Map<string, number>,
  ): StatSection {
    const maxValue = Math.max(1, ...months.map((month) => valuesByMonth.get(month) ?? 0));
    const bars = months.map((month) => {
      const total = valuesByMonth.get(month) ?? 0;
      return {
        month,
        monthLabel: this.formatShortMonth(month),
        total,
        heightPct: (total / maxValue) * 100,
      };
    });
    return {
      key,
      label,
      color,
      glow,
      iconPath,
      unit: '€',
      kind: 'bars',
      line: null,
      bars,
    };
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

  private formatAxis(value: number): string {
    const digits = Math.abs(value) >= 100 ? 0 : 2;
    return new Intl.NumberFormat('el-GR', {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(value);
  }

  private formatMeasurement(value: number): string {
    if (!Number.isFinite(value)) return '-';
    const digits = Math.abs(value) >= 100 ? 0 : 1;
    return new Intl.NumberFormat('el-GR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  private formatEuro(value: number): string {
    return new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}
