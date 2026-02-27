'use client';

import { useState, useEffect } from 'react';
import { Lead, User, ObjectionType, LeadDispositionHistoryEntry } from '@/app/types';
import { 
  X, MapPin, Phone, Mail, Clock, User as UserIcon, 
  CheckCircle, Circle, AlertCircle, Calendar, DollarSign,
  Home, Star, XCircle, Target, Users as UsersIcon, HelpCircle,
  ThumbsUp, ThumbsDown, Flag, Bookmark, Heart, Pin,
  DoorOpen, DoorClosed, Bell, MessageSquare, FileText, Clipboard,
  Zap, Sun, Cloud, Umbrella, Car, Truck, Building, Briefcase,
  Coffee, Gift, Shield, Lock, Unlock, Key, Trash, Archive,
  Ban, Slash, MinusCircle, PlusCircle, Info, ArrowRight, ArrowLeft
} from 'lucide-react';
import { updateLeadStatus, claimLead, unclaimLead, getUsersAsync } from '@/app/utils/storage';
import ObjectionTracker from './ObjectionTracker';
import LeadEditorModal from './LeadEditorModal';
import { Disposition, getDispositionsAsync } from '@/app/utils/dispositions';
import { checkEasterEggTrigger } from '@/app/utils/easterEggs';
import { EasterEgg } from '@/app/types/easterEgg';
import EasterEggWinModal from './EasterEggWinModal';
import GoBackScheduleModal, { GoBackScheduleData } from './GoBackScheduleModal';

interface LeadDetailProps {
  lead: Lead;
  currentUser: User | null;
  onClose: () => void;
  onUpdate: () => void;
}

// Icon map for dispositions
const ICON_MAP: Record<string, any> = {
  'circle': Circle,
  'target': Target,
  'home': Home,
  'star': Star,
  'x-circle': XCircle,
  'check-circle': CheckCircle,
  'calendar': Calendar,
  'phone': Phone,
  'mail': Mail,
  'user': UserIcon,
  'users': UsersIcon,
  'clock': Clock,
  'alert-circle': AlertCircle,
  'help-circle': HelpCircle,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'flag': Flag,
  'bookmark': Bookmark,
  'heart': Heart,
  'map-pin': Pin,
  'door-open': DoorOpen,
  'door-closed': DoorClosed,
  'bell': Bell,
  'message-square': MessageSquare,
  'file-text': FileText,
  'clipboard': Clipboard,
  'dollar-sign': DollarSign,
  'zap': Zap,
  'sun': Sun,
  'cloud': Cloud,
  'umbrella': Umbrella,
  'car': Car,
  'truck': Truck,
  'building': Building,
  'briefcase': Briefcase,
  'coffee': Coffee,
  'gift': Gift,
  'shield': Shield,
  'lock': Lock,
  'unlock': Unlock,
  'key': Key,
  'trash': Trash,
  'archive': Archive,
  'ban': Ban,
  'slash': Slash,
  'minus-circle': MinusCircle,
  'plus-circle': PlusCircle,
  'info': Info,
  'x': XCircle,
  'check': CheckCircle,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
};

