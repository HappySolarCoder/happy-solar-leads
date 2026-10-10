'use client';

import { HomeownerDetail } from '@/app/homeowners/Details';
import type { Homeowner } from '@/app/homeowners/model';
import { useDeviceValue } from '../_components/useDeviceValue';

import { FieldToolbar, MobileNav, MobileNotice, MobileLoading } from '../_components/MobileShell';
import DoorCoach from '../_components/DoorCoach';
import ReturnVisitReminder from '../_components/ReturnVisitReminder';
import FieldCompass from '../_components/FieldCompass';
import { summarizeActivity } from '../_lib/metrics';
import { countWorkdaysElapsedAndRemaining } from '@/app/utils/goals';
import { fieldPinArtwork } from '@/app/utils/fieldPin';
import MobileDialog from '../_components/MobileDialog';
import { useMobileData } from '../_components/useMobileData';
import { AppointmentOutcomeBadge } from '@/app/components/AppointmentOutcomeBadge';
import { appointmentOutcomeLegend, getAppointmentOutcome } from '@/app/utils/appointmentOutcome';
import { apiFetch } from '@/app/utils/apiFetch';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, List, Navigation, Filter, MapPin, Settings, Search, X, Route, Clock, Footprints, Car } from 'lucide-react';
import { getUsersAsync } from '@/app/utils/storage';
import { Lead, User, canSeeAllLeads, canAssignLeads } from '@/app/types';
const LeadDetail = dynamic(() => import('@/app/components/LeadDetail'), { ssr: false });
import { useGeolocation, calculateDistance, formatDistance } from '@/app/hooks/useGeolocation';
import { ensureUserColors } from '@/app/utils/userColors';
import LocationPermissionGuard from '@/app/components/LocationPermissionGuard';
import { useTeamAreasOverlay } from '@/app/hooks/useTeamAreasOverlay';
import { useHistoricalTerritoryPins } from '@/app/hooks/useHistoricalTerritoryPins';
import { mergeHistoricalTerritoryPins } from '@/app/utils/historicalTerritoryPins';
import { colorTerritories, membersFromTerritories } from '@/app/utils/teamAreas';

// Dynamic import for map (client-side only)
const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#F7FAFC]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#476E88] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-[#718096]">Loading map...</p>
      </div>
    </div>
  ),
});

const EMPTY_LEADS: Lead[] = [];

