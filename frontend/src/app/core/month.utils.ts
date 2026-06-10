export function currentMonth(): string {
  const now = new Date();
  return toMonthString(now.getFullYear(), now.getMonth() + 1);
}

export function toMonthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonth(value: string | null | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const [yearStr, monthStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month || month < 1 || month > 12) return null;
  return { year, month };
}

export function shiftMonth(value: string, delta: number): string {
  const parsed = parseMonth(value) ?? parseMonth(currentMonth())!;
  const date = new Date(parsed.year, parsed.month - 1 + delta, 1);
  return toMonthString(date.getFullYear(), date.getMonth() + 1);
}

export function formatMonthYear(value: string | null | undefined): string {
  const parsed = parseMonth(value ?? '');
  if (!parsed) return '';
  const date = new Date(parsed.year, parsed.month - 1, 1);
  const formatted = new Intl.DateTimeFormat('el', { month: 'long', year: 'numeric' }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export type MonthTimelineEntry = {
  value: string;
  label: string;
  year: number;
  yearDivider: boolean;
  isCurrent: boolean;
};

export function buildMonthTimeline(pastMonths = 48, futureMonths = 1): MonthTimelineEntry[] {
  const entries: MonthTimelineEntry[] = [];
  const today = currentMonth();

  for (let offset = futureMonths; offset >= -pastMonths; offset -= 1) {
    const value = shiftMonth(today, offset);
    const parsed = parseMonth(value)!;
    entries.push({
      value,
      label: formatMonthYear(value),
      year: parsed.year,
      yearDivider: false,
      isCurrent: value === today,
    });
  }

  for (let index = 0; index < entries.length; index += 1) {
    const prev = entries[index - 1];
    entries[index].yearDivider = !prev || prev.year !== entries[index].year;
  }

  return entries;
}

export const MONTH_SHORT_LABELS = [
  'Ιαν',
  'Φεβ',
  'Μαρ',
  'Απρ',
  'Μαΐ',
  'Ιουν',
  'Ιουλ',
  'Αυγ',
  'Σεπ',
  'Οκτ',
  'Νοε',
  'Δεκ',
] as const;
