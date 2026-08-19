// Firestore-backed storage (replacing localStorage)
import { Lead, User, LeadStatus } from '@/app/types';
import { 
  getAllLeads as firestoreGetAllLeads,
  getLeadsForUser as firestoreGetLeadsForUser,
  getLeadsInBounds as firestoreGetLeadsInBounds,
  getLeadsInBoundsForUser as firestoreGetLeadsInBoundsForUser,
  saveLead as firestoreSaveLead,
  batchSaveLeads as firestoreBatchSaveLeads,
  updateLead as firestoreUpdateLead,
  deleteLead as firestoreDeleteLead,
  getAllUsers as firestoreGetAllUsers,
  saveUser as firestoreSaveUser,
  updateUser as firestoreUpdateUser,
  getUser as firestoreGetUser
} from './firestore';
import { getLeadsForUserLimited as firestoreGetLeadsForUserLimited, toThinMapLead } from './mapLeadFields';

// ============================================
// LEADS
// ============================================

let leadsCache: Lead[] | null = null;
let leadsCacheKey: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 90000; // 90 seconds

function convertLeadDates(lead: any): Lead {
  return {
    ...lead,
    createdAt: lead.createdAt ? new Date(lead.createdAt) : new Date(),
    claimedAt: lead.claimedAt ? new Date(lead.claimedAt) : undefined,
    dispositionedAt: lead.dispositionedAt ? new Date(lead.dispositionedAt) : undefined,
    assignedAt: lead.assignedAt ? new Date(lead.assignedAt) : undefined,
    solarTestedAt: lead.solarTestedAt ? new Date(lead.solarTestedAt) : undefined,
    objectionRecordedAt: lead.objectionRecordedAt ? new Date(lead.objectionRecordedAt) : undefined,
  };
}

export function getLeads(): Lead[] {
  if (leadsCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return leadsCache;
  }
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem('raydar_leads');
    if (data) {
      const parsed = JSON.parse(data);
      const leads = parsed.map(convertLeadDates);
      leadsCache = leads;
      cacheTimestamp = Date.now();
      return leads;
    }
  } catch (e) {
    console.error('Error reading leads from localStorage:', e);
  }
  return leadsCache || [];
}

export async function getLeadsAsync(): Promise<Lead[]> {
  try {
    const { getCurrentAuthUser } = await import('./auth');
    const me = await getCurrentAuthUser();
    const cacheKey = me?.role === 'admin' ? 'admin' : me?.id ? `user:${me.id}` : 'anon';
    if (leadsCache && leadsCacheKey === cacheKey && Date.now() - cacheTimestamp < CACHE_TTL) {
      return leadsCache;
    }
    const leads = me?.role === 'admin'
      ? await firestoreGetAllLeads()
      : me?.id
        ? await firestoreGetLeadsForUser(me.id)
        : [];
    leadsCache = leads || [];
    leadsCacheKey = cacheKey;
    cacheTimestamp = Date.now();
    return leadsCache;
  } catch (error) {
    console.error('Firestore getLeads failed:', error);
    return leadsCache || [];
  }
}

const MAP_LEAD_CAP = 400;

export type MapBounds = { south: number; north: number; west: number; east: number };

export async function getLeadsInBoundsAsync(
  south: number,
  north: number,
  west: number,
  east: number,
  maxLeads: number = 2000
): Promise<Lead[]> {
  try {
    const { getCurrentAuthUser } = await import('./auth');
    const me = await getCurrentAuthUser();
    if (!me) return [];
    const box: MapBounds = { south, north, west, east };
    if (me.role === 'admin' || me.role === 'manager') {
      const all = await firestoreGetLeadsInBounds(south, north, west, east, maxLeads);
      if (all.length > 0) return all;
      if (me.id) {
        const mine = await firestoreGetLeadsForUserLimited(me.id, 2500);
        return filterLeadsToBounds(mine, box).slice(0, maxLeads);
      }
      return [];
    }
    if (me.id) {
      return await firestoreGetLeadsInBoundsForUser(me.id, south, north, west, east, maxLeads);
    }
    return [];
  } catch (error) {
    console.error('Error getting leads in bounds:', error);
    return [];
  }
}

/**
 * Map pin fetch: never dump the full assigned+claimed set onto the map.
 * Field maps are viewport-scoped (tight cap per visible box is OK).
 * Admin + manager: page the existing lat-index until MAP_LEAD_CAP in-viewport pins.
 * Setter/closer: claimedBy+lat / assignedTo+lat when those indexes exist;
 * on missing-index / query fail, scan a capped slice of the user's turf and keep
 * in-viewport pins (not a hard 400 on the whole turf, not an unbounded dump).
 * No Rochester box when bounds are missing — return [] and let the viewport fetch.
 */
