'use client';

import HouseHistory from '@/app/homeowners/HouseHistory';
import { HomeownerSection } from '@/app/homeowners/Details';
import type { Homeowner } from '@/app/homeowners/model';
import { homeownerKnockGps } from '@/app/homeowners/knockGps';
import { AREA_BLOCK_MESSAGE, assertAssignedAreaAtTap, knownPolygonsSync } from '@/app/field/areaGate';
import { useProximityPrompt } from '@/app/field/ProximityWarningDialog';
import { isProximityWarningCancelled, proximityVerdictAtTap, saveWithProximityWarning } from '@/app/field/proximityWarning';
import { DIRECT_MOBILE_WRITES } from '@/app/field/directWrites';
import { NOTES_BLANK_MESSAGE, NOTES_TOO_LONG_MESSAGE, notesEditTooLong, notesQueuedBody, parkedNotesNotice, saveNotesFromEditor, whitespaceNotesChange } from '@/app/field/notesLimits';
import { recordSyncEvent } from '@/app/field/syncDiagnostics';
import { displayedKnockPoint } from '@/app/field/knockPoint';
import { beginWarmGps, bestFixInWindow } from '@/app/field/warmGps';
import { knockPatch } from '@/app/field/knockPatch';
import { isDeviceOnline } from '@/app/utils/connectivity';
import AppointmentOutcomeCard from './AppointmentOutcomeBadge';
import DictateButton from '@/app/field/DictateButton';
import FieldDoorPanel, { type VisitDraft } from '@/app/field/FieldDoorPanel';
import { acknowledgeMobileLead } from '@/app/hooks/useLiveLeads';
import { overlayDrafts } from '@/app/field/deviceStore';
import { useOptionalMobileData } from '@/app/mobile/_components/MobileDataProvider';
import type { FieldMutation, FieldObservation } from '@/app/field/types';
import { localParts } from '@/app/field/analysis';

import { DEFAULT_DISPOSITIONS } from '@/app/types/disposition';
import { getLocation } from '@/app/utils/geolocation';
import { distanceBetween } from 'geofire-common';

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Lead, User, ObjectionType } from '@/app/types';
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
import { Disposition, getDispositionsAsync, isScheduledGoBackStatus } from '@/app/utils/dispositions';
import { checkEasterEggTrigger } from '@/app/utils/easterEggs';
import { awardSolarMadnessAsync } from '@/app/utils/solarMadness';
import { auth, db } from '@/app/utils/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { mapLeadDoc } from '@/app/utils/firestore';
import MobileDialog from '@/app/mobile/_components/MobileDialog';
import type { SolarMadnessAwardResponse } from '@/app/types/solarMadness';
import SolarMadnessWinModal from './SolarMadnessWinModal';
import { EasterEgg } from '@/app/types/easterEgg';
import EasterEggWinModal from './EasterEggWinModal';
import GoBackScheduleModal, { GoBackScheduleData } from './GoBackScheduleModal';
import { formatGoBackScheduledTime } from '@/app/utils/timezone';
import { isProximityRequired, PROXIMITY_MAX_DISTANCE_METERS } from '@/app/utils/proximityEnforcement';

