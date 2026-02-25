// Territory Types

export interface TerritoryPoint {
  lat: number;
  lng: number;
}

export interface Territory {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  polygon: TerritoryPoint[]; // Array of lat/lng coordinates as objects (Firestore compatible)
  leadIds: string[]; // Leads within this territory
  createdAt: Date;
  createdBy: string; // User ID who created the territory
}
