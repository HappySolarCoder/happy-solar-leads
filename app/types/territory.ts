// Territory Types

export interface Territory {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  polygon: [number, number][]; // Array of lat/lng coordinates
  leadIds: string[]; // Leads within this territory
  createdAt: Date;
  createdBy: string; // User ID who created the territory
}
