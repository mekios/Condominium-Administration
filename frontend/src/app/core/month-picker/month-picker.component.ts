import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

import {
  MonthTimelineEntry,
  buildMonthTimeline,
  currentMonth,
  formatMonthYear,
  shiftMonth,
} from '../month.utils';

@Component({
  standalone: true,
  selector: 'app-month-picker',
  imports: [NgIf, NgFor],
  template: `
    <div class="month-picker">
      <span class="label" *ngIf="label">{{ label }}</span>

      <div class="nav-bar">
        <button
          type="button"
          class="nav-btn"
          (click)="goPrevious()"
          [disabled]="disabled"
          aria-label="Προηγούμενος μήνας"
        >
          ‹
        </button>

        <button
          type="button"
          class="current-month"
          (click)="openPanel()"
          [disabled]="disabled"
          [attr.aria-expanded]="panelOpen"
        >
          <span class="current-label">{{ displayLabel }}</span>
          <span class="tap-hint">Αλλαγή μήνα</span>
        </button>

        <button
          type="button"
          class="nav-btn"
          (click)="goNext()"
          [disabled]="disabled"
          aria-label="Επόμενος μήνας"
        >
          ›
        </button>
      </div>
    </div>

    <div class="overlay" *ngIf="panelOpen" (click)="closePanel()">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Επιλογή μήνα" (click)="$event.stopPropagation()">
        <header class="sheet-head">
          <h3>Επιλογή μήνα</h3>
          <button type="button" class="close-btn" (click)="closePanel()" aria-label="Κλείσιμο">✕</button>
        </header>

        <div class="shortcuts">
          <button type="button" class="shortcut" (click)="pickMonth(currentMonth())">Τρέχων</button>
          <button type="button" class="shortcut" (click)="pickMonth(shiftMonth(currentMonth(), -1))">Προηγούμενος</button>
          <button type="button" class="shortcut" (click)="pickMonth(shiftMonth(currentMonth(), -2))">Πριν 2 μήνες</button>
        </div>

        <div class="timeline" #timelineEl>
          <ng-container *ngFor="let entry of monthEntries">
            <div class="year-divider" *ngIf="entry.yearDivider">{{ entry.year }}</div>
            <button
              type="button"
              class="timeline-row"
              [class.selected]="entry.value === value"
              [class.is-current]="entry.isCurrent"
              [attr.data-value]="entry.value"
              (click)="pickMonth(entry.value)"
            >
              <span>{{ entry.label }}</span>
              <span class="badge current" *ngIf="entry.isCurrent">Τώρα</span>
              <span class="badge selected" *ngIf="entry.value === value && !entry.isCurrent">Επιλεγμένος</span>
            </button>
          </ng-container>
        </div>
      </div>
    </div>
  `,
  styles: `
    .month-picker {
      display: grid;
      gap: 0.35rem;
      min-width: 0;
    }

    .label {
      color: #9db1e2;
      font-size: 0.78rem;
      font-weight: 600;
    }

    .nav-bar {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 0.45rem;
      align-items: stretch;
    }

    .nav-btn,
    .current-month,
    .close-btn,
    .shortcut,
    .timeline-row {
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
    .current-month:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .current-month {
      border: 1px solid #3b5088;
      border-radius: 12px;
      background: linear-gradient(180deg, #121d38, #0d1430);
      color: #f4f8ff;
      padding: 0.45rem 0.85rem;
      cursor: pointer;
      display: grid;
      align-content: center;
      gap: 0.08rem;
      text-align: center;
    }

    .current-month:hover:not(:disabled) {
      border-color: #6d8dce;
      box-shadow: 0 0 0 2px rgba(109, 141, 206, 0.22);
    }

    .current-label {
      font-size: 1rem;
      font-weight: 700;
      line-height: 1.15;
    }

    .tap-hint {
      font-size: 0.68rem;
      color: #8fa3d4;
      letter-spacing: 0.02em;
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
      padding: 0;
    }

    @media (min-width: 640px) {
      .overlay {
        align-items: center;
        padding: 1rem;
      }
    }

    .sheet {
      width: min(26rem, 100%);
      max-height: min(34rem, 88vh);
      border: 1px solid #33497a;
      border-radius: 16px 16px 0 0;
      background: linear-gradient(180deg, #121d38 0%, #0f1933 100%);
      box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.4);
      display: grid;
      grid-template-rows: auto auto 1fr;
      overflow: hidden;
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
      padding: 0.9rem 1rem 0.65rem;
      border-bottom: 1px solid #243152;
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
      padding: 0.65rem 1rem;
      border-bottom: 1px solid #243152;
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

    .timeline {
      overflow-y: auto;
      padding: 0.35rem 0.65rem 0.85rem;
      scroll-padding-block: 2rem;
    }

    .year-divider {
      position: sticky;
      top: 0;
      z-index: 1;
      margin: 0.55rem 0 0.25rem;
      padding: 0.25rem 0.55rem;
      color: #9cb3e8;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: linear-gradient(180deg, rgba(15, 25, 51, 0.98), rgba(15, 25, 51, 0.88));
    }

    .timeline-row {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: #dce8ff;
      padding: 0.62rem 0.7rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      cursor: pointer;
      text-align: left;
      font-size: 0.92rem;
    }

    .timeline-row:hover {
      background: rgba(79, 120, 255, 0.12);
    }

    .timeline-row.selected {
      border-color: #6d62ff;
      background: linear-gradient(135deg, rgba(79, 120, 255, 0.28), rgba(109, 98, 255, 0.22));
      font-weight: 700;
    }

    .timeline-row.is-current:not(.selected) {
      border-color: rgba(90, 111, 168, 0.65);
    }

    .badge {
      border-radius: 999px;
      padding: 0.12rem 0.45rem;
      font-size: 0.68rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge.current {
      border: 1px solid #5a6fa8;
      color: #c9d9ff;
    }

    .badge.selected {
      border: 1px solid #6d62ff;
      color: #ebe5ff;
    }
  `,
})
export class MonthPickerComponent implements AfterViewChecked {
  @ViewChild('timelineEl') timelineEl?: ElementRef<HTMLElement>;

