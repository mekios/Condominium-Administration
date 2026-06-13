import { parseIsoDate } from '../date.utils';

const STORAGE_KEY = 'mtmf5.recentDates';
const MAX_RECENT = 10;

export function loadRecentDates(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && !!parseIsoDate(item)).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecentDate(date: string): void {
  if (!parseIsoDate(date)) return;
  const existing = loadRecentDates().filter((item) => item !== date);
  const next = [date, ...existing].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}

export function formatRecentDateLabel(date: string): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  const formatted = new Intl.DateTimeFormat('el', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(parsed.year, parsed.month - 1, parsed.day));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