export async function getMapLeadsAsync(bounds?: MapBounds): Promise<Lead[]> {
  try {
    const { getCurrentAuthUser } = await import('./auth');
    const me = await getCurrentAuthUser();
    if (!me) return [];
    if (!bounds) return [];
    if (me.role === 'admin' || me.role === 'manager') {
      const leads = await firestoreGetLeadsInBounds(bounds.south, bounds.north, bounds.west, bounds.east, MAP_LEAD_CAP);
      if ((leads || []).length > 0) return leads.map(toThinMapLead);
      if (me.id) {
        const mine = await firestoreGetLeadsForUserLimited(me.id, 2500);
        return filterLeadsToBounds(mine, bounds).slice(0, MAP_LEAD_CAP).map(toThinMapLead);
      }
      return [];
    }
    if (me.id) {
      const leads = await firestoreGetLeadsInBoundsForUser(
        me.id,
        bounds.south,
        bounds.north,
        bounds.west,
        bounds.east,
        MAP_LEAD_CAP
      );
      return (leads || []).map(toThinMapLead);
    }
    return [];
  } catch (error) {
    console.error('Error getting map leads:', error);
    return (leadsCache || []).map(toThinMapLead);
  }
}

export function filterLeadsToBounds(leads: Lead[], bounds: MapBounds): Lead[] {
  return leads.filter((lead) => {
    if (lead.lat == null || lead.lng == null) return false;
    if (lead.lat < bounds.south || lead.lat > bounds.north) return false;
    if (bounds.west > bounds.east) {
      return lead.lng >= bounds.west || lead.lng <= bounds.east;
    }
    return lead.lng >= bounds.west && lead.lng <= bounds.east;
  });
}

export function saveLeads(leads: Lead[]): void {
  console.warn('saveLeads() is deprecated, use saveLeadsAsync() instead');
}

export async function saveLeadsAsync(leads: Lead[]): Promise<void> {
  for (const lead of leads) {
    await firestoreSaveLead(lead);
  }
  leadsCache = leads;
  cacheTimestamp = Date.now();
}

export async function saveLeadAsync(lead: Lead): Promise<void> {
  await firestoreSaveLead(lead);
  if (leadsCache) {
    const index = leadsCache.findIndex(l => l.id === lead.id);
    if (index >= 0) {
      leadsCache[index] = lead;
    } else {
      leadsCache.push(lead);
    }
  }
}

export function invalidateLeadsCache(): void {
  leadsCache = null;
  cacheTimestamp = 0;
}

export async function batchSaveLeadsAsync(
  leads: Lead[],
  onProgress?: (saved: number, total: number) => void
): Promise<void> {
  await firestoreBatchSaveLeads(leads, onProgress);
  leadsCache = null;
  cacheTimestamp = 0;
}

export async function updateLeadAsync(id: string, updates: Partial<Lead>): Promise<void> {
  await firestoreUpdateLead(id, updates);
  if (leadsCache) {
    const index = leadsCache.findIndex(l => l.id === id);
    if (index >= 0) {
      leadsCache[index] = { ...leadsCache[index], ...updates };
    }
  }
}

export async function deleteLeadAsync(id: string): Promise<void> {
  await firestoreDeleteLead(id);
  if (leadsCache) {
    leadsCache = leadsCache.filter(l => l.id !== id);
  }
}

export function deleteLead(id: string): void {
  const leads = JSON.parse(localStorage.getItem('raydar_leads') || '[]');
  const filtered = leads.filter((l: Lead) => l.id !== id);
  localStorage.setItem('raydar_leads', JSON.stringify(filtered));
  if (leadsCache) {
    leadsCache = leadsCache.filter(l => l.id !== id);
  }
}

let usersCache: User[] | null = null;
let usersCacheTimestamp = 0;

export function getUsers(): User[] {
  if (typeof window === 'undefined') return [];
  if (usersCache && Date.now() - usersCacheTimestamp < CACHE_TTL) {
    return usersCache;
  }
  const data = localStorage.getItem('raydar_users');
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return parsed.map((user: User) => ({
      ...user,
      createdAt: new Date(user.createdAt),
      lastLogin: user.lastLogin ? new Date(user.lastLogin) : undefined,
      approvalRequestedAt: (user as any).approvalRequestedAt ? new Date((user as any).approvalRequestedAt) : undefined,
    }));
  } catch {
    return [];
  }
}

export async function getUsersAsync(): Promise<User[]> {
  if (usersCache && usersCache.length > 0 && Date.now() - usersCacheTimestamp < CACHE_TTL) {
    return usersCache;
  }
  try {
    const { getCurrentAuthUser } = await import('./auth');
    const me = await getCurrentAuthUser();
    if (!me) return usersCache || [];
    const users = await firestoreGetAllUsers();
    if (users.length > 0) {
      usersCache = users;
      usersCacheTimestamp = Date.now();
    }
    return users;
  } catch (error) {
    console.error('Firestore getUsers failed:', error);
    return usersCache || [];
  }
}

