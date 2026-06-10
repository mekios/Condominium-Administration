import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { map, Observable } from 'rxjs';

import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

export type ConfirmOptions = ConfirmDialogData;

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(MatDialog);

  confirm(options: ConfirmOptions): Observable<boolean> {
    return this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          destructive: true,
          ...options,
        },
        panelClass: 'app-dialog-panel',
        backdropClass: 'app-dialog-backdrop',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(map((result) => !!result));
  }
}
