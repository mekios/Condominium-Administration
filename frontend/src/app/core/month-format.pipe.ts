import { Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';

/**
 * Formats a YYYY-MM string as localized month name + year (e.g. "Οκτώβριος 2025").
 * Uses the app locale (Greek by default).
 */
@Pipe({ name: 'monthFormat', standalone: true })
export class MonthFormatPipe implements PipeTransform {
  private datePipe = new DatePipe('el');

  transform(value: string | null | undefined): string {
    if (!value || typeof value !== 'string') return '';
    const [y, m] = value.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return value;
    const date = new Date(y, m - 1, 1);
    return this.datePipe.transform(date, 'LLLL yyyy') ?? value;
  }
}
