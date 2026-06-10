import { Component, OnInit } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { API_BASE } from '../core/api.constants';
import { AdminModeService } from '../core/admin-mode.service';
import { AppDataService, Me } from '../core/app-data.service';

type MonthItem = {
  measurement_date: string;
  heating_entries: number;
  heated_water_entries: number;
  apartments_total: number;
  locked: boolean;
};

type MonthDetailRow = {
  apartment_id: number;
  apartment_label: string;
  building_name: string;
  previous_heating_reading: string;
  heating_current_reading: string;
  heating_units_counted: string;
  previous_heated_water_reading: string;
  heated_water_current_reading: string;
  heated_water_units_counted: string;
};

type EntryRow = {
  apartment_id: number;
  apartment_label: string;
  building_name: string;
  previous_heating_reading: string;
  previous_heated_water_reading: string;
};

type EntryFormResponse = {
  measurement_date: string;
  rows: EntryRow[];
};

@Component({
  standalone: true,
  selector: 'app-measurements',
  imports: [NgFor, NgIf, FormsModule, DatePipe, MatDatepickerModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h2>Μετρήσεις ανά μήνα</h2>
        <p>Ιστορικό μηνών και γρήγορη καταχώριση νέων μετρήσεων.</p>
      </div>

      <p class="hint" *ngIf="loading">Φόρτωση δεδομένων...</p>
      <p class="hint error" *ngIf="loadError">{{ loadError }}</p>
      <p class="hint" *ngIf="!loading && !loadError && canWrite === false">
        Λειτουργία μόνο ανάγνωσης. Για καταχώριση μετρήσεων ενεργοποιήστε τη λειτουργία διαχειριστή.
      </p>

      <div *ngIf="!loadError" class="stack">
        <section class="subpanel">
          <h3>Λίστα ημερομηνιών</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ημερομηνία μέτρησης</th>
                  <th>Θέρμανση</th>
                  <th>Ζεστό νερό</th>
                  <th>Σύνολο διαμερισμάτων</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of monthItems">
                  <td>{{ item.measurement_date | date:'d MMMM yyyy' }}</td>
                  <td>{{ item.heating_entries }}</td>
                  <td>{{ item.heated_water_entries }}</td>
                  <td>{{ item.apartments_total }}</td>
                  <td class="row-actions inline-action-group">
                    <button class="btn btn-secondary" (click)="toggleDate(item.measurement_date)">
                      {{ expandedDate === item.measurement_date ? 'Απόκρυψη' : 'Προβολή' }}
                    </button>
                    <button
                      class="btn btn-danger btn-danger-icon"
                      *ngIf="canWrite"
                      aria-label="Διαγραφή"
                      (click)="deleteMeasurementsByDate(item.measurement_date)"
                      [disabled]="deletingDate === item.measurement_date"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="expandedDate" class="details">
            <div class="details-head">
              <h4>Μετρήσεις ημερομηνίας {{ expandedDate | date:'d MMMM yyyy' }}</h4>
              <div class="details-actions" *ngIf="canWrite && expandedRows.length">
                <button
                  *ngIf="!editingDetail && !detailLocked"
                  class="btn btn-secondary"
                  (click)="startEditDetail()"
                >
                  Επεξεργασία
                </button>
                <ng-container *ngIf="editingDetail">
                  <button class="btn btn-primary" (click)="saveEditDetail()" [disabled]="savingDetail">
                    {{ savingDetail ? 'Αποθήκευση...' : 'Αποθήκευση' }}
                  </button>
                  <button class="btn btn-secondary" (click)="cancelEditDetail()" [disabled]="savingDetail">
                    Ακύρωση
                  </button>
                </ng-container>
              </div>
            </div>
            <p class="hint" *ngIf="detailLocked">
              Οι μετρήσεις αυτού του μήνα έχουν χρησιμοποιηθεί σε κατανομή εξόδων (υπάρχουν λογαριασμοί) και δεν είναι επεξεργάσιμες. Ανακαλέστε πρώτα τους λογαριασμούς του μήνα.
            </p>
            <p class="hint" *ngIf="loadingDetails">Φόρτωση αναλυτικών μετρήσεων...</p>
            <div class="table-wrap" *ngIf="expandedRows.length">
              <table>
                <thead>
                  <tr>
                    <th>Διαμέρισμα</th>
                    <th>Προηγ. Θέρμανση</th>
                    <th>Τρέχ. Θέρμανση</th>
                    <th>Μονάδες Θέρμανσης</th>
                    <th>Προηγ. Ζεστό νερό</th>
                    <th>Τρέχ. Ζεστό νερό</th>
                    <th>Μονάδες Ζ. Νερού</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of expandedRows">
                    <td>{{ row.apartment_label }}</td>
                    <td>{{ formatOneDecimal(row.previous_heating_reading) }}</td>
                    <td *ngIf="!editingDetail">{{ formatOneDecimal(row.heating_current_reading) }}</td>
                    <td *ngIf="editingDetail">
                      <input
                        type="number"
                        step="0.1"
                        [ngModel]="editHeatingByApt[row.apartment_id]"
                        (ngModelChange)="editHeatingByApt[row.apartment_id] = $event"
                      />
                    </td>
                    <td *ngIf="!editingDetail">{{ calculateDiff(row.heating_current_reading, row.previous_heating_reading) }}</td>
                    <td *ngIf="editingDetail">{{ calculateDiff(editHeatingByApt[row.apartment_id], row.previous_heating_reading) }}</td>
                    <td>{{ formatOneDecimal(row.previous_heated_water_reading) }}</td>
                    <td *ngIf="!editingDetail">{{ formatOneDecimal(row.heated_water_current_reading) }}</td>
                    <td *ngIf="editingDetail">
                      <input
                        type="number"
                        step="0.1"
                        [ngModel]="editWaterByApt[row.apartment_id]"
                        (ngModelChange)="editWaterByApt[row.apartment_id] = $event"
                      />
                    </td>
                    <td *ngIf="!editingDetail">{{ calculateDiff(row.heated_water_current_reading, row.previous_heated_water_reading) }}</td>
                    <td *ngIf="editingDetail">{{ calculateDiff(editWaterByApt[row.apartment_id], row.previous_heated_water_reading) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="subpanel" *ngIf="canWrite !== false">
          <h3>Νέα καταχώριση ημερομηνίας</h3>
          <div class="form-grid">
            <mat-form-field>
              <mat-label>Ημερομηνία μέτρησης</mat-label>
              <input matInput [matDatepicker]="entryDatePicker" [value]="toDate(entryDate)" (click)="entryDatePicker.open()" (dateChange)="onEntryDatePicked($event.value)" />
              <mat-datepicker-toggle matIconSuffix [for]="entryDatePicker"></mat-datepicker-toggle>
              <mat-datepicker #entryDatePicker></mat-datepicker>
            </mat-form-field>
          </div>
          <p class="hint" *ngIf="loadingEntryForm">Προετοιμασία φόρμας ημερομηνίας...</p>

          <div class="table-wrap" *ngIf="entryRows.length">
            <table>
              <thead>
                <tr>
                  <th>Διαμέρισμα</th>
                  <th>Προηγ. Θέρμανση</th>
                  <th>Τρέχ. Θέρμανση</th>
                  <th>Μονάδες Θέρμανσης</th>
                  <th>Προηγ. Ζεστό νερό</th>
                  <th>Τρέχ. Ζεστό νερό</th>
                  <th>Μονάδες Ζ. Νερού</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of entryRows">
                  <td>{{ row.apartment_label }}</td>
                  <td>{{ formatOneDecimal(row.previous_heating_reading) }}</td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      [ngModel]="heatingCurrentByApt[row.apartment_id]"
                      (ngModelChange)="setHeatingCurrent(row.apartment_id, $event)"
                    />
                  </td>
                  <td>{{ calculateDiff(heatingCurrentByApt[row.apartment_id], row.previous_heating_reading) }}</td>
                  <td>{{ formatOneDecimal(row.previous_heated_water_reading) }}</td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      [ngModel]="heatedWaterCurrentByApt[row.apartment_id]"
                      (ngModelChange)="setHeatedWaterCurrent(row.apartment_id, $event)"
                    />
                  </td>
                  <td>{{ calculateDiff(heatedWaterCurrentByApt[row.apartment_id], row.previous_heated_water_reading) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="actions">
            <button class="btn btn-primary" (click)="saveMonthlyMeasurements()" [disabled]="saving">
              {{ saving ? 'Αποθήκευση...' : 'Αποθήκευση μετρήσεων ημερομηνίας' }}
            </button>
          </div>
        </section>
      </div>

      <p class="hint" *ngIf="message">{{ message }}</p>
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
    .hint.error {
      color: #ff9fa5;
    }
    .stack {
      display: grid;
      gap: 1rem;
    }
    .subpanel {
      border: 1px solid #27385f;
      border-radius: 12px;
      padding: 0.8rem;
      background: #0f1933;
    }
    h3 {
      margin: 0 0 0.6rem;
      font-size: 0.98rem;
    }
    h4 {
      margin: 0.7rem 0 0.5rem;
      font-size: 0.92rem;
    }
    .details-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .details-actions {
      display: flex;
      gap: 0.4rem;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.7rem;
      margin-bottom: 0.5rem;
    }
    label {
      display: grid;
      gap: 0.3rem;
      color: #b5c9f5;
      font-size: 0.86rem;
    }
    input:not([matInput]) {
      border: 1px solid #31416c;
      border-radius: 10px;
      background: #0d1430;
      color: #fff;
      padding: 0.55rem;
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid #243152;
      border-radius: 10px;
      background: #0d1530;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1024px;
    }
    th,
    td {
      border-bottom: 1px solid #223153;
      padding: 0.5rem 0.6rem;
      text-align: left;
      font-size: 0.86rem;
    }
    th {
      color: #9cb2e4;
      font-weight: 600;
      background: #111d3d;
      white-space: nowrap;
    }
    tbody tr {
      transition: background-color 0.15s ease;
    }
    tbody tr:hover {
      background: rgba(92, 120, 196, 0.22);
    }
    .actions {
      margin-top: 0.7rem;
    }
    .btn {
      border: 0;
      border-radius: 10px;
      padding: 0.55rem 0.9rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary {
      background: linear-gradient(135deg, #4f78ff, #6d62ff);
      box-shadow: 0 8px 18px rgba(70, 95, 255, 0.35);
    }
    .btn-secondary {
      border: 1px solid #30457d;
      background: #132247;
    }
    .row-actions {
      white-space: nowrap;
      vertical-align: middle;
    }
    @media (max-width: 900px) {
      .form-grid {
        grid-template-columns: 1fr;
      }
      table {
        min-width: 780px;
      }
    }
  `,
})
export class MeasurementsComponent implements OnInit {
  me: Me | null = null;
  canWrite: boolean | null = null;
  monthItems: MonthItem[] = [];
  expandedDate: string | null = null;
  expandedRows: MonthDetailRow[] = [];
  detailLocked = false;
  editingDetail = false;
  savingDetail = false;
  editHeatingByApt: Record<number, string> = {};
  editWaterByApt: Record<number, string> = {};
  entryRows: EntryRow[] = [];
  entryDate = '';
  loading = true;
  loadingDetails = false;
  loadingEntryForm = false;
  saving = false;
  deletingDate: string | null = null;
  loadError = '';
  message = '';
  heatingCurrentByApt: Record<number, string> = {};
  heatedWaterCurrentByApt: Record<number, string> = {};

  constructor(
    private readonly data: AppDataService,
    private readonly http: HttpClient,
    private readonly adminMode: AdminModeService,
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.loadError = '';
    this.data.getMe().subscribe({
      next: (me) => {
        this.me = me;
        this.refreshCanWrite();
      },
      error: () => {
        this.canWrite = false;
      },
    });
    this.adminMode.adminModeActive$.subscribe(() => this.refreshCanWrite());
    this.loadMonths();
  }

  private refreshCanWrite(): void {
    this.canWrite = this.adminMode.canManage(this.me);
    if (this.canWrite && this.entryDate && this.entryRows.length === 0) {
      this.loadEntryForm(this.entryDate);
    }
  }

  loadMonths(): void {
    this.http
      .get<{ items: MonthItem[]; suggested_next_date: string }>(`${API_BASE}/api/accounting/heating-inputs/dates/`)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (response) => {
          this.monthItems = response.items;
          if (!this.entryDate) {
            this.entryDate = response.suggested_next_date;
            if (this.adminMode.canManage(this.me)) {
              this.loadEntryForm(this.entryDate);
            }
          }
        },
        error: (error) => {
          const status = error?.status ? ` (${error.status})` : '';
          this.loadError = `Αποτυχία φόρτωσης μηνών μετρήσεων${status}.`;
        },
      });
  }

  toggleDate(measurementDate: string): void {
    if (this.expandedDate === measurementDate) {
      this.expandedDate = null;
      this.expandedRows = [];
      this.resetDetailEditState();
      return;
    }
    this.expandedDate = measurementDate;
    this.resetDetailEditState();
    this.loadDateDetail(measurementDate);
  }

  loadDateDetail(measurementDate: string): void {
    this.loadingDetails = true;
    this.http
      .get<{
        measurement_date: string;
        locked: boolean;
        rows: MonthDetailRow[];
      }>(`${API_BASE}/api/accounting/heating-inputs/date-detail/?measurement_date=${measurementDate}`)
      .pipe(finalize(() => (this.loadingDetails = false)))
      .subscribe({
        next: (response) => {
          this.expandedRows = this.sortRowsByUnitCode(response.rows);
          this.detailLocked = response.locked;
        },
        error: (error) => {
          this.message = error?.error?.detail || 'Αποτυχία φόρτωσης αναλυτικών μετρήσεων.';
          this.expandedRows = [];
        },
      });
  }

  private resetDetailEditState(): void {
    this.editingDetail = false;
    this.savingDetail = false;
    this.detailLocked = false;
    this.editHeatingByApt = {};
    this.editWaterByApt = {};
  }

  startEditDetail(): void {
    if (!this.canWrite || this.detailLocked) return;
    this.editHeatingByApt = {};
    this.editWaterByApt = {};
    this.expandedRows.forEach((row) => {
      const heating = row.heating_current_reading?.toString().trim();
      const water = row.heated_water_current_reading?.toString().trim();
      this.editHeatingByApt[row.apartment_id] = heating ? Number(heating).toString() : '';
      this.editWaterByApt[row.apartment_id] = water ? Number(water).toString() : '';
    });
    this.editingDetail = true;
  }

  cancelEditDetail(): void {
    this.editingDetail = false;
    this.editHeatingByApt = {};
    this.editWaterByApt = {};
  }

  saveEditDetail(): void {
    if (!this.expandedDate) return;

    const incomplete = this.expandedRows.find(
      (row) =>
        !this.editHeatingByApt[row.apartment_id]?.toString().trim() ||
        !this.editWaterByApt[row.apartment_id]?.toString().trim(),
    );
    if (incomplete) {
      this.message = `Συμπληρώστε και τις δύο μετρήσεις για το διαμέρισμα ${incomplete.apartment_label}.`;
      return;
    }

    this.savingDetail = true;
    this.message = '';
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/accounting/heating-inputs/monthly-upsert/`, {
        measurement_date: this.expandedDate,
        rows: this.expandedRows.map((row) => ({
          apartment_id: row.apartment_id,
          heating_current_reading: this.editHeatingByApt[row.apartment_id],
          heated_water_current_reading: this.editWaterByApt[row.apartment_id],
        })),
      })
      .pipe(finalize(() => (this.savingDetail = false)))
      .subscribe({
        next: (response) => {
          this.message = response.detail;
          this.editingDetail = false;
          if (this.expandedDate) {
            this.loadDateDetail(this.expandedDate);
          }
          this.loadMonths();
        },
        error: (error) => {
          this.message = error?.error?.detail || 'Αποτυχία αποθήκευσης μετρήσεων.';
        },
      });
  }

  onEntryDateChange(): void {
    this.loadEntryForm(this.entryDate);
  }

  loadEntryForm(measurementDate: string): void {
    if (!measurementDate) return;
    this.loadingEntryForm = true;
    this.heatingCurrentByApt = {};
    this.heatedWaterCurrentByApt = {};
    this.http
      .get<EntryFormResponse>(
        `${API_BASE}/api/accounting/heating-inputs/entry-form/?measurement_date=${measurementDate}`,
      )
      .pipe(finalize(() => (this.loadingEntryForm = false)))
      .subscribe({
        next: (response) => {
          this.entryRows = this.sortRowsByUnitCode(response.rows);
          this.entryDate = response.measurement_date;
          this.entryRows.forEach((row) => {
            this.heatingCurrentByApt[row.apartment_id] = '';
            this.heatedWaterCurrentByApt[row.apartment_id] = '';
          });
        },
        error: (error) => {
          this.message = error?.error?.detail || 'Αποτυχία φόρτωσης φόρμας εισαγωγής.';
          this.entryRows = [];
        },
      });
  }

  setHeatingCurrent(apartmentId: number, value: string): void {
    this.heatingCurrentByApt[apartmentId] = value;
  }

  setHeatedWaterCurrent(apartmentId: number, value: string): void {
    this.heatedWaterCurrentByApt[apartmentId] = value;
  }

  calculateDiff(currentValue: string, previousValue: string): string {
    if (!currentValue?.toString().trim()) return '-';
    const current = Number(currentValue);
    const previous = Number(previousValue || '0');
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return '-';
    return (current - previous).toFixed(1);
  }

  formatOneDecimal(value: string | null | undefined): string {
    if (!value?.toString().trim()) return '-';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toFixed(1);
  }

  deleteMeasurementsByDate(measurementDate: string): void {
    if (!this.canWrite) return;
    const confirmed = window.confirm('Να διαγραφούν όλες οι μετρήσεις της ημερομηνίας;');
    if (!confirmed) return;

    this.deletingDate = measurementDate;
    this.message = '';
    this.http
      .delete<{ detail: string; warnings?: string[] }>(
        `${API_BASE}/api/accounting/heating-inputs/by-date/?measurement_date=${measurementDate}`,
      )
      .pipe(finalize(() => (this.deletingDate = null)))
      .subscribe({
        next: (response) => {
          const warnings = response.warnings?.length ? ` ${response.warnings.join(' ')}` : '';
          this.message = `${response.detail}${warnings}`;
          if (this.expandedDate === measurementDate) {
            this.expandedDate = null;
            this.expandedRows = [];
          }
          this.loadMonths();
        },
        error: (error) => {
          this.message = error?.error?.detail || 'Αποτυχία διαγραφής μετρήσεων.';
        },
      });
  }

  saveMonthlyMeasurements(): void {
    if (!this.entryDate) {
      this.message = 'Παρακαλώ συμπληρώστε ημερομηνία μέτρησης.';
      return;
    }

    const incomplete = this.entryRows.find(
      (row) =>
        !this.heatingCurrentByApt[row.apartment_id]?.toString().trim() ||
        !this.heatedWaterCurrentByApt[row.apartment_id]?.toString().trim(),
    );
    if (incomplete) {
      this.message = `Συμπληρώστε και τις δύο μετρήσεις για το διαμέρισμα ${incomplete.apartment_label}.`;
      return;
    }

    this.saving = true;
    this.http
      .post<{ detail: string }>(`${API_BASE}/api/accounting/heating-inputs/monthly-upsert/`, {
        measurement_date: this.entryDate,
        rows: this.entryRows.map((row) => ({
          apartment_id: row.apartment_id,
          heating_current_reading: this.heatingCurrentByApt[row.apartment_id],
          heated_water_current_reading: this.heatedWaterCurrentByApt[row.apartment_id],
        })),
      })
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: (response) => {
          this.message = response.detail;
          this.expandedDate = this.entryDate;
          this.loadDateDetail(this.entryDate);
          this.loadMonths();
          this.loadEntryForm(this.entryDate);
        },
        error: (error) => {
          this.message = error?.error?.detail || 'Αποτυχία αποθήκευσης μετρήσεων.';
        },
      });
  }

  private sortRowsByUnitCode<T extends { apartment_label: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) =>
      this.extractUnitCode(a.apartment_label).localeCompare(this.extractUnitCode(b.apartment_label), 'el'),
    );
  }

  private extractUnitCode(apartmentLabel: string): string {
    return apartmentLabel.split('-')[0].trim();
  }

  toDate(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  onEntryDatePicked(value: Date | null): void {
    if (!value) return;
    this.entryDate = this.toIsoDate(value);
    this.onEntryDateChange();
  }

  private toIsoDate(value: Date): string {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
