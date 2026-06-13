import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';

import { API_BASE } from './api.constants';

export type Apartment = {
  id: number;
  building: number;
  unit_code: string;
  owner_name: string;
  apartment_label: string;
  building_name: string;
  ownership_permille: string;
};

export type Me = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  preferred_language: string;
};

export type Invoice = {
  id: number;
  apartment: number;
  apartment_unit_code: string;
  month: string;
  heating_radiators_total: string;
  heated_water_energy_total: string;
  water_consumption_total: string;
  common_recurring_total: string;
  common_non_recurring_total: string;
  owners_only_total: string;
  custom_adjustment?: string;
  custom_adjustment_note?: string;
  invoice_total: string;
  paid_total: string;
  outstanding_balance: string;
  status: string;
};

@Injectable({ providedIn: 'root' })
export class AppDataService {
  private meCache: Me | null = null;
  private apartmentsCache: Apartment[] | null = null;
  private linkedApartmentsCache: Apartment[] | null = null;

  constructor(private readonly http: HttpClient) {}

  getMe(force = false): Observable<Me> {
    if (!force && this.meCache) {
      return of(this.meCache);
    }
    return this.http.get<Me>(`${API_BASE}/api/me/`).pipe(tap((me) => (this.meCache = me)));
  }

  getApartments(force = false): Observable<Apartment[]> {
    if (!force && this.apartmentsCache) {
      return of(this.sortApartmentsByUnitCode(this.apartmentsCache));
    }
    return this.http
      .get<Apartment[]>(`${API_BASE}/api/apartments/?all=1`)
      .pipe(
        tap((apartments) => {
          this.apartmentsCache = this.sortApartmentsByUnitCode(apartments);
        }),
      );
  }

  getLinkedApartments(force = false): Observable<Apartment[]> {
    if (!force && this.linkedApartmentsCache) {
      return of(this.sortApartmentsByUnitCode(this.linkedApartmentsCache));
    }
    return this.http.get<Apartment[]>(`${API_BASE}/api/apartments/`).pipe(
      tap((apartments) => {
        this.linkedApartmentsCache = this.sortApartmentsByUnitCode(apartments);
      }),
    );
  }

  getInvoices(month: string): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(`${API_BASE}/api/invoices/?month=${month}`);
  }

  clearCache(): void {
    this.meCache = null;
    this.apartmentsCache = null;
    this.linkedApartmentsCache = null;
  }

  private sortApartmentsByUnitCode(apartments: Apartment[]): Apartment[] {
    return [...apartments].sort((a, b) => a.unit_code.localeCompare(b.unit_code, 'el'));
  }
}
