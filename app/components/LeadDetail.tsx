'use client';

import { useState } from 'react';
import { Lead, LeadStatus, STATUS_LABELS, STATUS_COLORS, User } from '@/app/types';
import { 
  X, MapPin, Phone, Mail, Clock, User as UserIcon, 
  CheckCircle, Circle, AlertCircle, Calendar, DollarSign 
} from 'lucide-react';
import { updateLeadStatus, claimLead, unclaimLead } from '@/app/utils/storage';

interface LeadDetailProps {
  lead: Lead;
  currentUser: User | null;
  onClose: () => void;
  onUpdate: () => void;
}

const STATUS_ACTIONS: Record<LeadStatus, { label: string; icon: typeof CheckCircle; color: string }> = {
  'unclaimed': { label: 'Claim Lead', icon: Circle, color: '#f59e0b' },
  'claimed': { label: 'Unclaim', icon: Circle, color: '#6b7280' },
  'not-home': { label: 'Not Home', icon: AlertCircle, color: '#6b7280' },
  'interested': { label: 'Mark Interested', icon: CheckCircle, color: '#3b82f6' },
  'not-interested': { label: 'Not Interested', icon: X, color: '#ef4444' },
  'appointment': { label: 'Set Appointment', icon: Calendar, color: '#8b5cf6' },
  'sale': { label: 'Sale!', icon: DollarSign, color: '#10b981' },
};

const QUICK_STATUSES: LeadStatus[] = [
  'not-home',
  'interested',
  'not-interested',
  'appointment',
  'sale',
];

export default function LeadDetail({ lead, currentUser, onClose, onUpdate }: LeadDetailProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [notes, setNotes] = useState(lead.notes || '');
  const [showAllStatuses, setShowAllStatuses] = useState(false);

  const isClaimedByMe = currentUser && lead.claimedBy === currentUser.id;
  const canClaim = !lead.claimedBy || isClaimedByMe;
  const isClaimed = !!lead.claimedBy;

  const handleStatusChange = async (newStatus: LeadStatus) => {
    if (!currentUser) return;
    
    setIsUpdating(true);
    
    try {
      if (newStatus === 'not-home' || (newStatus === 'claimed' && isClaimedByMe)) {
        // Handle claim/unclaim
        if (isClaimedByMe && isClaimed) {
          unclaimLead(lead.id);
        } else {
          claimLead(lead.id, currentUser.id);
        }
      } else {
        // Handle status change
        updateLeadStatus(lead.id, newStatus, currentUser.id);
      }
      
      onUpdate();
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl z-40 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div 
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[lead.status] }}
          />
          <span className="font-medium text-gray-900">
            {STATUS_LABELS[lead.status]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Name & Status */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">{lead.name}</h2>
          {isClaimed && lead.claimedBy && (
            <p className="text-sm text-gray-500 mt-1">
              Claimed by {isClaimedByMe ? 'you' : 'another knocker'}
              {lead.claimedAt && (
                <> • {formatTimeAgo(lead.claimedAt)}</>
              )}
            </p>
          )}
        </div>

        {/* Address */}
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">{lead.address}</p>
              <p className="text-gray-500">{lead.city}, {lead.state} {lead.zip}</p>
            </div>
          </div>
        </div>

        {/* Contact Info */}
        {(lead.phone || lead.email) && (
          <div className="mb-4 space-y-2">
            {lead.phone && (
              <div className="flex items-center gap-3 text-gray-600">
                <Phone className="w-4 h-4" />
                <a href={`tel:${lead.phone}`} className="hover:text-blue-500">
                  {lead.phone}
                </a>
              </div>
            )}
            {lead.email && (
              <div className="flex items-center gap-3 text-gray-600">
                <Mail className="w-4 h-4" />
                <a href={`mailto:${lead.email}`} className="hover:text-blue-500">
                  {lead.email}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Quick Dispositions
          </h3>
          
          <div className="flex flex-wrap gap-2">
            {/* Not Home - always available */}
            <button
              onClick={() => handleStatusChange('not-home')}
              disabled={isUpdating}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors disabled:opacity-50"
            >
              <AlertCircle className="w-4 h-4" />
              Not Home
            </button>

            {/* Interested */}
            <button
              onClick={() => handleStatusChange('interested')}
              disabled={isUpdating || !canClaim}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: `${STATUS_COLORS['interested']}20`,
                color: STATUS_COLORS['interested'],
              }}
            >
              <CheckCircle className="w-4 h-4" />
              Interested
            </button>

            {/* Not Interested */}
            <button
              onClick={() => handleStatusChange('not-interested')}
              disabled={isUpdating || !canClaim}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: `${STATUS_COLORS['not-interested']}20`,
                color: STATUS_COLORS['not-interested'],
              }}
            >
              <X className="w-4 h-4" />
              Not Interested
            </button>

            {/* Appointment */}
            <button
              onClick={() => handleStatusChange('appointment')}
              disabled={isUpdating || !canClaim}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: `${STATUS_COLORS['appointment']}20`,
                color: STATUS_COLORS['appointment'],
              }}
            >
              <Calendar className="w-4 h-4" />
              Appointment
            </button>

            {/* Sale */}
            <button
              onClick={() => handleStatusChange('sale')}
              disabled={isUpdating || !canClaim}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: `${STATUS_COLORS['sale']}20`,
                color: STATUS_COLORS['sale'],
              }}
            >
              <DollarSign className="w-4 h-4" />
              Sale!
            </button>
          </div>

          {!canClaim && isClaimed && (
            <p className="text-xs text-gray-500 mt-2">
              This lead is claimed by another knocker
            </p>
          )}
        </div>

        {/* Claim/Unclaim */}
        <div className="mb-6 pt-4 border-t border-gray-200">
          {canClaim ? (
            isClaimed ? (
              <button
                onClick={() => handleStatusChange('claimed')}
                disabled={isUpdating}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-700 transition-colors disabled:opacity-50"
              >
                Unclaim This Lead
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange('claimed')}
                disabled={isUpdating}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
              >
                Claim This Lead
              </button>
            )
          ) : null}
        </div>

        {/* Notes */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Notes</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this lead..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
            rows={4}
          />
        </div>

        {/* Metadata */}
        <div className="text-xs text-gray-400 space-y-1">
          <p>ID: {lead.id}</p>
          {lead.createdAt && (
            <p>Created: {lead.createdAt.toLocaleDateString()}</p>
          )}
          {lead.dispositionedAt && (
            <p>Last Action: {formatTimeAgo(lead.dispositionedAt)}</p>
          )}
        </div>

        {/* Delete Lead */}
        <div className="mt-6 pt-4 border-t border-red-200">
          <button
            onClick={() => {
              if (confirm(`Delete lead for ${lead.name}? This cannot be undone.`)) {
                import('@/app/utils/storage').then(({ deleteLead }) => {
                  deleteLead(lead.id);
                  onClose();
                  onUpdate();
                });
              }
            }}
            className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium text-sm transition-colors"
          >
            🗑️ Delete Lead
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
