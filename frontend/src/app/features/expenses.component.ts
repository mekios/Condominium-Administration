import { Component, OnInit } from '@angular/core';
import { MonthFormatPipe } from '../core/month-format.pipe';
import { EuroPipe } from '../core/euro.pipe';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';

import { Me } from '../core/app-data.service';
import { API_BASE } from '../core/api.constants';
import { getCategoryConfig, getCategoryIconColor, getCategoryIconGlow, getDisplayLabel, getIconPath } from '../core/expense-categories';

type ExpenseItem = {
  id: number;
  building: number;
  expense_category: string;
  expense_date: string;
  month: string;
  affected_period_start?: string;
  affected_period_end?: string;
  amount: string;
  description: string;
};

@Component({
  standalone: true,
  selector: 'app-expenses',
  imports: [NgFor, NgIf, MonthFormatPipe, EuroPipe],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h2>Λίστα εξόδων</h2>
        <p>Όλα τα έξοδα ομαδοποιημένα ανά μήνα.</p>
      </div>
      <p class="hint" *ngIf="!isAdmin(me)">Λειτουργία μόνο ανάγνωσης. Η επεξεργασία εξόδων είναι διαθέσιμη μόνο σε διαχειριστές.</p>

      <div class="actions">
        <button class="btn btn-primary" (click)="openCreateForm()" *ngIf="isAdmin(me)">Νέο έξοδο</button>
        <button class="btn btn-ghost" (click)="loadExpenses()">Ανανέωση</button>
      </div>
      <p class="hint" *ngIf="message">{{ message }}</p>
      <p class="hint" *ngIf="loading">Φόρτωση εξόδων...</p>
      <p class="hint" *ngIf="!loading && monthGroups.length === 0">Δεν υπάρχουν έξοδα.</p>

      <section class="month-group" *ngFor="let group of monthGroups">
        <div class="draft-head">
          <h3>Μήνας {{ group.month | monthFormat }}</h3>
          <p>{{ group.items.length }} έξοδα</p>
        </div>
        <div class="draft-table-wrap">
          <table class="draft-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Κτίριο</th>
                <th>Κατηγορία</th>
                <th>Ημερομηνία</th>
                <th>Ποσό</th>
                <th>Έναρξη περιόδου</th>
                <th>Λήξη περιόδου</th>
                <th>Περιγραφή</th>
              </tr>
            </thead>
            <tbody>
              <tr
                *ngFor="let expense of group.items"
                [class.clickable-row]="isAdmin(me)"
                [class.readonly-row]="!isAdmin(me)"
                (click)="openExpense(expense.id)"
              >
                <td>{{ expense.id }}</td>
                <td>#{{ expense.building }}</td>
                <td class="cat-cell">
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
                </td>
                <td>{{ expense.expense_date }}</td>
                <td>{{ expense.amount | euro }}</td>
                <td>{{ expense.affected_period_start || '-' }}</td>
                <td>{{ expense.affected_period_end || '-' }}</td>
                <td>{{ descriptionColumnValue(expense) }}</td>
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
    .actions {
      margin-top: 0.8rem;
      margin-bottom: 0.5rem;
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
    .month-group {
      margin-top: 1rem;
      border-top: 1px solid #243152;
      padding-top: 1.15rem;
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
      font-size: 0.9rem;
    }
    .draft-table th,
    .draft-table td {
      border-bottom: 1px solid #243152;
      padding: 0.7rem 0.85rem;
      text-align: left;
      white-space: nowrap;
      line-height: 1.35;
    }
    .draft-table th {
      color: #9db2e5;
      font-weight: 600;
      padding-top: 0.8rem;
      padding-bottom: 0.8rem;
    }
    .clickable-row {
      cursor: pointer;
    }
    .clickable-row:hover {
      background: #14213f;
    }
    .readonly-row {
      cursor: default;
    }
    .cat-cell {
      display: flex;
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
    @media (max-width: 900px) {
      .btn-ghost {
        margin-left: 0;
        margin-top: 0.5rem;
      }
    }
  `,
})
export class ExpensesComponent implements OnInit {
  me: Me | null = null;
  readonly getDisplayLabel = getDisplayLabel;
  loading = false;
  message = '';
  expenses: ExpenseItem[] = [];
  monthGroups: { month: string; items: ExpenseItem[] }[] = [];

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.loadMe();
    this.loadExpenses();
  }

  isAdmin(me: Me | null): boolean {
    return me?.role === 'superadmin' || me?.role === 'administrator';
  }

  loadExpenses(): void {
    this.loading = true;
    this.http.get<ExpenseItem[]>(`${API_BASE}/api/accounting/expenses/`).subscribe({
      next: (items) => {
        this.expenses = [...items].sort((a, b) => {
          if (a.month === b.month) return b.id - a.id;
          return a.month < b.month ? 1 : -1;
        });
        this.monthGroups = this.groupByMonth(this.expenses);
        this.loading = false;
      },
      error: () => {
        this.expenses = [];
        this.monthGroups = [];
        this.loading = false;
        this.message = 'Αποτυχία φόρτωσης εξόδων.';
      },
    });
  }

  openCreateForm(): void {
    this.router.navigateByUrl('/app/expenses/new');
  }

  openExpense(expenseId: number): void {
    if (!this.isAdmin(this.me)) {
      return;
    }
    this.router.navigateByUrl(`/app/expenses/${expenseId}`);
  }

  readonly getIconPath = getIconPath;
  readonly getCategoryIconColor = getCategoryIconColor;
  readonly getCategoryIconGlow = getCategoryIconGlow;

  descriptionColumnValue(expense: ExpenseItem): string {
    const cfg = getCategoryConfig(expense.expense_category);
    if (cfg?.useDescriptionAsLabel && expense.description?.trim()) {
      return '-';
    }
    return expense.description || '-';
  }

  private loadMe(): void {
    this.http.get<Me>(`${API_BASE}/api/me/`).subscribe({
      next: (me) => (this.me = me),
      error: () => (this.me = null),
    });
  }

  private groupByMonth(items: ExpenseItem[]): { month: string; items: ExpenseItem[] }[] {
    const map = new Map<string, ExpenseItem[]>();
    for (const item of items) {
      const monthItems = map.get(item.month) ?? [];
      monthItems.push(item);
      map.set(item.month, monthItems);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, monthItems]) => ({ month, items: monthItems }));
  }
}
