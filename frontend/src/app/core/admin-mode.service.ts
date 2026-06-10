import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Me } from './app-data.service';

const STORAGE_KEY = 'mtmf_admin_mode';

@Injectable({ providedIn: 'root' })
export class AdminModeService {
  private readonly activeSubject = new BehaviorSubject<boolean>(this.readStored());
  readonly adminModeActive$ = this.activeSubject.asObservable();

  isActive(): boolean {
    return this.activeSubject.value;
  }

  enter(): void {
    this.setActive(true);
  }

  exit(): void {
    this.setActive(false);
  }

  toggle(): void {
    this.setActive(!this.isActive());
  }

  canManage(me: Me | null): boolean {
    if (!me) return false;
    if (me.role === 'superadmin') return true;
    if (me.role === 'administrator') return this.isActive();
    return false;
  }

  isAdministratorRole(me: Me | null): boolean {
    return me?.role === 'administrator';
  }

  isSuperadmin(me: Me | null): boolean {
    return me?.role === 'superadmin';
  }

  private setActive(value: boolean): void {
    this.activeSubject.next(value);
    if (value) {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  private readStored(): boolean {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
