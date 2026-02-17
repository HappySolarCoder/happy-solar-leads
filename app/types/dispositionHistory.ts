// Disposition History Tracking
// Tracks every disposition change for analytics and auditing

export interface DispositionHistoryEntry {
  id: string;
  leadId: string;
  leadAddress: string; // Denormalized for easy reporting
  
  // Disposition change
  previousDisposition?: string;
  newDisposition: string;
  
  // User who made the change
  userId: string;
  userName: string; // Denormalized
  userRole: string; // Denormalized
  
  // GPS tracking (for knock verification)
  knockGpsLat?: number;
  knockGpsLng?: number;
  knockGpsAccuracy?: number;
  knockDistanceFromAddress?: number;
  
  // Objection data (if applicable)
  objectionType?: string;
  objectionNotes?: string;
  
  // Timestamp
  createdAt: Date;
  
  // Optional metadata
  notes?: string;
  source?: 'manual' | 'auto-assignment' | 'claim' | 'admin-action';
}

// Query helpers
export interface DispositionHistoryFilters {
  leadId?: string;
  userId?: string;
  disposition?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}
