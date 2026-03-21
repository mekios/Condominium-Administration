import { ResolveFn } from '@angular/router';
import { inject } from '@angular/core';
import { catchError, forkJoin, map, of } from 'rxjs';

import { AppDataService } from './app-data.service';

export const appPreloadResolver: ResolveFn<boolean> = () => {
  const data = inject(AppDataService);
  return forkJoin({
    me: data.getMe(),
    apartments: data.getApartments(),
  }).pipe(
    map(() => true),
    // Never block route rendering on preload failures.
    catchError(() => of(true)),
  );
};
