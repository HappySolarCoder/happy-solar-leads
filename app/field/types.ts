import type { Lead } from "@/app/types";
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
  id: string;
  userId: string;
  leadId: string;
  createdAt: string;
  kind: "knock" | "notes" | "handoff";
  baseStatus: string;
  baseNotes?: string;
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
export type PendingMutation = FieldMutation & {
  error?: string;
  blocked?: boolean;
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
