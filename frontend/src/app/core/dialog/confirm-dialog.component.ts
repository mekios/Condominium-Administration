import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { NgIf } from '@angular/common';

export type ConfirmDialogData = {
  title: string;
  message: string;
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

@Component({
  standalone: true,
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, NgIf],
  template: `
    <div class="dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="'dialog-title'">
      <div class="dialog-icon" [class.destructive]="data.destructive !== false" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path
            *ngIf="data.destructive !== false"
            d="M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          />
          <path
            *ngIf="data.destructive === false"
            d="M12 16v-4 M12 8h.01 M22 12A10 10 0 1 1 12 2a10 10 0 0 1 10 10z"
          />
        </svg>
      </div>

      <h2 id="dialog-title" class="dialog-title">{{ data.title }}</h2>
      <p class="dialog-message">{{ data.message }}</p>
      <p class="dialog-warning" *ngIf="data.warning">{{ data.warning }}</p>

      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" (click)="close(false)">
          {{ data.cancelLabel || 'Ακύρωση' }}
        </button>
        <button
          type="button"
          class="btn"
          [class.btn-danger]="data.destructive !== false"
          [class.btn-primary]="data.destructive === false"
          (click)="close(true)"
        >
          {{ data.confirmLabel || 'Επιβεβαίωση' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .dialog {
      width: min(420px, calc(100vw - 2rem));
      border: 1px solid #2a3962;
      border-radius: 14px;
      background: linear-gradient(180deg, #121d38 0%, #0f1933 100%);
      padding: 1.35rem 1.35rem 1.15rem;
      color: #e8f1ff;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
    }

    .dialog-icon {
      width: 2.6rem;
      height: 2.6rem;
      border-radius: 999px;
      display: grid;
      place-items: center;
      margin-bottom: 0.85rem;
      border: 1px solid rgba(109, 141, 206, 0.45);
      background: rgba(79, 120, 255, 0.12);
    }

    .dialog-icon.destructive {
      border-color: rgba(217, 88, 111, 0.45);
      background: rgba(217, 88, 111, 0.12);
    }

    .dialog-icon svg {
      width: 1.35rem;
      height: 1.35rem;
      fill: none;
      stroke: #8fb0ff;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .dialog-icon.destructive svg {
      stroke: #f06b82;
    }

    .dialog-title {
      margin: 0 0 0.45rem;
      font-size: 1.08rem;
      font-weight: 700;
      color: #f4f8ff;
    }

    .dialog-message {
      margin: 0;
      color: #b8c8ed;
      font-size: 0.94rem;
      line-height: 1.45;
    }

    .dialog-warning {
      margin: 0.75rem 0 0;
      color: #ffd97a;
      font-size: 0.88rem;
      line-height: 1.4;
      border: 1px solid rgba(198, 144, 46, 0.45);
      background: linear-gradient(180deg, rgba(96, 68, 18, 0.28), rgba(70, 49, 12, 0.22));
      border-radius: 10px;
      padding: 0.55rem 0.65rem;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.55rem;
      margin-top: 1.15rem;
    }

    .btn {
      border: 0;
      border-radius: 10px;
      padding: 0.58rem 0.95rem;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.9rem;
    }

    .btn-ghost {
      background: transparent;
      border: 1px solid #3b4b79;
      color: #c9d9ff;
    }

    .btn-ghost:hover {
      border-color: #5a6fa8;
      color: #e8f1ff;
    }

    .btn-primary {
      background: linear-gradient(135deg, #4f78ff, #6d62ff);
      box-shadow: 0 8px 18px rgba(70, 95, 255, 0.35);
    }

    .btn-danger {
      border: 1px solid #d9586f;
      background: transparent;
      color: #f06b82;
      box-shadow: none;
    }

    .btn-danger:hover {
      border-color: #f06b82;
      background: rgba(217, 88, 111, 0.12);
    }
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ConfirmDialogComponent, boolean>);

  close(confirmed: boolean): void {
    this.dialogRef.close(confirmed);
  }
}
