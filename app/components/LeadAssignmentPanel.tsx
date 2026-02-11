'use client';

import { useState, useEffect } from 'react';
import { Users, MapPin, Hand, Pencil, X, Check } from 'lucide-react';
import { Lead, User, canAssignLeads } from '@/app/types';
import { getUsersAsync, saveLeadAsync } from '@/app/utils/storage';

interface LeadAssignmentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  leads: Lead[];
  onAssignComplete: () => void;
  onModeChange?: (mode: 'none' | 'manual' | 'territory') => void;
  selectedLeadIds?: string[];
  onLeadSelect?: (leadId: string) => void;
}

export default function LeadAssignmentPanel({
  isOpen,
  onClose,
  currentUser,
  leads,
  onAssignComplete,
  onModeChange,
  selectedLeadIds = [],
  onLeadSelect,
}: LeadAssignmentPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [mode, setMode] = useState<'none' | 'manual' | 'territory'>('none');
  const [isAssigning, setIsAssigning] = useState(false);

  // Check permissions
  const canAssign = currentUser && canAssignLeads(currentUser.role);

  useEffect(() => {
    async function loadUsers() {
      const allUsers = await getUsersAsync();
      setUsers(allUsers);
      if (allUsers.length > 0) {
        setSelectedUserId(allUsers[0].id);
      }
    }
    loadUsers();
  }, []);

  // Notify parent of mode changes (only when mode actually changes)
  useEffect(() => {
    if (onModeChange) {
      onModeChange(mode);
    }
  }, [mode]); // Only depend on mode, not onModeChange

  if (!isOpen || !canAssign) return null;

  const handleModeChange = (newMode: 'none' | 'manual' | 'territory') => {
    setMode(newMode);
  };

  const handleAssignSelected = async () => {
    if (!selectedUserId || selectedLeadIds.length === 0) return;

    setIsAssigning(true);

    try {
      const selectedUser = users.find(u => u.id === selectedUserId);
      if (!selectedUser) return;

      // Assign each selected lead
      for (const leadId of selectedLeadIds) {
        const lead = leads.find(l => l.id === leadId);
        if (lead && lead.status === 'unclaimed') {
          const updated = {
            ...lead,
            assignedTo: selectedUserId,
            assignedAt: new Date(),
            autoAssigned: false,
            claimedBy: selectedUserId,
            claimedAt: new Date(),
            status: 'claimed' as const,
          };
          await saveLeadAsync(updated);
        }
      }

      // Reset selection
      setMode('none');
      onAssignComplete();
    } finally {
      setIsAssigning(false);
    }
  };

  const availableLeads = leads.filter(l => l.status === 'unclaimed');
  const selectedLeads = leads.filter(l => selectedLeadIds.includes(l.id));

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20 z-30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-white shadow-2xl z-40 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Assign Leads</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* User Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Assign To:
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode Selection */}
        <div className="px-6 py-4 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Assignment Mode:
          </label>
          <div className="space-y-2">
            <button
              onClick={() => handleModeChange('manual')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-colors ${
                mode === 'manual'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Hand className="w-5 h-5" />
              <div className="flex-1 text-left">
                <div className="font-medium text-gray-900">Manual Selection</div>
                <div className="text-xs text-gray-500">Click leads on map to select</div>
              </div>
              {mode === 'manual' && <Check className="w-5 h-5 text-blue-500" />}
            </button>

            <button
              onClick={() => handleModeChange('territory')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-colors ${
                mode === 'territory'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Pencil className="w-5 h-5" />
              <div className="flex-1 text-left">
                <div className="font-medium text-gray-900">Draw Territory</div>
                <div className="text-xs text-gray-500">Click & drag to draw freeform area</div>
              </div>
              {mode === 'territory' && <Check className="w-5 h-5 text-blue-500" />}
            </button>
          </div>
        </div>

        {/* Selected Leads */}
        {mode !== 'none' && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Selected Leads ({selectedLeadIds.length})
              </span>
              {mode === 'manual' && selectedLeadIds.length > 0 && (
                <button
                  onClick={() => {
                    selectedLeadIds.forEach(id => onLeadSelect?.(id));
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Clear All
                </button>
              )}
            </div>

            {selectedLeadIds.length === 0 ? (
              <div className="text-center py-8">
                <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">
                  {mode === 'manual' 
                    ? 'Click leads on the map to select them'
                    : 'Click and drag on the map to draw a territory'
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedLeads.map(lead => (
                  <div
                    key={lead.id}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    <MapPin className="w-4 h-4 text-blue-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {lead.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {lead.address}, {lead.city}
                      </div>
                    </div>
                    {mode === 'manual' && (
                      <button
                        onClick={() => onLeadSelect?.(lead.id)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {mode === 'none' && (
          <div className="flex-1 px-6 py-4 flex items-center justify-center">
            <div className="text-center">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Choose Assignment Mode
              </h3>
              <p className="text-sm text-gray-500">
                Select a mode above to start assigning leads
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        {mode !== 'none' && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={handleAssignSelected}
              disabled={selectedLeadIds.length === 0 || !selectedUserId || isAssigning}
              className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAssigning ? (
                'Assigning...'
              ) : (
                `Assign ${selectedLeadIds.length} Lead${selectedLeadIds.length !== 1 ? 's' : ''} to ${users.find(u => u.id === selectedUserId)?.name}`
              )}
            </button>

            <div className="mt-3 text-xs text-center text-gray-500">
              {availableLeads.length} unclaimed leads available
            </div>
          </div>
        )}
      </div>
    </>
  );
}
