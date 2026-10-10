'use client';

import { observeMapSize } from '@/app/utils/observeMapSize';

import { fieldPinArtwork, fieldPinZoomTier } from '@/app/utils/fieldPin';
import { buildLeadViewportIndex, queryLeadViewport } from '@/app/utils/mapViewport';
import { getAppointmentOutcome } from '@/app/utils/appointmentOutcome';
import { getLocation } from '@/app/utils/geolocation';

import { apiFetch } from '@/app/utils/apiFetch';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { auth } from '@/app/utils/firebase';
import { RouteWaypoint } from './RouteBuilder';
import { Disposition, getDispositionsAsync, isKnockStatus } from '@/app/utils/dispositions';
import AddLeadModal from './AddLeadModal';
import { getTerritoriesAsync } from '@/app/utils/territories';
import { findLeadTerritory } from '@/app/utils/territoryAssignment';
import { formatTimeEST } from '@/app/utils/timezone';
import { colorForTerritory, shouldRenderTerritoryOverlay, type TeamAreaMember } from '@/app/utils/teamAreas';
import { isProximityRequired, PROXIMITY_MAX_DISTANCE_METERS } from '@/app/utils/proximityEnforcement';
import { isAppointmentSetOrSoldLead, pastPinPopupLines } from '@/app/utils/historicalTerritoryPins';

interface UserRoute {
  userId: string;
  userName: string;
  userColor: string;
  waypoints: RouteWaypoint[];
}

interface LeadMapProps {
  leads: Lead[];
  dispositionOptions?: Disposition[];
  currentUser: User | null;
  users?: User[]; // All users for territory color mapping
  onLeadClick: (lead: Lead) => void;
  selectedLeadId?: string;
  routeWaypoints?: RouteWaypoint[];
  userRoutes?: UserRoute[]; // Multiple routes (one per user) for activity tracking
  center?: [number, number];
  zoom?: number;
  onMapMove?: (center: [number, number], zoom: number) => void; // Callback when map moves
  onMapTypeChange?: (mapType: 'street' | 'satellite') => void; // Callback when map type changes
  assignmentMode?: 'none' | 'manual' | 'territory';
  selectedLeadIdsForAssignment?: string[];
  onTerritoryDrawn?: (leadIds: string[], polygon: [number, number][]) => void;
  userPosition?: [number, number]; // GPS position for blue dot
  viewMode?: 'map' | 'assignments' | 'territory'; // Show territories in assignments/territory view
  territories?: any[]; // Territory polygons to display
  onTerritoryDelete?: (territoryId: string) => void; // Callback when territory deleted
  onLeadAdded?: () => void; // Callback when a new lead is added via map pin drop
  searchLocation?: { lat: number; lng: number } | null; // For address search marker
  heatCells?: { lat: number; lng: number; intensity: number; count: number }[]; // Optional heat overlay
  heatCellRadiusMeters?: number;
  showLocateControl?: boolean;
  showZoomControl?: boolean;
  showTeamAreas?: boolean; // User toggle: overlay FMA territories + teammate pins
  teamMembers?: TeamAreaMember[];
  onToggleTeamAreas?: (next: boolean) => void;
}

