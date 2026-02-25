'use client';

import { useState, useEffect } from 'react';
import { Wand2, RefreshCw, AlertTriangle, Check, Users, MapPin, Loader2 } from 'lucide-react';
import { getLeadsAsync, saveLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { Lead, User } from '@/app/types';
import { AutoAssignResponse } from '@/app/api/autoassign/route';

interface AutoAssignPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export default function AutoAssignPanel({ isOpen, onClose, onComplete }: AutoAssignPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [preview, setPreview] = useState<AutoAssignResponse | null>(null);
  const [result, setResult] = useState<AutoAssignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [options, setOptions] = useState({
    maxDistance: 50,
    reassignStale: false,
    staleDays: 5,
  });

  useEffect(() => {
    async function loadUsers() {
      const loadedUsers = await getUsersAsync();
      setUsers(loadedUsers);
    }
    if (isOpen) {
      loadUsers();
    }
  }, [isOpen]);

  const runAutoAssign = async (dryRun: boolean = false) => {
    setIsRunning(true);
    setError(null);
    
    try {
      const leads = await getLeadsAsync();
      const users = await getUsersAsync();

      const response = await fetch('/api/autoassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads,
          users,
          options: {
            ...options,
            preview: dryRun,
          },
        }),
      });

      const data: AutoAssignResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Auto-assignment failed');
      }

      if (dryRun) {
        setPreview(data);
      } else {
        // Save updated data to Firestore
        if (data.leads) {
          await saveLeadsAsync(data.leads);
        }
        setResult(data);
        onComplete?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRunning(false);
    }
  };

  const eligibleUsers = users.filter(u => u.isActive !== false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI Lead Assignment</h2>
              <p className="text-sm text-gray-500">Automatically distribute leads to setters</p>
            </div>
          </div>

          {/* Eligible Users Check */}
          {eligibleUsers.length === 0 ? (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-800">No eligible setters</p>
                  <p className="text-sm text-orange-600 mt-1">
                    Setters need a home address to receive auto-assigned leads.
                    {users.length > 0 && ` ${users.length} setter(s) found but none have addresses set.`}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 text-green-700">
                <Users className="w-4 h-4" />
                <span className="font-medium">{eligibleUsers.length} setter(s) ready</span>
              </div>
              <div className="mt-2 space-y-1">
                {eligibleUsers.slice(0, 3).map(user => (
                  <div key={user.id} className="text-sm text-green-600 flex items-center gap-2">
                    <MapPin className="w-3 h-3" />
                    {user.name}{user.territory ? ` - ${user.territory}` : ''}
                  </div>
                ))}
                {eligibleUsers.length > 3 && (
                  <div className="text-sm text-green-600">
                    ...and {eligibleUsers.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Distance (miles)
              </label>
              <input
                type="number"
                value={options.maxDistance}
                onChange={(e) => setOptions({ ...options, maxDistance: Number(e.target.value) })}
                min={1}
                max={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Only assign leads within this distance from setter's home
              </p>
            </div>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.reassignStale}
                onChange={(e) => setOptions({ ...options, reassignStale: e.target.checked })}
                className="w-4 h-4 text-purple-500 rounded focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700">
                Also reassign stale leads ({options.staleDays}+ days without disposition)
              </span>
            </label>
          </div>

          {/* Preview Results */}
          {preview && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="font-medium text-gray-900 mb-2">Preview Results</h3>
              <div className="space-y-2 text-sm">
                <p className="text-green-600">
                  ✓ {preview.summary.totalAssigned} leads would be assigned
                </p>
                <p className="text-gray-500">
                  ○ {preview.summary.totalSkipped} leads skipped (too far or ineligible)
                </p>
                {preview.staleLeads && preview.staleLeads.count > 0 && (
                  <p className="text-orange-500">
                    ⚠ {preview.staleLeads.count} stale leads found
                  </p>
                )}
                {Object.entries(preview.summary.byUser).map(([userId, data]) => (
                  data.count > 0 && (
                    <p key={userId} className="text-gray-600 ml-4">
                      → {data.leads[0]?.assignedToName}: {data.count} leads
                    </p>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Final Results */}
          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 text-green-700 mb-2">
                <Check className="w-5 h-5" />
                <span className="font-medium">Assignment Complete!</span>
              </div>
              <div className="space-y-1 text-sm text-green-600">
                <p>✓ {result.summary.totalAssigned} leads assigned</p>
                {Object.entries(result.summary.byUser).map(([userId, data]) => (
                  data.count > 0 && (
                    <p key={userId} className="ml-4">
                      → {data.leads[0]?.assignedToName}: {data.count} leads
                    </p>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <button
            onClick={() => {
              onClose();
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
          <div className="flex gap-2">
            {!result && (
              <>
                <button
                  onClick={() => runAutoAssign(true)}
                  disabled={isRunning || eligibleUsers.length === 0}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
                  Preview
                </button>
                <button
                  onClick={() => runAutoAssign(false)}
                  disabled={isRunning || eligibleUsers.length === 0}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Wand2 className="w-4 h-4" />
                  Assign Now
                </button>
              </>
            )}
            {result && (
              <button
                onClick={() => {
                  onClose();
                  window.location.reload();
                }}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Page
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
