// Team management utilities
// This is separate from Territory - Team is for user organization (e.g., Rochester, Buffalo)

export interface Team {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

// Default teams
export const DEFAULT_TEAMS: Team[] = [
  { id: 'rochester', name: 'Rochester', createdAt: new Date(), updatedAt: new Date() },
  { id: 'buffalo', name: 'Buffalo', createdAt: new Date(), updatedAt: new Date() },
];

// Get teams from localStorage
export function getTeams(): Team[] {
  if (typeof window === 'undefined') return DEFAULT_TEAMS;
  
  const stored = localStorage.getItem('raydar_teams');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return DEFAULT_TEAMS;
    }
  }
  return DEFAULT_TEAMS;
}

// Save teams to localStorage
export function saveTeams(teams: Team[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('raydar_teams', JSON.stringify(teams));
}

// Add a new team
export function addTeam(name: string): Team {
  const teams = getTeams();
  const newTeam: Team = {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  teams.push(newTeam);
  saveTeams(teams);
  return newTeam;
}

// Update a team
export function updateTeam(id: string, name: string): Team | null {
  const teams = getTeams();
  const index = teams.findIndex(t => t.id === id);
  if (index >= 0) {
    teams[index] = { ...teams[index], name, updatedAt: new Date() };
    saveTeams(teams);
    return teams[index];
  }
  return null;
}

// Delete a team
export function deleteTeam(id: string): boolean {
  const teams = getTeams();
  const filtered = teams.filter(t => t.id !== id);
  if (filtered.length < teams.length) {
    saveTeams(filtered);
    return true;
  }
  return false;
}