export function saveUsers(users: User[]): void {
  console.warn('saveUsers() is deprecated, use saveUsersAsync() instead');
}

export async function saveUsersAsync(users: User[]): Promise<void> {
  for (const user of users) {
    await firestoreSaveUser(user);
  }
  usersCache = users;
  usersCacheTimestamp = Date.now();
}

export async function saveUserAsync(user: User): Promise<void> {
  await firestoreSaveUser(user);
  if (usersCache) {
    const index = usersCache.findIndex(u => u.id === user.id);
    if (index >= 0) {
      usersCache[index] = user;
    } else {
      usersCache.push(user);
    }
  }
}

export async function deleteUserAsync(userId: string): Promise<void> {
  const { deleteUser } = await import('./firestore');
  await deleteUser(userId);
  if (usersCache) {
    usersCache = usersCache.filter(u => u.id !== userId);
  }
}

const CURRENT_USER_KEY = 'raydar_current_user_id';

export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null;
  const userId = localStorage.getItem(CURRENT_USER_KEY);
  if (!userId) return null;
  if (usersCache) {
    const cached = usersCache.find(u => u.id === userId);
    if (cached) return cached;
  }
  const usersData = localStorage.getItem('raydar_users');
  if (usersData) {
    try {
      const users: User[] = JSON.parse(usersData);
      const user = users.find(u => u.id === userId);
      if (user) {
        return {
          ...user,
          createdAt: new Date(user.createdAt),
          lastLogin: user.lastLogin ? new Date(user.lastLogin) : undefined,
          approvalRequestedAt: (user as any).approvalRequestedAt ? new Date((user as any).approvalRequestedAt) : undefined,
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function getCurrentUserAsync(): Promise<User | null> {
  if (typeof window === 'undefined') return null;
  const userId = localStorage.getItem(CURRENT_USER_KEY);
  if (!userId) return null;
  return await firestoreGetUser(userId);
}

export function saveCurrentUser(user: User): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURRENT_USER_KEY, user.id);
}

export async function saveCurrentUserAsync(user: User): Promise<void> {
  await firestoreSaveUser(user);
  if (typeof window !== 'undefined') {
    localStorage.setItem(CURRENT_USER_KEY, user.id);
  }
}

const GEOCODE_CACHE_KEY = 'happy_solar_geocode_cache';

export function getGeocodeCache(): Record<string, { lat: number; lng: number }> {
  if (typeof window === 'undefined') return {};
  const data = localStorage.getItem(GEOCODE_CACHE_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveGeocodeCache(cache: Record<string, { lat: number; lng: number }>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function addLead(lead: Lead): Promise<void> {
  await saveLeadAsync(lead);
}

export async function updateLeadStatus(leadId: string, status: LeadStatus, userId?: string): Promise<void> {
  const updates: Partial<Lead> = {
    status,
    dispositionedAt: ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(status)
      ? new Date()
      : undefined,
  };
  if (userId) {
    updates.claimedBy = userId;
    updates.claimedAt = new Date();
  }
  await updateLeadAsync(leadId, updates);
}

export async function claimLead(leadId: string, userId: string): Promise<void> {
  const leads = await getLeadsAsync();
  const lead = leads.find(l => l.id === leadId);
  if (lead && (lead.status === 'unclaimed' || lead.status === 'not-home')) {
    await updateLeadAsync(leadId, {
      status: 'claimed',
      claimedBy: userId,
      claimedAt: new Date(),
    });
  }
}

export async function unclaimLead(leadId: string): Promise<void> {
  const leads = await getLeadsAsync();
  const lead = leads.find(l => l.id === leadId);
  if (lead && lead.status === 'claimed') {
    await updateLeadAsync(leadId, {
      status: 'unclaimed',
      claimedBy: undefined,
      claimedAt: undefined,
    });
  }
}

export function getLeadsByStatus(status: LeadStatus): Lead[] {
  return getLeads().filter(l => l.status === status);
}

export async function getLeadsByStatusAsync(status: LeadStatus): Promise<Lead[]> {
  const leads = await getLeadsAsync();
  return leads.filter(l => l.status === status);
}

export function getLeadsByUser(userId: string): Lead[] {
  return getLeads().filter(l => l.claimedBy === userId);
}

export async function getLeadsByUserAsync(userId: string): Promise<Lead[]> {
  const leads = await getLeadsAsync();
  return leads.filter(l => l.claimedBy === userId);
}

// Do not eager-fetch all leads/users on import — maps and lists load scoped data themselves.
