// Firestore-backed storage (replacing localStorage)
import { Lead, User, LeadStatus } from '@/app/types';
import { 
  getAllLeads as firestoreGetAllLeads,
  saveLead as firestoreSaveLead,
  updateLead as firestoreUpdateLead,
  deleteLead as firestoreDeleteLead,
  getAllUsers as firestoreGetAllUsers,
  saveUser as firestoreSaveUser,
  updateUser as firestoreUpdateUser,
  getUser as firestoreGetUser
} from './firestore';

// ============================================
// LEADS
// ============================================

let leadsCache: Lead[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds

export function getLeads(): Lead[] {
  // Return cache if fresh
  if (leadsCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return leadsCache;
  }
  
  // For SSR, return empty
  if (typeof window === 'undefined') return [];
  
  // Fallback: read from localStorage if cache is empty
  try {
    const data = localStorage.getItem('happysolar_leads');
    if (data) {
      const parsed = JSON.parse(data);
      // Update cache
      leadsCache = parsed;
      cacheTimestamp = Date.now();
      return parsed;
    }
  } catch (e) {
    console.error('Error reading leads from localStorage:', e);
  }
  
  // Return empty cache or empty array
  return leadsCache || [];
}

export async function getLeadsAsync(): Promise<Lead[]> {
  try {
    const leads = await firestoreGetAllLeads();
    if (leads && leads.length > 0) {
      leadsCache = leads;
      cacheTimestamp = Date.now();
      // Also backup to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('happysolar_leads', JSON.stringify(leads));
      }
      return leads;
    }
    // If Firestore returns empty, try localStorage fallback
    if (typeof window !== 'undefined') {
      const fallbackData = localStorage.getItem('happysolar_leads');
      if (fallbackData) {
        const fallbackLeads = JSON.parse(fallbackData);
        leadsCache = fallbackLeads;
        cacheTimestamp = Date.now();
        return fallbackLeads;
      }
    }
    return [];
  } catch (error) {
    console.error('Firestore getLeads failed, falling back to localStorage:', error);
    // Fallback to localStorage on error
    if (typeof window !== 'undefined') {
      const fallbackData = localStorage.getItem('happysolar_leads');
      if (fallbackData) {
        const fallbackLeads = JSON.parse(fallbackData);
        leadsCache = fallbackLeads;
        cacheTimestamp = Date.now();
        return fallbackLeads;
      }
    }
    return [];
  }
}

export function saveLeads(leads: Lead[]): void {
  // Deprecated - use saveLead or saveLeadsAsync
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
  // Update cache
  if (leadsCache) {
    const index = leadsCache.findIndex(l => l.id === lead.id);
    if (index >= 0) {
      leadsCache[index] = lead;
    } else {
      leadsCache.push(lead);
    }
  }
}

export async function updateLeadAsync(id: string, updates: Partial<Lead>): Promise<void> {
  await firestoreUpdateLead(id, updates);
  // Update cache
  if (leadsCache) {
    const index = leadsCache.findIndex(l => l.id === id);
    if (index >= 0) {
      leadsCache[index] = { ...leadsCache[index], ...updates };
    }
  }
}

export async function deleteLeadAsync(id: string): Promise<void> {
  await firestoreDeleteLead(id);
  // Update cache
  if (leadsCache) {
    leadsCache = leadsCache.filter(l => l.id !== id);
  }
}

export function deleteLead(id: string): void {
  // Sync version for backwards compatibility
  const leads = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');
  const filtered = leads.filter((l: Lead) => l.id !== id);
  localStorage.setItem('happysolar_leads', JSON.stringify(filtered));
  
  // Update cache
  if (leadsCache) {
    leadsCache = leadsCache.filter(l => l.id !== id);
  }
}

// ============================================
// USERS
// ============================================

let usersCache: User[] | null = null;
let usersCacheTimestamp = 0;

export function getUsers(): User[] {
  if (typeof window === 'undefined') return [];
  
  // Return cache if fresh
  if (usersCache && Date.now() - usersCacheTimestamp < CACHE_TTL) {
    return usersCache;
  }
  
  // Fallback: load from localStorage
  const data = localStorage.getItem('happysolar_users');
  if (!data) return [];
  
  try {
    const parsed = JSON.parse(data);
    return parsed.map((user: User) => ({
      ...user,
      createdAt: new Date(user.createdAt),
      lastLogin: user.lastLogin ? new Date(user.lastLogin) : undefined,
    }));
  } catch {
    return [];
  }
}

export async function getUsersAsync(): Promise<User[]> {
  const users = await firestoreGetAllUsers();
  usersCache = users;
  usersCacheTimestamp = Date.now();
  return users;
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
  // Update cache
  if (usersCache) {
    const index = usersCache.findIndex(u => u.id === user.id);
    if (index >= 0) {
      usersCache[index] = user;
    } else {
      usersCache.push(user);
    }
  }
}

// ============================================
// CURRENT USER
// ============================================

const CURRENT_USER_KEY = 'happysolar_current_user_id';

export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null;
  
  const userId = localStorage.getItem(CURRENT_USER_KEY);
  if (!userId) return null;
  
  // Always try to load from localStorage directly if cache doesn't have it
  if (usersCache) {
    const cached = usersCache.find(u => u.id === userId);
    if (cached) return cached;
  }
  
  // Fallback: load from localStorage
  const usersData = localStorage.getItem('happysolar_users');
  if (usersData) {
    try {
      const users: User[] = JSON.parse(usersData);
      const user = users.find(u => u.id === userId);
      if (user) {
        return {
          ...user,
          createdAt: new Date(user.createdAt),
          lastLogin: user.lastLogin ? new Date(user.lastLogin) : undefined,
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

// ============================================
// GEOCODE CACHE (Keep in localStorage for now)
// ============================================

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

// ============================================
// HELPER FUNCTIONS (Backwards Compatibility)
// ============================================

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

// ============================================
// INITIALIZATION
// ============================================

// Load initial data on client
if (typeof window !== 'undefined') {
  getLeadsAsync().catch(console.error);
  getUsersAsync().catch(console.error);
}
