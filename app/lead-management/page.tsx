'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Trash2, CheckSquare, Square, Users, MapPin } from 'lucide-react';
import { getLeadsAsync, getUsersAsync, saveLeadAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads } from '@/app/types';

const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#F7FAFC]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-[#718096]">Loading map...</p>
      </div>
    </div>
  ),
});

export default function LeadManagementPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [userFilter, setUserFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // Check permission - managers and admins only
      if (!canSeeAllLeads(user.role)) {
        router.push('/mobile/knocking');
        return;
      }

      setCurrentUser(user);

      const loadedLeads = await getLeadsAsync();
      const loadedUsers = await getUsersAsync();

      setLeads(loadedLeads);
      setUsers(loadedUsers);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  const handleUpdate = async () => {
    const loadedLeads = await getLeadsAsync();
    setLeads(loadedLeads);
    setSelectedLeads(new Set());
  };

  // Filter leads by selected user
  const filteredLeads = userFilter === 'all' 
    ? leads 
    : leads.filter(lead => lead.assignedTo === userFilter || lead.claimedBy === userFilter);

  // Get lead counts per user
  const userLeadCounts = users.map(user => ({
    user,
    count: leads.filter(lead => lead.assignedTo === user.id || lead.claimedBy === user.id).length,
  }));

  const toggleLeadSelection = (leadId: string) => {
    const newSelection = new Set(selectedLeads);
    if (newSelection.has(leadId)) {
      newSelection.delete(leadId);
    } else {
      newSelection.add(leadId);
    }
    setSelectedLeads(newSelection);
  };

  const selectAll = () => {
    setSelectedLeads(new Set(filteredLeads.map(l => l.id)));
  };

  const deselectAll = () => {
    setSelectedLeads(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.size === 0) return;
    
    const confirmed = confirm(
      `Are you sure you want to delete ${selectedLeads.size} lead(s)? This action cannot be undone.`
    );
    
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      const { deleteLeadAsync } = await import('@/app/utils/storage');
      
      // Delete all selected leads
      await Promise.all(
        Array.from(selectedLeads).map(leadId => deleteLeadAsync(leadId))
      );

      await handleUpdate();
    } catch (error) {
      console.error('Error deleting leads:', error);
      alert('Failed to delete leads. Please try again.');
    } finally {
      setIsDeleting(false);
      setSelectionMode(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/tools')}
              className="p-2 -ml-2 text-[#718096] hover:text-[#FF5F5A] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-[#2D3748]">Lead Management</h1>
          </div>

          <div className="flex items-center gap-2">
            {selectionMode && (
              <>
                <button
                  onClick={handleBulkDelete}
                  disabled={selectedLeads.size === 0 || isDeleting}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                    selectedLeads.size === 0 || isDeleting
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete ({selectedLeads.size})
                </button>
              </>
            )}
            <button
              onClick={() => {
                setSelectionMode(!selectionMode);
                if (selectionMode) {
                  deselectAll();
                }
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectionMode
                  ? 'bg-[#FF5F5A] text-white'
                  : 'bg-[#F7FAFC] text-[#2D3748] hover:bg-[#E2E8F0]'
              }`}
            >
              {selectionMode ? 'Cancel' : 'Select Leads'}
            </button>
          </div>
        </div>

        {/* User Filter */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-[#718096]" />
            <label className="text-sm font-medium text-[#2D3748]">Filter by User</label>
          </div>
          <select
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              deselectAll();
            }}
            className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
          >
            <option value="all">All Users ({leads.length} leads)</option>
            {userLeadCounts
              .filter(({ count }) => count > 0)
              .map(({ user, count }) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({count} leads)
                </option>
              ))}
          </select>

          {selectionMode && filteredLeads.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-sm text-[#4299E1] hover:text-[#3182CE] font-medium"
              >
                Select All ({filteredLeads.length})
              </button>
              {selectedLeads.size > 0 && (
                <>
                  <span className="text-[#CBD5E0]">•</span>
                  <button
                    onClick={deselectAll}
                    className="text-sm text-[#718096] hover:text-[#2D3748] font-medium"
                  >
                    Deselect All
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Map View */}
      <div className="flex-1 relative">
        <LeadMap
          leads={filteredLeads}
          currentUser={currentUser}
          onLeadClick={(lead) => {
            if (selectionMode) {
              toggleLeadSelection(lead.id);
            }
          }}
        />

        {/* Selection Overlay */}
        {selectionMode && filteredLeads.length > 0 && (
          <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-4 z-10 max-w-xs">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-2">Selection Mode</h3>
            <p className="text-xs text-[#718096] mb-3">
              Click leads on the map to select them for bulk deletion
            </p>
            <div className="flex items-center gap-2 text-sm">
              <CheckSquare className="w-4 h-4 text-[#FF5F5A]" />
              <span className="font-medium text-[#2D3748]">
                {selectedLeads.size} selected
              </span>
            </div>
          </div>
        )}

        {/* Selected Leads List (Mobile) */}
        {selectionMode && selectedLeads.size > 0 && (
          <div className="absolute bottom-4 left-4 right-4 bg-white rounded-lg shadow-lg p-4 z-10 max-h-48 overflow-y-auto">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-2">
              Selected Leads ({selectedLeads.size})
            </h3>
            <div className="space-y-1">
              {Array.from(selectedLeads).slice(0, 10).map(leadId => {
                const lead = leads.find(l => l.id === leadId);
                if (!lead) return null;
                return (
                  <div key={leadId} className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => toggleLeadSelection(leadId)}
                      className="text-[#FF5F5A] hover:text-[#E54E49]"
                    >
                      <Square className="w-3 h-3 fill-current" />
                    </button>
                    <MapPin className="w-3 h-3 text-[#718096]" />
                    <span className="text-[#2D3748] truncate">{lead.address}</span>
                  </div>
                );
              })}
              {selectedLeads.size > 10 && (
                <p className="text-xs text-[#718096] mt-2">
                  + {selectedLeads.size - 10} more...
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
