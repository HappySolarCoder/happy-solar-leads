'use client';

import { useState } from 'react';
import { Lead, LeadStatus, STATUS_LABELS, STATUS_COLORS } from '@/app/types';
import { Search, Filter, MapPin, User, Clock, TrendingUp } from 'lucide-react';
import { calculateKnockabilityScore, getKnockabilityColor, getKnockabilityLabel } from '@/app/utils/knockability';

interface LeadListProps {
  leads: Lead[];
  selectedLeadId?: string;
  onLeadSelect: (lead: Lead) => void;
  currentUserId?: string;
}

const STATUS_GROUPS: LeadStatus[] = [
  'unclaimed',
  'claimed',
  'not-home',
  'interested',
  'not-interested',
  'appointment',
  'sale',
];

export default function LeadList({ 
  leads, 
  selectedLeadId, 
  onLeadSelect,
  currentUserId,
}: LeadListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [expandedGroup, setExpandedGroup] = useState<string | null>('unclaimed');

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = 
      (lead.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lead.address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lead.city || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const groupedLeads = STATUS_GROUPS.reduce((acc, status) => {
    const statusLeads = filteredLeads.filter(l => l.status === status);
    if (statusLeads.length > 0) {
      acc[status] = statusLeads;
    }
    return acc;
  }, {} as Record<LeadStatus, Lead[]>);

  const totalCount = filteredLeads.length;
  const unclaimedCount = groupedLeads['unclaimed']?.length || 0;

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Leads</h2>
          <span className="text-sm text-gray-500">
            {unclaimedCount} available
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Status Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
              statusFilter === 'all'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({leads.length})
          </button>
          {STATUS_GROUPS.map(status => {
            const count = leads.filter(l => l.status === status).length;
            if (count === 0) return null;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                  statusFilter === status
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={{
                  backgroundColor: statusFilter === status ? STATUS_COLORS[status] : undefined,
                }}
              >
                {STATUS_LABELS[status]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Lead List */}
      <div className="flex-1 overflow-y-auto">
        {statusFilter !== 'all' ? (
          // Single filtered list
          <div className="divide-y divide-gray-100">
            {filteredLeads.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No leads found
              </div>
            ) : (
              filteredLeads.map(lead => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  isSelected={lead.id === selectedLeadId}
                  onClick={() => onLeadSelect(lead)}
                  currentUserId={currentUserId}
                />
              ))
            )}
          </div>
        ) : (
          // Grouped by status
          <div className="divide-y divide-gray-100">
            {STATUS_GROUPS.map(status => {
              const statusLeads = groupedLeads[status];
              if (!statusLeads || statusLeads.length === 0) return null;

              const isExpanded = expandedGroup === status;
              const displayCount = isExpanded ? statusLeads.length : Math.min(3, statusLeads.length);

              return (
                <div key={status} className="border-b border-gray-100">
                  <button
                    onClick={() => setExpandedGroup(isExpanded ? null : status)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    style={{
                      borderLeft: `3px solid ${STATUS_COLORS[status]}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span 
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[status] }}
                      />
                      <span className="font-medium text-gray-900">
                        {STATUS_LABELS[status]}
                      </span>
                      <span className="text-xs text-gray-500">
                        ({statusLeads.length})
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="bg-gray-50">
                      {statusLeads.slice(0, displayCount).map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          isSelected={lead.id === selectedLeadId}
                          onClick={() => onLeadSelect(lead)}
                          currentUserId={currentUserId}
                          compact
                        />
                      ))}
                      {statusLeads.length > 3 && isExpanded && (
                        <div className="px-4 py-2 text-center text-xs text-gray-500">
                          +{statusLeads.length - 3} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 bg-gray-50 text-center text-xs text-gray-500">
        {totalCount} of {leads.length} leads
      </div>
    </div>
  );
}

interface LeadCardProps {
  lead: Lead;
  isSelected: boolean;
  onClick: () => void;
  currentUserId?: string;
  compact?: boolean;
}

function LeadCard({ lead, isSelected, onClick, currentUserId, compact }: LeadCardProps) {
  const isClaimedByMe = currentUserId && lead.claimedBy === currentUserId;
  const canClaim = !lead.claimedBy || isClaimedByMe;

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 text-left transition-colors ${
        isSelected 
          ? 'bg-blue-50 border-l-4 border-blue-500' 
          : 'hover:bg-gray-50 border-l-4 border-transparent'
      } ${compact ? 'py-2' : ''}`}
      style={{
        borderLeftColor: isSelected ? STATUS_COLORS[lead.status] : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 truncate">
              {lead.name}
            </span>
            {!canClaim && (
              <span className="text-xs bg-gray-200 px-1.5 py-0.5 rounded">
                🔒
              </span>
            )}
          </div>
          
          {!compact && (
            <>
              <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{lead.address}</span>
              </div>
              
              <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                <span>{lead.city}, {lead.state}</span>
              </div>
            </>
          )}

          {lead.phone && !compact && (
            <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
              <span>📞</span>
              <span>{lead.phone}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <span 
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: `${STATUS_COLORS[lead.status]}20`,
              color: STATUS_COLORS[lead.status],
            }}
          >
            {STATUS_LABELS[lead.status]}
          </span>

          {/* Knockability Score */}
          {(() => {
            const score = calculateKnockabilityScore(lead);
            const color = getKnockabilityColor(score.total);
            const label = getKnockabilityLabel(score.total);
            return (
              <div className="flex items-center gap-1" title={score.reasons.join(', ')}>
                <TrendingUp className="w-3 h-3" style={{ color }} />
                <span className="text-xs font-semibold" style={{ color }}>
                  {score.total}
                </span>
              </div>
            );
          })()}
          
          {lead.claimedBy && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <User className="w-3 h-3" />
              <span className="truncate max-w-[80px]">
                {isClaimedByMe ? 'You' : 'Claimed'}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