export default function LeadDetail({ lead, currentUser, onClose, onUpdate }: LeadDetailProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [notes, setNotes] = useState(lead.notes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [showObjectionTracker, setShowObjectionTracker] = useState(false);
  const [showLeadEditor, setShowLeadEditor] = useState(false);
  const [showGoBackSchedule, setShowGoBackSchedule] = useState(false);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [adminAssignUser, setAdminAssignUser] = useState<string>('');
  const [isLoadingDispositions, setIsLoadingDispositions] = useState(true);
  const [wonEasterEgg, setWonEasterEgg] = useState<EasterEgg | null>(null);
  const [photos, setPhotos] = useState(lead.photos || []);

  const isClaimedByMe = currentUser && lead.claimedBy === currentUser.id;
  const canClaim = !lead.claimedBy || isClaimedByMe;
  const isClaimed = !!lead.claimedBy;

  // Load dispositions on mount
  useEffect(() => {
    async function loadData() {
      const dispos = await getDispositionsAsync();
      setDispositions(dispos);
      const userList = await getUsersAsync();
      setUsers(userList.filter(u => u.role !== 'admin')); // Exclude admins from assignment list
      setIsLoadingDispositions(false);
    }
    loadData();
  }, []);

  // Get current disposition
  const currentDisposition = dispositions.find(d => d.id === lead.status);
  const CurrentIcon = currentDisposition ? ICON_MAP[currentDisposition.icon] || Circle : Circle;

  // Filter dispositions for quick actions (exclude unclaimed/claimed, show door knock statuses)
  const quickActionDispositions = dispositions.filter(
    d => d.id !== 'unclaimed' && d.id !== 'claimed' && d.countsAsDoorKnock
  );

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser) return;
    
    // Check for special behavior dispositions
    const disposition = dispositions.find(d => d.id === newStatus);
    
    // If go-back disposition, show scheduling modal
    if (newStatus === 'go-back') {
      setShowGoBackSchedule(true);
      return;
    }
    
    // If scheduling manager (other types), show lead editor instead
    if (disposition?.specialBehavior === 'scheduling-manager') {
      setShowLeadEditor(true);
      return;
    }
    
    // If marking as not-interested, show objection tracker first
    if (newStatus === 'not-interested') {
      setShowObjectionTracker(true);
      return;
    }
    
    setIsUpdating(true);
    
    try {
      // Capture GPS for knock verification (if disposition counts as door knock)
      const disposition = dispositions.find(d => d.id === newStatus);
      let gpsData = {};
      
      if (disposition?.countsAsDoorKnock && navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 0,
            });
          });
          
          // Calculate distance from lead address
          let distanceFromAddress: number | undefined;
          if (lead.lat && lead.lng) {
            const R = 6371000; // Earth's radius in meters
            const dLat = (lead.lat - position.coords.latitude) * Math.PI / 180;
            const dLng = (lead.lng - position.coords.longitude) * Math.PI / 180;
            const a = 
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(position.coords.latitude * Math.PI / 180) * 
              Math.cos(lead.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distanceFromAddress = R * c;
          }
          
          // Distance verification for setter, manager, sales (not admin)
          const MAX_DISTANCE_METERS = 50; // 50 meters (~164 feet) - close enough to verify, not too strict
          const requiresProximity = ['setter', 'manager', 'sales'].includes(currentUser.role);
          
          if (requiresProximity && distanceFromAddress && distanceFromAddress > MAX_DISTANCE_METERS) {
            setIsUpdating(false);
            const distanceFeet = Math.round(distanceFromAddress * 3.281); // Convert to feet
            alert(
              `You are not close enough to this address to disposition it.\n\n` +
              `Distance: ${distanceFeet} feet away\n` +
              `Required: Within 100 feet\n\n` +
              `Please move closer to the address and try again.`
            );
            return;
          }
          
          gpsData = {
            knockGpsLat: position.coords.latitude,
            knockGpsLng: position.coords.longitude,
            knockGpsAccuracy: position.coords.accuracy,
            knockGpsTimestamp: new Date(),
            knockDistanceFromAddress: distanceFromAddress,
          };
        } catch (err) {
          console.warn('GPS capture failed:', err);
          // Continue without GPS if it fails (allows indoor knocking where GPS might not work)
        }
      }
      
      if (newStatus === 'claimed') {
        // Handle claim
        claimLead(lead.id, currentUser.id);
      } else if (newStatus === 'unclaimed' && isClaimedByMe) {
        // Handle unclaim
        unclaimLead(lead.id);
      } else {
        // Handle status change with GPS data
        const { saveLeadAsync } = await import('@/app/utils/storage');
        
        // Add to disposition history
        const historyEntry: LeadDispositionHistoryEntry = {
          disposition: disposition?.name || newStatus,
          timestamp: new Date(),
          userId: currentUser.id,
          userName: currentUser.name,
        };
        
        const updatedLead: Lead = {
          ...lead,
          status: newStatus,
          dispositionedAt: new Date(),
          claimedBy: adminAssignUser || currentUser.id,
          assignedTo: adminAssignUser || lead.assignedTo,
          dispositionHistory: [historyEntry, ...(lead.dispositionHistory || [])],
          ...gpsData,
        };
        
        await saveLeadAsync(updatedLead);
      }
      
      // Check for Easter Egg win!
      try {
        const eggWon = await checkEasterEggTrigger(
          lead.id,
          currentUser.id,
          currentUser.name,
          lead.address
        );
        
        if (eggWon) {
          setWonEasterEgg(eggWon);
        }
      } catch (err) {
        console.error('Easter egg check failed:', err);
        // Don't block the disposition save if egg check fails
      }
      
      onUpdate();
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle saving notes
  const handleSaveNotes = async () => {
    if (!currentUser) return;
    
    setNotesSaving(true);
    try {
      const { saveLeadAsync } = await import('@/app/utils/storage');
      const updatedLead: Lead = {
        ...lead,
        notes,
      };
      await saveLeadAsync(updatedLead);
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error saving notes:', error);
    } finally {
      setNotesSaving(false);
    }
  };

  // Handle adding a photo
  const handleAddPhoto = async (photoUrl: string, caption: string, type: 'roof' | 'meter' | 'electrical' | 'roofing' | 'other') => {
    if (!currentUser) return;
    
    const newPhoto = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: photoUrl,
      caption,
      type,
      uploadedBy: currentUser.id,
      uploadedAt: new Date(),
    };
    
    const updatedPhotos = [...(lead.photos || []), newPhoto];
    setPhotos(updatedPhotos);
    
    const { saveLeadAsync } = await import('@/app/utils/storage');
    const updatedLead: Lead = {
      ...lead,
      photos: updatedPhotos,
    };
    await saveLeadAsync(updatedLead);
    if (onUpdate) onUpdate();
  };

  const handleObjectionSave = async (objectionType: ObjectionType, objectionNotes: string) => {
    if (!currentUser) return;
    
    setIsUpdating(true);
    
    try {
      // Update lead with objection data using async Firestore
      const { saveLeadAsync } = await import('@/app/utils/storage');
      
      // Add to disposition history
      const historyEntry: LeadDispositionHistoryEntry = {
        disposition: 'Not Interested',
        timestamp: new Date(),
        userId: currentUser.id,
        userName: currentUser.name,
      };
      
      const updatedLead: Lead = {
        ...lead,
        status: 'not-interested',
        objectionType,
        objectionNotes,
        objectionRecordedAt: new Date(),
        objectionRecordedBy: currentUser.id,
        claimedBy: adminAssignUser || currentUser.id,
        assignedTo: adminAssignUser || lead.assignedTo,
        dispositionedAt: new Date(),
        dispositionHistory: [historyEntry, ...(lead.dispositionHistory || [])],
      };
      
      await saveLeadAsync(updatedLead);
      
      setShowObjectionTracker(false);
      onUpdate();
    } finally {
      setIsUpdating(false);
    }
  };

  const handleGoBackSave = async (scheduleData: GoBackScheduleData) => {
    if (!currentUser) return;
    
    setIsUpdating(true);
    
    try {
      // Update lead with go back schedule data using async Firestore
      const { saveLeadAsync } = await import('@/app/utils/storage');
      
      // Add to disposition history
      const historyEntry: LeadDispositionHistoryEntry = {
        disposition: 'Go Back',
        timestamp: new Date(),
        userId: currentUser.id,
        userName: currentUser.name,
      };
      
      const updatedLead: Lead = {
        ...lead,
        status: 'go-back',
        disposition: 'Go Back',
        dispositionedAt: new Date(),
        claimedBy: adminAssignUser || currentUser.id,
        assignedTo: adminAssignUser || lead.assignedTo,
        goBackScheduledDate: scheduleData.date,
        goBackScheduledTime: scheduleData.time,
        goBackNotes: scheduleData.notes,
        goBackScheduledBy: currentUser.id,
        dispositionHistory: [historyEntry, ...(lead.dispositionHistory || [])],
      };
      
      await saveLeadAsync(updatedLead);
      
      setShowGoBackSchedule(false);
      onUpdate();
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoadingDispositions) {
    return (
      <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl z-40 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-[#718096]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl z-40 overflow-hidden flex flex-col border-l border-[#E2E8F0]">
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F7FAFC]">
          <div className="flex items-center gap-3">
            <div 
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: currentDisposition?.color || '#6B7280' }}
            />
            <span className="font-semibold text-[#2D3748]">
              {currentDisposition?.name || lead.status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#718096]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Name & Status */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-[#2D3748]">{lead.name}</h2>
            {isClaimed && lead.claimedBy && (
              <p className="text-sm text-[#718096] mt-1">
                Claimed by {isClaimedByMe ? 'you' : 'another rep'}
                {lead.claimedAt && (
                  <> • {formatTimeAgo(new Date(lead.claimedAt))}</>
                )}
              </p>
            )}
          </div>

          {/* Address - Clickable for Google Maps Directions */}
          <a
            href={
              lead.lat && lead.lng
                ? `https://www.google.com/maps/dir/?api=1&destination=${lead.lat},${lead.lng}`
                : `https://maps.google.com/?q=${encodeURIComponent(`${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`)}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="block mb-4 p-4 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg hover:bg-[#FF5F5A]/5 hover:border-[#FF5F5A] transition-all group"
          >
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] mt-0.5 transition-colors" />
              <div className="flex-1">
                <p className="font-medium text-[#2D3748] group-hover:text-[#FF5F5A] transition-colors">{lead.address}</p>
                <p className="text-[#718096]">{lead.city}, {lead.state} {lead.zip}</p>
                <p className="text-xs text-[#FF5F5A] mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  Tap to open in Google Maps →
                </p>
              </div>
            </div>
          </a>

          {/* Contact Info */}
          {(lead.phone || lead.email) && (
            <div className="mb-4 space-y-2">
              {lead.phone && (
                <div className="flex items-center gap-3 p-3 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                  <Phone className="w-4 h-4 text-[#718096]" />
                  <a href={`tel:${lead.phone}`} className="text-[#2D3748] hover:text-[#FF5F5A] transition-colors">
                    {lead.phone}
                  </a>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-3 p-3 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                  <Mail className="w-4 h-4 text-[#718096]" />
                  <a href={`mailto:${lead.email}`} className="text-[#2D3748] hover:text-[#FF5F5A] transition-colors">
                    {lead.email}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Solar Score */}
          {lead.solarScore && (
            <div className="mb-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-amber-900">Solar Potential</span>
                <span className="text-2xl font-bold text-amber-600">{lead.solarScore}/100</span>
              </div>
              <div className="text-xs text-amber-700 capitalize mb-2">{lead.solarCategory} fit for solar</div>
              
              {/* Solar Details */}
              <div className="space-y-1 text-xs text-amber-800 pt-2 border-t border-amber-200">
                {lead.solarSunshineHours && (
                  <div className="flex items-center justify-between">
                    <span>☀️ Sunshine Hours/Year:</span>
                    <span className="font-semibold">{Math.round(lead.solarSunshineHours).toLocaleString()}</span>
                  </div>
                )}
                {lead.solarMaxPanels && (
                  <div className="flex items-center justify-between">
                    <span>📊 Max Panels:</span>
                    <span className="font-semibold">{lead.solarMaxPanels}</span>
                  </div>
                )}
                {lead.hasSouthFacingRoof !== undefined && (
                  <div className="flex items-center justify-between">
                    <span>🏠 South-Facing Roof:</span>
                    <span className="font-semibold">{lead.hasSouthFacingRoof ? 'Yes ✅' : 'No'}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Quick Actions</h3>
            
            {/* Admin: Assign to user dropdown */}
            {currentUser?.role === 'admin' && (
              <div className="mb-3">
                <label className="text-xs text-gray-500 mb-1 block">Assign to setter (admin):</label>
                <select
                  value={adminAssignUser}
                  onChange={(e) => setAdminAssignUser(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">-- Select setter (optional) --</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-2">
              {!isClaimed && (
                <button
                  onClick={() => handleStatusChange('claimed')}
                  disabled={isUpdating}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  <Target className="w-4 h-4" />
                  Claim
                </button>
              )}
              
              {isClaimedByMe && (
                <button
                  onClick={() => handleStatusChange('unclaimed')}
                  disabled={isUpdating}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-[#718096] hover:bg-[#4A5568] text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  <Circle className="w-4 h-4" />
                  Unclaim
                </button>
              )}

              {quickActionDispositions.map(dispo => {
                const Icon = ICON_MAP[dispo.icon] || Circle;
                return (
                  <button
                    key={dispo.id}
                    onClick={() => handleStatusChange(dispo.id)}
                    disabled={isUpdating}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-white rounded-lg font-medium transition-all disabled:opacity-50 hover:opacity-90"
                    style={{ backgroundColor: dispo.color }}
                  >
                    <Icon className="w-4 h-4" />
                    {dispo.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* All Statuses */}
          {showAllStatuses && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-[#2D3748] mb-3">All Dispositions</h3>
              <div className="space-y-2">
                {dispositions.map(dispo => {
                  const Icon = ICON_MAP[dispo.icon] || Circle;
                  return (
                    <button
                      key={dispo.id}
                      onClick={() => handleStatusChange(dispo.id)}
                      disabled={isUpdating}
                      className="w-full flex items-center gap-3 p-3 border-2 rounded-lg font-medium transition-all disabled:opacity-50 hover:shadow-md"
                      style={{ 
                        borderColor: lead.status === dispo.id ? dispo.color : '#E2E8F0',
                        backgroundColor: lead.status === dispo.id ? `${dispo.color}10` : 'white'
                      }}
                    >
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${dispo.color}20` }}
                      >
                        <Icon className="w-5 h-5" style={{ color: dispo.color }} />
                      </div>
                      <span className="text-[#2D3748]">{dispo.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={() => setShowAllStatuses(!showAllStatuses)}
            className="w-full py-2 text-sm text-[#4299E1] hover:text-[#3182CE] font-medium transition-colors"
          >
            {showAllStatuses ? 'Show Less' : 'Show All Dispositions'}
          </button>

          {/* Metadata */}
          <div className="mt-6 pt-6 border-t border-[#E2E8F0] space-y-2 text-xs text-[#718096]">
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Added {formatTimeAgo(new Date(lead.createdAt))}
            </div>
            {lead.dispositionedAt && (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3" />
                Dispositioned {formatTimeAgo(new Date(lead.dispositionedAt))}
              </div>
            )}
          </div>

          {/* Book Appointment Manually */}
          <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
            <a
              href="https://api.leadconnectorhq.com/widget/groups/happy-solar-booking-hub"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-[#38A169] hover:bg-[#2F855A] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Book Appointment Manually
            </a>
          </div>

          {/* Notes Section */}
          <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this lead..."
              className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              rows={3}
            />
            <button
              onClick={handleSaveNotes}
              disabled={notesSaving}
              className="mt-2 px-4 py-2 bg-[#FF5F5A] text-white rounded-lg text-sm font-semibold hover:bg-[#F27141] disabled:opacity-50"
            >
              {notesSaving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          {/* Photos Section */}
          <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Photos</h3>
            {photos && photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                    <img src={photo.url} alt={photo.caption || photo.type} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1">
                      {photo.caption || photo.type}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Simple photo URL input - in production would use file upload */}
            <div className="flex gap-2">
              <input
                type="text"
                id="photoUrl"
                placeholder="Photo URL..."
                className="flex-1 px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A]"
              />
              <select id="photoType" className="px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm">
                <option value="roof">Roof</option>
                <option value="meter">Meter</option>
                <option value="electrical">Electrical</option>
                <option value="roofing">Roofing</option>
                <option value="other">Other</option>
              </select>
              <button
                onClick={() => {
                  const urlInput = document.getElementById('photoUrl') as HTMLInputElement;
                  const typeInput = document.getElementById('photoType') as HTMLSelectElement;
                  if (urlInput.value) {
                    handleAddPhoto(urlInput.value, '', typeInput.value as any);
                    urlInput.value = '';
                  }
                }}
                className="px-4 py-2 bg-[#FF5F5A] text-white rounded-lg text-sm font-semibold hover:bg-[#F27141]"
              >
                Add
              </button>
            </div>
          </div>

          {/* Disposition History */}
          {lead.dispositionHistory && lead.dispositionHistory.length > 0 && (
            <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
              <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Disposition History</h3>
              <div className="space-y-2">
                {lead.dispositionHistory.slice(0, 10).map((entry, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs">
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-[#CBD5E0] mt-1.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-[#2D3748]">
                        <span className="font-medium">{entry.disposition}</span>
                        <span className="text-[#718096]">•</span>
                        <span className="text-[#718096]">{formatTimeAgo(new Date(entry.timestamp))}</span>
                      </div>
                      <div className="text-[#718096]">by {entry.userName}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Objection Tracker Modal */}
      {showObjectionTracker && currentUser && (
        <ObjectionTracker
          lead={lead}
          currentUserId={currentUser.id}
          onSave={handleObjectionSave}
          onClose={() => setShowObjectionTracker(false)}
        />
      )}

      {/* Lead Editor Modal (Scheduling Manager) */}
      {showLeadEditor && (
        <LeadEditorModal
          lead={lead}
          onClose={() => setShowLeadEditor(false)}
          onSave={() => {
            setShowLeadEditor(false);
            onUpdate();
          }}
        />
      )}

      {/* Go Back Schedule Modal */}
      {showGoBackSchedule && (
        <GoBackScheduleModal
          isOpen={showGoBackSchedule}
          onClose={() => setShowGoBackSchedule(false)}
          onSave={handleGoBackSave}
          leadAddress={lead.address}
          currentDisposition={lead.status}
        />
      )}
      
      {/* Easter Egg Win Modal */}
      {wonEasterEgg && (
        <EasterEggWinModal
          egg={wonEasterEgg}
          onClose={() => setWonEasterEgg(null)}
        />
      )}
    </>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return date.toLocaleDateString();
}
