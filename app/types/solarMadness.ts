export type SolarMadnessPrizeType = 'points' | 'cash' | 'swag';

export interface SolarMadnessPrize {
  id: string;
  enabled: boolean;
  type: SolarMadnessPrizeType;
  label: string;
  weight: number;
  pointsValue?: number;
  cashValue?: number;
  swagValue?: string;
}

export interface SolarMadnessConfig {
  enabled: boolean;
  seasonName: string;
  startsAt: any; // Firestore Timestamp
  endsAt: any;   // Firestore Timestamp
  baseOddsRegular: number;      // 0..1
  baseOddsAppointment: number;  // 0..1
  appointmentDispositionIds?: string[]; // preferred appointment detection
  regularPrizes: SolarMadnessPrize[];
  appointmentPrizes: SolarMadnessPrize[];
}

export type SolarMadnessTriggerType = 'regular' | 'appointment';

export interface SolarMadnessEvent {
  id: string;
  uid: string;
  userName: string;
  leadId: string;
  dispositionId?: string;
  dispositionName?: string;
  triggerType: SolarMadnessTriggerType;
  oddsUsed: number;
  prize: SolarMadnessPrize;
  pointsAwarded: number;
  createdAt: any; // Firestore Timestamp
}

export interface SolarMadnessAwardResponse {
  awarded: boolean;
  reason?: string;
  seasonName?: string;
  triggerType?: SolarMadnessTriggerType;
  oddsUsed?: number;
  prize?: SolarMadnessPrize;
  pointsAwarded?: number;
  totalPoints?: number;
  eventId?: string;
}
