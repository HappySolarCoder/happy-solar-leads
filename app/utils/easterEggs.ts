// Easter Egg Firestore Utilities

import { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  setDoc, 
  updateDoc, 
  deleteDoc,
  deleteField,
  query,
  where,
  Timestamp,
  arrayUnion
} from 'firebase/firestore';
import { db } from './firebase';
import { EasterEgg, EasterEggWinner } from '@/app/types/easterEgg';
import { getLeadsAsync, updateLeadAsync } from './storage';

// Haversine formula to calculate distance between two points in miles
function getDistanceFromLatLonInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of Earth in miles
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Get all easter eggs
export async function getEasterEggsAsync(): Promise<EasterEgg[]> {
  if (!db) return [];
  
  const querySnapshot = await getDocs(collection(db, 'easterEggs'));
  const eggs: EasterEgg[] = [];
  
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    eggs.push({
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      wonBy: data.wonBy?.map((w: any) => ({
        ...w,
        wonAt: w.wonAt?.toDate() || new Date()
      })) || []
    } as EasterEgg);
  });
  
  return eggs;
}

// Get active easter eggs only
export async function getActiveEasterEggsAsync(): Promise<EasterEgg[]> {
  const allEggs = await getEasterEggsAsync();
  return allEggs.filter(egg => egg.active);
}

// Create easter egg
export async function createEasterEggAsync(egg: Omit<EasterEgg, 'id' | 'createdAt'>): Promise<string> {
  if (!db) throw new Error('Firebase not initialized');
  
  const eggsRef = collection(db, 'easterEggs');
  const newEggRef = doc(eggsRef);
  
  const eggData = {
    ...egg,
    createdAt: Timestamp.now(),
    currentWinners: 0,
    wonBy: []
  };
  
  await setDoc(newEggRef, eggData);
  
  // If hidden pin with random placement, assign to random lead
  if (egg.type === 'hidden' && egg.placement === 'random') {
    try {
      await assignHiddenEggToRandomLead(newEggRef.id, egg.territoryFilter, egg.zipCode);
    } catch (error) {
      console.warn('Could not assign hidden egg to random lead:', error);
      // Egg is still created, just without a random lead assignment
    }
  }
  
  return newEggRef.id;
}

// Update easter egg
export async function updateEasterEggAsync(id: string, updates: Partial<EasterEgg>): Promise<void> {
  if (!db) throw new Error('Firebase not initialized');
  
  const eggRef = doc(db, 'easterEggs', id);
  await updateDoc(eggRef, updates as any);
}

// Delete easter egg
export async function deleteEasterEggAsync(id: string): Promise<void> {
  if (!db) throw new Error('Firebase not initialized');
  
  // Remove from any leads using direct Firestore call
  const leads = await getLeadsAsync();
  const affectedLeads = leads.filter(l => l.easterEggId === id);
  
  for (const lead of affectedLeads) {
    const leadRef = doc(db, 'leads', lead.id);
    await updateDoc(leadRef, {
      hasEasterEgg: false,
      easterEggId: deleteField()
    });
  }
  
  // Delete egg
  const eggRef = doc(db, 'easterEggs', id);
  await deleteDoc(eggRef);
}

