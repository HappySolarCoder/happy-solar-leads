// Local storage utility for MVP persistence
// Later: upgrade to Supabase or Vercel Postgres for multi-user sync

import { Lead, User, LeadStatus } from '@/app/types';

const STORAGE_KEYS = {
  LEADS: 'happysolar_leads',
  USER: 'happysolar_currentuser',
  USERS: 'happysolar_users',
};

export function getLeads(): Lead[] {
  if (typeof window === 'undefined') return [];
  
  const data = localStorage.getItem(STORAGE_KEYS.LEADS);
  if (!data) return [];
  
  try {
    const parsed = JSON.parse(data);
    // Convert date strings back to Date objects
    return parsed.map((lead: Lead) => ({
      ...lead,
      claimedAt: lead.claimedAt ? new Date(lead.claimedAt) : undefined,
      dispositionedAt: lead.dispositionedAt ? new Date(lead.dispositionedAt) : undefined,
      createdAt: new Date(lead.createdAt),
    }));
  } catch {
    return [];
  }
}

export function saveLeads(leads: Lead[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.LEADS, JSON.stringify(leads));
}

export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null;
  
  const data = localStorage.getItem(STORAGE_KEYS.USER);
  if (!data) return null;
  
  try {
    const user = JSON.parse(data);
    return {
      ...user,
      createdAt: new Date(user.createdAt),
    };
  } catch {
    return null;
  }
}

export function saveCurrentUser(user: User): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
}

export function getUsers(): User[] {
  if (typeof window === 'undefined') return [];
  
  const data = localStorage.getItem(STORAGE_KEYS.USERS);
  if (!data) return [];
  
  try {
    const parsed = JSON.parse(data);
    return parsed.map((user: User) => ({
      ...user,
      createdAt: new Date(user.createdAt),
    }));
  } catch {
    return [];
  }
}

export function saveUsers(users: User[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
}

export function addLead(lead: Lead): void {
  const leads = getLeads();
  leads.push(lead);
  saveLeads(leads);
}

export function updateLeadStatus(leadId: string, status: LeadStatus, userId: string): void {
  const leads = getLeads();
  const lead = leads.find(l => l.id === leadId);
  
  if (lead) {
    lead.status = status;
    lead.claimedBy = userId;
    lead.claimedAt = new Date();
    lead.dispositionedAt = ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(status) 
      ? new Date() 
      : undefined;
    
    saveLeads(leads);
  }
}

export function claimLead(leadId: string, userId: string): void {
  const leads = getLeads();
  const lead = leads.find(l => l.id === leadId);
  
  if (lead && (lead.status === 'unclaimed' || lead.status === 'not-home')) {
    lead.status = 'claimed';
    lead.claimedBy = userId;
    lead.claimedAt = new Date();
    saveLeads(leads);
  }
}

export function unclaimLead(leadId: string): void {
  const leads = getLeads();
  const lead = leads.find(l => l.id === leadId);
  
  if (lead && lead.status === 'claimed') {
    lead.status = 'unclaimed';
    lead.claimedBy = undefined;
    lead.claimedAt = undefined;
    saveLeads(leads);
  }
}

export function getLeadsByStatus(status: LeadStatus): Lead[] {
  return getLeads().filter(l => l.status === status);
}

export function getLeadsByUser(userId: string): Lead[] {
  return getLeads().filter(l => l.claimedBy === userId);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function deleteLead(leadId: string): void {
  const leads = getLeads();
  const filtered = leads.filter(l => l.id !== leadId);
  saveLeads(filtered);
}
