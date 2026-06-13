import { Me } from './app-data.service';

export function userDisplayName(me: Pick<Me, 'first_name' | 'last_name' | 'username'> | null | undefined): string {
  if (!me) return 'Χρήστη';

  const fullName = [me.first_name?.trim(), me.last_name?.trim()].filter(Boolean).join(' ');
  return fullName || me.username || 'Χρήστη';
}