interface LeadDetailProps {
  relatedLeads?: Lead[];
  unvisitedHome?: boolean;
  saveLeadPatch?: (patch: Partial<Lead>, deferGps?: boolean) => Promise<void>;
  prepareLead?: () => Promise<void>;
  homeowner?: Homeowner;
  fieldMemory?: boolean;
  dispositionOptions?: Disposition[];
  dispositionsLoading?: boolean;
  lead: Lead;
  currentUser: User | null;
  onClose: () => void;
  onUpdate: (updatedLead?: Lead) => void;
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

const QUICK_ACTION_LABELS: Record<string, string> = {
  'not-home': 'NH', 'not-interested': 'NI', 'go-back': 'GB',
};

function LeadDetailContent({ lead, relatedLeads, currentUser, onClose, onUpdate, fieldMemory = false, homeowner, dispositionOptions, dispositionsLoading = false, unvisitedHome = false, saveLeadPatch, prepareLead }: LeadDetailProps) {
  const mobile = useOptionalMobileData();
  const field = fieldMemory || DIRECT_MOBILE_WRITES ? mobile?.field : undefined;
  const shared = field?.leads.find(item => item.id === lead.id);
  // A lightweight map row must never replace the selected door's full notes.
  if (shared && !(shared as Lead & {mobileSummary?:boolean}).mobileSummary) lead = shared;
  if (field?.drafts.length) lead = overlayDrafts([lead], field.drafts)[0];
  const summaryOnly = Boolean((lead as Lead & {mobileSummary?:boolean}).mobileSummary);
  homeowner = homeowner || lead.homeowner;
  const hasPendingFieldWork = !!field?.drafts.some(d => d.leadId === lead.id);
  const pausedWithDrafts = !DIRECT_MOBILE_WRITES && hasPendingFieldWork && !field?.flags.capture;
  const capture = !DIRECT_MOBILE_WRITES && !!field?.flags.capture;
  async function saveReportingPatch(patch: Partial<Lead>, deferGps = false) {
    const point = displayedKnockPoint(lead, homeowner || lead.homeowner);
    const write = async () => {
      if (saveLeadPatch) await saveLeadPatch(patch, deferGps);
      else if (DIRECT_MOBILE_WRITES) {
        if (!field) throw Error('Open the mobile Knock screen to save this action safely.');
        await field.enqueueDirect(lead, patch, undefined, deferGps, point);
      }
      else { const { updateLeadAsync } = await import('@/app/utils/storage'); await updateLeadAsync(lead.id, patch); }
      if (DIRECT_MOBILE_WRITES) setFieldMessage('');
    };
    if (deferGps && currentUser) {
      const tappedAt = patch.dispositionedAt instanceof Date ? patch.dispositionedAt.getTime() : Date.now();
      const actorId = currentUser.id;
      await saveWithProximityWarning({
        guardId: `${lead.id}:${actorId}`,
        checkArea: () => assertAssignedAreaAtTap({
          user: currentUser,
          lead,
          tappedAt,
          status: typeof patch.status === 'string' ? patch.status : undefined,
          disposition: patch.dispositionHistory?.[0]?.disposition,
        }),
        verdict: proximityVerdictAtTap({
          fix: bestFixInWindow(tappedAt, tappedAt),
          tappedAt,
          pin: point,
          role: currentUser.role,
          optOut: currentUser.features?.proximityEnforcement === false,
          polygons: knownPolygonsSync(currentUser.id)?.polygons,
        }),
        ask: proximity.ask,
        save: write,
      });
      return;
    }
    await write();
  }
  const [visit, setVisit] = useState<VisitDraft>({});
  const [fieldMessage, setFieldMessage] = useState('');
  const proximity = useProximityPrompt();
  function reportSilent(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[raydar-sync]', message);
    if (!currentUser) return;
    void recordSyncEvent({
      id: crypto.randomUUID(), userId: currentUser.id, at: Date.now(), draftId: 'ui', leadId: lead.id,
      createdAt: new Date().toISOString(), state: 'retry', lastError: message, attempts: 0,
    });
  }
  function isFieldValidation(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    if (message === AREA_BLOCK_MESSAGE) return true;
    return /Reload your dispositions|Connect before claiming|Only the rep who claimed|Field capture is paused|Review pending drafts|Sign in to save this visit|Open the mobile Knock screen|Sign in with the rep/i.test(message);
  }
  async function recordField(kind: FieldMutation['kind'], patch: Partial<FieldMutation> = {}) {
    if (!field || !currentUser) throw Error('Sign in to save this visit.');
    const at = new Date(), id = crypto.randomUUID(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = localParts(at, zone), status = patch.status || lead.status;
    const disposition = dispositions.find(d => d.id === status);
    const observation: FieldObservation = {
      ...visit, eventId: id, timeZone: zone, localHour: parts.hour, localDay: parts.day,
      statusId: status, countsAsKnock: !!disposition?.countsAsDoorKnock,
      flags: field.flags, experiment: field.config.experiment, group: field.group,
      ...(status === 'not-home' ? { answered: false, conversation: undefined } : {}),
      ...(patch.objectionType ? { objections: [patch.objectionType] } : {}),
    };
    if (kind === 'knock' && disposition?.countsAsDoorKnock) {
      if (prepareLead) {
        const gps = await homeownerKnockGps(lead, currentUser);
        if (gps.knockGpsLat != null && gps.knockGpsLng != null) observation.gps = {
          lat: gps.knockGpsLat, lng: gps.knockGpsLng, accuracy: gps.knockGpsAccuracy!, timestamp: gps.knockGpsTimestamp!.toISOString(),
        };
      } else try {
        const position = await getLocation({ enableHighAccuracy: true, timeout: 10000 });
        const point = displayedKnockPoint(lead, homeowner || lead.homeowner);
        const distance = point
          ? distanceBetween(
            [position.coords.latitude, position.coords.longitude],
            [point.lat, point.lng],
          ) * 1000
          : undefined;
        observation.gps = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp).toISOString(),
          ...(distance !== undefined ? { distance } : {}),
        };
      } catch {
        /* A missing fix is recorded with the knock. It does not stop the save. */
      }
    }
    await prepareLead?.();
    await field.enqueue({id,userId:currentUser.id,leadId:lead.id,createdAt:at.toISOString(),kind,baseStatus:lead.status,baseNotes:lead.notes||'',...(kind==='knock'?{observation,disposition:disposition?.name||status}:{}),...patch});
    setFieldMessage('');
    if (kind === 'knock') setVisit({});
    onUpdate();
  }
  const [isUpdating, setIsUpdating] = useState(false);
  const [notes, setNotes] = useState(lead.notes || '');
  const savedNotes = useRef(lead.notes || '');
  useEffect(() => {
    const previous = savedNotes.current, next = lead.notes || '';
    setNotes(draft => draft === previous ? next : draft);
    savedNotes.current = next;
  }, [lead.notes]);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [showObjectionTracker, setShowObjectionTracker] = useState(false);
  const [showLeadEditor, setShowLeadEditor] = useState(false);
  const [showGoBackSchedule, setShowGoBackSchedule] = useState(false);
  const [pendingGoBackStatus, setPendingGoBackStatus] = useState('go-back');
  const [loadedDispositions, setDispositions] = useState<Disposition[]>(DEFAULT_DISPOSITIONS);
  const dispositions = dispositionOptions ?? loadedDispositions;
  const [users, setUsers] = useState<User[]>([]);
  const [adminAssignUser, setAdminAssignUser] = useState<string>('');
  const [isLoadingDispositions, setIsLoadingDispositions] = useState(!dispositionOptions);
  const actionsLoading = dispositionOptions ? dispositionsLoading : isLoadingDispositions;
  const [wonEasterEgg, setWonEasterEgg] = useState<EasterEgg | null>(null);
  const [solarMadnessAward, setSolarMadnessAward] = useState<(SolarMadnessAwardResponse & { matchup?: any }) | null>(null);
  const [photos, setPhotos] = useState(lead.photos || []);
  useEffect(() => {
    if (!fieldMemory) return;
    const receive = (event: Event) => { const value = (event as CustomEvent).detail; if (value.leadId !== lead.id) return; if (value.egg) setWonEasterEgg(value.egg); if (value.madness?.awarded) setSolarMadnessAward(value.madness); };
    window.addEventListener('raydar-field-award', receive);
    return () => window.removeEventListener('raydar-field-award', receive);
  }, [fieldMemory, lead.id]);


