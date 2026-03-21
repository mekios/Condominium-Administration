import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'euro', standalone: true })
export class EuroPipe implements PipeTransform {
  private readonly formatter = new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  transform(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return this.formatter.format(0);
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(numeric)) {
      return String(value);
    }
    return this.formatter.format(numeric);
  }
}
