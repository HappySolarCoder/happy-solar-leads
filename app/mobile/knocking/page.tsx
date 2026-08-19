'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, List, Navigation, Filter, MapPin, Settings, Search, X, Route, Clock, Footprints, Car } from 'lucide-react';
import { getLeads, getLeadsAsync, getMapLeadsAsync, getUsersAsync, saveCurrentUser, type MapBounds } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads, canAssignLeads } from '@/app/types';
import LeadDetail from '@/app/components/LeadDetail';
import { useGeolocation, calculateDistance, formatDistance } from '@/app/hooks/useGeolocation';
import { getDispositionsAsync } from '@/app/utils/dispositions';
import { ensureUserColors } from '@/app/utils/userColors';
import LocationPermissionGuard from '@/app/components/LocationPermissionGuard';
import GoalsPaceModal from '@/app/components/GoalsPaceModal';

const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#F7FAFC]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-[#718096]">Loading map...</p>
      </div>
    </div>
  ),
});

export default function KnockingPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>(() => getLeads());
  const [mapLeads, setMapLeads] = useState<Lead[]>([]);
  const mapBoundsRef = useRef<MapBounds | null>(null);
  const mapFetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(undefined);
  const [hasInitializedMap, setHasInitializedMap] = useState(false);
  const [mapZoom, setMapZoom] = useState(15);
  const [solarFilter, setSolarFilter] = useState<string[]>([]);
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  const [setterFilter, setSetterFilter] = useState<string>('all');
  const [freshPinsOnly, setFreshPinsOnly] = useState<boolean>(false);
  const [leadTypeFilter, setLeadTypeFilter] = useState<'all' | 'prospects' | 'customers'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [addressSearch, setAddressSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchLocation, setSearchLocation] = useState<{ lat: number; lng: number } | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showSearchSheet, setShowSearchSheet] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [routeLeads, setRouteLeads] = useState<Lead[]>([]);
  const [routeStartPoint, setRouteStartPoint] = useState<[number, number] | null>(null);

  const { position: gpsPosition, error: gpsError, isLoading: gpsLoading } = useGeolocation({
    enableHighAccuracy: true,
    watch: true,
    maximumAge: 20000,
  });

  useEffect(() => {
    if (!currentUser || hasInitializedMap) return;
    if (currentUser.role === 'admin') {
      setMapCenter([43.1566, -77.6088]);
      setHasInitializedMap(true);
    } else if (gpsPosition) {
      setMapCenter([gpsPosition.lat, gpsPosition.lng]);
      setHasInitializedMap(true);
    }
  }, [gpsPosition, currentUser, hasInitializedMap]);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      if (user.approvalStatus === 'pending') {
        router.push('/pending-approval');
        return;
      }
      setCurrentUser(user);
      saveCurrentUser(user);
      setIsLoading(false);
      setIsRefreshing(true);
      // Admin map fetch needs a real box (no Rochester default inside getMapLeadsAsync).
      // Setter/closer ignore bounds and still get up to 400 claimed+assigned.
      const startLat = 43.1566;
      const startLng = -77.6088;
      const initialBounds: MapBounds = {
        south: startLat - 0.12,
        north: startLat + 0.12,
        west: startLng - 0.16,
        east: startLng + 0.16,
      };
      mapBoundsRef.current = initialBounds;
      const [loadedLeads, loadedMapLeads] = await Promise.all([
        getLeadsAsync(),
        getMapLeadsAsync(initialBounds),
      ]);
      setLeads(loadedLeads);
      setMapLeads(loadedMapLeads);
      setIsRefreshing(false);
    }
    loadData();
  }, [router]);

  useEffect(() => {
    getDispositionsAsync().then(setDispositions);
    getUsersAsync().then(setUsers);
  }, []);

  const refreshLeads = useCallback(async () => {
    try {
      const [loadedLeads, loadedMapLeads] = await Promise.all([
        getLeadsAsync(),
        getMapLeadsAsync(mapBoundsRef.current || undefined),
      ]);
      setLeads(loadedLeads);
      setMapLeads(loadedMapLeads);
      setWriteError(null);
    } catch (error: any) {
      const code = error?.code || 'unknown';
      const msg = error?.message || 'Failed to save changes.';
      setWriteError(`${code}: ${msg}`);
    }
  }, []);

  const handleViewportLeads = useCallback((bounds: MapBounds) => {
    mapBoundsRef.current = bounds;
    if (mapFetchTimerRef.current) clearTimeout(mapFetchTimerRef.current);
    mapFetchTimerRef.current = setTimeout(async () => {
      try {
        const loadedMapLeads = await getMapLeadsAsync(bounds);
        if (loadedMapLeads.length > 0 || mapLeads.length === 0) {
          setMapLeads(loadedMapLeads);
        }
      } catch (error) {
        console.error('Map viewport fetch failed; keeping existing pins', error);
      }
    }, 400);
  }, [mapLeads]);

  const handleLeadSelect = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setShowLeadDetail(true);
  };

  const handleAddressSearch = async (query: string) => {
    setAddressSearch(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/geocode?address=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          setSearchResults(data.results.slice(0, 5));
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        console.error('Address search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleSelectAddress = (result: any) => {
    const location = result.geometry?.location;
    if (location) {
      const lat = location.lat || location.latitude;
      const lng = location.lng || location.longitude;
      setMapCenter([lat, lng]);
      setMapZoom(16);
      setSearchLocation({ lat, lng });
    }
    setAddressSearch('');
    setSearchResults([]);
  };

  const calculateOptimizedRoute = useCallback((leadsToRoute: Lead[], startPoint?: [number, number]) => {
    if (leadsToRoute.length === 0) return [];
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
      if (nearest.lat && nearest.lng) currentPoint = [nearest.lat, nearest.lng];
    }
    return route;
  }, [gpsPosition]);

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

  const walkingTimeMinutes = Math.round(routeDistance / 0.05);
  const drivingTimeMinutes = Math.round(routeDistance / 0.42);

  const roleFilteredLeads = currentUser
    ? (currentUser.role === 'setter' || currentUser.role === 'closer')
      ? leads.filter(l => (l.leadType === 'customer' || l.leadType === 'sale') || l.claimedBy === currentUser.id || l.assignedTo === currentUser.id)
      : leads
    : [];

  const handleGenerateRoute = useCallback(() => {
    const unknockedLeads = roleFilteredLeads.filter(lead => !lead.disposition || lead.status === 'assigned');
    const startPoint: [number, number] | undefined = gpsPosition ? [gpsPosition.lat, gpsPosition.lng] : undefined;
    setRouteStartPoint(startPoint || null);
    const optimized = calculateOptimizedRoute(unknockedLeads, startPoint);
    setRouteLeads(optimized);
    setShowRoute(true);
  }, [roleFilteredLeads, gpsPosition, calculateOptimizedRoute]);

  const isCustomerLead = useCallback((l: Lead) => {
    return l.leadType === 'customer' || l.leadType === 'sale' || l.status === 'customer';
  }, []);

  const leadTypeFilteredLeads = useMemo(() => {
    if (leadTypeFilter === 'customers') return roleFilteredLeads.filter(isCustomerLead);
    if (leadTypeFilter === 'prospects') return roleFilteredLeads.filter(l => !isCustomerLead(l));
    return roleFilteredLeads;
  }, [roleFilteredLeads, leadTypeFilter, isCustomerLead]);

  let prospects = leadTypeFilteredLeads.filter(l => !isCustomerLead(l) && l.solarCategory !== 'poor');
  let customers = leadTypeFilteredLeads.filter(isCustomerLead);

  if (setterFilter !== 'all') {
    prospects = prospects.filter(l => l.claimedBy === setterFilter);
  }
  if (solarFilter.length > 0) {
    prospects = prospects.filter(l => solarFilter.includes(l.solarCategory || ''));
  }
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
  if (freshPinsOnly) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    prospects = prospects.filter(l => {
      const dt = l.dispositionedAt ? new Date(l.dispositionedAt).getTime() : null;
      return !dt || dt < cutoff;
    });
  }

  const filteredLeads = leadTypeFilter === 'customers'
    ? customers
    : leadTypeFilter === 'prospects'
      ? prospects
      : [...customers, ...prospects];

  const leadsWithDistance = filteredLeads.map(lead => ({
    ...lead,
    distance: gpsPosition && lead.lat && lead.lng
      ? calculateDistance(gpsPosition.lat, gpsPosition.lng, lead.lat, lead.lng)
      : undefined,
  })).sort((a, b) => {
    if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance;
    return 0;
  });

  const selectedLead = leads.find(l => l.id === selectedLeadId);

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

  const prioritizedLeads = leadsWithDistance.filter(l => l.solarCategory && ['solid', 'good', 'great'].includes(l.solarCategory));
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

  const heatCells = useMemo(() => {
    if (!showHeat || !currentUser) return [] as { lat: number; lng: number; intensity: number; count: number }[];
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    const isTwoStarPlus = (cat?: string) => {
      const c = String(cat || '').toLowerCase();
      return c === 'good' || c === 'great';
    };
    const eligible = leads
      .filter((l: any) => l.lat && l.lng)
      .filter((l: any) => isTwoStarPlus(l.solarCategory))
      .filter((l: any) => !l.dispositionedAt || new Date(l.dispositionedAt) < cutoff);
    if (eligible.length === 0) return [];
    const cellSizeMiles = 0.2;
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
      out.push({ lat: centerLat, lng: centerLng, intensity: within, count: within });
    }
    if (out.length === 0) return [];
    const max = Math.max(...out.map(o => o.intensity));
    const normalized = out.sort((a, b) => b.intensity - a.intensity).map(o => ({ ...o, intensity: max ? o.intensity / max : 0 }));
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const doorKnockStatusIds = dispositions.filter((d: any) => d.countsAsDoorKnock).map((d: any) => String(d.id).toLowerCase());
  const todaysKnocks = leads.filter(l => {
    if (!l.dispositionedAt || l.dispositionedAt < todayStart) return false;
    const lastHistoryUserId = (l.dispositionHistory && l.dispositionHistory[0]?.userId) ? String(l.dispositionHistory[0].userId) : null;
    const actedByMe = lastHistoryUserId === currentUser?.id || l.claimedBy === currentUser?.id;
    if (!actedByMe) return false;
    const disp = String(l.status || l.disposition || '').toLowerCase();
    return doorKnockStatusIds.includes(disp);
  }).length;

  const [dailyTarget, setDailyTarget] = useState<number | null>(null);
  useEffect(() => {
    async function loadGoalTarget() {
      if (!currentUser) return;
      try {
        const monthId = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const { getMyGoalViaApiAsync, getMyMonthlyKnocksAsync, countWorkdaysElapsedAndRemaining } = await import('@/app/utils/goals');
        const goal = await getMyGoalViaApiAsync(monthId);
        if (!goal?.doorKnocksGoal) {
          setDailyTarget(null);
          return;
        }
        const K = await getMyMonthlyKnocksAsync(new Date(), currentUser);
        const { remaining } = countWorkdaysElapsedAndRemaining(new Date());
        const remainingWorkdays = Math.max(1, remaining);
        const needed = Math.max(0, Number(goal.doorKnocksGoal) - K);
        setDailyTarget(Math.ceil(needed / remainingWorkdays));
      } catch {
        setDailyTarget(null);
      }
    }
    loadGoalTarget();
  }, [currentUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading leads...</p>
        </div>
      </div>
    );
  }

  return (
    <LocationPermissionGuard requireLocation={true}>
      <div className="h-screen flex flex-col bg-white overflow-hidden">
      {currentUser && <GoalsPaceModal currentUser={currentUser} openOverride={showGoalsModal} onCloseOverride={() => setShowGoalsModal(false)} />}

      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-200 px-4 flex-shrink-0">
        <div className="h-14 flex items-center gap-2">
          <button
            onClick={() => {
              if (showLeadDetail) {
                setShowLeadDetail(false);
                setSelectedLeadId(undefined);
              } else {
                router.push('/mobile');
              }
            }}
            className="h-11 w-11 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 active:scale-95 transition-all flex-none"
            title={showLeadDetail ? 'Close' : 'Back'}
          >
            {showLeadDetail ? (
              <X className="w-5 h-5 text-[#718096]" />
            ) : (
              <ArrowLeft className="w-5 h-5 text-[#718096]" />
            )}
          </button>

          <button
            onClick={() => { setShowSearchSheet(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
            className="h-11 flex-1 min-w-0 rounded-full bg-gray-100 border border-gray-200 px-4 inline-flex items-center gap-2 text-left hover:bg-gray-200/60 transition-colors"
            title="Search address"
          >
            <Search className="w-4 h-4 text-gray-500 flex-none" />
            <span className="text-sm text-gray-500 truncate">Search address…</span>
          </button>

          <button
            onClick={() => router.push('/tools')}
            className="h-11 w-11 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 active:scale-95 transition-all flex-none"
            title="Tools"
          >
            <Settings className="w-5 h-5 text-[#718096]" />
          </button>
        </div>

        <div className="pb-3 pt-2 -mt-1 flex items-center gap-2 overflow-x-auto pr-1 text-xs font-semibold tabular-nums [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {isRefreshing && (
            <div className="h-10 min-h-10 px-3 rounded-full bg-[#FFF7ED] border border-[#FDBA74] text-[#9A3412] inline-flex items-center gap-2 leading-none whitespace-nowrap">
              <span className="animate-pulse">↻</span>
              <span>Refreshing…</span>
            </div>
          )}
          <div className="h-10 min-h-10 px-3 rounded-full bg-white border border-gray-200 text-[#2D3748] inline-flex items-center gap-2 leading-none whitespace-nowrap">
            <span className="text-sm leading-none">🚪</span>
            <span className="text-sm font-semibold leading-none tabular-nums">{todaysKnocks}</span>
          </div>
          {dailyTarget !== null && (
            <button
              onClick={() => setShowGoalsModal(true)}
              className="h-10 min-h-10 px-3 rounded-full bg-white border border-gray-200 text-[#2D3748] inline-flex items-center gap-2 leading-none whitespace-nowrap hover:bg-gray-50"
              title="Goal details"
            >
              <span className="text-sm leading-none">🎯</span>
              <span className="text-sm font-semibold leading-none tabular-nums">{dailyTarget}</span>
            </button>
          )}
          <button
            onClick={() => { if (nextBest) handleLeadSelect(nextBest); }}
            disabled={!nextBest}
            className="h-10 min-h-10 px-3 rounded-full bg-white border border-gray-200 text-[#2D3748] inline-flex items-center gap-2 leading-none whitespace-nowrap disabled:opacity-50"
            title="Nearest 3⭐"
          >
            <span className="text-sm leading-none">⭐</span>
            <span className="text-sm font-semibold leading-none truncate max-w-[140px]">
              {nextBest ? (nextBestIsFar ? 'Far' : `${nextBestDistance}${nextBestDirection ? ` ${nextBestDirection}` : ''}`) : '—'}
            </span>
          </button>
          <button
            onClick={() => setShowHeat(!showHeat)}
            className={`h-10 w-10 min-h-10 rounded-full border inline-flex items-center justify-center leading-none ${
              showHeat ? 'border-[#FF5F5A] text-[#FF5F5A] bg-[#FF5F5A]/5' : 'border-gray-200 text-[#2D3748] bg-white'
            }`}
            title="Heat map"
          >
            <span className="text-sm leading-none">🔥</span>
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`h-10 w-10 min-h-10 rounded-full border inline-flex items-center justify-center leading-none ${
              showFilters ? 'border-[#FF5F5A] text-[#FF5F5A] bg-[#FF5F5A]/5' : 'border-gray-200 text-[#2D3748] bg-white'
            }`}
            title="Filters"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>

        {writeError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Save failed: {writeError}
          </div>
        )}

        {showSearchSheet && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/30" onClick={() => setShowSearchSheet(false)} />
            <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[75vh] overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#2D3748]">Search address</div>
                <button onClick={() => setShowSearchSheet(false)} className="h-10 w-10 rounded-full hover:bg-gray-100 flex items-center justify-center" title="Close">
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
                    value={addressSearch}
                    onChange={(e) => handleAddressSearch(e.target.value)}
                    className="bg-transparent w-full text-sm text-gray-900 placeholder:text-gray-500 outline-none"
                  />
                  {addressSearch && (
                    <button onClick={() => { setAddressSearch(''); setSearchResults([]); }} className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-gray-200" title="Clear">
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>
              </div>
              <div className="px-4 pb-4 overflow-y-auto max-h-[55vh]">
                {isSearching && (
                  <div className="p-3 text-sm text-gray-500 flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-[#FF5F5A] border-t-transparent rounded-full animate-spin" />
                    Searching...
                  </div>
                )}
                {searchResults.map((result, index) => (
                  <button key={index} onClick={() => { handleSelectAddress(result); setShowSearchSheet(false); }} className="w-full px-4 py-3 text-left hover:bg-gray-50 border border-gray-200 rounded-xl mb-2">
                    <p className="text-sm font-medium text-gray-900">{result.formatted_address || result.name}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {showFilters && (
          <div className="px-4 py-3 border-t border-[#E2E8F0] bg-[#F7FAFC]">
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🙂</span>
                <label className="text-xs font-semibold text-[#2D3748]">Lead Type</label>
              </div>
              <div className="inline-flex w-full rounded-xl bg-white border border-[#E2E8F0] p-1">
                {([{ key: 'all' as const, label: 'All' }, { key: 'prospects' as const, label: 'Prospects' }, { key: 'customers' as const, label: 'Customers' }]).map(opt => (
                  <button key={opt.key} onClick={() => setLeadTypeFilter(opt.key)} className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-colors ${
                    leadTypeFilter === opt.key ? 'bg-[#FF5F5A] text-white' : 'bg-transparent text-[#2D3748] hover:bg-gray-50'
                  }`} type="button">{opt.label}</button>
                ))}
              </div>
            </div>
            {currentUser && canSeeAllLeads(currentUser.role) && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">👥</span>
                  <label className="text-xs font-semibold text-[#2D3748]">Filter by Setter</label>
                </div>
                <select value={setterFilter} onChange={(e) => setSetterFilter(e.target.value)} className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10">
                  <option value="all">All Setters</option>
                  {users.map(user => (<option key={user.id} value={user.id}>{user.name}</option>))}
                </select>
              </div>
            )}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">☀️</span>
                <label className="text-xs font-semibold text-[#2D3748]">Solar Score Filter</label>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={solarFilter.length === 0} onChange={(e) => { if (e.target.checked) setSolarFilter([]); }} className="w-3 h-3 rounded border-gray-300 text-[#FF5F5A]" />
                  <span className="text-xs text-[#2D3748]">All</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={solarFilter.includes('solid')} onChange={(e) => { if (e.target.checked) setSolarFilter([...solarFilter, 'solid']); else setSolarFilter(solarFilter.filter(f => f !== 'solid')); }} className="w-3 h-3 rounded border-gray-300 text-[#FF5F5A]" />
                  <span className="text-xs text-[#2D3748]">⭐ Solid (60-74)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={solarFilter.includes('good')} onChange={(e) => { if (e.target.checked) setSolarFilter([...solarFilter, 'good']); else setSolarFilter(solarFilter.filter(f => f !== 'good')); }} className="w-3 h-3 rounded border-gray-300 text-[#FF5F5A]" />
                  <span className="text-xs text-[#2D3748]">⭐⭐ Good (75-84)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={solarFilter.includes('great')} onChange={(e) => { if (e.target.checked) setSolarFilter([...solarFilter, 'great']); else setSolarFilter(solarFilter.filter(f => f !== 'great')); }} className="w-3 h-3 rounded border-gray-300 text-[#FF5F5A]" />
                  <span className="text-xs text-[#2D3748]">⭐⭐⭐ Great (85+)</span>
                </label>
              </div>
            </div>
            <div className="mt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={freshPinsOnly} onChange={(e) => setFreshPinsOnly(e.target.checked)} className="w-3 h-3 rounded border-gray-300 text-[#FF5F5A]" />
                <span className="text-xs text-[#2D3748] font-semibold">Fresh Pins</span>
                <span className="text-[11px] text-[#718096]">(not dispositioned in last 30 days)</span>
              </label>
            </div>
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">📋</span>
                <label className="text-xs font-semibold text-[#2D3748]">Disposition Filter</label>
              </div>
              <select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)} className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10">
                <option value="all">All Dispositions</option>
                {dispositions.map(dispo => (<option key={dispo.id} value={dispo.id}>{dispo.emoji} {dispo.name}</option>))}
              </select>
            </div>
            <button onClick={() => setShowFilters(false)} className="w-full mt-4 px-4 py-3 bg-gradient-to-r from-[#FF5F5A] to-[#FF7A6B] text-white font-semibold rounded-xl shadow-sm active:scale-95 transition-transform">
              Apply Filters
            </button>
          </div>
        )}
      </header>

      {viewMode === 'map' && (
        <main className="flex-1 relative overflow-hidden">
          <LeadMap
            leads={mapLeads}
            currentUser={currentUser}
            users={ensureUserColors(users)}
            onLeadClick={handleLeadSelect}
            selectedLeadId={selectedLeadId}
            assignmentMode="none"
            selectedLeadIdsForAssignment={[]}
            userPosition={gpsPosition ? [gpsPosition.lat, gpsPosition.lng] : undefined}
            center={mapCenter}
            zoom={mapZoom}
            onMapMove={(center, zoom, bounds) => {
              if (center) setMapCenter(center);
              if (typeof zoom === 'number') setMapZoom(zoom);
              if (bounds) handleViewportLeads(bounds);
            }}
            onLeadAdded={refreshLeads}
            searchLocation={searchLocation}
            heatCells={heatCells}
            heatCellRadiusMeters={805}
          />
        </main>
      )}

      {viewMode === 'list' && (
        <main className="flex-1 overflow-y-auto px-4 py-4">
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
            {leadsWithDistance.length === 0 ? (
              <div className="text-center py-12 text-[#718096]"><p>No leads available</p></div>
            ) : (
              leadsWithDistance.map(lead => (
                <button key={lead.id} onClick={() => handleLeadSelect(lead)} className="w-full bg-white border border-[#E2E8F0] rounded-xl p-4 text-left hover:border-[#FF5F5A] active:scale-98 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-semibold text-[#2D3748] truncate">{lead.name}</div>
                        {lead.distance !== undefined && (
                          <span className="text-xs font-semibold text-[#FF5F5A] flex-shrink-0">📍 {formatDistance(lead.distance)}</span>
                        )}
                      </div>
                      <div className="text-sm text-[#718096] truncate">{lead.address}</div>
                      <div className="text-xs text-[#718096] mt-1">{lead.city}, {lead.state}</div>
                    </div>
                    <div className="flex-shrink-0">
                      {lead.solarScore && (
                        <div className="px-2 py-1 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg text-xs font-semibold text-[#2D3748]">☀️ {lead.solarScore}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </main>
      )}

      {selectedLead && showLeadDetail && (
        <LeadDetail
          lead={selectedLead}
          currentUser={currentUser}
          onClose={() => { setShowLeadDetail(false); setSelectedLeadId(undefined); }}
          onUpdate={refreshLeads}
        />
      )}
      </div>
    </LocationPermissionGuard>
  );
}
