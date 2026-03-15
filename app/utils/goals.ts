import { auth, db } from '@/app/utils/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { startOfMonth, endOfMonth, format, isAfter, isBefore } from 'date-fns';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getDispositionsAsync } from '@/app/utils/dispositions';
import { Lead, User } from '@/app/types';

export type MonthId = `${number}-${string}`; // e.g. 2026-03

export interface UserGoal {
  uid: string;
  month: string; // YYYY-MM
  doorKnocksGoal: number;
  updatedAt?: any;
  updatedBy?: string;
}

export function getMonthId(d = new Date()): MonthId {
  return format(d, 'yyyy-MM') as MonthId;
}

export function getUserGoalDocId(uid: string, month: string) {
  // Stable, URL-safe document id
  return `${uid}_${month.replace('-', '')}`; // e.g. uid_202603
}

export function countWorkdaysInMonth(monthDate: Date) {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    // 0=Sun, 6=Sat; workdays Mon–Fri
    if (day >= 1 && day <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function countWorkdaysElapsedAndRemaining(monthDate: Date, now = new Date()) {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);

  let elapsed = 0;
  let remaining = 0;

  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    const isWorkday = day >= 1 && day <= 5;
    if (isWorkday) {
      // elapsed = workdays strictly before today
      // remaining = workdays on/after today
      const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (isBefore(startOfDay, startOfToday)) elapsed++;
      else remaining++;
    }
    d.setDate(d.getDate() + 1);
  }

  return { elapsed, remaining };
}

export async function getMyMonthlyKnocksAsync(monthDate: Date, currentUser: User) {
  const [leads, dispositions] = await Promise.all([getLeadsAsync(), getDispositionsAsync()]);

  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);

  const doorKnockStatusIds = dispositions
    .filter(d => d.countsAsDoorKnock)
    .map(d => d.id.toLowerCase());

  const knocks = leads.filter((lead: Lead) => {
    if (!lead.dispositionedAt) return false;
    if (!lead.claimedBy) return false;
    if (lead.claimedBy !== currentUser.id) return false;

    const disp = (lead.status || lead.disposition || '').toLowerCase();
    if (!doorKnockStatusIds.includes(disp)) return false;

    const dt = new Date(lead.dispositionedAt);
    // within month (local)
    if (isBefore(dt, start) || isAfter(dt, end)) return false;

    return true;
  }).length;

  return knocks;
}

export async function getMyGoalAsync(month: string, uidOverride?: string): Promise<UserGoal | null> {
  if (!db) return null;
  const uid = uidOverride || auth?.currentUser?.uid;
  if (!uid) return null;
  const docId = getUserGoalDocId(uid, month);
  const snap = await getDoc(doc(db, 'userGoals', docId));
  if (!snap.exists()) return null;
  return snap.data() as any;
}