  const isClaimedByMe = currentUser && lead.claimedBy === currentUser.id;
  const canClaim = !lead.claimedBy || isClaimedByMe;
  const isClaimed = !!lead.claimedBy;

  // Read the selected lead immediately, including from cache. Supporting settings
  // and the admin-only assignment directory must not block or trap the panel.
  useEffect(() => {
    if (dispositionOptions) return;
    let active = true;
    void getDispositionsAsync().then((items) => {
      if (active) { setDispositions(items); setIsLoadingDispositions(false); }
    }).catch(() => { if (active) setIsLoadingDispositions(false); });
    return () => { active = false; };
  }, [dispositionOptions]);
  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    let active = true;
    void getUsersAsync().then((items) => {
      if (active) setUsers(items.filter(user => user.role !== 'admin'));
    }).catch(() => {});
    return () => { active = false; };
  }, [currentUser?.id, currentUser?.role]);

  // Lock background scroll while lead detail is open so the app header/page does not fight the panel
  useEffect(() => {
    if (!DIRECT_MOBILE_WRITES) return;
    return beginWarmGps();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  // Get current disposition
  const currentDisposition = dispositions.find(d => d.id === lead.status);
  const CurrentIcon = currentDisposition ? ICON_MAP[currentDisposition.icon] || Circle : Circle;

  // Filter dispositions for quick actions (exclude unclaimed/claimed, show door knock statuses)
  const quickActionDispositions = dispositions.filter(
    d => d.id !== 'unclaimed' && d.id !== 'claimed' && d.countsAsDoorKnock
  );

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser || actionsLoading) return;
    const knockedAt = new Date();
    if (pausedWithDrafts) { setFieldMessage('Field capture is paused. Sync or review this pin’s pending drafts in Field tools before changing it.'); return; }
    
    // Check for special behavior dispositions
    const disposition = dispositions.find(d => d.id === newStatus);
    
    // Go Back / House for Sale: schedule a return visit, keep the chosen pin status
    if (isScheduledGoBackStatus(newStatus)) {
      setPendingGoBackStatus(newStatus);
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
    
    if (capture && !['claimed','unclaimed'].includes(newStatus)) {
      setIsUpdating(true);
      try { await recordField('knock', { status: newStatus }); }
      catch (e) { setFieldMessage((e as Error).message); }
      finally { setIsUpdating(false); }
      return;
    }
    setIsUpdating(true);
    
    try {
      const disposition = dispositions.find(d => d.id === newStatus);
      const gpsData = disposition?.countsAsDoorKnock && !DIRECT_MOBILE_WRITES
        ? await homeownerKnockGps(lead, currentUser) : {};

      if (DIRECT_MOBILE_WRITES && ['claimed', 'unclaimed'].includes(newStatus)) {
        if (!isDeviceOnline()) throw Error('Connect before claiming or unclaiming a lead. Your offline knocks remain saved.');
        await field?.ensureLeadSynced(lead.id);
      }
      if (newStatus === 'claimed') {
        // Handle claim
        const updated = await claimLead(lead.id, currentUser.id);
        if (mobile) acknowledgeMobileLead(currentUser, updated);
        onUpdate(updated);
      } else if (newStatus === 'unclaimed') {
        // Handle unclaim
        if (!isClaimedByMe) throw Error('Only the rep who claimed this lead can unclaim it.');
        const updated = await unclaimLead(lead.id);
        if (mobile) acknowledgeMobileLead(currentUser, updated);
        onUpdate(updated);
        onClose();
        return;
      } else {
        // Handle status change with GPS data
        // IMPORTANT: use partial update so we don't accidentally send ownership fields that could trip rules.
        if (!disposition) throw Error('Reload your dispositions before saving.');
        await saveReportingPatch(knockPatch(lead, currentUser, auth?.currentUser?.uid, disposition, knockedAt, gpsData), disposition.countsAsDoorKnock);
      }

      if (DIRECT_MOBILE_WRITES) { onUpdate(); onClose(); return; }
      
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

      // Solar Madness (basket win)
      try {
        const token = await auth?.currentUser?.getIdToken();
        if (token) {
          const resp = await awardSolarMadnessAsync({
            idToken: token,
            leadId: lead.id,
            dispositionId: disposition?.id,
            dispositionName: disposition?.name || newStatus,
          });
          if (resp?.awarded) {
            setSolarMadnessAward(resp);
          }
        }
      } catch (err) {
        console.error('Solar Madness award failed:', err);
        // Don't block the disposition save if award fails
      }

      onUpdate();
    } catch (error: unknown) {
      if (isProximityWarningCancelled(error)) return;
      if (DIRECT_MOBILE_WRITES && !isFieldValidation(error)) reportSilent(error);
      else setFieldMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle saving notes
  const notesRoute = notesQueuedBody({
    leadId: lead.id,
    notes,
    baseNotes: lead.notes || '',
    parkedNotes: field?.drafts,
  });
  const notesTooLong = notesEditTooLong({
    currentNotes: lead.notes || '',
    notes,
    leadId: lead.id,
    baseNotes: lead.notes || '',
    parkedNotes: field?.drafts,
  });

  const parkedNotesMessage = parkedNotesNotice(field?.drafts, lead.id);

  const handleSaveNotes = async () => {
    if (summaryOnly) return;
    if (!currentUser) return;
    if (notesTooLong) return;
    if (whitespaceNotesChange(lead.notes || '', notes)) {
      setFieldMessage(NOTES_BLANK_MESSAGE);
      return;
    }
    if (notes === (lead.notes || '') && notesRoute.tooLong) return;
    if (pausedWithDrafts) { setFieldMessage('Review pending drafts in Field tools before changing these notes.'); return; }
    
    setNotesSaving(true);
    try {
      await saveNotesFromEditor(notes, async () => {
        if (capture) {
          await recordField('notes', { notes });
          return;
        }
        const { saveLeadAsync } = await import('@/app/utils/storage');
        const updatedLead: Lead = {
          ...lead,
          notes,
        };
        if (DIRECT_MOBILE_WRITES) await saveReportingPatch({ notes });
        else if (saveLeadPatch) await saveLeadPatch({ notes });
        else await saveLeadAsync(updatedLead);
        if (!DIRECT_MOBILE_WRITES) setFieldMessage('Notes saved.');
        if (onUpdate) onUpdate();
      }, {
        leadId: lead.id,
        baseNotes: lead.notes || '',
        currentNotes: lead.notes || '',
        parkedNotes: field?.drafts,
      });
    } catch (error) {
      if ((error as Error).message === NOTES_TOO_LONG_MESSAGE) return;
      if (capture) setFieldMessage((error as Error).message);
      else if (DIRECT_MOBILE_WRITES) reportSilent(error);
      else setFieldMessage((error as Error).message || 'Notes could not be saved. Please retry.');
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
    if (DIRECT_MOBILE_WRITES) await saveReportingPatch({ photos: updatedPhotos });
    else if (saveLeadPatch) await saveLeadPatch({ photos: updatedPhotos });
    else if (fieldMemory) { const { updateLeadAsync } = await import('@/app/utils/storage'); await updateLeadAsync(lead.id, { photos: updatedPhotos }); } else await saveLeadAsync(updatedLead);
    if (onUpdate) onUpdate();
  };

  const handleObjectionSave = async (objectionType: ObjectionType, objectionNotes: string) => {
    if (!currentUser) return;
    const at = new Date();
    setIsUpdating(true);
    try {
      if (capture) { await recordField('knock', { status: 'not-interested', objectionType, objectionNotes }); setShowObjectionTracker(false); return; }
      const disposition = dispositions.find(d => d.id === 'not-interested');
      if (!disposition) throw Error('Reload your dispositions before saving.');
      const gps = disposition.countsAsDoorKnock && !DIRECT_MOBILE_WRITES ? await homeownerKnockGps(lead, currentUser) : {};
      await saveReportingPatch(knockPatch(lead, currentUser, auth?.currentUser?.uid, disposition, at, {
        objectionType, objectionNotes, objectionRecordedAt: at, objectionRecordedBy: currentUser.id, ...gps,
      }), disposition.countsAsDoorKnock);
      setShowObjectionTracker(false); onUpdate(); if (DIRECT_MOBILE_WRITES) onClose();
    } catch (e) {
      if (isProximityWarningCancelled(e)) return;
      if (DIRECT_MOBILE_WRITES && !isFieldValidation(e)) { reportSilent(e); return; }
      setFieldMessage((e as Error).message); throw e;
    }
    finally { setIsUpdating(false); }
  };

  const handleGoBackSave = async (scheduleData: GoBackScheduleData) => {
    if (!currentUser) return;
    const at = new Date();
    setIsUpdating(true);
    try {
      if (capture) { await recordField('knock', { status: pendingGoBackStatus || 'go-back', goBackScheduledDate: new Date(scheduleData.date).toISOString(), goBackScheduledTime: scheduleData.time, goBackNotes: scheduleData.notes }); setShowGoBackSchedule(false); return; }
      const disposition = dispositions.find(d => d.id === pendingGoBackStatus);
      if (!disposition) throw Error('Reload your dispositions before saving.');
      const gps = disposition.countsAsDoorKnock && !DIRECT_MOBILE_WRITES ? await homeownerKnockGps(lead, currentUser) : {};
      await saveReportingPatch(knockPatch(lead, currentUser, auth?.currentUser?.uid, disposition, at, {
        disposition: disposition.name, goBackScheduledDate: scheduleData.date,
        goBackScheduledTime: scheduleData.time, goBackNotes: scheduleData.notes,
        goBackScheduledBy: currentUser.id, ...gps,
      }), disposition.countsAsDoorKnock);
      setShowGoBackSchedule(false); onUpdate(); if (DIRECT_MOBILE_WRITES) onClose();
    } catch (e) {
      if (isProximityWarningCancelled(e)) return;
      if (DIRECT_MOBILE_WRITES && !isFieldValidation(e)) { reportSilent(e); return; }
      setFieldMessage((e as Error).message); throw e;
    }
    finally { setIsUpdating(false); }
  };

  if (actionsLoading && !fieldMemory) {
    return (
      <div className="rm-lead-detail fixed inset-0 md:inset-y-0 md:right-0 md:left-auto w-full md:max-w-sm bg-white shadow-2xl z-[80] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-[#718096]">Loading...</p>
        </div>
      </div>
    );
  }

  const effectiveLeadType = lead.leadType === 'sale' ? 'customer' : (lead.leadType || 'prospect');
  const isCustomerLead = effectiveLeadType === 'customer';

  if (isCustomerLead) {
    const displayName = (lead.customerFirstName || lead.customerLastName)
      ? `${lead.customerFirstName || ''} ${lead.customerLastName || ''}`.trim()
      : (lead.name || 'Customer');

    return (
      <>
        <div className="rm-lead-detail fixed inset-0 md:inset-y-0 md:right-0 md:left-auto w-full md:max-w-sm bg-white shadow-2xl z-[80] overflow-hidden flex flex-col md:border-l border-[#E2E8F0]">
          <div className="sticky top-0 z-10 p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F7FAFC]">
            <div className="flex items-center gap-2">
              <span className="text-lg">🙂</span>
              <span className="font-semibold text-[#2D3748]">Customer</span>
            </div>
            <button data-raydar-back-close onClick={onClose} aria-label="Close lead details" className="p-2 hover:bg-white rounded-lg transition-colors">
              <X className="w-5 h-5 text-[#718096]" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <HomeownerSection homeowner={homeowner} />
            <div>
              <h2 className="text-xl font-bold text-[#2D3748]">{displayName}</h2>
              <p className="text-sm text-[#718096] mt-1">{lead.address}</p>
              <p className="text-sm text-[#718096]">{lead.city}, {lead.state} {lead.zip || ''}</p>
            </div>

            <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 space-y-2 text-sm">
              {lead.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-[#718096]">Phone</span>
                  <span className="font-semibold text-[#2D3748]">{lead.phone}</span>
                </div>
              )}
              {lead.soldByName && (
                <div className="flex items-center justify-between">
                  <span className="text-[#718096]">Sales Rep</span>
                  <span className="font-semibold text-[#2D3748]">{lead.soldByName}</span>
                </div>
              )}
              {lead.setByName && (
                <div className="flex items-center justify-between">
                  <span className="text-[#718096]">FMA</span>
                  <span className="font-semibold text-[#2D3748]">{lead.setByName}</span>
                </div>
              )}
              {(() => {
                // soldDate may be a Date, ISO string, number, or Firestore Timestamp-like object
                const raw: any = (lead as any).soldDate;
                if (!raw) return null;

                let dt: Date | null = null;
                if (raw instanceof Date) {
                  dt = raw;
                } else if (typeof raw === 'string' || typeof raw === 'number') {
                  const d = new Date(raw);
                  dt = isNaN(d.getTime()) ? null : d;
                } else if (typeof raw?.toDate === 'function') {
                  const d = raw.toDate();
                  dt = d instanceof Date && !isNaN(d.getTime()) ? d : null;
                } else if (typeof raw?.seconds === 'number') {
                  const d = new Date(raw.seconds * 1000);
                  dt = isNaN(d.getTime()) ? null : d;
                }

                if (!dt) return null;

                return (
                  <div className="flex items-center justify-between">
                    <span className="text-[#718096]">Sold Date</span>
                    <span className="font-semibold text-[#2D3748]">{format(dt, 'MMM d, yyyy')}</span>
                  </div>
                );
              })()}
            </div>

            <AppointmentOutcomeCard lead={lead} />

            {lead.notes && (
              <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg p-4">
                <div className="text-sm font-semibold text-[#2D3748] mb-1">Notes</div>
                <div className="text-sm text-[#4A5568] whitespace-pre-wrap">{lead.notes}</div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {proximity.dialog}
      <div className="rm-lead-detail fixed inset-0 md:inset-y-0 md:right-0 md:left-auto w-full md:max-w-sm bg-white shadow-2xl z-[80] overflow-hidden flex flex-col md:border-l border-[#E2E8F0]">
        {/* Header */}
        <div className="sticky top-0 z-10 p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F7FAFC]">
          <div className="flex items-center gap-3">
            <div 
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: unvisitedHome ? '#476E88' : currentDisposition?.color || '#6B7280' }}
            />
            <span className="font-semibold text-[#2D3748]">
              {unvisitedHome ? 'Ready to knock' : currentDisposition?.name || lead.status}
            </span>
          </div>
          <button
            data-raydar-back-close onClick={onClose}
            aria-label="Close lead details"
            className="p-2 hover:bg-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#718096]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <HomeownerSection homeowner={homeowner} compact />
          {/* Name & Status */}
          <div className={homeowner?.ownerName === lead.name ? 'mb-2' : 'mb-6'}>
            {homeowner?.ownerName !== lead.name && <h2 className="text-xl font-bold text-[#2D3748]">{lead.name}</h2>}
            {!unvisitedHome && isClaimed && lead.claimedBy && (
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

          {fieldMessage && fieldMessage !== NOTES_BLANK_MESSAGE && <p className="rf-notice" role="status">
            <span>{fieldMessage}</span>
            {fieldMessage === AREA_BLOCK_MESSAGE && <button type="button" className="rf-plain" onClick={() => setFieldMessage('')}>Dismiss</button>}
          </p>}
          {fieldMemory && !summaryOnly && <FieldDoorPanel lead={lead} draft={visit} onChange={setVisit} onHandoff={() => setShowLeadEditor(true)} />}
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

          <AppointmentOutcomeCard lead={lead} />

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
            {actionsLoading && <p role="status" className="text-sm text-[#718096] mb-3">Loading actions. You can still read this lead and close the panel.</p>}
            {fieldMemory && <div className="rm-quick-actions" role="group" aria-label="Quick knock actions">
              {(['not-home', 'not-interested'] as const).map(id => {
                const dispo = dispositions.find(item => item.id === id);
                const Icon = id === 'not-home' ? Home : XCircle;
                return <button key={id} type="button"
                  aria-label={`${QUICK_ACTION_LABELS[id]} — ${dispo?.name || (id === 'not-home' ? 'Not Home' : 'Not Interested')}`}
                  title={dispo?.name}
                  onClick={() => handleStatusChange(id)}
                  disabled={isUpdating || actionsLoading || !dispo}
                  style={{ backgroundColor: dispo?.color || '#617382' }}>
                  <Icon size={18} />{QUICK_ACTION_LABELS[id]}
                </button>;
              })}
              <button type="button" aria-label="CSM — Call Scheduling Manager" title="Call Scheduling Manager"
                onClick={() => setShowLeadEditor(true)} disabled={summaryOnly || isUpdating || actionsLoading}>
                <Phone size={18} />CSM
              </button>
            </div>}
            
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
              {!unvisitedHome && !isClaimed && (
                <button
                  onClick={() => handleStatusChange('claimed')}
                  disabled={isUpdating || actionsLoading}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  <Target className="w-4 h-4" />
                  Claim
                </button>
              )}
              
              {!unvisitedHome && isClaimedByMe && (
                <button
                  onClick={() => handleStatusChange('unclaimed')}
                  disabled={isUpdating || actionsLoading}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-[#718096] hover:bg-[#4A5568] text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  <Circle className="w-4 h-4" />
                  Unclaim
                </button>
              )}

              {quickActionDispositions.filter(dispo => !fieldMemory ||
                (!['not-home', 'not-interested'].includes(dispo.id) && dispo.specialBehavior !== 'scheduling-manager')).map(dispo => {
                const Icon = ICON_MAP[dispo.icon] || Circle;
                const shortLabel = fieldMemory ? QUICK_ACTION_LABELS[dispo.id] : undefined;
                return (
                  <button
                    key={dispo.id}
                    aria-label={shortLabel ? `${shortLabel} — ${dispo.name}` : dispo.name}
                    title={dispo.name}
                    onClick={() => handleStatusChange(dispo.id)}
                    disabled={isUpdating || actionsLoading}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-white rounded-lg font-medium transition-all disabled:opacity-50 hover:opacity-90"
                    style={{ backgroundColor: dispo.color }}
                  >
                    <Icon className="w-4 h-4" />
                    {shortLabel || dispo.name}
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
                {dispositions.filter(dispo => !unvisitedHome || !['claimed', 'unclaimed'].includes(dispo.id)).map(dispo => {
                  const Icon = ICON_MAP[dispo.icon] || Circle;
                  return (
                    <button
                      key={dispo.id}
                      onClick={() => handleStatusChange(dispo.id)}
                      disabled={isUpdating || actionsLoading}
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

          <HouseHistory key={`${currentUser?.id}:${lead.id}`} lead={lead} related={relatedLeads} uid={currentUser?.id} />

          {/* Go Back Section */}
          {(isScheduledGoBackStatus(lead.status) || !!lead.goBackScheduledDate) && (
            <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
              <h3 className="text-sm font-semibold text-[#2D3748] mb-3">
                {lead.status === 'house-for-sale' ? 'House for Sale' : 'Go Back'}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-[#2D3748]">
                  <Calendar className="w-4 h-4 text-[#FF5F5A]" />
                  <span className="font-medium">Go Back Scheduled:</span>
                  <span>
                    {lead.goBackScheduledDate
                      ? format(new Date(lead.goBackScheduledDate), 'MMM d, yyyy')
                      : 'Not set'}
                    {lead.goBackScheduledTime ? ` • ${formatGoBackScheduledTime(lead.goBackScheduledTime)}` : ' • Anytime'}
                  </span>
                </div>

                {lead.goBackNotes && (
                  <div className="flex items-start gap-2 text-[#2D3748]">
                    <FileText className="w-4 h-4 text-[#718096] mt-0.5" />
                    <div>
                      <div className="font-medium">Notes:</div>
                      <div className="text-[#4A5568] whitespace-pre-wrap">{lead.goBackNotes}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

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
          {summaryOnly && <p role="status">Saved door summary. You can log a knock offline. Reconnect and reopen this door to edit notes and details.</p>}
          {/* Notes Section */}
          <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Notes</h3>
            {fieldMemory && !summaryOnly && <DictateButton onText={text => setNotes(current => [current.trim(), text].filter(Boolean).join("\n"))} onKeyboard={() => noteInput.current?.focus()} />}
            <textarea
              disabled={summaryOnly}
              ref={noteInput}
              aria-label="Lead notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this lead..."
              className="w-full px-4 py-3 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              rows={3}
            />
            {notesTooLong ? <p className="mt-2 text-sm font-semibold text-[#C53030]">{NOTES_TOO_LONG_MESSAGE}</p> : null}
            {fieldMessage === NOTES_BLANK_MESSAGE ? <p className="mt-2 text-sm font-semibold text-[#C53030]">{NOTES_BLANK_MESSAGE}</p> : null}
            {parkedNotesMessage ? <p className="mt-2 text-sm font-semibold text-[#C53030]">{parkedNotesMessage}</p> : null}
            <button
              onClick={handleSaveNotes}
              disabled={notesSaving || summaryOnly || notesTooLong}
              className="mt-2 px-4 py-2 bg-[#FF5F5A] text-white rounded-lg text-sm font-semibold hover:bg-[#F27141] disabled:opacity-50"
            >
              {notesSaving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          {/* Photos Section */}
          {!summaryOnly && <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
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
          </div>}

          {/* Book Manually */}
          <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
            <a
              href="https://api.leadconnectorhq.com/widget/groups/happy-solar-booking-hub"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-[#38A169] hover:bg-[#2F855A] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Book Manually
            </a>
          </div>
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
          signedInRep={currentUser}
          saveLeadPatch={DIRECT_MOBILE_WRITES ? saveReportingPatch : saveLeadPatch}
          beforeSend={DIRECT_MOBILE_WRITES && field ? () => field.prepareSendInfo(lead.id) : undefined}
          mobileMode={fieldMemory}
          pendingFieldWork={!DIRECT_MOBILE_WRITES && hasPendingFieldWork}
          fieldContext={capture ? [visit.openerId ? `Opener: ${field.config.openers.find(o => o.id === visit.openerId)?.label || visit.openerId}` : "", visit.previewShown ? "Company-approved savings illustration shown; not a quote." : "", visit.proofShown ? "Approved local proof shown." : ""].filter(Boolean).join("\n") : undefined}
          onInfoSent={!DIRECT_MOBILE_WRITES && field?.flags.show ? async () => { try { await recordField("handoff", { handoff: "sent" }); } catch (e) { setFieldMessage(`Info sent; tracking needs attention: ${(e as Error).message}`); } } : undefined}
          pendingDrafts={field?.drafts}
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
          currentDisposition={pendingGoBackStatus || lead.status}
        />
      )}
      
      {/* Easter Egg Win Modal */}
      {wonEasterEgg && (
        <EasterEggWinModal
          egg={wonEasterEgg}
          onClose={() => setWonEasterEgg(null)}
        />
      )}

      {/* Solar Madness Win Modal */}
      {solarMadnessAward?.awarded && (
        <SolarMadnessWinModal
          award={solarMadnessAward}
          onClose={() => setSolarMadnessAward(null)}
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

/** Map/activity summaries deliberately omit large note/history fields. Fetch the
 * selected door before editing so saving notes cannot erase existing content. */
export default function LeadDetail(props: LeadDetailProps) {
  const summary = Boolean((props.lead as Lead & {mobileSummary?:boolean}).mobileSummary);
  const [full,setFull] = useState<Lead | null>(null);
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  const uid=props.currentUser?.id, id=props.lead.id;
  useEffect(() => {
    if (!summary || !uid || !db) return;
    let active=true;
    setFull(null);setError('');
    void getDoc(doc(db,'leads',id)).then(snapshot => {
      if(!active || auth?.currentUser?.uid!==uid)return;
      if(!snapshot.exists())throw Error('This door is no longer available.');
      setFull(mapLeadDoc(snapshot));
    }).catch(()=>{if(active)setError('Full door details could not load. Reconnect and retry. Your saved knocks are safe.');});
    return()=>{active=false;};
  },[id,uid,summary,attempt]);
  if(summary && (!full || full.id!==id) && !error && isDeviceOnline())return <MobileDialog title="Door details" onClose={props.onClose}>
    <p role="status">{error || 'Loading door details…'}</p><button className="rm-secondary" onClick={props.onClose}>Close door details</button>
    {error && <button className="rm-primary" onClick={()=>setAttempt(v=>v+1)}>Retry</button>}
  </MobileDialog>;
  return <LeadDetailContent {...props} lead={summary && full?.id===id ? full : props.lead} />;
}