  @Input() value = '';
  @Input() label = '';
  @Input() allowEmpty = false;
  @Input() emptyLabel = 'Επιλογή μήνα';
  @Input() disabled = false;

  /** @deprecated use allowEmpty */
  @Input() set allowClear(v: boolean) {
    this.allowEmpty = v;
  }

  @Output() valueChange = new EventEmitter<string>();

  readonly monthEntries: MonthTimelineEntry[] = buildMonthTimeline();
  readonly currentMonth = currentMonth;
  readonly shiftMonth = shiftMonth;

  panelOpen = false;
  private shouldScrollToSelection = false;

  get displayLabel(): string {
    if (!this.value) return this.emptyLabel;
    return formatMonthYear(this.value);
  }

  ngAfterViewChecked(): void {
    if (!this.shouldScrollToSelection) return;
    this.scrollToSelection();
    this.shouldScrollToSelection = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.panelOpen = false;
  }

  openPanel(): void {
    if (this.disabled) return;
    this.panelOpen = true;
    this.shouldScrollToSelection = true;
  }

  closePanel(): void {
    this.panelOpen = false;
  }

  goPrevious(): void {
    if (this.disabled) return;
    this.emitMonth(shiftMonth(this.value || currentMonth(), -1));
  }

  goNext(): void {
    if (this.disabled) return;
    this.emitMonth(shiftMonth(this.value || currentMonth(), 1));
  }

  pickMonth(month: string): void {
    this.emitMonth(month);
    this.closePanel();
  }

  private emitMonth(month: string): void {
    this.value = month;
    this.valueChange.emit(month);
  }

  private scrollToSelection(): void {
    const container = this.timelineEl?.nativeElement;
    if (!container) return;
    const selected = container.querySelector('.timeline-row.selected') as HTMLElement | null;
    const current = container.querySelector('.timeline-row.is-current') as HTMLElement | null;
    (selected ?? current)?.scrollIntoView({ block: 'center' });
  }
}
