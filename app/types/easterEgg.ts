// Easter Egg Types

export type EasterEggType = 'odds' | 'hidden';

export interface EasterEgg {
  id: string;
  type: EasterEggType;
  prizeName: string;
  prizeValue: string;
  prizeDescription?: string;
  
  // ODDS-BASED FIELDS
  odds?: number;              // 1 in N chance (e.g., 50 means 1 in 50)
  timeStart?: string;         // "18:00" (24-hour format)
  timeEnd?: string;           // "23:59"
  daysOfWeek?: number[];      // [0,6] = Sunday, Saturday (0-6)
  territory?: string;         // Territory name filter
  maxWinners?: number;        // Max total winners (unlimited if not set)
  currentWinners?: number;    // How many have won so far
  
  // HIDDEN PIN FIELDS
  leadId?: string;            // Specific lead ID that has the egg
  placement?: 'random' | 'manual';
  territoryFilter?: string;   // Where to randomly place it
  zipCode?: string;           // Zip code for proximity-based placement
  
  // COMMON FIELDS
  active: boolean;
  createdAt: Date;
  createdBy: string;          // Admin user ID
  wonBy?: EasterEggWinner[];  // Array of winners
}

export interface EasterEggWinner {
  userId: string;
  userName: string;
  wonAt: Date;
  leadAddress?: string;
}

// Extended Lead type with easter egg fields
export interface LeadWithEasterEgg {
  hasEasterEgg?: boolean;     // HIDDEN - only for hidden pins
  easterEggId?: string;       // Which egg ID
}