const EMPTY_USERS: User[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_ROUTES: UserRoute[] = [];
type PinEntry = { marker: L.Marker; lead: Lead; styleKey: string; users: User[]; disposition?: Disposition };

function markPinSelected(entry: PinEntry, selected: boolean) {
  const icon = entry.marker.options.icon;
  if (icon) {
    const base = (icon.options.className || '').replace(/\bis-selected\b/g, '').trim();
    icon.options.className = `${base}${selected ? ' is-selected' : ''}`;
  }
  entry.marker.getElement()?.classList.toggle('is-selected', selected);
  entry.marker.setZIndexOffset(entry.lead.historicalTerritoryPin ? -300 : selected ? 500 : 0);
}

export default function LeadMap({ 
  leads: leadsProp,
  dispositionOptions,
  currentUser,
  users = EMPTY_USERS,
  onLeadClick, 
  selectedLeadId,
  routeWaypoints,
  userRoutes = EMPTY_ROUTES,
  center = [43.1566, -77.6088], // Rochester, NY - default for admin oversight
  zoom = 11,
  onMapMove,
  onMapTypeChange,
  assignmentMode = 'none',
  selectedLeadIdsForAssignment = EMPTY_IDS,
  onTerritoryDrawn,
  userPosition,
  viewMode = 'map',
  territories = [],
  onTerritoryDelete,
  onLeadAdded,
  searchLocation,
  heatCells = [],
  heatCellRadiusMeters = 180,
  showLocateControl = true,
  showZoomControl = true,
  showTeamAreas = false,
  teamMembers = [],
  onToggleTeamAreas,
}: LeadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const pinEntriesRef = useRef(new Map<string, PinEntry>());
  const routeModeRef = useRef(false);
  const selectedPinRef = useRef<string | undefined>(undefined);
  // Selecting a door only changes its outline. Do not replace its Leaflet icon
  // or restart batched marker reconciliation while a touch event is in progress.
  useEffect(() => {
    const previous = selectedPinRef.current;
    selectedPinRef.current = selectedLeadId;
    for (const id of [previous, selectedLeadId]) {
      if (!id) continue;
      const entry = pinEntriesRef.current.get(id);
      if (entry) markPinSelected(entry, id === selectedLeadId);
    }
  }, [selectedLeadId]);
  const clickRef = useRef(onLeadClick);
  useEffect(() => { clickRef.current = onLeadClick; }, [onLeadClick]);
  const hasUserPosition = Boolean(userPosition);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const drawControlRef = useRef<any>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const hasFitBoundsRef = useRef<boolean>(false); // Track if we've already fit bounds for activity routes
  const hasFitRouteBoundsRef = useRef<boolean>(false); // Track if we've already fit bounds for single route mode
  const userInteractedRef = useRef<boolean>(false); // After user pans/zooms, never auto-fit/auto-pan
  const [isClient, setIsClient] = useState(false);
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);
  const [loadedDispositions, setDispositions] = useState<Disposition[]>([]);
  const dispositions = dispositionOptions ?? loadedDispositions;
  const [mapZoom, setMapZoom] = useState(zoom);
  const [zoomTier, setZoomTier] = useState(0); // Tier system to avoid re-rendering on every zoom
  const [viewportKey, setViewportKey] = useState(0); // Trigger re-render on pan/zoom
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [dropPinLocation, setDropPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [dropPinAddress, setDropPinAddress] = useState({ address: '', city: '', state: '', zip: '' });
  const tempPinRef = useRef<L.Marker | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const heatLayerRef = useRef<L.LayerGroup | null>(null);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite'); // Default to satellite
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsTileLayerRef = useRef<L.TileLayer | null>(null);
  const hasFitLeadsBoundsRef = useRef(false); // Prevent constant re-fitting of bounds
  const hasFitTerritoryBoundsRef = useRef(false); // Track territory bounds fitting
  // Past / historical pin popup. One Leaflet popup, keyed by lead id, so a
  // marker rebuild (pan, zoom, idle refetch) updates it instead of closing it.
  const persistentPopupIdRef = useRef<string | null>(null);
  const persistentPopupRef = useRef<L.Popup | null>(null);

  const ensurePersistentPopup = () => {
    if (!persistentPopupRef.current) {
      const popup = L.popup({
        autoPan: false,
        closeButton: true,
        // Map pans, zooms, and marker rebuilds must not dismiss this.
        // A tap on the map (below) or the X button closes it.
        closeOnClick: false,
        autoClose: false,
        maxWidth: 300,
        offset: L.point(0, -20),
        className: 'past-pin-popup',
      });
      popup.on('remove', () => {
        persistentPopupIdRef.current = null;
      });
      persistentPopupRef.current = popup;
    }
    return persistentPopupRef.current;
  };

  const showPersistentPopup = (map: L.Map, lead: Lead) => {
    if (lead.lat == null || lead.lng == null) return;
    const popup = ensurePersistentPopup();
    popup.setLatLng([lead.lat, lead.lng]);
    popup.setContent(createPopupContent(lead));
    if (!popup.isOpen()) popup.openOn(map);
    persistentPopupIdRef.current = lead.id;
  };

  // Use leadsProp directly - parent already handles filtering if needed
  // For large datasets, we only render what's passed in
  const leads = useMemo(() => leadsProp, [leadsProp]);

  const viewportIndex = useMemo(() => buildLeadViewportIndex(leads), [leads]);

  // Load dispositions
  useEffect(() => {
    if (dispositionOptions) return;
    async function loadDispositions() {
      const dispos = await getDispositionsAsync();
      setDispositions(dispos);
    }
    loadDispositions();
  }, [dispositionOptions]);

  // Reset fitBounds when userRoutes changes (new date/user filter selected)
  useEffect(() => {
    hasFitBoundsRef.current = false;
  }, [userRoutes]);

  // Reset route bounds fitting when routeWaypoints changes (avoid snap-back while panning)
  useEffect(() => {
    hasFitRouteBoundsRef.current = false;
  }, [routeWaypoints]);

  // Heat overlay
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient || !heatLayerRef.current) return;

    const layer = heatLayerRef.current;
    layer.clearLayers();

    if (!heatCells || heatCells.length === 0) return;

    for (const cell of heatCells) {
      const opacity = Math.max(0.08, Math.min(0.45, cell.intensity));
      const circle = L.circle([cell.lat, cell.lng], {
        radius: heatCellRadiusMeters,
        color: '#FF5F5A',
        weight: 0,
        fillColor: '#FF5F5A',
        fillOpacity: opacity,
        interactive: false,
      });
      circle.addTo(layer);
    }
  }, [heatCells, heatCellRadiusMeters, isClient]);

  // Reset lead bounds fitting when leads change significantly
  useEffect(() => {
    hasFitLeadsBoundsRef.current = false;
    hasFitTerritoryBoundsRef.current = false;
  }, [leadsProp]);

  // Fix Leaflet icons
  useEffect(() => {
    // @ts-ignore
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    });
    setIsClient(true);
  }, []);

  // Handle map type switching
  useEffect(() => {
    if (!mapInstanceRef.current || !baseTileLayerRef.current || !labelsTileLayerRef.current) return;

    const map = mapInstanceRef.current;

    // Remove old layers
    baseTileLayerRef.current.remove();
    labelsTileLayerRef.current.remove();

    if (mapType === 'satellite') {
      // Satellite imagery
      baseTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
      }).addTo(map);

      // Labels overlay (Esri reference tiles; no API key)
      labelsTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Labels &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
        maxZoom: 19,
        pane: 'shadowPane',
      }).addTo(map);
    } else {
      // Street map
      baseTileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // No labels needed for street view (already has them)
      labelsTileLayerRef.current = L.tileLayer('', { maxZoom: 0 }); // Dummy layer
    }
  }, [mapType]);

  // Initialize map
  useEffect(() => {
    if (!isClient || !mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center,
      zoom,
      zoomControl: showZoomControl,
      attributionControl: false,
    });

    // Initialize with satellite view
    baseTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    }).addTo(map);

    // Add labels overlay for satellite view (Esri reference tiles; no API key)
    labelsTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Labels &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
      maxZoom: 19,
      pane: 'shadowPane', // Put labels above satellite but below markers
    }).addTo(map);

    // Heat layer (optional overlays)
    heatLayerRef.current = L.layerGroup().addTo(map);

    // Create marker cluster group with optimized clustering for performance
    markersLayerRef.current = L.markerClusterGroup({
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const label = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
        return L.divIcon({
          className: 'field-cluster', iconSize: [46, 46],
          html: `<div title="${count} doors — zoom in" style="width:46px;height:46px;border-radius:16px;background:#203d49;border:2px solid #6fc9c5;box-shadow:0 0 0 3px #ffffffbb;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font:700 15px system-ui"><span>${label}</span><span style="font:500 8px system-ui;color:#bde4da;letter-spacing:.6px">DOORS</span></div>`,
        });
      },
      disableClusteringAtZoom: 15, // Show individual pins at zoom 15+ (slightly later for performance)
      maxClusterRadius: 60, // Reduced from default 80 (tighter clusters = fewer markers)
      spiderfyOnMaxZoom: true, // Spread out markers when clicking cluster at max zoom
      showCoverageOnHover: false, // Don't show cluster bounds on hover (cleaner UX + performance)
      zoomToBoundsOnClick: true, // Zoom into cluster when clicked
      chunkedLoading: false, // Marker creation/insertion is already scheduled in cancellable frame batches
      chunkInterval: 50, // Process in 50ms chunks
      chunkDelay: 50, // 50ms delay between chunks
      removeOutsideVisibleBounds: true, // Remove markers outside view (huge performance boost)
    }).addTo(map);
    
    mapInstanceRef.current = map;

    const stopObservingSize = observeMapSize(map);

    // Mark user interaction to prevent auto-fit snapback
    map.on('dragstart', () => {
      userInteractedRef.current = true;
    });
    map.on('zoomstart', () => {
      userInteractedRef.current = true;
    });

    // Listen for zoom changes - update tier only when crossing thresholds
    map.on('zoomend', () => {
      const currentZoom = map.getZoom();
      const newCenter: [number, number] = [map.getCenter().lat, map.getCenter().lng];
      setMapZoom(currentZoom);
      
      // Calculate zoom tier (only re-render markers when tier changes, not on every zoom)
      const newTier = fieldPinZoomTier(currentZoom);
      
      setZoomTier(newTier);
      setViewportKey(prev => prev + 1); // Trigger viewport update on zoom
      
      // Notify parent of map move
      if (onMapMove) {
        onMapMove(newCenter, currentZoom);
      }
    });

    // Listen for map panning - update viewport to load new markers
    map.on('moveend', () => {
      const newCenter: [number, number] = [map.getCenter().lat, map.getCenter().lng];
      const currentZoom = map.getZoom();
      setViewportKey(prev => prev + 1);
      
      // Notify parent of map move
      if (onMapMove) {
        onMapMove(newCenter, currentZoom);
      }
    });

    // Handle right-click to drop pin (desktop)
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      handleDropPin(e.latlng);
    });

    // Handle long-press to drop pin (mobile)
    let longPressTimer: NodeJS.Timeout;
    let longPressStartPos: L.LatLng | null = null;
    
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      longPressStartPos = e.latlng;
      longPressTimer = setTimeout(() => {
        if (longPressStartPos) {
          console.log('[LeadMap] Long press detected, dropping pin');
          handleDropPin(longPressStartPos);
        }
      }, 800); // 800ms for long-press
    });
    
    map.on('touchstart', (e: any) => {
      // Handle touch events - extract latlng from the event
      const latlng = (e as any).latlng || e.latlng;
      if (latlng) {
        longPressStartPos = latlng;
        longPressTimer = setTimeout(() => {
          if (longPressStartPos) {
            console.log('[LeadMap] Touch long press detected, dropping pin');
            apiFetch('/api/debug-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ level: 'info', message: 'Touch long press triggered', data: { lat: longPressStartPos.lat, lng: longPressStartPos.lng } })
            }).catch(() => {});
            handleDropPin(longPressStartPos);
          }
        }, 800);
      }
    });
    
    map.on('mouseup touchend mousemove', () => {
      clearTimeout(longPressTimer);
      longPressStartPos = null;
    });

    // Close the past-pin popup only when the tap is on the map itself.
    // Marker taps, the popup (including X), and zoom controls do not count.
    map.on('click', (event: L.LeafletMouseEvent) => {
      const target = event.originalEvent?.target;
      if (target instanceof Element && target.closest('.leaflet-popup, .leaflet-marker-icon, .marker-cluster, .leaflet-control')) {
        return;
      }
      persistentPopupRef.current?.close();
    });

    return () => {
      stopObservingSize();
      clearTimeout(longPressTimer);
      if (routeLineRef.current) routeLineRef.current.remove();
      map.remove();
      mapInstanceRef.current = null;
      pinEntriesRef.current.clear();
      routeModeRef.current = false;
    };
  }, [isClient]);

  // Handle center and zoom changes from parent (e.g., address search)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    const map = mapInstanceRef.current;
    
    // Get current center and zoom
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    
    // Calculate target values
    const targetLat = center?.[0] ?? 43.1566;
    const targetLng = center?.[1] ?? -77.6088;
    const targetZoom = zoom ?? 11;
    
    // Only fly if there's a significant difference
    const latDiff = Math.abs(currentCenter.lat - targetLat);
    const lngDiff = Math.abs(currentCenter.lng - targetLng);
    const zoomDiff = Math.abs(currentZoom - targetZoom);
    
    // Fly to new center and zoom if needed (threshold: >0.001 lat/lng or >0.5 zoom)
    if (latDiff > 0.001 || lngDiff > 0.001 || zoomDiff > 0.5) {
      console.log('[LeadMap] Flying to:', [targetLat, targetLng], 'zoom:', targetZoom);
      map.flyTo([targetLat, targetLng], targetZoom, { 
        duration: 1.0,
        animate: true,
      });
    }
  }, [center?.[0], center?.[1], zoom]);

  // Handle search marker placement
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;
    
    const map = mapInstanceRef.current;
    
    // Remove existing search marker
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
    
    // If we have a search location, add the marker
    if (searchLocation) {
      // Create a distinct search marker - large pulsing blue circle
      const searchIcon = L.divIcon({
        html: `
          <div style="
            width: 40px;
            height: 40px;
            background: #3B82F6;
            border: 4px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: pulse 1.5s infinite;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <style>
            @keyframes pulse {
              0% { transform: scale(1); }
              50% { transform: scale(1.1); }
              100% { transform: scale(1); }
            }
          </style>
        `,
        className: 'search-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
      
      searchMarkerRef.current = L.marker([searchLocation.lat, searchLocation.lng], {
        icon: searchIcon,
      }).addTo(map);
      
      // Add popup with navigate button
      const popupContent = `
        <div style="text-align: center; padding: 8px;">
          <p style="margin: 0 0 8px 0; font-weight: 600;">Searched Address</p>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${searchLocation.lat},${searchLocation.lng}" 
             target="_blank"
             style="
               display: inline-block;
               background: #3B82F6;
               color: white;
               padding: 8px 16px;
               border-radius: 6px;
               text-decoration: none;
               font-weight: 600;
             ">
            🚀 Navigate
          </a>
        </div>
      `;
      // Prevent auto-pan snap when popup opens
      searchMarkerRef.current.bindPopup(popupContent, { autoPan: false }).openPopup();
    }
  }, [searchLocation, isClient]);

  // Update markers and route (optimized for large datasets - only render when needed)
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !isClient) return;

    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;

    const pinnedIdAtStart = persistentPopupIdRef.current;
    const routeMode = Boolean(userRoutes.length || routeWaypoints?.length);
    if (routeMode || routeModeRef.current) {
      layer.clearLayers();
      pinEntriesRef.current.clear();
    }
    routeModeRef.current = routeMode;
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    const currentZoom = map.getZoom();
    const bounds = map.getBounds().pad(0.3);
    const visibleLeads = queryLeadViewport(viewportIndex, {
      south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast(),
    });

    // Show multiple user routes (activity map mode)
    if (userRoutes && userRoutes.length > 0) {
      const allCoords: [number, number][] = [];
      
      userRoutes.forEach(userRoute => {
        const routeCoords = userRoute.waypoints.map(wp => [wp.lat, wp.lng] as [number, number]);
        allCoords.push(...routeCoords);
        
        // Draw route line in user's color (solid line, thicker for visibility)
        L.polyline(routeCoords, {
          color: userRoute.userColor,
          weight: 5,
          opacity: 0.85,
        }).addTo(map);

        // Add numbered markers for each waypoint
        userRoute.waypoints.forEach((wp, index) => {
          const icon = createActivityMarkerIcon(index + 1, userRoute.userColor);
          const marker = L.marker([wp.lat, wp.lng], { icon });
          marker.bindPopup(createActivityPopupContent(wp, userRoute.userName), { maxWidth: 300 });
          marker.on('click', () => onLeadClick(wp.lead));
          marker.addTo(layer);
          
          // Add person icon showing where knocker was standing when dispositioning
          if (wp.lead.knockGpsLat && wp.lead.knockGpsLng) {
            const personIcon = createPersonMarkerIcon(userRoute.userColor);
            const personMarker = L.marker([wp.lead.knockGpsLat, wp.lead.knockGpsLng], { icon: personIcon });
            
            // Add popup showing GPS accuracy
            const distance = wp.lead.knockDistanceFromAddress 
              ? Math.round(wp.lead.knockDistanceFromAddress * 3.281) // Convert meters to feet
              : null;
            personMarker.bindPopup(
              `<div style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
                <div style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:#1f2937;">Knocker Position</div>
                <div style="font-size:12px;color:#6b7280;">When dispositioning ${wp.lead.name}</div>
                ${distance !== null ? `<div style="margin-top:8px;font-size:12px;color:#10b981;">Distance: ${distance} feet from door</div>` : ''}
                ${wp.lead.knockGpsAccuracy ? `<div style="font-size:11px;color:#9ca3af;">GPS accuracy: ±${Math.round(wp.lead.knockGpsAccuracy)} meters</div>` : ''}
              </div>`,
              { maxWidth: 250 }
            );
            personMarker.addTo(layer);
            
            // Draw line from person position to door (if different)
            if (distance && distance > 10) { // Only draw line if >10 feet apart
              L.polyline(
                [[wp.lead.knockGpsLat, wp.lead.knockGpsLng], [wp.lat, wp.lng]],
                {
                  color: userRoute.userColor,
                  weight: 2,
                  opacity: 0.5,
                  dashArray: '5, 5',
                }
              ).addTo(map);
            }
          }
        });
      });

      // Fit bounds to show all routes (only on first load, not on user zoom)
      if (allCoords.length > 0 && !hasFitBoundsRef.current && !userInteractedRef.current) {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [50, 50] });
        hasFitBoundsRef.current = true;
      }
      return;
    }

    // Show single route mode (route builder)
    if (routeWaypoints && routeWaypoints.length > 0) {
      const routeCoords = routeWaypoints.map(wp => [wp.lat, wp.lng] as [number, number]);
      
      routeLineRef.current = L.polyline(routeCoords, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.8,
        dashArray: '10, 10',
      }).addTo(map);

      routeWaypoints.forEach((wp, index) => {
        const icon = createRouteNumberIcon(index + 1);
        const marker = L.marker([wp.lat, wp.lng], { icon });
        marker.bindPopup(createRoutePopupContent(wp), { maxWidth: 300 });
        marker.on('click', () => onLeadClick(wp.lead));
        marker.addTo(layer);
      });

      if (routeCoords.length > 0 && !hasFitRouteBoundsRef.current && !userInteractedRef.current) {
        const bounds = L.latLngBounds(routeCoords);
        map.fitBounds(bounds, { padding: [50, 50] });
        hasFitRouteBoundsRef.current = true;
      }
      return;
    }

    // Reuse marker instances. A GPS tick or unchanged snapshot never rebuilds pins.
    const entries = pinEntriesRef.current;
    const eligible = visibleLeads.filter(lead => lead.historicalTerritoryPin ||
      lead.solarCategory !== 'poor' || isKnockStatus(lead.status) || getAppointmentOutcome(lead) ||
      (currentUser && (lead.assignedTo === currentUser.id || lead.claimedBy === currentUser.id)));
    const visibleIds = new Set(eligible.map(lead => lead.id));
    const removed: L.Marker[] = [];
    entries.forEach((entry, id) => {
      if (!visibleIds.has(id)) { removed.push(entry.marker); entries.delete(id); }
    });
    if (removed.length) layer.removeLayers(removed);
    const assignedIds = new Set(selectedLeadIdsForAssignment);
    const byId = new Map(dispositions.map(d => [d.id, d]));
    const byName = new Map(dispositions.map(d => [String(d.name || '').toLowerCase(), d]));
    let offset = 0;
    let frame = 0;
    let cancelled = false;
    let created = 0, updated = 0;
    const renderBatch = () => {
      if (cancelled) return;
      const start = performance.now();
      const added: L.Marker[] = [];
      while (offset < eligible.length && performance.now() - start < 8 && added.length < 75) {
        const lead = eligible[offset++];
        const isClaimedByMe = !!currentUser && lead.claimedBy === currentUser.id;
        const canClaim = lead.claimedBy == null || isClaimedByMe;
        const selectedForAssignment = assignedIds.has(lead.id);
        const selected = selectedForAssignment;
        const disposition = byId.get(lead.status) || byName.get(String(lead.dispositionHistory?.[0]?.disposition || '').toLowerCase());
        const styleKey = `${fieldPinZoomTier(currentZoom)}:${viewMode}:${selected}:${isClaimedByMe}:${canClaim}:${selectedForAssignment}`;
        let entry = entries.get(lead.id);
        if (entry && entry.lead === lead && entry.styleKey === styleKey && entry.users === users && entry.disposition === disposition) continue;
        const icon = createCustomIcon(lead, users, viewMode, lead.solarCategory, lead.status, selected,
          isClaimedByMe, canClaim, !!lead.claimedBy, selectedForAssignment, disposition, currentZoom, lead.tags);
        const title = `${lead.address} · ${fieldPinArtwork(lead, disposition, currentZoom).label}`;
        if (!entry) {
          entry = { marker: L.marker([lead.lat!, lead.lng!], {icon, title, alt: title, zIndexOffset: lead.historicalTerritoryPin ? -300 : 0}), lead, styleKey, users, disposition };
          const liveEntry = entry;
          // Popup markup is only produced when opened, not for every pin during load.
          entry.marker.bindPopup(() => createPopupContent(liveEntry.lead), { maxWidth: 300, autoPan: false });
          entry.marker.on('click', () => {
            const current = liveEntry.lead;
            if (isPersistentPinPopup(current)) {
              liveEntry.marker.closePopup();
              showPersistentPopup(map, current);
              if (current.historicalTerritoryPin) return;
            } else if (persistentPopupRef.current?.isOpen()) persistentPopupRef.current.close();
            clickRef.current(current);
          });
          entries.set(lead.id, entry);
          added.push(entry.marker);
          created++;
        } else {
          const old = entry.lead;
          // Coordinates affect clustering: remove/re-add only a moved pin.
          if (old.lat !== lead.lat || old.lng !== lead.lng) {
            layer.removeLayer(entry.marker);
            entry.marker.setLatLng([lead.lat!, lead.lng!]);
            added.push(entry.marker);
          }
          entry.marker.setIcon(icon);
          entry.marker.setZIndexOffset(lead.historicalTerritoryPin ? -300 : selected ? 500 : 0);
          const element = entry.marker.getElement();
          element?.setAttribute('title', title);
          element?.setAttribute('aria-label', title);
          entry.lead = lead; entry.styleKey = styleKey; entry.users = users; entry.disposition = disposition;
          if (entry.marker.isPopupOpen()) entry.marker.setPopupContent(createPopupContent(lead));
          updated++;
        }
      }
      if (added.length) layer.addLayers(added);
      const selectedEntry = selectedPinRef.current ? entries.get(selectedPinRef.current) : undefined;
      if (selectedEntry) markPinSelected(selectedEntry, true);
      if (offset < eligible.length) frame = requestAnimationFrame(renderBatch);
      else if (process.env.NODE_ENV !== 'production') console.debug('[LeadMap] Pin reconciliation', {visible: eligible.length, created, updated, removed: removed.length});
    };
    frame = requestAnimationFrame(renderBatch);

    if (pinnedIdAtStart) {
      const pinned = leads.find((item) => item.id === pinnedIdAtStart);
      if (pinned && isPersistentPinPopup(pinned) && pinned.lat != null && pinned.lng != null) {
        showPersistentPopup(map, pinned);
      } else if (persistentPopupRef.current && !persistentPopupRef.current.isOpen()) {
        persistentPopupRef.current.openOn(map);
        persistentPopupIdRef.current = pinnedIdAtStart;
      }
    }

    // Include leads with dispositions when calculating map bounds (they may not have solar data)
    const hasDisposition = (l: any) => isKnockStatus(l.status);
    
    // Include: good solar leads OR leads with dispositions
    const goodLeads = leads.filter(l => {
      if (!l.lat || !l.lng) return false;
      // Past pins must not pull the camera away from the rep's own doors.
      if (l.historicalTerritoryPin) return false;
      const assignedToMe = currentUser != null && (l as any).assignedTo != null && (l as any).assignedTo === currentUser.id;
      const claimedByMe = currentUser != null && (l as any).claimedBy != null && (l as any).claimedBy === currentUser.id;

      // Include: good solar leads OR leads with dispositions OR leads assigned/claimed to me
      return ((l.solarCategory && l.solarCategory !== 'poor') || hasDisposition(l) || assignedToMe || claimedByMe);
    });
    // Only fit bounds once when leads first load, not on every render/pan/zoom
    // On /mobile/knocking we want to default to GPS location (not last knocked pin / small lead set).
    const preferGpsCenter = currentUser?.role !== 'admin' && hasUserPosition;

    if (goodLeads.length > 0 && goodLeads.length <= 50 && !hasFitLeadsBoundsRef.current && !userInteractedRef.current && !preferGpsCenter) {
      const bounds = L.latLngBounds(goodLeads.map(l => [l.lat!, l.lng!]));
      map.fitBounds(bounds, { padding: [50, 50] });
      hasFitLeadsBoundsRef.current = true;
    }

    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [leads, viewportIndex, currentUser, routeWaypoints, userRoutes, isClient, dispositions, zoomTier, viewportKey, hasUserPosition, users, viewMode, selectedLeadIdsForAssignment]);

  // Handle territory drawing mode
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;

    const map = mapInstanceRef.current;
    
    if (assignmentMode === 'territory') {
      // CRITICAL: Disable ALL map interactions to allow drawing
      if (map.dragging) map.dragging.disable();
      if (map.touchZoom) map.touchZoom.disable();
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
      if (map.scrollWheelZoom) map.scrollWheelZoom.disable();
      if (map.boxZoom) map.boxZoom.disable();
      if (map.keyboard) map.keyboard.disable();
      
      // Disable default click behavior on map
      map.off('click');
      map.off('dblclick');
      
      // Change cursor to crosshair
      if (mapRef.current) {
        mapRef.current.style.cursor = 'crosshair';
      }
      
      console.log('[LeadMap] Territory mode enabled - map interactions disabled');

      // Territory mode: freeform drawing (click and drag)
      let drawingPoints: L.LatLng[] = [];
      let tempPolygon: L.Polygon | null = null;
      let isDrawing = false;

      const handleMouseDown = (e: L.LeafletMouseEvent) => {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        
        isDrawing = true;
        drawingPoints = [e.latlng];
        
        // Create initial polygon
        if (tempPolygon) {
          tempPolygon.remove();
        }
        
        console.log('[LeadMap] Started drawing at:', e.latlng);
      };

      const handleMouseMove = (e: L.LeafletMouseEvent) => {
        if (!isDrawing) return;
        
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        
        // Add point every few pixels to smooth the line
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        const distance = map.distance(lastPoint, e.latlng);
        
        // Only add point if moved enough (prevents too many points)
        if (distance > 10) {
          drawingPoints.push(e.latlng);
          
          // Update polygon
          if (tempPolygon) {
            tempPolygon.remove();
          }
          
          if (drawingPoints.length >= 3) {
            tempPolygon = L.polygon(drawingPoints, {
              color: '#8b5cf6',
              fillColor: '#8b5cf6',
              fillOpacity: 0.2,
              weight: 3,
            }).addTo(map);
          } else if (drawingPoints.length >= 2) {
            // Show line while drawing
            const line = L.polyline(drawingPoints, {
              color: '#8b5cf6',
              weight: 3,
            }).addTo(map);
            tempPolygon = line as any;
          }
          
          console.log('[LeadMap] Drawing - points:', drawingPoints.length);
        }
      };

      const handleMouseUp = (e: L.LeafletMouseEvent) => {
        if (!isDrawing) return;
        
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        
        isDrawing = false;
        
        console.log('[LeadMap] Finished drawing - points:', drawingPoints.length);
        
        if (drawingPoints.length < 3) {
          // Not enough points, clear and alert
          if (tempPolygon) tempPolygon.remove();
          drawingPoints = [];
          tempPolygon = null;
          alert('Draw a larger area (move your mouse while clicking)');
          return;
        }

        // Close the polygon
        drawingPoints.push(drawingPoints[0]);
        
        // Redraw final polygon
        if (tempPolygon) {
          tempPolygon.remove();
        }
        tempPolygon = L.polygon(drawingPoints, {
          color: '#8b5cf6',
          fillColor: '#8b5cf6',
          fillOpacity: 0.3,
          weight: 3,
        }).addTo(map);

        // Find leads within polygon
        const polygon = L.polygon(drawingPoints);
        const leadsInside = leads.filter(lead => {
          if (!lead.lat || !lead.lng) return false;
          const point = L.latLng(lead.lat, lead.lng);
          return polygon.getBounds().contains(point) && isPointInPolygon(point, drawingPoints);
        });

        console.log('[LeadMap] Leads found in territory:', leadsInside.length);

        // Call callback with lead IDs and polygon coordinates
        if (onTerritoryDrawn) {
          const polygonCoords: [number, number][] = drawingPoints.map(p => [p.lat, p.lng]);
          onTerritoryDrawn(leadsInside.map(l => l.id), polygonCoords);
        }

        // Clean up after delay so user can see the result
        setTimeout(() => {
          if (tempPolygon) tempPolygon.remove();
          drawingPoints = [];
          tempPolygon = null;
        }, 500);
      };

      map.on('mousedown', handleMouseDown);
      map.on('mousemove', handleMouseMove);
      map.on('mouseup', handleMouseUp);

      return () => {
        map.off('mousedown', handleMouseDown);
        map.off('mousemove', handleMouseMove);
        map.off('mouseup', handleMouseUp);
        
        // Re-enable ALL map controls
        if (map.dragging) map.dragging.enable();
        if (map.touchZoom) map.touchZoom.enable();
        if (map.doubleClickZoom) map.doubleClickZoom.enable();
        if (map.scrollWheelZoom) map.scrollWheelZoom.enable();
        if (map.boxZoom) map.boxZoom.enable();
        if (map.keyboard) map.keyboard.enable();
        
        // Reset cursor
        if (mapRef.current) {
          mapRef.current.style.cursor = '';
        }
        
        if (tempPolygon) tempPolygon.remove();
        
        console.log('[LeadMap] Territory mode disabled - map interactions restored');
      };
    } else {
      // Not in territory mode - ensure map controls are enabled
      if (map.dragging) map.dragging.enable();
      if (map.touchZoom) map.touchZoom.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      if (map.scrollWheelZoom) map.scrollWheelZoom.enable();
      if (map.boxZoom) map.boxZoom.enable();
      if (map.keyboard) map.keyboard.enable();
      
      if (mapRef.current) {
        mapRef.current.style.cursor = '';
      }
    }
  }, [assignmentMode, leads, onTerritoryDrawn, isClient]);

  // Update marker styling for selected leads in assignment mode
  useEffect(() => {
    if (!markersLayerRef.current || assignmentMode === 'none') return;

    // Re-render markers with selection highlight
    // This is handled in the main markers effect above
  }, [selectedLeadIdsForAssignment, assignmentMode]);

  // Update user position marker (person icon)
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;

    const map = mapInstanceRef.current;

    if (userPosition) {
      const [lat, lng] = userPosition;

      if (userMarkerRef.current) {
        // Update existing marker position (more performant than remove/recreate)
        userMarkerRef.current.setLatLng([lat, lng]);
      } else {
        // Create person icon (red for high visibility)
        const personIcon = L.divIcon({
          className: 'user-location-marker',
          html: `
            <div style="
              position: relative;
              width: 40px;
              height: 40px;
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <div style="
                position: absolute;
                width: 40px;
                height: 40px;
                background: rgba(239, 68, 68, 0.2);
                border-radius: 50%;
                animation: pulse 2s infinite;
              "></div>
              <div style="
                position: relative;
                width: 32px;
                height: 32px;
                background: #EF4444;
                border: 3px solid #ffffff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                z-index: 1;
              ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              </div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });

        userMarkerRef.current = L.marker([lat, lng], {
          icon: personIcon,
          zIndexOffset: 1000,
        }).addTo(map);
      }
    } else {
      // Remove marker if no position
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
    }

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
    };
  }, [userPosition, isClient]);

  // Handle manual recenter when center prop changes
  const prevCenterRef = useRef<[number, number] | undefined>(undefined);
  useEffect(() => {
    if (!mapInstanceRef.current || !center) return;
    
    // Only recenter if center actually changed (not just re-rendered with same value)
    const prevCenter = prevCenterRef.current;
    const centerChanged = !prevCenter || 
      prevCenter[0] !== center[0] || 
      prevCenter[1] !== center[1];
    
    if (centerChanged) {
      const map = mapInstanceRef.current;
      map.setView(center, map.getZoom());
      prevCenterRef.current = center;
    }
  }, [center]);

  // Render territory polygons (assignments view only)
  const territoriesLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;

    const map = mapInstanceRef.current;

    // Clear existing territories
    if (territoriesLayerRef.current) {
      territoriesLayerRef.current.clearLayers();
    } else {
      territoriesLayerRef.current = L.layerGroup().addTo(map);
    }

    // Assignments/territory views keep their existing overlay. Field map uses showTeamAreas.
    console.log('[LeadMap] Territory rendering check:', { viewMode, showTeamAreas, territoriesCount: territories.length, currentUserRole: currentUser?.role });
    if (!shouldRenderTerritoryOverlay(viewMode, showTeamAreas)) {
      console.log('[LeadMap] Territory overlay off, skipping territories');
      return;
    }

    // Filter territories: in territory view, show only current user's territory (unless admin/manager).
    // The field toggle shows every assigned FMA area so teammates can see each other.
    let territoriesToRender = territories;
    if (!showTeamAreas && viewMode === 'territory' && currentUser && currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      territoriesToRender = territories.filter(t => t.userId === currentUser.id);
      console.log('[LeadMap] Filtering to user territory:', territoriesToRender.length);
    }

    if (territoriesToRender.length === 0) {
      console.log('[LeadMap] No territories to render');
      return;
    }
    console.log('[LeadMap] Rendering territories:', territoriesToRender);

    territoriesToRender.forEach(territory => {
      if (!territory.polygon || territory.polygon.length < 3) return;

      // Convert TerritoryPoint objects to Leaflet format [lat, lng]
      const leafletCoords: [number, number][] = territory.polygon.map((p: any) => [p.lat, p.lng]);

      const areaColor = colorForTerritory(territory, users);
      const polygon = L.polygon(leafletCoords, {
        color: areaColor,
        fillColor: areaColor,
        fillOpacity: 0.2, // More visible fill
        weight: 4, // Thicker border
        opacity: 1, // Full opacity on border
        interactive: !showTeamAreas, // Field overlay must not steal lead-pin clicks
      });

      // Add permanent label in center of territory
      const bounds = polygon.getBounds();
      const center = bounds.getCenter();
      
      const label = L.marker(center, {
        icon: L.divIcon({
          className: 'territory-label',
          html: `
            <div style="
              background: ${areaColor};
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              font-weight: bold;
              font-size: 14px;
              white-space: nowrap;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              border: 2px solid white;
              pointer-events: none;
            ">
              ${territory.userName}
            </div>
          `,
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
      });

      if (!showTeamAreas) {
        const popupContent = `
          <div style="padding:12px;font-family:system-ui,-apple-system,sans-serif;">
            <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:${areaColor};">${territory.userName}</h3>
            <p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">${territory.leadIds.length} leads assigned</p>
            <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;">Created: ${new Date(territory.createdAt).toLocaleDateString()}</p>
            <button 
              id="delete-territory-${territory.id}"
              style="
                width:100%;
                padding:8px 16px;
                background:#EF4444;
                color:white;
                border:none;
                border-radius:6px;
                font-size:14px;
                font-weight:600;
                cursor:pointer;
                transition:background 0.2s;
              "
              onmouseover="this.style.background='#DC2626'"
              onmouseout="this.style.background='#EF4444'"
            >
              Delete Territory
            </button>
          </div>
        `;

        polygon.bindPopup(popupContent);
        
        // Add delete button handler when popup opens
        polygon.on('popupopen', () => {
          const deleteBtn = document.getElementById(`delete-territory-${territory.id}`);
          if (deleteBtn && onTerritoryDelete) {
            deleteBtn.addEventListener('click', () => {
              if (confirm(`Delete territory for ${territory.userName}?\n\nThis will unassign all ${territory.leadIds.length} leads but preserve their history.`)) {
                onTerritoryDelete(territory.id);
                map.closePopup();
              }
            });
          }
        });
      }

      polygon.addTo(territoriesLayerRef.current!);
      label.addTo(territoriesLayerRef.current!);
    });

    // Auto-fit bounds to show territory in territory view mode (only once).
    // Field toggle must not yank the knocker's current map position.
    if (!showTeamAreas && viewMode === 'territory' && territories.length > 0 && !hasFitTerritoryBoundsRef.current) {
      const allTerritoryCoords: [number, number][] = [];
      territories.forEach(t => {
        if (t.polygon) {
          t.polygon.forEach((p: any) => {
            allTerritoryCoords.push([p.lat, p.lng]);
          });
        }
      });
      if (allTerritoryCoords.length > 0) {
        const territoryBounds = L.latLngBounds(allTerritoryCoords);
        map.fitBounds(territoryBounds, { padding: [50, 50] });
        hasFitTerritoryBoundsRef.current = true;
      }
    }

    return () => {
      if (territoriesLayerRef.current) {
        territoriesLayerRef.current.clearLayers();
      }
    };
  }, [territories, users, viewMode, showTeamAreas, isClient]);

  // Named FMA location pins — only while the field toggle is on
  const teamMembersLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;

    const map = mapInstanceRef.current;
    if (teamMembersLayerRef.current) {
      teamMembersLayerRef.current.clearLayers();
    } else {
      teamMembersLayerRef.current = L.layerGroup().addTo(map);
    }

    if (!showTeamAreas || teamMembers.length === 0) return;

    teamMembers.forEach((member) => {
      if (!Number.isFinite(member.lat) || !Number.isFinite(member.lng)) return;

      const marker = L.marker([member.lat, member.lng], {
        icon: L.divIcon({
          className: 'team-area-member-marker',
          html: `
            <div style="position:relative;display:flex;flex-direction:column;align-items:center;pointer-events:none;">
              <div style="
                width:22px;
                height:22px;
                background:${member.color || '#FF5F5A'};
                border:3px solid #ffffff;
                border-radius:50%;
                box-shadow:0 2px 8px rgba(0,0,0,0.35);
              "></div>
              <div style="
                margin-top:4px;
                color:#ffffff;
                font-size:12px;
                font-weight:700;
                text-shadow:0 1px 3px rgba(0,0,0,0.85);
                white-space:nowrap;
              ">${member.name}</div>
            </div>
          `,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 800,
      });

      marker.addTo(teamMembersLayerRef.current!);
    });

    return () => {
      if (teamMembersLayerRef.current) {
        teamMembersLayerRef.current.clearLayers();
      }
    };
  }, [teamMembers, showTeamAreas, isClient]);

  // Handle dropping a pin
  const handleDropPin = async (latlng: L.LatLng) => {
    try {
      if (!mapInstanceRef.current || assignmentMode !== 'none') {
        console.log('[LeadMap] handleDropPin blocked:', { hasMap: !!mapInstanceRef.current, assignmentMode });
        return;
      }

      console.log('[LeadMap] handleDropPin called with latlng:', latlng);
    
    const map = mapInstanceRef.current;

    // Remove existing temp pin if any
    if (tempPinRef.current) {
      tempPinRef.current.remove();
    }

    // Add temporary pin
    const tempPin = L.marker([latlng.lat, latlng.lng], {
      icon: L.divIcon({
        html: '<div style="width:40px;height:40px;background:#FF5F5A;border:4px solid white;border-radius:50%;box-shadow:0 4px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-center;"><span style="color:white;font-size:20px;">+</span></div>',
        className: 'temp-pin',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
    }).addTo(map);

    tempPinRef.current = tempPin;
    console.log('[LeadMap] Temp pin created at', latlng.lat, latlng.lng);

    // Send debug log - temp pin created
    apiFetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', message: 'Temp pin created, starting geocode', data: { lat: latlng.lat, lng: latlng.lng } })
    }).catch(() => {});

    // Reverse geocode to get address
    try {
      const response = await apiFetch(
        `/api/geocode?lat=${latlng.lat}&lng=${latlng.lng}&reverse=true`
      );
      const data = await response.json();
      console.log('[LeadMap] Geocode result:', data);

      if (data.results && data.results[0]) {
        const result = data.results[0];
        const components = result.address_components || [];

        let street = '';
        let city = '';
        let state = '';
        let zip = '';

        components.forEach((component: any) => {
          if (component.types.includes('street_number')) {
            street = component.long_name + ' ' + street;
          }
          if (component.types.includes('route')) {
            street += component.long_name;
          }
          if (component.types.includes('locality')) {
            city = component.long_name;
          }
          if (component.types.includes('administrative_area_level_1')) {
            state = component.short_name;
          }
          if (component.types.includes('postal_code')) {
            zip = component.long_name;
          }
        });

        setDropPinAddress({ address: street.trim(), city, state, zip });
      }
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      setDropPinAddress({ address: '', city: '', state: '', zip: '' });
    }

    setDropPinLocation({ lat: latlng.lat, lng: latlng.lng });
    setShowAddLeadModal(true);
    console.log('[LeadMap] Modal should show now');
    
    // Send debug log - modal state set
    apiFetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', message: 'Modal state set to true', data: { lat: latlng.lat, lng: latlng.lng } })
    }).catch(() => {});
    } catch (error) {
      console.error('[LeadMap] handleDropPin error:', error);
      apiFetch('/api/debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'error', message: 'handleDropPin failed', data: { error: String(error) } })
      }).catch(() => {});
    }
  };

  // Handle saving new lead from dropped pin
  const handleSaveDroppedLead = async (leadData: Partial<Lead>) => {
    try {
      if (isProximityRequired(currentUser)) {
        try {
          const position = await getLocation({
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });

          const pinLat = typeof leadData.lat === 'number' ? leadData.lat : dropPinLocation?.lat;
          const pinLng = typeof leadData.lng === 'number' ? leadData.lng : dropPinLocation?.lng;

          if (typeof pinLat === 'number' && typeof pinLng === 'number') {
            const R = 6371000;
            const dLat = (pinLat - position.coords.latitude) * Math.PI / 180;
            const dLng = (pinLng - position.coords.longitude) * Math.PI / 180;
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(position.coords.latitude * Math.PI / 180) *
              Math.cos(pinLat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distanceFromPin = R * c;

            if (distanceFromPin > PROXIMITY_MAX_DISTANCE_METERS) {
              const distanceFeet = Math.round(distanceFromPin * 3.281);
              alert(
                `You are not close enough to this pin to create it.\n\n` +
                `Distance: ${distanceFeet} feet away\n` +
                `Required: Within 100 feet\n\n` +
                `Please move closer to the location and try again.`
              );
              return;
            }
          }
        } catch (err) {
          console.warn('[LeadMap] Manual pin GPS capture failed:', err);
          alert('Your location could not be verified. Enable precise location and try again.');
          return;
        }
      }

      // Generate ID
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const firebaseUid = auth?.currentUser?.uid;
      if (!firebaseUid) {
        throw new Error('Auth not ready — please wait 2 seconds and try again.');
      }

      const manualDisposition = typeof leadData.disposition === 'string' ? leadData.disposition : undefined;
      const manualStatus = typeof leadData.status === 'string' ? leadData.status : undefined;
      const historyEntry = manualDisposition
        ? [{
            disposition: manualDisposition,
            timestamp: new Date(),
            userId: currentUser?.id || firebaseUid,
            userName: currentUser?.name || 'User',
          }]
        : undefined;

      const newLead: Lead = {
        ...leadData,
        id,
        status: manualStatus || 'available',
        disposition: manualDisposition,
        dispositionedAt: manualDisposition ? (leadData.dispositionedAt || new Date()) : leadData.dispositionedAt,
        dispositionHistory: (leadData.dispositionHistory as any) || historyEntry,
        createdAt: new Date(),
        // Manual lead ownership: must match Firestore rules (setterId == request.auth.uid)
        setterId: firebaseUid,
        // Also set claimedBy so rep-safe map queries (claimedBy/assignedTo) include it
        claimedBy: firebaseUid,
        claimedAt: new Date(),
        source: 'manually-added', // Mark as manually added via map pin drop
      } as Lead;

      // Save to Firestore (create)
      const { saveLeadAsync, updateLeadAsync } = await import('@/app/utils/storage');
      await saveLeadAsync(newLead);

      // Auto-assign to territory user if within a territory
      // NOTE: This requires write permissions to change assignedTo.
      // Under our Firestore rules, only admins can reassign leads.
      if (currentUser?.role === 'admin' && newLead.lat && newLead.lng) {
        try {
          const territories = await getTerritoriesAsync();
          if (territories.length > 0) {
            const territory = findLeadTerritory(newLead, territories);
            if (territory?.userId) {
              await updateLeadAsync(newLead.id, {
                assignedTo: territory.userId,
                assignedAt: new Date(),
                status: 'assigned',
              });
              console.log('[LeadMap] Auto-assigned lead to territory user:', territory.userId);
            }
          }
        } catch (err) {
          console.warn('[LeadMap] Territory auto-assignment failed:', err);
        }
      }

      // Run Solar API in background
      if (newLead.lat && newLead.lng) {
        apiFetch('/api/solar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: `${newLead.address}, ${newLead.city}, ${newLead.state} ${newLead.zip}`,
            lat: newLead.lat,
            lng: newLead.lng,
          }),
        })
          .then((res) => res.json())
          .then((solarData) => {
            if (solarData.solarScore) {
              // Update lead with solar data (partial update; do not overwrite ownership fields)
              updateLeadAsync(newLead.id, {
                solarScore: solarData.solarScore,
                solarCategory: solarData.solarCategory,
                solarMaxPanels: solarData.maxPanels,
                solarSunshineHours: solarData.sunshineHours,
                hasSouthFacingRoof: solarData.hasSouthFacingRoof,
                solarTestedAt: new Date(),
              }).catch((err: any) => {
                console.error('Solar enrichment update failed:', err);
              });
            }
          })
          .catch((err) => console.error('Solar API error:', err));
      }

      // Remove temp pin
      if (tempPinRef.current) {
        tempPinRef.current.remove();
        tempPinRef.current = null;
      }

      setShowAddLeadModal(false);
      setDropPinLocation(null);

      // Call parent callback to refresh leads (keeps map position)
      if (onLeadAdded) {
        onLeadAdded();
      }
    } catch (error: any) {
      console.error('Error saving dropped lead:', error);
      // Surface the real reason up to UI (permission-denied vs auth-not-ready)
      const msg = error?.message || String(error);
      const code = (error as any)?.code;
      apiFetch('/api/debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'error', message: 'manual lead save failed', data: { code, error: msg } })
      }).catch(() => {});
      const pretty = code ? `[${code}] ${msg}` : msg;
      throw new Error(pretty);
    }
  };

  // Handle GPS locate button click
  const handleLocateMe = () => {
    if (!mapInstanceRef.current || !userPosition) return;
    
    const map = mapInstanceRef.current;
    // Center on GPS location and zoom to street level
    map.setView([userPosition[0], userPosition[1]], 17, {
      animate: true,
      duration: 0.5,
    });
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full min-h-[400px] rounded-xl overflow-hidden shadow-lg" style={{ zIndex: 0 }} />
      
      {/* Both real basemaps remain available without changing pins or map position. */}
      <div role="group" aria-label="Map imagery"
        className="absolute top-3 right-3 z-20 flex gap-1 rounded-xl border border-[#D5DFDA] bg-white p-1 shadow-lg">
        {([{ value: 'street', label: 'Map', description: 'Street map' },
          { value: 'satellite', label: 'Satellite', description: 'Real aerial imagery' }] as const).map(option => (
          <button key={option.value} type="button" aria-pressed={mapType === option.value}
            title={option.description}
            onClick={() => {
              if (mapType === option.value) return;
              setMapType(option.value);
              onMapTypeChange?.(option.value);
            }}
            className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors ${mapType === option.value
              ? 'bg-[#203D49] text-white' : 'text-[#3D5E58] hover:bg-[#EDF2EB]'}`}>
            {option.label}
          </button>
        ))}
      </div>

      {onToggleTeamAreas && (
        <button
          type="button"
          onClick={() => onToggleTeamAreas(!showTeamAreas)}
          className={`absolute top-20 right-6 px-4 py-2 border-2 rounded-lg shadow-lg flex items-center gap-2 font-medium text-sm z-20 transition-all duration-200 hover:scale-105 active:scale-95 ${
            showTeamAreas
              ? 'bg-[#FF5F5A] border-[#FF5F5A] text-white'
              : 'bg-white border-[#E2E8F0] text-[#2D3748] hover:bg-[#FF5F5A] hover:text-white'
          }`}
          title={showTeamAreas ? 'Hide team areas' : 'Show team areas'}
          aria-pressed={showTeamAreas}
          style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
            <path d="M9 3v15" />
            <path d="M15 6v15" />
          </svg>
          {showTeamAreas ? 'Hide areas' : 'Show team areas'}
        </button>
      )}

      {/* GPS Locate Button */}
      {userPosition && showLocateControl && (
        <button
          onClick={handleLocateMe}
          className="absolute bottom-6 right-6 w-12 h-12 bg-white hover:bg-[#FF5F5A] border-2 border-[#E2E8F0] rounded-full shadow-lg flex items-center justify-center text-[#FF5F5A] hover:text-white transition-all duration-200 hover:scale-110 active:scale-95 z-20"
          title="Center on my location"
          style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </button>
      )}
      
      {/* Drawing Instructions */}
      {assignmentMode === 'territory' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-purple-500 text-white px-6 py-3 rounded-lg shadow-lg z-10">
          <p className="text-sm font-medium">
            🖊️ Click and drag to draw territory • Release to select leads
          </p>
        </div>
      )}

      {/* Manual Selection Instructions */}
      {assignmentMode === 'manual' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-6 py-3 rounded-lg shadow-lg z-10">
          <p className="text-sm font-medium">
            👆 Click leads to select • {selectedLeadIdsForAssignment.length} selected
          </p>
        </div>
      )}

      {/* Add Lead Modal */}
      {dropPinLocation && (
        <AddLeadModal
          isOpen={showAddLeadModal}
          onClose={() => {
            setShowAddLeadModal(false);
            setDropPinLocation(null);
            if (tempPinRef.current) {
              tempPinRef.current.remove();
              tempPinRef.current = null;
            }
          }}
          onSave={handleSaveDroppedLead}
          initialAddress={dropPinAddress.address}
          initialCity={dropPinAddress.city}
          initialState={dropPinAddress.state}
          initialZip={dropPinAddress.zip}
          lat={dropPinLocation.lat}
          lng={dropPinLocation.lng}
        />
      )}
    </div>
  );
}

