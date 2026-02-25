'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { RouteWaypoint } from './RouteBuilder';
import { Disposition, getDispositionsAsync } from '@/app/utils/dispositions';
import AddLeadModal from './AddLeadModal';

interface LeadMapProps {
  leads: Lead[];
  currentUser: User | null;
  users?: User[]; // All users for territory color mapping
  onLeadClick: (lead: Lead) => void;
  selectedLeadId?: string;
  routeWaypoints?: RouteWaypoint[];
  center?: [number, number];
  zoom?: number;
  assignmentMode?: 'none' | 'manual' | 'territory';
  selectedLeadIdsForAssignment?: string[];
  onTerritoryDrawn?: (leadIds: string[], polygon: [number, number][]) => void;
  userPosition?: [number, number]; // GPS position for blue dot
  viewMode?: 'map' | 'assignments'; // Show territories in assignments view
  territories?: any[]; // Territory polygons to display
  onTerritoryDelete?: (territoryId: string) => void; // Callback when territory deleted
}

export default function LeadMap({ 
  leads: leadsProp, 
  currentUser,
  users = [],
  onLeadClick, 
  selectedLeadId,
  routeWaypoints,
  center = [43.1566, -77.6088], // Rochester, NY - default for admin oversight
  zoom = 11,
  assignmentMode = 'none',
  selectedLeadIdsForAssignment = [],
  onTerritoryDrawn,
  userPosition,
  viewMode = 'map',
  territories = [],
  onTerritoryDelete,
}: LeadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const drawControlRef = useRef<any>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [mapZoom, setMapZoom] = useState(zoom);
  const [zoomTier, setZoomTier] = useState(0); // Tier system to avoid re-rendering on every zoom
  const [viewportKey, setViewportKey] = useState(0); // Trigger re-render on pan/zoom
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [dropPinLocation, setDropPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [dropPinAddress, setDropPinAddress] = useState({ address: '', city: '', state: '', zip: '' });
  const tempPinRef = useRef<L.Marker | null>(null);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite'); // Default to satellite
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsTileLayerRef = useRef<L.TileLayer | null>(null);

  // Use leadsProp directly - parent already handles filtering if needed
  // For large datasets, we only render what's passed in
  const leads = useMemo(() => leadsProp, [leadsProp]);

  // Load dispositions
  useEffect(() => {
    async function loadDispositions() {
      const dispos = await getDispositionsAsync();
      setDispositions(dispos);
    }
    loadDispositions();
  }, []);

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

      // Labels overlay
      labelsTileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
        attribution: '&copy; CARTO',
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
      zoomControl: true,
      attributionControl: true,
    });

    // Initialize with satellite view
    baseTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    }).addTo(map);

    // Add labels overlay for satellite view
    labelsTileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
      attribution: '&copy; CARTO',
      maxZoom: 19,
      pane: 'shadowPane', // Put labels above satellite but below markers
    }).addTo(map);

    // Create marker cluster group with optimized clustering for performance
    markersLayerRef.current = L.markerClusterGroup({
      disableClusteringAtZoom: 15, // Show individual pins at zoom 15+ (slightly later for performance)
      maxClusterRadius: 60, // Reduced from default 80 (tighter clusters = fewer markers)
      spiderfyOnMaxZoom: true, // Spread out markers when clicking cluster at max zoom
      showCoverageOnHover: false, // Don't show cluster bounds on hover (cleaner UX + performance)
      zoomToBoundsOnClick: true, // Zoom into cluster when clicked
      chunkedLoading: true, // Better performance for large datasets
      chunkInterval: 50, // Process in 50ms chunks
      chunkDelay: 50, // 50ms delay between chunks
      removeOutsideVisibleBounds: true, // Remove markers outside view (huge performance boost)
    }).addTo(map);
    
    mapInstanceRef.current = map;

    // Listen for zoom changes - update tier only when crossing thresholds
    map.on('zoomend', () => {
      const currentZoom = map.getZoom();
      setMapZoom(currentZoom);
      
      // Calculate zoom tier (only re-render markers when tier changes, not on every zoom)
      // Tiers: 0 (<12), 1 (12-14), 2 (14-16), 3 (>16)
      let newTier = 0;
      if (currentZoom >= 16) newTier = 3;
      else if (currentZoom >= 14) newTier = 2;
      else if (currentZoom >= 12) newTier = 1;
      
      setZoomTier(newTier);
      setViewportKey(prev => prev + 1); // Trigger viewport update on zoom
    });

    // Listen for map panning - update viewport to load new markers
    map.on('moveend', () => {
      setViewportKey(prev => prev + 1);
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
          handleDropPin(longPressStartPos);
        }
      }, 800); // 800ms for long-press
    });
    
    map.on('touchstart', (e: L.LeafletEvent) => {
      const mouseEvent = e as any;
      if (mouseEvent.latlng) {
        longPressStartPos = mouseEvent.latlng;
        longPressTimer = setTimeout(() => {
          if (longPressStartPos) {
            handleDropPin(longPressStartPos);
          }
        }, 800);
      }
    });
    
    map.on('mouseup touchend mousemove', () => {
      clearTimeout(longPressTimer);
      longPressStartPos = null;
    });

    return () => {
      if (routeLineRef.current) routeLineRef.current.remove();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [isClient]);

  // Update markers and route (optimized for large datasets - only render when needed)
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !isClient) return;

    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;

    // Performance: Log start time
    const startTime = Date.now();
    console.log(`[LeadMap] Updating ${leads.length} markers...`);

    // Clear existing markers
    layer.clearLayers();
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    // Get current zoom level for scaling
    const currentZoom = map.getZoom();

    // PERFORMANCE OPTIMIZATION: Viewport-based filtering
    // Only render markers that are within the current map bounds + buffer
    const bounds = map.getBounds();
    const padding = 0.5; // Add 50% buffer around visible area
    const latDiff = bounds.getNorth() - bounds.getSouth();
    const lngDiff = bounds.getEast() - bounds.getWest();
    const paddedBounds = L.latLngBounds([
      [bounds.getSouth() - latDiff * padding, bounds.getWest() - lngDiff * padding],
      [bounds.getNorth() + latDiff * padding, bounds.getEast() + lngDiff * padding]
    ]);

    // Filter leads to only those in viewport
    const visibleLeads = leads.filter(lead => {
      if (!lead.lat || !lead.lng) return false;
      return paddedBounds.contains([lead.lat, lead.lng]);
    });

    console.log(`[LeadMap] Rendering ${visibleLeads.length} of ${leads.length} visible leads (${Math.round(visibleLeads.length / leads.length * 100)}%)`);


    // Show route mode
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

      if (routeCoords.length > 0) {
        const bounds = L.latLngBounds(routeCoords);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
      return;
    }

    // Regular lead display - using visible leads only
    visibleLeads.forEach(lead => {
      if (!lead.lat || !lead.lng || lead.solarCategory === 'poor') return;

      const isSelected = lead.id === selectedLeadId;
      const isClaimedByMe = currentUser != null && lead.claimedBy != null && lead.claimedBy === currentUser.id;
      const canClaim = lead.claimedBy == null || isClaimedByMe;
      const isSelectedForAssignment = selectedLeadIdsForAssignment.includes(lead.id);

      // Find disposition for this lead
      const disposition = dispositions.find(d => d.id === lead.status);

      const icon = createCustomIcon(
        lead,
        users,
        viewMode, // Only show territory colors in assignments view
        lead.solarCategory,
        lead.status,
        Boolean(isSelected || isSelectedForAssignment),
        Boolean(isClaimedByMe),
        Boolean(canClaim),
        Boolean(lead.claimedBy),
        isSelectedForAssignment,
        disposition,
        currentZoom,
        lead.tags // Pass tags for special styling
      );

      const marker = L.marker([lead.lat!, lead.lng!], { icon });
      marker.bindPopup(createPopupContent(lead), { maxWidth: 300 });
      marker.on('click', () => onLeadClick(lead));
      if (isSelected) marker.openPopup();
      marker.addTo(layer);
    });

    const goodLeads = leads.filter(l => l.lat && l.lng && l.solarCategory && l.solarCategory !== 'poor');
    if (goodLeads.length > 0 && goodLeads.length <= 50) {
      const bounds = L.latLngBounds(goodLeads.map(l => [l.lat!, l.lng!]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    // Performance: Log completion time
    const duration = Date.now() - startTime;
    console.log(`[LeadMap] Rendered ${visibleLeads.length} markers in ${duration}ms (zoom tier: ${zoomTier})`);
  }, [leads, selectedLeadId, currentUser, onLeadClick, routeWaypoints, isClient, dispositions, zoomTier, viewportKey]);
  // Note: Using zoomTier instead of direct mapZoom - only re-renders when crossing zoom thresholds
  // This prevents constant re-renders on every zoom event (just 4 tiers: <12, 12-14, 14-16, >16)

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

    // Only render territories in assignments view
    console.log('[LeadMap] Territory rendering check:', { viewMode, territoriesCount: territories.length });
    if (viewMode !== 'assignments') {
      console.log('[LeadMap] Not in assignments view, skipping territories');
      return;
    }
    if (territories.length === 0) {
      console.log('[LeadMap] No territories to render');
      return;
    }
    console.log('[LeadMap] Rendering territories:', territories);

    territories.forEach(territory => {
      if (!territory.polygon || territory.polygon.length < 3) return;

      // Convert TerritoryPoint objects to Leaflet format [lat, lng]
      const leafletCoords: [number, number][] = territory.polygon.map((p: any) => [p.lat, p.lng]);

      const polygon = L.polygon(leafletCoords, {
        color: territory.userColor,
        fillColor: territory.userColor,
        fillOpacity: 0.2, // More visible fill
        weight: 4, // Thicker border
        opacity: 1, // Full opacity on border
      });

      // Add permanent label in center of territory
      const bounds = polygon.getBounds();
      const center = bounds.getCenter();
      
      const label = L.marker(center, {
        icon: L.divIcon({
          className: 'territory-label',
          html: `
            <div style="
              background: ${territory.userColor};
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              font-weight: bold;
              font-size: 14px;
              white-space: nowrap;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              border: 2px solid white;
            ">
              ${territory.userName}
            </div>
          `,
          iconSize: [0, 0],
        }),
      });

      const popupContent = `
        <div style="padding:12px;font-family:system-ui,-apple-system,sans-serif;">
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:${territory.userColor};">${territory.userName}</h3>
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

      polygon.addTo(territoriesLayerRef.current!);
      label.addTo(territoriesLayerRef.current!);
    });

    return () => {
      if (territoriesLayerRef.current) {
        territoriesLayerRef.current.clearLayers();
      }
    };
  }, [territories, viewMode, isClient]);

  // Handle dropping a pin
  const handleDropPin = async (latlng: L.LatLng) => {
    if (!mapInstanceRef.current || assignmentMode !== 'none') return;

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

    // Reverse geocode to get address
    try {
      const response = await fetch(
        `/api/geocode?lat=${latlng.lat}&lng=${latlng.lng}&reverse=true`
      );
      const data = await response.json();

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
  };

  // Handle saving new lead from dropped pin
  const handleSaveDroppedLead = async (leadData: Partial<Lead>) => {
    try {
      // Generate ID
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const newLead: Lead = {
        ...leadData,
        id,
        status: 'unclaimed',
        createdAt: new Date(),
        setterId: currentUser?.id,
      } as Lead;

      // Save to Firestore
      const { saveLeadAsync } = await import('@/app/utils/storage');
      await saveLeadAsync(newLead);

      // Run Solar API in background
      if (newLead.lat && newLead.lng) {
        fetch('/api/solar', {
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
              // Update lead with solar data
              saveLeadAsync({
                ...newLead,
                solarScore: solarData.solarScore,
                solarCategory: solarData.solarCategory,
                solarMaxPanels: solarData.maxPanels,
                solarSunshineHours: solarData.sunshineHours,
                hasSouthFacingRoof: solarData.hasSouthFacingRoof,
                solarTestedAt: new Date(),
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

      // Refresh page to show new lead
      window.location.reload();
    } catch (error) {
      console.error('Error saving dropped lead:', error);
      throw error;
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
      
      {/* Map Type Toggle Button */}
      <button
        onClick={() => setMapType(mapType === 'satellite' ? 'street' : 'satellite')}
        className="absolute top-6 right-6 px-4 py-2 bg-white hover:bg-[#FF5F5A] border-2 border-[#E2E8F0] rounded-lg shadow-lg flex items-center gap-2 text-[#2D3748] hover:text-white transition-all duration-200 hover:scale-105 active:scale-95 z-20 font-medium text-sm"
        title={`Switch to ${mapType === 'satellite' ? 'street' : 'satellite'} view`}
        style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}
      >
        {mapType === 'satellite' ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 17h10" />
              <path d="M7 12h10" />
              <path d="M7 7h10" />
            </svg>
            Street
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              <path d="M2 12h20" />
            </svg>
            Satellite
          </>
        )}
      </button>

      {/* GPS Locate Button */}
      {userPosition && (
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

function createCustomIcon(
  lead: Lead,
  users: User[],
  viewMode: 'map' | 'assignments',
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
  
  // Homeowner leads are 70% smaller (more subtle)
  if (isHomeownerLead) {
    baseSize = Math.round(baseSize * 0.7);
  }
  
  const size = isSelected ? baseSize * 1.2 : baseSize;
  
  // For simple dots (zoomed out), use circles instead of teardrops
  const isSimpleDot = zoom < 14;
  
  const solarColors: Record<string, string> = {
    great: '#10b981',
    good: '#3b82f6',
    solid: '#f59e0b',
  };
  
  // Homeowner leads: gray pin with solar rating as border color
  let color: string;
  let border: string;
  
  if (isHomeownerLead) {
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
    
    // Solar data leads (or no tags): colorful pins as before
    color = territoryColor
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

function createPopupContent(lead: Lead): string {
  const statusColor = STATUS_COLORS[lead.status];
  const statusLabel = STATUS_LABELS[lead.status];
  
  return `
    <div style="padding:8px;font-family:system-ui,-apple-system,sans-serif;">
      <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:600;color:#1f2937;">${lead.name}</h3>
      <p style="margin:0 0 4px 0;font-size:14px;color:#4b5563;">${lead.address}</p>
      <p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;">${lead.city}, ${lead.state} ${lead.zip}</p>
      <div style="display:inline-block;padding:4px 10px;background:${statusColor}20;color:${statusColor};border-radius:9999px;font-size:12px;font-weight:500;">${statusLabel}</div>
      ${lead.phone ? `<p style="margin:8px 0 0 0;font-size:13px;color:#4b5563;">📞 ${lead.phone}</p>` : ''}
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
