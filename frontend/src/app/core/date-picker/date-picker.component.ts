import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

import {
  WEEKDAY_LABELS,
  buildCalendarGrid,
  calendarMonthLabel,
  currentDate,
  formatDateParts,
  parseIsoDate,
  shiftCalendarMonth,
  shiftDate,
} from '../date.utils';
import {
  formatRecentDateLabel,
  loadRecentDates,
  rememberRecentDate,
} from './recent-dates.storage';

@Component({
  standalone: true,
  selector: 'app-date-picker',
  imports: [NgIf, NgFor],
  template: `
    <div class="date-picker">
      <span class="label" *ngIf="label">{{ label }}</span>

      <div class="nav-bar" [class.empty]="!value">
        <button
          type="button"
          class="nav-btn"
          (click)="goPrevious()"
          [disabled]="disabled || !value"
          aria-label="Προηγούμενη ημέρα"
        >
          ‹
        </button>

        <button
          type="button"
          class="date-display"
          (click)="openPanel()"
          [disabled]="disabled"
          [attr.aria-expanded]="panelOpen"
        >
          <ng-container *ngIf="parts as p; else emptyStateTpl">
            <span class="date-primary">{{ p.primary }}</span>
            <span class="date-secondary">{{ p.secondary }}</span>
          </ng-container>
          <ng-template #emptyStateTpl>
            <span class="empty-text">{{ emptyLabel }}</span>
          </ng-template>
        </button>

        <button
          type="button"
          class="nav-btn"
          (click)="goNext()"
          [disabled]="disabled || !value"
          aria-label="Επόμενη ημέρα"
        >
          ›
        </button>
      </div>
    </div>

    <div class="overlay" *ngIf="panelOpen" (click)="closePanel()">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Επιλογή ημερομηνίας" (click)="$event.stopPropagation()">
        <header class="sheet-head">
          <h3>Επιλογή ημερομηνίας</h3>
          <button type="button" class="close-btn" (click)="closePanel()" aria-label="Κλείσιμο">✕</button>
        </header>

        <div class="shortcuts">
          <button type="button" class="shortcut" (click)="pickDate(currentDate())">Σήμερα</button>
          <button type="button" class="shortcut" (click)="pickDate(shiftDate(currentDate(), -1))">Χθες</button>
        </div>

        <div class="shortcuts recent" *ngIf="recentDates.length">
          <span class="shortcuts-caption">Συχνές</span>
          <button
            type="button"
            class="shortcut recent"
            *ngFor="let date of recentDates"
            (click)="pickDate(date)"
          >
            {{ formatRecentDateLabel(date) }}
          </button>
        </div>

        <div class="calendar-nav">
          <button type="button" class="nav-btn" (click)="shiftViewMonth(-1)" aria-label="Προηγούμενος μήνας">‹</button>
          <span class="calendar-month">{{ calendarMonthLabel(viewYear, viewMonth) }}</span>
          <button type="button" class="nav-btn" (click)="shiftViewMonth(1)" aria-label="Επόμενος μήνας">›</button>
        </div>

        <div class="weekdays">
          <span *ngFor="let weekday of weekdayLabels">{{ weekday }}</span>
        </div>

        <div class="calendar-grid">
          <ng-container *ngFor="let cell of calendarGrid">
            <span class="pad" *ngIf="!cell"></span>
            <button
              type="button"
              class="day-cell"
              *ngIf="cell"
              [class.today]="cell.isToday"
              [class.selected]="cell.isSelected"
              (click)="pickDate(cell.value)"
            >
              {{ cell.day }}
            </button>
          </ng-container>
        </div>
      </div>
    </div>
  `,
  styles: `
    .date-picker {
      display: grid;
      gap: 0.35rem;
      min-width: 0;
    }

    .label {
      color: #b5c9f5;
      font-size: 0.86rem;
    }

    .nav-bar {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 0.45rem;
      align-items: stretch;
    }

    .nav-bar.empty .date-display {
      border-style: dashed;
    }

    .nav-btn,
    .date-display,
    .close-btn,
    .shortcut,
    .day-cell {
      font-family: inherit;
    }

    .nav-btn {
      width: 2.6rem;
      border: 1px solid #31416c;
      border-radius: 12px;
      background: #0d1430;
      color: #dce8ff;
      font-size: 1.45rem;
      line-height: 1;
      cursor: pointer;
      display: grid;
      place-items: center;
    }

    .nav-btn:hover:not(:disabled) {
      border-color: #6d8dce;
      color: #fff;
    }

    .nav-btn:disabled,
    .date-display:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .date-display {
      border: 1px solid #31416c;
      border-radius: 12px;
      background: #0d1430;
      color: #f4f8ff;
      padding: 0.45rem 0.85rem;
      cursor: pointer;
      display: grid;
      align-content: center;
      gap: 0.08rem;
      text-align: center;
    }

    .date-display:hover:not(:disabled) {
      border-color: #6d8dce;
      box-shadow: 0 0 0 2px rgba(109, 141, 206, 0.22);
    }

    .date-primary {
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1.15;
    }

    .date-secondary {
      font-size: 0.72rem;
      color: #9cb3e8;
    }

    .empty-text {
      color: #8fa3d4;
      font-size: 0.9rem;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: 120;
      background: rgba(4, 8, 18, 0.78);
      backdrop-filter: blur(4px);
      display: grid;
      align-items: end;
      justify-items: center;
    }

    @media (min-width: 640px) {
      .overlay {
        align-items: center;
        padding: 1rem;
      }
    }

    .sheet {
      width: min(22rem, 100%);
      border: 1px solid #33497a;
      border-radius: 16px 16px 0 0;
      background: linear-gradient(180deg, #121d38 0%, #0f1933 100%);
      box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.4);
      padding: 1rem;
      color: #e8f1ff;
    }

    @media (min-width: 640px) {
      .sheet {
        border-radius: 16px;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
      }
    }

    .sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }

    .sheet-head h3 {
      margin: 0;
      font-size: 1rem;
    }

    .close-btn {
      width: 2rem;
      height: 2rem;
      border: 1px solid #3b4b79;
      border-radius: 8px;
      background: transparent;
      color: #c9d9ff;
      cursor: pointer;
    }

    .shortcuts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
      align-items: center;
    }

    .shortcuts.recent {
      padding-top: 0.15rem;
      border-top: 1px solid #243152;
    }

    .shortcuts-caption {
      width: 100%;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #8fa3d4;
    }

    .shortcut.recent {
      background: rgba(125, 255, 176, 0.08);
      border-color: rgba(125, 255, 176, 0.35);
    }

    .shortcut.recent:hover {
      background: rgba(125, 255, 176, 0.16);
      border-color: rgba(125, 255, 176, 0.55);
    }

    .shortcut {
      border: 1px solid #3b4b79;
      border-radius: 999px;
      background: rgba(79, 120, 255, 0.1);
      color: #d7e4ff;
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .shortcut:hover {
      border-color: #6d8dce;
      background: rgba(79, 120, 255, 0.2);
    }

    .calendar-nav {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.65rem;
    }

    .calendar-month {
      text-align: center;
      font-size: 0.95rem;
      font-weight: 700;
      color: #f4f8ff;
    }

    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.25rem;
      margin-bottom: 0.35rem;
    }

    .weekdays span {
      text-align: center;
      font-size: 0.72rem;
      font-weight: 700;
      color: #8fa3d4;
    }

    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.3rem;
    }

    .pad {
      display: block;
    }

    .day-cell {
      aspect-ratio: 1;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: #dce8ff;
      font-size: 0.88rem;
      cursor: pointer;
      display: grid;
      place-items: center;
    }

    .day-cell:hover {
      border-color: #6d8dce;
      background: rgba(79, 120, 255, 0.12);
    }

    .day-cell.today {
      border-color: #5a6fa8;
    }

    .day-cell.selected {
      border-color: #6d62ff;
      background: linear-gradient(135deg, rgba(79, 120, 255, 0.35), rgba(109, 98, 255, 0.32));
      color: #fff;
      font-weight: 700;
    }
  `,
})
export class DatePickerComponent {
  @Input() value = '';
  @Input() label = '';
  @Input() emptyLabel = 'Επιλογή ημερομηνίας';
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<string>();

