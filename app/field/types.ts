import type { Lead } from "@/app/types";
import type { SyncReasonCode } from "./syncReasons";
export const FEATURE_KEYS = [
  "capture",
  "scoring",
  "timing",
  "preview",
  "proof",
  "pitch",
  "recovery",
  "show",
  "coaching",
] as const;
export type FieldFeature = (typeof FEATURE_KEYS)[number];
export type FieldFlags = Record<FieldFeature, boolean>;
export type FieldObservation = {
  eventId: string;
  timeZone: string;
  localHour: number;
  localDay: number;
  statusId: string;
  countsAsKnock: boolean;
  territoryId?: string;
  answered?: boolean;
  conversation?: "short" | "45s-plus";
  openerId?: string;
  objections?: string[];
  previewShown?: boolean;
  proofShown?: boolean;
  gps?: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
    distance?: number;
  };
  flags: FieldFlags;
  experiment: string;
  group: "pilot" | "control";
};
export type FieldDoorData = {
  ownerOccupied?: boolean;
  ownerSource?: string;
  ownerVerified?: boolean;
  hasSolar?: boolean;
  doNotKnock?: boolean;
  utility?: string;
  territoryId?: string;
};
export type FieldHandoff = {
  state: "sent" | "acknowledged" | "callback" | "booked" | "closed";
  updatedAt: string;
  updatedBy: string;
  sentAt?: string;
  setterId: string;
  callbackAt?: string;
  note?: string;
};
export type ProofItem = {
  id: string;
  title: string;
  city: string;
  state: string;
  lat?: number;
  lng?: number;
  quote: string;
  imageUrl?: string;
  sourceUrl?: string;
  permission: boolean;
  approved: boolean;
  verifiedAt: string;
};
export type SavingsAssumptions = {
  approved: boolean;
  approvedAt: string;
  source: string;
  state: string;
  panelWatts: number;
  annualKwhPerKwLow: number;
  annualKwhPerKwHigh: number;
  avoidedRateLow: number;
  avoidedRateHigh: number;
  monthlyPaymentPerKwLow: number;
  monthlyPaymentPerKwHigh: number;
  fixedMonthlyCharge: number;
  selfConsumption: number;
  exportRate: number;
};
export type FieldConfig = {
  version: string;
  experiment: string;
  pilotPercent: number;
  enabled: FieldFlags;
  allowedUsers: string[];
  startHour: number;
  endHour: number;
  maxAttempts: number;
  minTimingAttempts: number;
  maxCacheDoors: number;
  openers: { id: string; label: string; approvedTip: string }[];
  proof: ProofItem[];
  savings: SavingsAssumptions | null;
  publicOrigin: string;
  bookingUrl: string;
  bookingAttributionVerified: boolean;
  schedulingPhone: string;
};
export const DEFAULT_FIELD_CONFIG: FieldConfig = {
  version: "0",
  experiment: "field-v11",
  pilotPercent: 0,
  enabled: {
    capture: false,
    scoring: false,
    timing: false,
    preview: false,
    proof: false,
    pitch: false,
    recovery: false,
    show: false,
    coaching: false,
  },
  allowedUsers: [],
  startHour: 10,
  endHour: 19,
  maxAttempts: 3,
  minTimingAttempts: 20,
  maxCacheDoors: 750,
  openers: [],
  proof: [],
  savings: null,
  publicOrigin: "",
  bookingUrl: "",
  bookingAttributionVerified: false,
  schedulingPhone: "",
};
export type FieldMutation = {
  // Device-only queue payload. Never written as a new Firestore document/field.
  userName?: string;
  direct?: {
    patch: Partial<Lead>;
    create?: Lead;
    legacy?: boolean;
    /** Territory-API pin, or a pin with no territory that this rep does not own. */
    serverDispo?: boolean;
    /** Route body only. Never copied onto the Firestore patch. */
    homeownerId?: string;
    /** Diagnostics only. Never copied onto the Firestore patch or sync-report. */
    gpsPointSource?: "homeowner_corrected" | "lead_stored";
    gps?: {
      lat?: number;
      lng?: number;
      deadline: number;
      required: boolean;
      /** Tap instant. The fix window is [tappedAt−30s, tappedAt+15s], not save time. */
      tappedAt?: number;
      source?: "homeowner_corrected" | "lead_stored";
      homeownerId?: string;
      /** Device-only. Owned leads flag out_of_area instead of blocking. Never sent to Firestore. */
      areaOwned?: boolean;
    };
  };
  id: string;
  userId: string;
  leadId: string;
  createdAt: string;
  /**
   * Device queue only. Monotonic per account, assigned when the draft is queued.
   * Same-millisecond saves sort by this, not by the random id. Absent on drafts
   * queued before this build; those still sort by createdAt. Never sent.
   */
  queueSeq?: number;
  kind: "knock" | "notes" | "handoff" | "contact";
  baseStatus: string;
  baseNotes?: string;
  /**
   * Device queue only. Set when this build queues an explicit notes clear,
   * and sent as clearNotes:true with notes:"" and baseNotes. Never inferred
   * from notes:"" plus a base. Never copied onto a Firestore patch. Never
   * removed once set. Route reference: main 15efe05.
   */
  clearNotes?: boolean;
  /**
   * Device queue only. Defense in depth if a notes draft is ever written
   * directly. The route dedupes by draftId and is the notes path. Never sent.
   * Never copied onto the lead.
   */
  appliedNotes?: string;
  appliedAgainst?: string;
  status?: string;
  disposition?: string;
  notes?: string;
  observation?: FieldObservation;
  objectionType?: string;
  objectionNotes?: string;
  goBackScheduledDate?: string;
  goBackScheduledTime?: string;
  goBackNotes?: string;
  handoff?: FieldHandoff["state"];
  callbackAt?: string;
};
export type SyncState = "queued" | "gps" | "retry" | "parked";
export type ParkedReason = SyncReasonCode;
export type PendingMutation = FieldMutation & {
  /** Legacy flag. Readable only while migrating a draft from 14.17 or earlier. */
  error?: string;
  /** Legacy flag. Readable only while migrating a draft from 14.17 or earlier. */
  blocked?: boolean;
  syncState?: SyncState;
  attempts?: number;
  nextAttemptAt?: number;
  parkedReason?: ParkedReason;
  lastError?: string;
  /** Set when /api/field/dispo is not deployed. The draft stays queued for a slow retry. */
  routeHold?: "field-dispo";
};
export type FieldEvent = {
  id: string;
  leadId: string;
  repId: string;
  at: Date;
  street: string;
  territoryId: string;
  statusId: string;
  knock: boolean;
  answered?: boolean;
  engaged?: boolean;
  openerId?: string;
  previewShown?: boolean;
  proofShown?: boolean;
  localHour: number;
  localDay: number;
  group: "pilot" | "control" | "legacy";
  experiment: string;
};
export type LeadWithField = Lead & {
  fieldDoor?: FieldDoorData;
  fieldHandoff?: FieldHandoff;
  fieldRecovery?: {
    requestedAt: string;
    phone: string;
    consentVersion: string;
    callbackRequested: boolean;
  };
};