// Assign hidden egg to random lead
async function assignHiddenEggToRandomLead(eggId: string, territoryFilter?: string, zipCode?: string): Promise<void> {
  let leads = await getLeadsAsync();
  
  // Filter to unclaimed leads with location
  let eligibleLeads = leads.filter(l => 
    l.status === 'unclaimed' && 
    !l.hasEasterEgg &&
    l.lat && l.lng
  );
  
  // If zip code provided, geocode it and find leads within 15 miles (24 km)
  let zipCodeUsed = false;
  if (zipCode) {
    try {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (apiKey) {
        // Geocode the zip code
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zipCode)}&key=${apiKey}`;
        const geoResponse = await fetch(geoUrl);
        const geoData = await geoResponse.json();
        
        if (geoData.results && geoData.results[0]?.geometry?.location) {
          const zipLat = geoData.results[0].geometry.location.lat;
          const zipLng = geoData.results[0].geometry.location.lng;
          
          console.log('[EasterEgg] Zip code geocoded:', { zipCode, zipLat, zipLng });
          
          // Filter leads within 15 miles using Haversine formula
          const leadsWithinRadius = eligibleLeads.filter(l => {
            if (!l.lat || !l.lng) return false;
            const distance = getDistanceFromLatLonInMiles(zipLat, zipLng, l.lat, l.lng);
            return distance <= 15;
          });
          
          console.log('[EasterEgg] Leads within 15 miles of zip:', leadsWithinRadius.length);
          
          if (leadsWithinRadius.length > 0) {
            eligibleLeads = leadsWithinRadius;
            zipCodeUsed = true;
          } else {
            // No leads within 15 miles - throw error instead of falling back
            throw new Error(`No eligible leads found within 15 miles of zip code ${zipCode}`);
          }
        }
      }
    } catch (error) {
      // If zip code was specified, don't fall back - throw error
      console.warn('[EasterEgg] Could not geocode zip code or no leads found:', error);
      throw new Error(`No eligible leads found within 15 miles of zip code ${zipCode}. Please try a different zip code.`);
    }
  }
  
  // Apply territory filter if specified
  if (territoryFilter) {
    eligibleLeads = eligibleLeads.filter(l => {
      // Simple contains check
      const address = `${l.address} ${l.city}`.toLowerCase();
      return address.includes(territoryFilter.toLowerCase());
    });
  }
  
  if (eligibleLeads.length === 0) {
    throw new Error('No eligible leads found for hidden egg placement');
  }
  
  // Pick random lead
  const randomLead = eligibleLeads[Math.floor(Math.random() * eligibleLeads.length)];
  
  // Mark lead with egg
  await updateLeadAsync(randomLead.id, {
    hasEasterEgg: true,
    easterEggId: eggId
  });
  
  // Update egg with lead ID
  await updateEasterEggAsync(eggId, {
    leadId: randomLead.id
  });
}

// Assign hidden egg to specific lead (manual placement)
export async function assignHiddenEggToLeadAsync(eggId: string, leadId: string): Promise<void> {
  // Mark lead with egg
  await updateLeadAsync(leadId, {
    hasEasterEgg: true,
    easterEggId: eggId
  });
  
  // Update egg with lead ID
  await updateEasterEggAsync(eggId, {
    leadId: leadId
  });
}

// Rehide an existing hidden egg to a new random location
export async function rehideEasterEggAsync(eggId: string): Promise<void> {
  if (!db) throw new Error('Firebase not initialized');
  
  const eggDoc = await getDoc(doc(db, 'easterEggs', eggId));
  
  if (!eggDoc.exists()) {
    throw new Error('Easter egg not found');
  }
  
  const egg = eggDoc.data() as EasterEgg;
  
  // Remove egg from current lead if any
  if (egg.leadId) {
    // Use direct Firestore call to properly remove the field
    const leadRef = doc(db!, 'leads', egg.leadId);
    await updateDoc(leadRef, {
      hasEasterEgg: false,
      easterEggId: deleteField()
    });
  }
  
  // Assign to new random lead
  await assignHiddenEggToRandomLead(eggId, egg.territoryFilter, egg.zipCode);
}

// Check if disposition triggers an easter egg
export async function checkEasterEggTrigger(
  leadId: string,
  userId: string,
  userName: string,
  leadAddress: string
): Promise<EasterEgg | null> {
  const activeEggs = await getActiveEasterEggsAsync();
  const lead = (await getLeadsAsync()).find(l => l.id === leadId);
  
  if (!lead) return null;
  
  // Check HIDDEN PIN eggs first
  if (lead.hasEasterEgg && lead.easterEggId) {
    const hiddenEgg = activeEggs.find(e => e.id === lead.easterEggId);
    if (hiddenEgg) {
      // Winner!
      await recordEasterEggWin(hiddenEgg.id, userId, userName, leadAddress);
      return hiddenEgg;
    }
  }
  
  // Check ODDS-BASED eggs
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
  const currentDay = now.getDay(); // 0-6 (Sunday-Saturday)
  
  for (const egg of activeEggs.filter(e => e.type === 'odds')) {
    // Check if max winners reached
    if (egg.maxWinners && egg.currentWinners && egg.currentWinners >= egg.maxWinners) {
      continue;
    }
    
    // Check time rules
    if (egg.timeStart && currentTime < egg.timeStart) continue;
    if (egg.timeEnd && currentTime > egg.timeEnd) continue;
    
    // Check day rules
    if (egg.daysOfWeek && !egg.daysOfWeek.includes(currentDay)) continue;
    
    // Check territory rules
    if (egg.territory && lead.assignedTo) {
      // Simple check - can be enhanced with user territory lookup
      // For now, skip territory check
    }
    
    // Roll the dice!
    const roll = Math.random();
    const chance = 1 / (egg.odds || 50); // Default 1 in 50
    
    if (roll <= chance) {
      // Winner!
      await recordEasterEggWin(egg.id, userId, userName, leadAddress);
      return egg;
    }
  }
  
  return null;
}

// Record a win
async function recordEasterEggWin(
  eggId: string,
  userId: string,
  userName: string,
  leadAddress: string
): Promise<void> {
  if (!db) return;
  
  const winner: EasterEggWinner = {
    userId,
    userName,
    wonAt: new Date(),
    leadAddress
  };
  
  const eggRef = doc(db, 'easterEggs', eggId);
  const eggSnap = await getDoc(eggRef);
  const eggData = eggSnap.data();
  
  // Update egg
  await updateDoc(eggRef, {
    wonBy: arrayUnion({
      ...winner,
      wonAt: Timestamp.now()
    }),
    currentWinners: (eggData?.currentWinners || 0) + 1,
    // If hidden pin, deactivate after win
    ...(eggData?.type === 'hidden' ? { active: false } : {})
  });
  
  // If hidden pin, remove from lead
  if (eggData?.type === 'hidden' && eggData?.leadId) {
    await updateLeadAsync(eggData.leadId, {
      hasEasterEgg: false,
      easterEggId: undefined
    });
  }
}

// Get leaderboard
export async function getEasterEggLeaderboardAsync(timeframe: 'week' | 'month' | 'alltime' = 'week'): Promise<Array<{
  userId: string;
  userName: string;
  eggCount: number;
  totalValue: string;
  recentWins: EasterEggWinner[];
}>> {
  const eggs = await getEasterEggsAsync();
  const userStats = new Map<string, {
    userId: string;
    userName: string;
    eggCount: number;
    prizes: string[];
    recentWins: EasterEggWinner[];
  }>();
  
  // Filter winners by timeframe
  const now = new Date();
  const cutoff = new Date();
  if (timeframe === 'week') {
    cutoff.setDate(now.getDate() - 7);
  } else if (timeframe === 'month') {
    cutoff.setMonth(now.getMonth() - 1);
  } else {
    cutoff.setFullYear(2000); // All time
  }
  
  eggs.forEach(egg => {
    egg.wonBy?.forEach(winner => {
      if (winner.wonAt >= cutoff) {
        const existing = userStats.get(winner.userId);
        if (existing) {
          existing.eggCount++;
          existing.prizes.push(egg.prizeValue);
          existing.recentWins.push(winner);
        } else {
          userStats.set(winner.userId, {
            userId: winner.userId,
            userName: winner.userName,
            eggCount: 1,
            prizes: [egg.prizeValue],
            recentWins: [winner]
          });
        }
      }
    });
  });
  
  // Convert to array and sort by egg count
  return Array.from(userStats.values())
    .sort((a, b) => b.eggCount - a.eggCount)
    .map(stat => ({
      userId: stat.userId,
      userName: stat.userName,
      eggCount: stat.eggCount,
      totalValue: stat.prizes.join(', '),
      recentWins: stat.recentWins.sort((a, b) => b.wonAt.getTime() - a.wonAt.getTime()).slice(0, 3)
    }));
}