  readonly weekdayLabels = WEEKDAY_LABELS;
  readonly currentDate = currentDate;
  readonly shiftDate = shiftDate;
  readonly calendarMonthLabel = calendarMonthLabel;
  readonly formatRecentDateLabel = formatRecentDateLabel;

  panelOpen = false;
  viewYear = new Date().getFullYear();
  viewMonth = new Date().getMonth() + 1;
  recentDates: string[] = [];

  get parts() {
    return formatDateParts(this.value);
  }

  get calendarGrid() {
    return buildCalendarGrid(this.viewYear, this.viewMonth, this.value);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.panelOpen = false;
  }

  openPanel(): void {
    if (this.disabled) return;
    const parsed = parseIsoDate(this.value) ?? parseIsoDate(currentDate())!;
    this.viewYear = parsed.year;
    this.viewMonth = parsed.month;
    this.recentDates = loadRecentDates();
    this.panelOpen = true;
  }

  closePanel(): void {
    this.panelOpen = false;
  }

  goPrevious(): void {
    if (this.disabled || !this.value) return;
    this.emitDate(shiftDate(this.value, -1));
  }

  goNext(): void {
    if (this.disabled || !this.value) return;
    this.emitDate(shiftDate(this.value, 1));
  }

  shiftViewMonth(delta: number): void {
    const next = shiftCalendarMonth(this.viewYear, this.viewMonth, delta);
    this.viewYear = next.year;
    this.viewMonth = next.month;
  }

  pickDate(value: string): void {
    this.emitDate(value);
    this.closePanel();
  }

  private emitDate(value: string): void {
    if (!parseIsoDate(value)) return;
    rememberRecentDate(value);
    this.recentDates = loadRecentDates();
    this.value = value;
    this.valueChange.emit(value);
  }
}