// Helper function to check if point is inside polygon
function isPointInPolygon(point: L.LatLng, polygon: L.LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    
    const intersect = ((yi > point.lng) !== (yj > point.lng))
        && (point.lat < (xj - xi) * (point.lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Map Lucide icon names to unicode characters for map markers
const ICON_TO_UNICODE: Record<string, string> = {
  'circle': '●',
  'target': '◆',
  'home': '🏠',
  'star': '★',
  'x-circle': '✗',
  'check-circle': '✓',
  'calendar': '📅',
  'phone': '📞',
  'mail': '✉',
  'user': '👤',
  'users': '👥',
  'clock': '🕐',
  'alert-circle': '⚠',
  'help-circle': '?',
  'thumbs-up': '👍',
  'thumbs-down': '👎',
  'flag': '🚩',
  'bookmark': '🔖',
  'heart': '❤',
  'map-pin': '📍',
  'door-open': '🚪',
  'door-closed': '🚪',
  'bell': '🔔',
  'message-square': '💬',
  'file-text': '📄',
  'clipboard': '📋',
  'dollar-sign': '💰',
  'zap': '⚡',
  'sun': '☀',
  'cloud': '☁',
  'umbrella': '☂',
  'car': '🚗',
  'truck': '🚚',
  'building': '🏢',
  'briefcase': '💼',
  'coffee': '☕',
  'gift': '🎁',
  'shield': '🛡',
  'lock': '🔒',
  'unlock': '🔓',
  'key': '🔑',
  'trash': '🗑',
  'archive': '📦',
  'ban': '🚫',
  'slash': '⃠',
  'minus-circle': '⊖',
  'plus-circle': '⊕',
  'info': 'ℹ',
  'x': '✕',
  'check': '✓',
  'arrow-right': '→',
  'arrow-left': '←',
};

function createMutedHistoricalIcon(disposition: Disposition | undefined, zoom: number): L.DivIcon {
  let size = 30;
  let showIcon = true;
  if (zoom < 12) {
    size = 7;
    showIcon = false;
  } else if (zoom < 14) {
    size = 13;
    showIcon = false;
  } else if (zoom < 16) {
    size = 20;
  }

  const color = '#9CA3AF';
  const icon = disposition ? (ICON_TO_UNICODE[disposition.icon] || '●') : '●';

  if (zoom < 14) {
    const html = `<div style="width:${size}px;height:${size}px;background:${color};border:1px solid #6B7280;border-radius:50%;opacity:0.8;box-shadow:0 1px 2px rgba(0,0,0,0.2);"></div>`;
    return L.divIcon({
      html,
      className: 'custom-marker historical-pin',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  const fontSize = showIcon ? size * 0.45 : 0;
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:2px solid #6B7280;border-radius:50% 50% 50% 0;transform:rotate(-45deg);opacity:0.82;box-shadow:0 2px 4px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;">
      ${showIcon ? `<span style="transform:rotate(45deg);color:#F9FAFB;font-size:${fontSize}px;font-weight:bold;">${icon}</span>` : ''}
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-marker historical-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function escapePopupText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createCustomIcon(
  lead: Lead,
  users: User[],
  viewMode: 'map' | 'assignments' | 'territory',
  solarCategory: string | undefined,
  status: string,
  isSelected: boolean,
  isClaimedByMe: boolean,
  canClaim: boolean,
  isClaimed: boolean,
  isSelectedForAssignment: boolean = false,
  disposition?: Disposition,
  zoom: number = 12,
  tags?: string[]
): L.DivIcon {
  // Other reps' past Appointment Set / Sold pins. Own pins never take this path.
  if (lead.historicalTerritoryPin) {
    return createMutedHistoricalIcon(disposition, zoom);
  }

  if (viewMode === 'map') {
    const pin = fieldPinArtwork(lead, disposition, zoom, isSelected);
    const hitSize = Math.max(44, pin.height);
    const left = (hitSize - pin.size) / 2;
    const top = hitSize - pin.height;
    return L.divIcon({
      className: 'field-pin',
      html: `<img src="${pin.url}" width="${pin.size}" height="${pin.height}" alt="" draggable="false" style="display:block;pointer-events:none;position:absolute;left:${left}px;top:${top}px"/>`,
      iconSize: [hitSize, hitSize], iconAnchor: [hitSize / 2, zoom < 14 ? top + pin.height / 2 : hitSize - (pin.height * 3 / 56)], popupAnchor: [0, -pin.height],
    });
  }

  // Customer pins (installed sales/customers)
  const leadType = (lead.leadType === 'sale' ? 'customer' : lead.leadType) || 'prospect';
  const isCustomerPin = leadType === 'customer';

  // Check if this is a manually-added lead (red pins)
  const isManuallyAdded = lead.source === 'manually-added';
  
  // Check if this is a homeowner/home-data lead (subtle gray pins)
  const isHomeownerLead = tags && (tags.includes('homeowner') || tags.includes('home-data'));
  
  // Zoom-based sizing
  // Zoom < 12: Simple dots (8px)
  // Zoom 12-14: Small pins (16px)
  // Zoom 14-16: Medium pins (24px)
  // Zoom > 16: Full pins (36px)
  let baseSize = 36;
  let showIcon = true;
  
  if (zoom < 12) {
    baseSize = 8;
    showIcon = false;
  } else if (zoom < 14) {
    baseSize = 16;
    showIcon = false;
  } else if (zoom < 16) {
    baseSize = 24;
    showIcon = true;
  }

  // Manual pins with dispositions should always show an icon/emoji
  if (isManuallyAdded && disposition) {
    showIcon = true;
    baseSize = Math.max(baseSize, 18);
  }
  
  // Homeowner leads are 70% smaller (more subtle)
  if (isHomeownerLead) {
    baseSize = Math.round(baseSize * 0.7);
  }
  
  const size = isSelected ? baseSize * 1.2 : baseSize;
  
  // For simple dots (zoomed out), use circles instead of teardrops
  const isSimpleDot = zoom < 14;

  // Customer pins: always smiley marker, smaller + non-disposition
  if (isCustomerPin) {
    const customerSize = Math.max(10, Math.round(size * 0.75));
    const html = `
      <div style="width:${customerSize}px;height:${customerSize}px;background:white;border:2px solid #10b981;border-radius:9999px;box-shadow:0 3px 6px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;">
        <span style="font-size:${Math.round(customerSize * 0.55)}px;line-height:1;">🙂</span>
      </div>
    `;
    return L.divIcon({ html, className: 'custom-marker', iconSize: [customerSize, customerSize], iconAnchor: [customerSize / 2, customerSize / 2], popupAnchor: [0, -customerSize / 2] });
  }
  
  const solarColors: Record<string, string> = {
    great: '#10b981',
    good: '#3b82f6',
    solid: '#f59e0b',
  };
  
  // Manually-added leads: red pin (stands out from all other leads)
  // Homeowner leads: gray pin with solar rating as border color
  let color: string;
  let border: string;
  
  if (isManuallyAdded) {
    // Red pin for manually-added leads (via map pin drop)
    color = '#FF5F5A'; // Bright red
    
    if (isSelectedForAssignment) {
      border = '3px solid #8b5cf6'; // Purple for assignment
    } else if (isSelected) {
      border = '3px solid white';
    } else if (isSimpleDot) {
      border = 'none';
    } else {
      border = '3px solid white'; // Thicker white border to stand out
    }
  } else if (isHomeownerLead) {
    // Gray pin body for homeowner/home-data leads
    color = '#6b7280';
    
    // Solar rating determines border color
    const solarBorderColor = solarCategory ? solarColors[solarCategory] : undefined;
    
    if (isSelectedForAssignment) {
      border = '3px solid #8b5cf6'; // Purple for assignment
    } else if (isSelected) {
      border = '2px solid white';
    } else if (solarBorderColor) {
      border = `3px solid ${solarBorderColor}`; // Solar rating color border!
    } else if (isSimpleDot) {
      border = 'none';
    } else {
      border = '2px solid #9ca3af'; // Light gray border if no solar data
    }
  } else {
    // In assignments view: show territory colors
    // In map view: show solar/disposition/status colors
    let territoryColor: string | undefined;
    
    if (viewMode === 'assignments') {
      const assignedUser = lead.assignedTo ? users.find(u => u.id === lead.assignedTo) : null;
      const claimedUser = lead.claimedBy ? users.find(u => u.id === lead.claimedBy) : null;
      territoryColor = assignedUser?.color || claimedUser?.color;
    }
    
    // Solar data leads (or no tags): colorful pins as before.
    // House for Sale keeps its sky pin so it stays distinct from Go Back / solar colors.
    const preferDispositionColor = disposition?.id === 'house-for-sale';
    color = territoryColor
      || (preferDispositionColor ? disposition?.color : undefined)
      || (solarCategory ? solarColors[solarCategory] : undefined)
      || disposition?.color 
      || (STATUS_COLORS as Record<string, string>)[status] 
      || '#6b7280';
    
    border = isSelectedForAssignment 
      ? '3px solid #8b5cf6'
      : isSelected 
      ? '2px solid white' 
      : isSimpleDot ? 'none' : '2px solid white';
  }
  
  const opacity = isClaimed && !canClaim ? 0.7 : 1;
  
  // Use disposition icon if available, otherwise fallback to default
  const icon = disposition 
    ? (ICON_TO_UNICODE[disposition.icon] || '●')
    : '●';
  
  // Simple dot for zoomed out
  if (isSimpleDot) {
    const html = `
      <div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50%;opacity:${opacity};box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>
    `;
    return L.divIcon({ html, className: 'custom-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
  }
  
  // Teardrop pin for zoomed in
  const fontSize = showIcon ? size * 0.5 : 0;
  const iconDisplay = showIcon ? icon : '';
  
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50% 50% 50% 0;transform:rotate(-45deg);opacity:${opacity};box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      ${showIcon ? `<span style="transform:rotate(45deg);color:white;font-size:${fontSize}px;font-weight:bold;">${iconDisplay}</span>` : ''}
    </div>
  `;

  return L.divIcon({ html, className: 'custom-marker', iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size] });
}

function isPersistentPinPopup(lead: Lead): boolean {
  return lead.historicalTerritoryPin === true || isAppointmentSetOrSoldLead(lead);
}

function pastPinDetailHtml(lead: Lead, alreadyShown?: string): string {
  if (!isPersistentPinPopup(lead)) return '';
  // The status badge already shows this label. Skip a second copy of it.
  const shown = alreadyShown?.trim();
  return pastPinPopupLines(lead)
    .filter((line) => line !== shown)
    .map((line) => `<p style="margin:8px 0 0 0;font-size:12px;color:#4b5563;">${escapePopupText(line)}</p>`)
    .join('');
}

function createPopupContent(lead: Lead): string {
  const outcome = getAppointmentOutcome(lead);
  const outcomeHtml = outcome ? `<p style="margin:9px 0;padding:7px 9px;background:${outcome.background};color:${outcome.color};border-radius:7px;font-size:12px;font-weight:600;">GHL: ${escapePopupText(outcome.label)}</p>` : '';

  if (lead.historicalTerritoryPin) {
    const statusLabel = STATUS_LABELS[lead.status] || lead.disposition || lead.status || 'Past pin';
    return `
      <div data-pin-id="${escapePopupText(lead.id)}" style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
        <div style="display:inline-block;margin:0 0 8px 0;padding:2px 8px;background:#F3F4F6;color:#4B5563;border-radius:9999px;font-size:11px;font-weight:700;letter-spacing:0.02em;">PAST PIN</div>
        <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#374151;">${escapePopupText(lead.name)}</h3>
        <p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">${escapePopupText(lead.address)}</p>
        <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;">${escapePopupText(lead.city)}, ${escapePopupText(lead.state)} ${escapePopupText(lead.zip)}</p>
        <div style="display:inline-block;padding:4px 10px;background:#E5E7EB;color:#4B5563;border-radius:9999px;font-size:12px;font-weight:600;">${escapePopupText(statusLabel)}</div>
        ${outcomeHtml}${pastPinDetailHtml(lead, statusLabel)}
        <p style="margin:8px 0 0 0;font-size:11px;color:#6b7280;">Another rep already set or sold this door. Shown because it is inside your territory.</p>
      </div>
    `;
  }

  const leadType = (lead.leadType === 'sale' ? 'customer' : lead.leadType) || 'prospect';
  if (leadType === 'customer') {
    const name = (lead.customerFirstName || lead.customerLastName)
      ? `${lead.customerFirstName || ''} ${lead.customerLastName || ''}`.trim()
      : (lead.name || 'Customer');

    return `
      <div style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
        <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#1f2937;">🙂 ${name}</h3>
        <p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">${lead.address}</p>
        <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;">${lead.city}, ${lead.state} ${lead.zip || ''}</p>
        <div style="font-size:12px;color:#4b5563;">
          ${lead.soldByName ? `<div><strong>Sales Rep:</strong> ${lead.soldByName}</div>` : ''}
          ${lead.setByName ? `<div><strong>FMA:</strong> ${lead.setByName}</div>` : ''}
        </div>
        ${outcomeHtml}
        ${lead.phone ? `<p style="margin:8px 0 0 0;font-size:13px;color:#4b5563;">📞 ${lead.phone}</p>` : ''}
      </div>
    `;
  }

  const statusColor = STATUS_COLORS[lead.status] || '#6b7280';
  const statusLabel = STATUS_LABELS[lead.status] || lead.disposition || lead.status;
  
  return `
    <div data-pin-id="${escapePopupText(lead.id)}" style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
      <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#1f2937;">${escapePopupText(lead.name)}</h3>
      <p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">${escapePopupText(lead.address)}</p>
      <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;">${escapePopupText(lead.city)}, ${escapePopupText(lead.state)} ${escapePopupText(lead.zip)}</p>
      <div style="display:inline-block;padding:4px 10px;background:${statusColor}20;color:${statusColor};border-radius:9999px;font-size:12px;font-weight:500;">${escapePopupText(statusLabel)}</div>
      ${outcomeHtml}${pastPinDetailHtml(lead, statusLabel)}
      ${lead.phone ? `<p style="margin:8px 0 0 0;font-size:13px;color:#4b5563;">📞 ${escapePopupText(lead.phone)}</p>` : ''}
    </div>
  `;
}

function createRouteNumberIcon(order: number): L.DivIcon {
  const size = 36;
  const html = `
    <div style="width:${size}px;height:${size}px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      <span style="color:white;font-size:16px;font-weight:bold;">${order}</span>
    </div>
  `;
  return L.divIcon({ html, className: 'route-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function createRoutePopupContent(wp: RouteWaypoint): string {
  return `
    <div style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
      <div style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:#1f2937;">Stop #${wp.order}</div>
      <h3 style="margin:0 0 4px 0;font-size:16px;font-weight:600;color:#1f2937;">${wp.lead.name}</h3>
      <p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">${wp.lead.address}</p>
      <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">${wp.lead.city}, ${wp.lead.state} ${wp.lead.zip}</p>
      ${wp.lead.estimatedBill ? `<p style="margin:0 0 8px 0;font-size:14px;color:#3b82f6;font-weight:500;">$${wp.lead.estimatedBill}/mo</p>` : ''}
      ${wp.lead.solarScore ? `<div style="display:inline-block;padding:4px 10px;background:#3b82f620;color:#3b82f6;border-radius:9999px;font-size:12px;font-weight:500;">☀️ Solar Score: ${wp.lead.solarScore}</div>` : ''}
    </div>
  `;
}

function createActivityMarkerIcon(order: number, color: string): L.DivIcon {
  const size = 32;
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      <span style="color:white;font-size:14px;font-weight:bold;">${order}</span>
    </div>
  `;
  return L.divIcon({ html, className: 'activity-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function createPersonMarkerIcon(color: string): L.DivIcon {
  const size = 24;
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    </div>
  `;
  return L.divIcon({ html, className: 'person-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function createActivityPopupContent(wp: RouteWaypoint, userName: string): string {
  const timeStr = wp.lead.dispositionedAt 
    ? formatTimeEST(wp.lead.dispositionedAt)
    : '';
  
  return `
    <div style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
      <div style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#1f2937;">${userName} - Stop #${wp.order}</div>
      ${timeStr ? `<div style="margin:0 0 8px 0;font-size:14px;color:#6b7280;">🕐 ${timeStr} EST</div>` : ''}
      <h3 style="margin:0 0 4px 0;font-size:15px;font-weight:600;color:#1f2937;">${wp.lead.name}</h3>
      <p style="margin:0 0 4px 0;font-size:13px;color:#4b5563;">${wp.lead.address}</p>
      <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">${wp.lead.city}, ${wp.lead.state} ${wp.lead.zip}</p>
      ${wp.lead.disposition ? `<div style="display:inline-block;padding:4px 10px;background:#10b98120;color:#10b981;border-radius:9999px;font-size:12px;font-weight:500;">${wp.lead.disposition}</div>` : ''}
    </div>
  `;
}