export default function KnockingPage() {
  const router = useRouter();

  const { user: currentUser, live, leads, dispositions, loading: isLoading, leadsLoading: isRefreshing, dataLoading, dataUnavailable, error: sessionError } = useMobileData();
  const [selectedHomeowner, setSelectedHomeowner] = useState<Homeowner | undefined>();
  const [homePreference, setHomePreference] = useDeviceValue(`raydar-homeowners:${currentUser?.id || ""}`, "localStorage");
  const showHomeowners = homePreference !== "off";
  const [outcomesOnly, setOutcomesOnly] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [viewMode] = useState<'map' | 'list'>('map');
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(undefined);
  const [hasInitializedMap, setHasInitializedMap] = useState(false);
  const [mapZoom, setMapZoom] = useState(15);
  const [solarFilter, setSolarFilter] = useState<string[]>([]);
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  const [setterFilter, setSetterFilter] = useState<string>('all');
  const [freshPinsOnly, setFreshPinsOnly] = useState<boolean>(false);
  const [leadTypeFilter, setLeadTypeFilter] = useState<'all' | 'prospects' | 'customers'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [addressSearch, setAddressSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchLocation, setSearchLocation] = useState<{ lat: number; lng: number } | null>(null);
  const searchSequence = useRef(0);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showSearchSheet, setShowSearchSheet] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [showTeamAreas, setShowTeamAreas] = useState(false);
  
  // Route optimization state
  const [showRoute, setShowRoute] = useState(false);
  const [routeLeads, setRouteLeads] = useState<Lead[]>([]);
  const [routeStartPoint, setRouteStartPoint] = useState<[number, number] | null>(null);
  
  // Weather state
  const [weather, setWeather] = useState<{ temperature: number; condition: string; icon: string; recommendation: string; hourly?: any[] } | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [showWeatherPopup, setShowWeatherPopup] = useState(false);

  // GPS tracking - continuous updates
  const { position: gpsPosition, error: gpsError, isLoading: gpsLoading } = useGeolocation({
    enableHighAccuracy: true,
    watch: true, // Continuous tracking
  });
  const { territories: overlayTerritories, members: overlayMembers } = useTeamAreasOverlay(showTeamAreas);
  const historicalPins = useHistoricalTerritoryPins(currentUser?.id);
  const coloredUsers = useMemo(() => ensureUserColors(users), [users]);
  const teamAreaTerritories = useMemo(
    () => (showTeamAreas ? colorTerritories(overlayTerritories, coloredUsers) : []),
    [showTeamAreas, overlayTerritories, coloredUsers]
  );
  const teamMembersForMap = useMemo(() => {
    if (!showTeamAreas) return [];
    if (overlayMembers.length > 0) {
      return overlayMembers.map((member) => ({
        ...member,
        color: coloredUsers.find((user) => user.id === member.id)?.color || member.color,
      }));
    }
    return membersFromTerritories(overlayTerritories, coloredUsers);
  }, [showTeamAreas, overlayTerritories, overlayMembers, coloredUsers]);

  // Set map center based on user role
  useEffect(() => {
    if (!currentUser || hasInitializedMap) return;
    
    // Admins: center on Rochester for full market oversight
    if (currentUser.role === 'admin') {
      setMapCenter([43.1566, -77.6088]); // Rochester, NY
      setHasInitializedMap(true);
    }
    // Everyone else (managers, setters, closers): center on GPS location
    else if (gpsPosition) {
      setMapCenter([gpsPosition.lat, gpsPosition.lng]);
      setHasInitializedMap(true);
    }
  }, [gpsPosition, currentUser, hasInitializedMap]);

  // Fetch weather when GPS position is available
  useEffect(() => {
    if (!gpsPosition) return;
    const lat = gpsPosition.lat;
    const lng = gpsPosition.lng;
    if (!lat || !lng) return;
    
    async function fetchWeather() {
      setWeatherLoading(true);
      try {
        const response = await apiFetch(`/api/weather?lat=${lat}&lng=${lng}`);
        const data = await response.json();
        if (data.temperature !== undefined) {
          setWeather({
            temperature: data.temperature,
            condition: data.condition,
            icon: data.icon,
            recommendation: data.recommendation,
            hourly: data.hourly || [],
          });
        }
      } catch (error) {
        console.error('Weather fetch error:', error);
      } finally {
        setWeatherLoading(false);
      }
    }
    
    fetchWeather();
    // Refresh weather every 30 minutes
    const interval = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [gpsPosition ? Math.round(gpsPosition.lat * 100) : null, gpsPosition ? Math.round(gpsPosition.lng * 100) : null]);

  // Only managers need the directory. Ignore responses after an account change.
  useEffect(() => {
    let active = true;
    if (currentUser && canSeeAllLeads(currentUser.role)) {
      void getUsersAsync().then((items) => { if (active) setUsers(items); }).catch(() => {});
    }
    return () => { active = false; };
  }, [currentUser]);

  // Successful writes arrive on the existing listener without refetching every lead.
  const refreshLeads = useCallback(async () => setWriteError(null), []);
  const handleLeadSelect = useCallback((lead: Lead, homeowner?: Homeowner) => {
    setSelectedHomeowner(homeowner);
    setSelectedLeadId(lead.id);
    setShowLeadDetail(true);
  }, []);

  // Handle address search
  const handleAddressSearch = async (query: string) => {
    setAddressSearch(query);
    const sequence = ++searchSequence.current;
    setSearchResults([]);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if (query.length < 3) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/geocode?address=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (sequence !== searchSequence.current) return;
        
        if (data.results && data.results.length > 0) {
          setSearchResults(data.results.slice(0, 5));
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        if (sequence !== searchSequence.current) return;
        console.error('Address search error:', error);
        setSearchResults([]);
      } finally {
        if (sequence === searchSequence.current) setIsSearching(false);
      }
    }, 300);
  };

  // Handle selecting an address result
  const handleSelectAddress = (result: any) => {
    const location = result.geometry?.location;
    if (location) {
      const lat = location.lat || location.latitude;
      const lng = location.lng || location.longitude;
      setMapCenter([lat, lng]);
      setMapZoom(16); // Moderate zoom - user can zoom in more themselves
      setSearchLocation({ lat, lng }); // Place search marker
    }
    setAddressSearch('');
    setSearchResults([]);
  };

  // Calculate optimized route using nearest neighbor algorithm
  const calculateOptimizedRoute = useCallback((leadsToRoute: Lead[], startPoint?: [number, number]) => {
    if (leadsToRoute.length === 0) return [];
    
    // Filter leads that have valid coordinates
    const validLeads = leadsToRoute.filter(lead => lead.lat !== undefined && lead.lng !== undefined);
    if (validLeads.length === 0) return [];
    
    const unvisited = [...validLeads];
    const route: Lead[] = [];
    const firstLead = validLeads[0];
    let currentPoint = startPoint || (gpsPosition ? [gpsPosition.lat, gpsPosition.lng] : (firstLead.lat !== undefined && firstLead.lng !== undefined ? [firstLead.lat, firstLead.lng] : [43.1566, -77.6088]));
    
    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      
      unvisited.forEach((lead, index) => {
        const lat = lead.lat!;
        const lng = lead.lng!;
        const distance = calculateDistance(currentPoint[0], currentPoint[1], lat, lng);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      
      const nearest = unvisited.splice(nearestIndex, 1)[0];
      route.push(nearest);
      if (nearest.lat && nearest.lng) {
        currentPoint = [nearest.lat, nearest.lng];
      }
    }
    
    return route;
  }, [gpsPosition]);

  // Calculate total route distance
  const routeDistance = useMemo(() => {
    if (routeLeads.length === 0) return 0;
    let total = 0;
    let prevPoint = routeStartPoint || (routeLeads[0].lat !== undefined && routeLeads[0].lng !== undefined ? [routeLeads[0].lat, routeLeads[0].lng] : [0, 0]);
    
    routeLeads.forEach(lead => {
      if (lead.lat !== undefined && lead.lng !== undefined) {
        total += calculateDistance(prevPoint[0], prevPoint[1], lead.lat, lead.lng);
        prevPoint = [lead.lat, lead.lng];
      }
    });
    return total;
  }, [routeLeads, routeStartPoint]);

  // Estimate walking time (average 3 mph = 0.05 miles per minute)
  const walkingTimeMinutes = Math.round(routeDistance / 0.05);
  // Estimate driving time (average 25 mph in city = 0.42 miles per minute)
  const drivingTimeMinutes = Math.round(routeDistance / 0.42);

  // Role-based visibility: setters/closers only see their claimed OR territory-assigned leads
  const roleFilteredLeads = useMemo(() => currentUser
    ? (currentUser.role === 'setter' || currentUser.role === 'closer')
      ? leads.filter(l => l.claimedBy === currentUser.id || l.assignedTo === currentUser.id)
      : leads
    : EMPTY_LEADS, [leads, currentUser]);

  // Generate route when button is clicked
  const handleGenerateRoute = useCallback(() => {
    // Get unknocked leads for the current user
    const unknockedLeads = roleFilteredLeads.filter(lead => 
      !lead.disposition || lead.status === 'assigned'
    );
    
    // Set start point to GPS or first lead
    const startPoint: [number, number] | undefined = gpsPosition ? [gpsPosition.lat, gpsPosition.lng] : undefined;
    setRouteStartPoint(startPoint || null);
    
    // Calculate optimized route
    const optimized = calculateOptimizedRoute(unknockedLeads, startPoint);
    setRouteLeads(optimized);
    setShowRoute(true);
  }, [roleFilteredLeads, gpsPosition, calculateOptimizedRoute]);

  const isCustomerLead = useCallback((l: Lead) => {
    return l.leadType === 'customer' || l.leadType === 'sale' || l.status === 'customer';
  }, []);

  // Lead type filter (mobile): All / Prospects / Customers
  // Guardrail: this applies AFTER role/permission filtering (roleFilteredLeads)
  const leadTypeFilteredLeads = useMemo(() => {
    if (leadTypeFilter === 'customers') return roleFilteredLeads.filter(isCustomerLead);
    if (leadTypeFilter === 'prospects') return roleFilteredLeads.filter(l => !isCustomerLead(l));
    return roleFilteredLeads;
  }, [roleFilteredLeads, leadTypeFilter, isCustomerLead]);

  const filteredLeads = useMemo(() => {
  // Prospects baseline (exclude poor solar leads). Customers are unaffected by solar filters.
  let prospects = leadTypeFilteredLeads.filter(l => !isCustomerLead(l) && (l.solarCategory !== 'poor' || !!getAppointmentOutcome(l)));
  let customers = leadTypeFilteredLeads.filter(isCustomerLead);

  // Filter by setter if selected (Admin/Manager only) — prospects only
  if (setterFilter !== 'all') {
    prospects = prospects.filter(l => l.claimedBy === setterFilter);
  }

  // Filter by solar category if selected — prospects only
  if (solarFilter.length > 0) {
    prospects = prospects.filter(l => solarFilter.includes(l.solarCategory || ''));
  }

  // Filter by disposition if selected — apply to both prospects and customers
  if (dispositionFilter !== 'all') {
    const normalize = (v: unknown) => String(v || '').trim().toLowerCase();
    const dispositionsById = new Map(dispositions.map((d: any) => [String(d.id), d]));
    const selectedId = String(dispositionFilter);
    const selectedName = normalize(dispositionsById.get(selectedId)?.name);

    const matchesDisposition = (l: Lead) => {
      const statusNorm = normalize(l.status).replace(/\s+/g, '-');
      const selectedNorm = normalize(selectedId).replace(/\s+/g, '-');
      const latestHistoryName = normalize(l.dispositionHistory?.[0]?.disposition);
      const byId = statusNorm === selectedNorm;
      const byLegacyName = selectedName && normalize(l.disposition) === selectedName;
      const byHistoryName = selectedName && latestHistoryName === selectedName;

      return Boolean(byId || byLegacyName || byHistoryName);
    };

    prospects = prospects.filter(matchesDisposition);
    customers = customers.filter(matchesDisposition);
  }

  // Fresh Pins: only show leads NOT dispositioned in the last 30 days — prospects only
  if (freshPinsOnly) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    prospects = prospects.filter(l => {
      const dt = l.dispositionedAt ? new Date(l.dispositionedAt).getTime() : null;
      return !dt || dt < cutoff;
    });
  }

  const typeFilteredLeads = leadTypeFilter === 'customers'
    ? customers
    : leadTypeFilter === 'prospects'
      ? prospects
      : [...customers, ...prospects];

  return outcomesOnly ? typeFilteredLeads.filter(l => getAppointmentOutcome(l)) : typeFilteredLeads;

  }, [leadTypeFilteredLeads, isCustomerLead, setterFilter, solarFilter, dispositionFilter, dispositions, freshPinsOnly, leadTypeFilter, outcomesOnly]);

  // Calculate distances and sort by nearest if GPS available
  const leadsWithDistance = useMemo(() => {
    // Distances are needed by the list and the tools sheet, never to draw the map.
    if (viewMode !== 'list' && !showFilters) return [];
    return filteredLeads.map(lead => ({
      ...lead,
      distance: gpsPosition && lead.lat != null && lead.lng != null
        ? calculateDistance(gpsPosition.lat, gpsPosition.lng, lead.lat, lead.lng)
        : undefined,
    })).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [filteredLeads, viewMode, showFilters, gpsPosition?.lat, gpsPosition?.lng]);

  // Keep original lead objects stable: GPS movement must not recreate every pin.
  const mapLeads = useMemo(() => mergeHistoricalTerritoryPins(
    filteredLeads, outcomesOnly ? EMPTY_LEADS : historicalPins, currentUser?.id,
  ), [filteredLeads, outcomesOnly, historicalPins, currentUser?.id]);
  const userPosition = useMemo<[number, number] | undefined>(() => gpsPosition
    ? [gpsPosition.lat, gpsPosition.lng] : undefined, [gpsPosition?.lat, gpsPosition?.lng]);

  const homeownerLeads = useMemo(() => mergeHistoricalTerritoryPins(leads, historicalPins, currentUser?.id), [leads, historicalPins, currentUser?.id]);
  const handleHomeownerSelect = useCallback((homeowner: Homeowner) => { setSelectedLeadId(undefined); setSelectedHomeowner(homeowner); setShowLeadDetail(true); }, []);

  // Get selected lead
  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Helper: Calculate compass direction from user to lead
  function getDirection(userLat: number, userLng: number, leadLat: number, leadLng: number): string {
    const angle = Math.atan2(leadLng - userLng, leadLat - userLat) * 180 / Math.PI;
    const normalized = (angle + 360) % 360;
    
    if (normalized >= 337.5 || normalized < 22.5) return 'N';
    if (normalized >= 22.5 && normalized < 67.5) return 'NE';
    if (normalized >= 67.5 && normalized < 112.5) return 'E';
    if (normalized >= 112.5 && normalized < 157.5) return 'SE';
    if (normalized >= 157.5 && normalized < 202.5) return 'S';
    if (normalized >= 202.5 && normalized < 247.5) return 'SW';
    if (normalized >= 247.5 && normalized < 292.5) return 'W';
    return 'NW';
  }

  // Stats: Next Best Lead (nearest high-quality lead in current view)
  const prioritizedLeads = leadsWithDistance.filter(l => 
    l.solarCategory && 
    ['solid', 'good', 'great'].includes(l.solarCategory)
  );
  const nextBest = prioritizedLeads.length > 0 ? prioritizedLeads[0] : null;
  const nextBestDistanceRaw = nextBest?.distance;
  const nextBestDistance = nextBestDistanceRaw !== undefined 
    ? nextBestDistanceRaw < 0.1 
      ? `${Math.round(nextBestDistanceRaw * 5280)} ft`
      : nextBestDistanceRaw > 25 
        ? `${Math.round(nextBestDistanceRaw)} mi`
        : `${nextBestDistanceRaw.toFixed(1)} mi`
    : null;
  const nextBestDirection = nextBest && gpsPosition 
    ? getDirection(gpsPosition.lat, gpsPosition.lng, nextBest.lat!, nextBest.lng!)
    : null;
  const nextBestIsFar = (nextBestDistanceRaw || 0) > 50;

  // Heat Map v2 (micro-hotzones)
  const heatCells = useMemo(() => {
    if (!showHeat || !currentUser) return [] as { lat: number; lng: number; intensity: number; count: number }[];

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);

    // Evan: 2⭐+ only (good/great). Solid excluded.
    const isTwoStarPlus = (cat?: string) => {
      const c = String(cat || '').toLowerCase();
      return c === 'good' || c === 'great';
    };

    // Eligible leads (2⭐+ + fresh)
    const eligible = leads
      .filter((l: any) => l.lat && l.lng)
      .filter((l: any) => isTwoStarPlus(l.solarCategory))
      .filter((l: any) => !l.dispositionedAt || new Date(l.dispositionedAt) < cutoff);

    if (eligible.length === 0) return [];

    const cellSizeMiles = 0.2; // slightly smaller than before for more precise blocks
    const latStep = cellSizeMiles / 69;
    const lngStep = cellSizeMiles / 69;

    const cellMap = new Map<string, { latIdx: number; lngIdx: number; count: number }>();

    for (const l of eligible as any[]) {
      const lat = Number(l.lat);
      const lng = Number(l.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const latIdx = Math.floor(lat / latStep);
      const lngIdx = Math.floor(lng / lngStep);
      const key = `${latIdx}:${lngIdx}`;
      const entry = cellMap.get(key) || { latIdx, lngIdx, count: 0 };
      entry.count += 1;
      cellMap.set(key, entry);
    }

    // Hot zone rule: within 0.5 miles, >= 5 eligible (2⭐+, fresh)
    const RADIUS_MILES = 0.5;
    const radiusCells = Math.ceil(RADIUS_MILES / cellSizeMiles);
    const MIN_WITHIN = 5;

    const out: { lat: number; lng: number; intensity: number; count: number }[] = [];
    const cells = Array.from(cellMap.values());

    for (const c of cells) {
      const centerLat = (c.latIdx + 0.5) * latStep;
      const centerLng = (c.lngIdx + 0.5) * lngStep;

      let within = 0;
      for (let di = -radiusCells; di <= radiusCells; di++) {
        for (let dj = -radiusCells; dj <= radiusCells; dj++) {
          const key = `${c.latIdx + di}:${c.lngIdx + dj}`;
          const n = cellMap.get(key);
          if (!n) continue;
          const nLat = (n.latIdx + 0.5) * latStep;
          const nLng = (n.lngIdx + 0.5) * lngStep;
          const dist = calculateDistance(centerLat, centerLng, nLat, nLng);
          if (dist <= RADIUS_MILES) within += n.count;
        }
      }

      if (within < MIN_WITHIN) continue;

      // Score emphasizes density in walkable radius
      out.push({ lat: centerLat, lng: centerLng, intensity: within, count: within });
    }

    if (out.length === 0) return [];

    const max = Math.max(...out.map(o => o.intensity));
    const normalized = out
      .sort((a, b) => b.intensity - a.intensity)
      .map(o => ({ ...o, intensity: max ? o.intensity / max : 0 }));

    // Cap + enforce separation to avoid carpet
    const TOP_N = 15;
    const MIN_SEPARATION_MILES = 0.4;
    const picked: { lat: number; lng: number; intensity: number; count: number }[] = [];

    for (const c of normalized) {
      if (picked.length >= TOP_N) break;
      const tooClose = picked.some(p => calculateDistance(p.lat, p.lng, c.lat, c.lng) < MIN_SEPARATION_MILES);
      if (tooClose) continue;
      picked.push(c);
    }

    return picked;
  }, [showHeat, leads, currentUser]);

  // Stats: Today's Knocks (must match canonical rule from /setter-stats)
  // Only count dispositions where disposition.countsAsDoorKnock === true.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const doorKnockStatusIds = dispositions
    .filter((d: any) => d.countsAsDoorKnock)
    .map((d: any) => String(d.id).toLowerCase());

  const todaysKnocks = leads.filter(l => {
    if (!l.dispositionedAt || new Date(l.dispositionedAt) < todayStart) return false;

    // Count by actor (who actually dispositioned), fallback to claimedBy for legacy rows.
    const lastHistoryUserId = (l.dispositionHistory && l.dispositionHistory[0]?.userId) ? String(l.dispositionHistory[0].userId) : null;
    const actedByMe = (lastHistoryUserId || l.claimedBy || l.assignedTo) === currentUser?.id;
    if (!actedByMe) return false;

    const disp = String(l.status || l.disposition || '').toLowerCase();
    return doorKnockStatusIds.includes(disp);
  }).length;

  // Goals (v1) — deterministic goal read via API
  const [monthlyGoal, setMonthlyGoal] = useState<number | null>(null);
  const monthNow = new Date();
  const goalYear = monthNow.getFullYear();
  const goalMonth = monthNow.getMonth();
  const monthlyKnocks = useMemo(() => currentUser ? summarizeActivity(leads, currentUser.id, dispositions, new Date(goalYear, goalMonth, 1), new Date(goalYear, goalMonth+1, 1)).knocks : 0, [leads, currentUser, dispositions, goalYear, goalMonth]);
  const dailyTarget = monthlyGoal === null || !live ? null : Math.ceil(Math.max(0, monthlyGoal - monthlyKnocks) / Math.max(1, countWorkdaysElapsedAndRemaining(monthNow).remaining));

  useEffect(() => {
    async function loadGoalTarget() {
      if (!currentUser) return;
      try {
        const monthId = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const { getMyGoalViaApiAsync } = await import('@/app/utils/goals');
        const goal = await getMyGoalViaApiAsync(monthId);
        if (!goal?.doorKnocksGoal) {
          setMonthlyGoal(null);
          return;
        }
        setMonthlyGoal(Number(goal.doorKnocksGoal));
      } catch {
        setMonthlyGoal(null);
      }
    }
    loadGoalTarget();
  }, [currentUser]);

  if (isLoading) return <MobileLoading />;
  if (!currentUser) return <MobileNotice>{sessionError || 'Sign in to open the map.'}</MobileNotice>;

  return (
    <LocationPermissionGuard requireLocation={false}>
      <div className="rm-field-shell">
      {showGoalsModal && <MobileDialog title="Daily pace" onClose={() => setShowGoalsModal(false)}><div className="rm-coach-panel"><div className="rm-panel-heading"><h2>Daily pace</h2><button onClick={() => setShowGoalsModal(false)} aria-label="Close daily pace"><X size={22}/></button></div><p>{monthlyKnocks} of {monthlyGoal} monthly knocks completed.</p><h2>{dailyTarget ?? '—'} knocks per remaining workday</h2><p>Based on your company goal and the latest recorded disposition per door.</p></div></MobileDialog>}

      <header className={`relative flex-shrink-0 ${showSearchSheet ? 'z-[70]' : 'z-50'}`}>
        <FieldToolbar showTeamAreas={showTeamAreas} onToggleTeamAreas={() => setShowTeamAreas(v => !v)}
          onSearch={() => { setShowSearchSheet(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
          onFilter={() => setShowFilters(!showFilters)}
          filterCount={solarFilter.length + Number(dispositionFilter !== 'all') + Number(setterFilter !== 'all') + Number(freshPinsOnly) + Number(leadTypeFilter !== 'all') + Number(outcomesOnly)}
          accuracy={gpsPosition?.accuracy} gpsError={!!gpsError} gpsLoading={gpsLoading} knocks={dataLoading || dataUnavailable ? undefined : todaysKnocks}
          onLocate={() => { if (gpsPosition) { setMapCenter([gpsPosition.lat, gpsPosition.lng]); setMapZoom(17); } }} />
        {live?.error && <MobileNotice>{live.error}</MobileNotice>}
        {live?.cached && !live.error && <MobileNotice>Showing cached leads. Checking for latest outcomes.</MobileNotice>}
        {writeError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Save failed: {writeError}
          </div>
        )}

        {/* Search Sheet */}
        {showSearchSheet && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/30" onClick={() => setShowSearchSheet(false)} />
            <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[75vh] overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#2D3748]">Search address</div>
                <button
                  onClick={() => setShowSearchSheet(false)}
                  className="h-10 w-10 rounded-full hover:bg-gray-100 flex items-center justify-center"
                  title="Close"
                >
                  <X className="w-5 h-5 text-[#718096]" />
                </button>
              </div>
              <div className="p-4">
                <div className="h-11 rounded-full bg-gray-100 border border-gray-200 flex items-center gap-2 px-4">
                  <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search address..."
                    aria-label="Search address"
                    value={addressSearch}
                    onChange={(e) => handleAddressSearch(e.target.value)}
                    className="bg-transparent w-full text-sm text-gray-900 placeholder:text-gray-500 outline-none"
                  />
                  {addressSearch && (
                    <button
                      onClick={() => handleAddressSearch('')}
                      className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-gray-200"
                      title="Clear"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>
              </div>
              <div className="px-4 pb-4 overflow-y-auto max-h-[55vh]">
                {isSearching && (
                  <div className="p-3 text-sm text-gray-500 flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-[#476E88] border-t-transparent rounded-full animate-spin" />
                    Searching...
                  </div>
                )}
                {!isSearching && addressSearch.length >= 3 && searchResults.length === 0 && <p className="p-3 text-sm text-gray-500">No addresses found. Try adding the city or ZIP code.</p>}
                {searchResults.map((result, index) => (
                  <button
                    key={index}
                    onClick={() => { handleSelectAddress(result); setShowSearchSheet(false); }}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 border border-gray-200 rounded-xl mb-2"
                  >
                    <p className="text-sm font-medium text-gray-900">{result.formatted_address || result.name}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filters Panel */}
        {showFilters && (
          <MobileDialog title="Map filters and tools" onClose={() => setShowFilters(false)}>
          <div className="rm-mobile-filters px-4 py-3 bg-[#F7FAFC]">
            <div className="rm-panel-heading"><h2>Map filters & tools</h2><button onClick={() => setShowFilters(false)} aria-label="Close map filters"><X size={22} /></button></div>
        <div className="rm-map-shortcuts"><button disabled={!nextBest} onClick={() => { if (nextBest) { setShowFilters(false); handleLeadSelect(nextBest); } }}>Nearest great roof{nextBest ? ` · ${nextBestIsFar ? 'farther away' : nextBestDistance}` : ' · none nearby'}</button>{dailyTarget !== null && <button onClick={() => { setShowFilters(false); setShowGoalsModal(true); }}>Daily pace · {dailyTarget}</button>}</div>
        <div className="rm-map-summary"><button aria-pressed={showHomeowners} onClick={() => setHomePreference(showHomeowners ? "off" : "on")}>Homeowner pins{showHomeowners ? " ✓" : ""}</button><span>Gray = property record · ? = suspected renter</span></div>
        <div className="rm-map-summary"><span>{filteredLeads.length} pins{isRefreshing ? ' · Updating…' : ''}</span><button aria-pressed={outcomesOnly} onClick={() => setOutcomesOnly(!outcomesOnly)}>GHL outcomes{outcomesOnly ? ' ✓' : ''}</button><button aria-pressed={showHeat} onClick={() => setShowHeat(!showHeat)}>Heat map</button></div>
        {outcomesOnly && <div className="rm-pin-legend" aria-label="Appointment outcome colors">{appointmentOutcomeLegend.map(outcome => <span key={outcome.key}><i style={{ background: outcome.color }} />{outcome.label}</span>)}</div>}

            <details className="rm-pin-key"><summary>Pin guide</summary><div>{['assigned','interested','not-home','go-back','appointment','sale','not-interested'].map(status => { const lead = {status} as Lead; const pin = fieldPinArtwork(lead, dispositions.find(d => d.id === status), 17); return <span key={status}><img src={pin.url} alt="" width={30} height={35}/>{pin.style.label}</span>; })}</div><p>The Signal R badge marks pre-uploaded solar-rated warm leads. The top accent shows roof quality; the opposite corner badge shows the GHL result. Cyan brackets mark your selected door. Pins shrink at roof-level zoom while keeping a larger tap area.</p></details>
            {/* Lead Type Filter (mobile) */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🙂</span>
                <label className="text-xs font-semibold text-[#2D3748]">Lead Type</label>
              </div>
              <div className="inline-flex w-full rounded-xl bg-white border border-[#E2E8F0] p-1">
                {(
                  [
                    { key: 'all' as const, label: 'All' },
                    { key: 'prospects' as const, label: 'Prospects' },
                    { key: 'customers' as const, label: 'Customers' },
                  ]
                ).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setLeadTypeFilter(opt.key)}
                    className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-colors ${
                      leadTypeFilter === opt.key
                        ? 'bg-[#476E88] text-white'
                        : 'bg-transparent text-[#2D3748] hover:bg-gray-50'
                    }`}
                    type="button"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Setter Filter - Admin/Manager only */}
            {currentUser && canSeeAllLeads(currentUser.role) && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">👥</span>
                  <label className="text-xs font-semibold text-[#2D3748]">
                    Filter by Setter
                  </label>
                </div>
                <select
                  value={setterFilter}
                  onChange={(e) => setSetterFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#476E88] focus:ring-2 focus:ring-[#476E88]/10"
                >
                  <option value="all">All Setters</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Solar Score Filter - Multi-select */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">☀️</span>
                <label className="text-xs font-semibold text-[#2D3748]">
                  Solar Score Filter
                </label>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={solarFilter.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) setSolarFilter([]);
                    }}
                    className="w-3 h-3 rounded border-gray-300 text-[#476E88]"
                  />
                  <span className="text-xs text-[#2D3748]">All</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={solarFilter.includes('solid')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSolarFilter([...solarFilter, 'solid']);
                      } else {
                        setSolarFilter(solarFilter.filter(f => f !== 'solid'));
                      }
                    }}
                    className="w-3 h-3 rounded border-gray-300 text-[#476E88]"
                  />
                  <span className="text-xs text-[#2D3748]">⭐ Solid (60-74)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={solarFilter.includes('good')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSolarFilter([...solarFilter, 'good']);
                      } else {
                        setSolarFilter(solarFilter.filter(f => f !== 'good'));
                      }
                    }}
                    className="w-3 h-3 rounded border-gray-300 text-[#476E88]"
                  />
                  <span className="text-xs text-[#2D3748]">⭐⭐ Good (75-84)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={solarFilter.includes('great')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSolarFilter([...solarFilter, 'great']);
                      } else {
                        setSolarFilter(solarFilter.filter(f => f !== 'great'));
                      }
                    }}
                    className="w-3 h-3 rounded border-gray-300 text-[#476E88]"
                  />
                  <span className="text-xs text-[#2D3748]">⭐⭐⭐ Great (85+)</span>
                </label>
              </div>
            </div>
            
            {/* Fresh Pins */}
            <div className="mt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={freshPinsOnly}
                  onChange={(e) => setFreshPinsOnly(e.target.checked)}
                  className="w-3 h-3 rounded border-gray-300 text-[#476E88]"
                />
                <span className="text-xs text-[#2D3748] font-semibold">Fresh Pins</span>
                <span className="text-[11px] text-[#718096]">(not dispositioned in last 30 days)</span>
              </label>
            </div>

            {/* Disposition Filter */}
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">📋</span>
                <label className="text-xs font-semibold text-[#2D3748]">
                  Disposition Filter
                </label>
              </div>
              <select
                value={dispositionFilter}
                onChange={(e) => setDispositionFilter(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#476E88] focus:ring-2 focus:ring-[#476E88]/10"
              >
                <option value="all">All Dispositions</option>
                {dispositions.map(dispo => (
                  <option key={dispo.id} value={dispo.id}>
                    {dispo.name}
                  </option>
                ))}
              </select>
            </div>
            
            <button className="w-full mt-3 py-3 text-sm text-[#476E88]" onClick={() => { setSolarFilter([]); setDispositionFilter('all'); setSetterFilter('all'); setFreshPinsOnly(false); setLeadTypeFilter('all'); setOutcomesOnly(false); }}>Reset all filters</button>
            {/* Apply Button - Closes filter panel */}
            <button
              onClick={() => setShowFilters(false)}
              className="w-full mt-4 px-4 py-3 bg-gradient-to-r from-[#476E88] to-[#587E98] text-white font-semibold rounded-xl shadow-sm active:scale-95 transition-transform"
            >
              Show map
            </button>
          </div>
          </MobileDialog>
        )}
      </header>

      {/* Weather Popup */}
      {showWeatherPopup && weather && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowWeatherPopup(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold">Hourly Weather</h2>
              <button aria-label="Close" onClick={() => setShowWeatherPopup(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4">
              {/* Current conditions */}
              <div className="flex items-center justify-center gap-3 mb-4 pb-4 border-b border-gray-200">
                <span className="text-4xl">{weather.icon}</span>
                <div>
                  <p className="text-3xl font-bold">{Math.round(weather.temperature)}°F</p>
                  <p className="text-gray-600">{weather.condition}</p>
                </div>
              </div>
              {/* Hourly forecast */}
              <div className="space-y-2">
                {weather.hourly && weather.hourly.length > 0 ? (
                  weather.hourly.map((hour: any, index: number) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="text-gray-600">{hour.time}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{hour.icon}</span>
                        <span className="font-semibold">{Math.round(hour.temperature)}°F</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center">No hourly data available</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Route Panel (disabled - feature not shipped yet) */}
      {false && showRoute && routeLeads.length > 0 && (
        <div className="px-3 py-3 bg-gradient-to-r from-[#476E88] to-[#587E98] text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Route className="w-5 h-5" />
              <span className="font-semibold">Today's Route</span>
              <span className="text-white/80">({routeLeads.length} stops)</span>
            </div>
            <button aria-label="Close"
              onClick={() => setShowRoute(false)}
              className="p-1 hover:bg-white/20 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          {/* Route Stats */}
          <div className="flex items-center gap-4 mb-3 text-sm">
            <div className="flex items-center gap-1">
              <Footprints className="w-4 h-4" />
              <span>{(routeDistance * 5280 / 5280).toFixed(1)} mi</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>~{walkingTimeMinutes} min walk</span>
            </div>
            <div className="flex items-center gap-1">
              <Car className="w-4 h-4" />
              <span>~{drivingTimeMinutes} min drive</span>
            </div>
          </div>
          
          {/* Route List */}
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {routeLeads.map((lead, index) => (
              <div
                key={lead.id}
                className="flex items-center gap-2 p-2 bg-white/20 rounded-lg"
              >
                <div className="w-6 h-6 bg-white text-[#476E88] rounded-full flex items-center justify-center text-sm font-bold">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{lead.address || 'No address'}</p>
                  {lead.name && <p className="text-xs text-white/70 truncate">{lead.name}</p>}
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${lead.lat},${lead.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-white/30 rounded-lg hover:bg-white/40"
                >
                  <Navigation className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
          
          {/* Start Navigation Button */}
          {gpsPosition && (
            <a
              href={`https://www.google.com/maps/dir/${gpsPosition!.lat},${gpsPosition!.lng}/${routeLeads[0]?.lat},${routeLeads[0]?.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 w-full py-2 bg-white text-[#476E88] rounded-lg font-semibold text-center flex items-center justify-center gap-2"
            >
              <Navigation className="w-5 h-5" />
              Start Navigation
            </a>
          )}
        </div>
      )}

      {/* Map View - Full Screen */}
      {viewMode === 'map' && (
        <main className="rm-knocking-map flex-1 relative overflow-hidden" aria-label="Knocking map">
          <LeadMap
            leads={mapLeads}
            showHomeowners={showHomeowners && !outcomesOnly && dispositionFilter === "all" && leadTypeFilter !== "customers" && solarFilter.length === 0 && !freshPinsOnly && setterFilter === "all"}
            homeownerLeads={homeownerLeads}
            selectedHomeownerId={selectedHomeowner?.id}
            onHomeownerClick={handleHomeownerSelect}
            dispositionOptions={dispositions}
            currentUser={currentUser}
            users={coloredUsers}
            onLeadClick={handleLeadSelect}
            selectedLeadId={selectedLeadId}
            assignmentMode="none"
            userPosition={userPosition}
            showLocateControl={false}
            showZoomControl={false}
            center={mapCenter} // Set ONCE on GPS load, then only on manual recenter
            zoom={mapZoom} // Closer zoom for mobile
            onLeadAdded={refreshLeads}
            searchLocation={searchLocation}
            heatCells={heatCells}
            heatCellRadiusMeters={805}
            showTeamAreas={showTeamAreas}
            territories={showTeamAreas ? teamAreaTerritories : []}
            teamMembers={teamMembersForMap}
          />
          <FieldCompass />
          {currentUser && !dataLoading && !dataUnavailable && <DoorCoach key={currentUser.id} leads={leads} userId={currentUser.id} dispositions={dispositions} />}
          {currentUser && !isRefreshing && !dataUnavailable && !showLeadDetail && <ReturnVisitReminder key={currentUser.id} leads={leads} userId={currentUser.id} position={gpsError ? null : gpsPosition} onLead={handleLeadSelect} />}
          {isRefreshing && <div className="rm-map-loading" role="status">Loading your pins…</div>}
          {/* GPS Locate button is now built into LeadMap component */}
        </main>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <main className="rm-field-list flex-1 overflow-y-auto px-4 py-4">
          {/* GPS Status */}
          {gpsLoading && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Getting your location...
            </div>
          )}
          {gpsError && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              📍 Location disabled - Enable GPS for distance sorting
            </div>
          )}
          
          <div className="space-y-3">
            {isRefreshing || dataUnavailable ? <p className="rm-data-loading" role="status">{dataUnavailable ? "Pins are unavailable. Check your connection and account access." : "Loading your pins…"}</p> : leadsWithDistance.length === 0 ? (
              <div className="text-center py-12 text-[#718096]">
                <p>No pins match these filters.</p><button className="rm-primary mt-4" onClick={() => setShowFilters(true)}>Review filters</button>
              </div>
            ) : (
              leadsWithDistance.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => handleLeadSelect(lead)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl p-4 text-left hover:border-[#476E88] active:scale-98 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-semibold text-[#2D3748] truncate">{lead.name}</div>
                        {lead.distance !== undefined && (
                          <span className="text-xs font-semibold text-[#476E88] flex-shrink-0">
                            📍 {formatDistance(lead.distance)}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-[#718096] truncate">{lead.address}</div><div className="mt-2"><AppointmentOutcomeBadge lead={lead} /></div>
                      <div className="text-xs text-[#718096] mt-1">{lead.city}, {lead.state}</div>
                    </div>
                    <div className="flex-shrink-0">
                      {lead.solarScore && (
                        <div className="px-2 py-1 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg text-xs font-semibold text-[#2D3748]">
                          ☀️ {lead.solarScore}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </main>
      )}

      <MobileNav />

      {selectedHomeowner && !selectedLeadId && showLeadDetail && <HomeownerDetail homeowner={selectedHomeowner} onClose={() => {setSelectedHomeowner(undefined);setShowLeadDetail(false);}} />}
      {/* Lead Detail Panel */}
      {selectedLead && showLeadDetail && (
        <LeadDetail
          key={selectedLead.id}
          fieldMemory
          dispositionOptions={dispositions}
          dispositionsLoading={dataLoading}
          lead={selectedLead}
          homeowner={selectedHomeowner}
          currentUser={currentUser}
          onClose={() => {
            setShowLeadDetail(false);
            setSelectedLeadId(undefined);
            setSelectedHomeowner(undefined);
          }}
          onUpdate={refreshLeads}
        />
      )}
      </div>
    </LocationPermissionGuard>
  );
}
