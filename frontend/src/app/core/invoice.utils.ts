import { Invoice } from './app-data.service';

export function invoiceHasAdjustment(inv: Pick<Invoice, 'custom_adjustment'>): boolean {
  return Number(inv.custom_adjustment || 0) !== 0;
}

export function invoiceComputedTotal(inv: Invoice): number {
  return Number(inv.invoice_total || 0) - Number(inv.custom_adjustment || 0);
}

export function invoiceAdjustmentLabel(inv: Pick<Invoice, 'custom_adjustment_note'>): string {
  return inv.custom_adjustment_note?.trim() || '';
}
