import { formatMonthYear, parseMonth, toMonthString } from './month.utils';

export const WEEKDAY_LABELS = ['Δε', 'Τρ', 'Τε', 'Πέ', 'Πα', 'Σά', 'Κυ'] as const;

export type CalendarCell = {
  day: number;
  value: string;
  isToday: boolean;
  isSelected: boolean;
};

export function currentDate(): string {
  return toIsoDate(new Date());
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return null;
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() + 1 !== month || probe.getDate() !== day) return null;
  return { year, month, day };
}

export function shiftDate(value: string, deltaDays: number): string {
  const parsed = parseIsoDate(value) ?? parseIsoDate(currentDate())!;
  const date = new Date(parsed.year, parsed.month - 1, parsed.day + deltaDays);
  return toIsoDate(date);
}

export function formatDateDisplay(value: string | null | undefined): string {
  const parsed = parseIsoDate(value ?? '');
  if (!parsed) return '';
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  const formatted = new Intl.DateTimeFormat('el', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function formatDateParts(value: string | null | undefined): { primary: string; secondary: string } | null {
  const parsed = parseIsoDate(value ?? '');
  if (!parsed) return null;
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  const primary = new Intl.DateTimeFormat('el', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  const secondary = new Intl.DateTimeFormat('el', { weekday: 'long' }).format(date);
  return {
    primary: primary.charAt(0).toUpperCase() + primary.slice(1),
    secondary: secondary.charAt(0).toUpperCase() + secondary.slice(1),
  };
}

export function shiftCalendarMonth(viewYear: number, viewMonth: number, delta: number): { year: number; month: number } {
  const parsed = parseMonth(toMonthString(viewYear, viewMonth))!;
  const date = new Date(parsed.year, parsed.month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function buildCalendarGrid(viewYear: number, viewMonth: number, selectedValue: string): (CalendarCell | null)[] {
  const cells: (CalendarCell | null)[] = [];
  const weekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const leading = weekday === 0 ? 6 : weekday - 1;
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const today = currentDate();

  for (let index = 0; index < leading; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = toIsoDate(new Date(viewYear, viewMonth - 1, day));
    cells.push({
      day,
      value,
      isToday: value === today,
      isSelected: value === selectedValue,
    });
  }

  return cells;
}

export function calendarMonthLabel(viewYear: number, viewMonth: number): string {
  return formatMonthYear(toMonthString(viewYear, viewMonth));
}
