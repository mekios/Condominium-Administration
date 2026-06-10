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
import { DialogService } from '../core/dialog/dialog.service';

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
        <div>
          <h2>Μετρήσεις</h2>
          <p>Καταχώριση και ιστορικό μετρήσεων θέρμανσης &amp; ζεστού νερού.</p>
        </div>
        <button
          *ngIf="canWrite && !showEntryPanel"
          class="btn btn-primary btn-cta"
          (click)="openEntryPanel()"
        >
          + Νέα καταχώριση
        </button>
      </div>

      <p class="hint" *ngIf="loading">Φόρτωση δεδομένων...</p>
      <p class="hint error" *ngIf="loadError">{{ loadError }}</p>
      <p class="hint app-warning" *ngIf="!loading && !loadError && canWrite === false">
        Λειτουργία μόνο ανάγνωσης. Για καταχώριση μετρήσεων ενεργοποιήστε τη λειτουργία διαχειριστή.
      </p>

      <p class="banner-msg" *ngIf="message">{{ message }}</p>

      <div *ngIf="!loadError" class="stack">
        <!-- New entry (collapsible, hidden by default) -->
        <section class="subpanel entry-panel" *ngIf="showEntryPanel">
          <div class="subpanel-head">
            <div class="subpanel-title">
              <h3>Νέα καταχώριση μετρήσεων</h3>
              <p class="muted">Επίλεξε ημερομηνία και συμπλήρωσε τις τρέχουσες ενδείξεις ανά διαμέρισμα.</p>
            </div>
            <button class="icon-close" aria-label="Κλείσιμο" (click)="closeEntryPanel()">✕</button>
          </div>

          <mat-form-field class="date-field">
            <mat-label>Ημερομηνία μέτρησης</mat-label>
            <input matInput [matDatepicker]="entryDatePicker" [value]="toDate(entryDate)" (click)="entryDatePicker.open()" (dateChange)="onEntryDatePicked($event.value)" />
            <mat-datepicker-toggle matIconSuffix [for]="entryDatePicker"></mat-datepicker-toggle>
            <mat-datepicker #entryDatePicker></mat-datepicker>
          </mat-form-field>

          <p class="hint" *ngIf="loadingEntryForm">Προετοιμασία φόρμας ημερομηνίας...</p>

          <div class="table-wrap" *ngIf="entryRows.length">
            <table>
              <thead>
                <tr>
                  <th rowspan="2" class="apt-col">Διαμέρισμα</th>
                  <th colspan="3" class="group-h">Θέρμανση</th>
                  <th colspan="3" class="group-w">Ζεστό νερό</th>
                </tr>
                <tr>
                  <th>Προηγ.</th>
                  <th>Τρέχ.</th>
                  <th>Μονάδες</th>
                  <th>Προηγ.</th>
                  <th>Τρέχ.</th>
                  <th>Μονάδες</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of entryRows">
                  <td class="apt-col">{{ row.apartment_label }}</td>
                  <td class="muted">{{ formatOneDecimal(row.previous_heating_reading) }}</td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="—"
                      [ngModel]="heatingCurrentByApt[row.apartment_id]"
                      (ngModelChange)="setHeatingCurrent(row.apartment_id, $event)"
                    />
                  </td>
                  <td class="units">{{ calculateDiff(heatingCurrentByApt[row.apartment_id], row.previous_heating_reading) }}</td>
                  <td class="muted">{{ formatOneDecimal(row.previous_heated_water_reading) }}</td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="—"
                      [ngModel]="heatedWaterCurrentByApt[row.apartment_id]"
                      (ngModelChange)="setHeatedWaterCurrent(row.apartment_id, $event)"
                    />
                  </td>
                  <td class="units">{{ calculateDiff(heatedWaterCurrentByApt[row.apartment_id], row.previous_heated_water_reading) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="actions">
            <button class="btn btn-primary" (click)="saveMonthlyMeasurements()" [disabled]="saving">
              {{ saving ? 'Αποθήκευση...' : 'Αποθήκευση μετρήσεων' }}
            </button>
            <button class="btn btn-secondary" (click)="closeEntryPanel()" [disabled]="saving">Ακύρωση</button>
          </div>
        </section>

        <!-- History -->
        <section class="subpanel">
          <h3>Ιστορικό μετρήσεων</h3>

          <p class="empty" *ngIf="!loading && !monthItems.length">
            Δεν υπάρχουν καταχωρημένες μετρήσεις ακόμη.
          </p>

          <div class="table-wrap" *ngIf="monthItems.length">
            <table class="history-table">
              <thead>
                <tr>
                  <th>Ημερομηνία</th>
                  <th>Θέρμανση</th>
                  <th>Ζεστό νερό</th>
                  <th>Διαμερίσματα</th>
                  <th>Κατάσταση</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let item of monthItems">
                  <tr [class.row-open]="expandedDate === item.measurement_date">
                    <td class="date-cell">{{ item.measurement_date | date:'d MMMM yyyy' }}</td>
                    <td>{{ item.heating_entries }}</td>
                    <td>{{ item.heated_water_entries }}</td>
                    <td>{{ item.apartments_total }}</td>
                    <td>
                      <span class="badge" [class.badge-locked]="item.locked" [class.badge-open]="!item.locked">
                        {{ item.locked ? 'Σε λογαριασμούς' : 'Επεξεργάσιμο' }}
                      </span>
                    </td>
                    <td class="row-actions inline-action-group">
                      <button class="btn btn-secondary" (click)="toggleDate(item.measurement_date)">
                        {{ expandedDate === item.measurement_date ? 'Απόκρυψη' : 'Προβολή' }}
                      </button>
                      <button
                        class="btn btn-danger btn-danger-icon"
                        *ngIf="canWrite"
                        aria-label="Διαγραφή"
                        title="Διαγραφή μετρήσεων ημερομηνίας"
                        (click)="deleteMeasurementsByDate(item.measurement_date)"
                        [disabled]="deletingDate === item.measurement_date"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                  <tr *ngIf="expandedDate === item.measurement_date" class="detail-row">
                    <td colspan="6">
                      <div class="details">
                        <div class="details-head">
                          <h4>
                            Ανάλυση μετρήσεων
                            <span class="badge badge-locked" *ngIf="detailLocked">Σε λογαριασμούς</span>
                          </h4>
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
                        <p class="hint app-warning" *ngIf="detailLocked">
                          Οι μετρήσεις αυτού του μήνα έχουν χρησιμοποιηθεί σε κατανομή εξόδων (υπάρχουν λογαριασμοί) και δεν είναι επεξεργάσιμες. Ανακαλέστε πρώτα τους λογαριασμούς του μήνα.
                        </p>
                        <p class="hint" *ngIf="loadingDetails">Φόρτωση αναλυτικών μετρήσεων...</p>
                        <div class="table-wrap" *ngIf="expandedRows.length">
                          <table>
                            <thead>
                              <tr>
                                <th rowspan="2" class="apt-col">Διαμέρισμα</th>
                                <th colspan="3" class="group-h">Θέρμανση</th>
                                <th colspan="3" class="group-w">Ζεστό νερό</th>
                              </tr>
                              <tr>
                                <th>Προηγ.</th>
                                <th>Τρέχ.</th>
                                <th>Μονάδες</th>
                                <th>Προηγ.</th>
                                <th>Τρέχ.</th>
                                <th>Μονάδες</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr *ngFor="let row of expandedRows">
                                <td class="apt-col">{{ row.apartment_label }}</td>
                                <td class="muted">{{ formatOneDecimal(row.previous_heating_reading) }}</td>
                                <td *ngIf="!editingDetail">{{ formatOneDecimal(row.heating_current_reading) }}</td>
                                <td *ngIf="editingDetail">
                                  <input
                                    type="number"
                                    step="0.1"
                                    [ngModel]="editHeatingByApt[row.apartment_id]"
                                    (ngModelChange)="editHeatingByApt[row.apartment_id] = $event"
                                  />
                                </td>
                                <td class="units" *ngIf="!editingDetail">{{ calculateDiff(row.heating_current_reading, row.previous_heating_reading) }}</td>
                                <td class="units" *ngIf="editingDetail">{{ calculateDiff(editHeatingByApt[row.apartment_id], row.previous_heating_reading) }}</td>
                                <td class="muted">{{ formatOneDecimal(row.previous_heated_water_reading) }}</td>
                                <td *ngIf="!editingDetail">{{ formatOneDecimal(row.heated_water_current_reading) }}</td>
                                <td *ngIf="editingDetail">
                                  <input
                                    type="number"
                                    step="0.1"
                                    [ngModel]="editWaterByApt[row.apartment_id]"
                                    (ngModelChange)="editWaterByApt[row.apartment_id] = $event"
                                  />
                                </td>
                                <td class="units" *ngIf="!editingDetail">{{ calculateDiff(row.heated_water_current_reading, row.previous_heated_water_reading) }}</td>
                                <td class="units" *ngIf="editingDetail">{{ calculateDiff(editWaterByApt[row.apartment_id], row.previous_heated_water_reading) }}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                </ng-container>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: `
    .panel {
      border: 1px solid #243152;
      background: #101a33;
      border-radius: 12px;
      padding: 1rem;
    }
    .panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.8rem;
      flex-wrap: wrap;
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
    .btn-cta {
      flex-shrink: 0;
      font-size: 0.95rem;
      padding: 0.6rem 1.1rem;
    }
    .banner-msg {
      margin: 0 0 0.8rem;
      border: 1px solid #2f6a4a;
      background: linear-gradient(180deg, rgba(24, 96, 60, 0.28), rgba(14, 70, 44, 0.22));
      color: #b5f0cf;
      border-radius: 10px;
      padding: 0.55rem 0.7rem;
      font-size: 0.88rem;
    }
    .stack {
      display: grid;
      gap: 1rem;
    }
    .subpanel {
      border: 1px solid #27385f;
      border-radius: 12px;
      padding: 0.9rem;
      background: #0f1933;
    }
    .entry-panel {
      border-color: #3a4f86;
      box-shadow: inset 0 0 0 1px rgba(99, 121, 255, 0.12);
    }
    .subpanel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
      margin-bottom: 0.6rem;
    }
    .subpanel-title .muted,
    p.muted {
      margin: 0.2rem 0 0;
      color: #8aa0d0;
      font-size: 0.82rem;
    }
    .icon-close {
      border: 1px solid #334a7c;
      background: #122043;
      color: #dce8ff;
      border-radius: 8px;
      width: 2rem;
      height: 2rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    h3 {
      margin: 0 0 0.6rem;
      font-size: 0.98rem;
    }
    h4 {
      margin: 0 0 0.2rem;
      font-size: 0.92rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .details {
      padding: 0.2rem 0 0.3rem;
    }
    .details-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
    }
    .details-actions {
      display: flex;
      gap: 0.4rem;
    }
    .date-field {
      max-width: 260px;
      margin-bottom: 0.5rem;
    }
    .empty {
      color: #8aa0d0;
      font-size: 0.9rem;
      padding: 0.6rem 0.2rem;
    }
    .muted {
      color: #8094c0;
    }
    .units {
      font-variant-numeric: tabular-nums;
      color: #cfe0ff;
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 0.18rem 0.6rem;
      font-size: 0.74rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-open {
      color: #b6f0d0;
      border: 1px solid #2f6a4a;
      background: rgba(33, 110, 70, 0.25);
    }
    .badge-locked {
      color: #ffd38a;
      border: 1px solid #8b6a37;
      background: rgba(120, 88, 38, 0.28);
    }
    input:not([matInput]) {
      border: 1px solid #31416c;
      border-radius: 10px;
      background: #0d1430;
      color: #fff;
      padding: 0.5rem;
      width: 100%;
      max-width: 120px;
    }
    input:not([matInput]):focus {
      outline: none;
      border-color: #6d8dce;
      box-shadow: 0 0 0 2px rgba(109, 141, 206, 0.22);
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
      min-width: 760px;
    }
    .history-table {
      min-width: 640px;
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
    th.group-h,
    th.group-w {
      text-align: center;
      border-left: 1px solid #223153;
    }
    th.group-h {
      color: #ffb38a;
    }
    th.group-w {
      color: #8ac6ff;
    }
    .apt-col {
      position: sticky;
      left: 0;
      background: #0d1530;
      z-index: 1;
    }
    th.apt-col {
      background: #111d3d;
    }
    .date-cell {
      white-space: nowrap;
      font-weight: 600;
      color: #e2ecff;
    }
    tbody tr {
      transition: background-color 0.15s ease;
    }
    tbody tr:hover:not(.detail-row) {
      background: rgba(92, 120, 196, 0.18);
    }
    tr.row-open > td {
      background: rgba(92, 120, 196, 0.16);
    }
    tr.detail-row > td {
      background: #0c1429;
      padding: 0.4rem 0.7rem 0.8rem;
    }
    tr.detail-row:hover > td {
      background: #0c1429;
    }
    .actions {
      margin-top: 0.8rem;
      display: flex;
      gap: 0.5rem;
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
      table {
        min-width: 640px;
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
  showEntryPanel = false;
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
    private readonly dialog: DialogService,
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
    if (!this.canWrite) {
      this.closeEntryPanel();
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
          }
        },
        error: (error) => {
          const status = error?.status ? ` (${error.status})` : '';
          this.loadError = `Αποτυχία φόρτωσης μηνών μετρήσεων${status}.`;
        },
      });
  }

  openEntryPanel(): void {
    if (!this.canWrite) return;
    this.showEntryPanel = true;
    this.message = '';
    if (this.entryDate) {
      this.loadEntryForm(this.entryDate);
    }
  }

  closeEntryPanel(): void {
    this.showEntryPanel = false;
    this.entryRows = [];
    this.heatingCurrentByApt = {};
    this.heatedWaterCurrentByApt = {};
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
    this.dialog
      .confirm({
        title: 'Διαγραφή μετρήσεων',
        message: 'Να διαγραφούν όλες οι μετρήσεις της ημερομηνίας;',
        confirmLabel: 'Διαγραφή',
      })
      .subscribe((confirmed) => {
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
          const savedDate = this.entryDate;
          this.closeEntryPanel();
          this.loadMonths();
          this.expandedDate = savedDate;
          this.resetDetailEditState();
          this.loadDateDetail(savedDate);
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
