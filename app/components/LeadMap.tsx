'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { RouteWaypoint } from './RouteBuilder';
import { Disposition, getDispositionsAsync } from '@/app/utils/dispositions';

interface LeadMapProps {
  leads: Lead[];
  currentUser: User | null;
  onLeadClick: (lead: Lead) => void;
  selectedLeadId?: string;
  routeWaypoints?: RouteWaypoint[];
  center?: [number, number];
  zoom?: number;
  assignmentMode?: 'none' | 'manual' | 'territory';
  selectedLeadIdsForAssignment?: string[];
  onTerritoryDrawn?: (leadIds: string[]) => void;
  userPosition?: [number, number]; // GPS position for blue dot
}

export default function LeadMap({ 
  leads: leadsProp, 
  currentUser, 
  onLeadClick, 
  selectedLeadId,
  routeWaypoints,
  center = [43.0884, -77.6758],
  zoom = 12,
  assignmentMode = 'none',
  selectedLeadIdsForAssignment = [],
  onTerritoryDrawn,
  userPosition,
}: LeadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const drawControlRef = useRef<any>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);

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

  // Initialize map
  useEffect(() => {
    if (!isClient || !mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center,
      zoom,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      if (routeLineRef.current) routeLineRef.current.remove();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [isClient]);

  // Update markers and route
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !isClient) return;

    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;

    layer.clearLayers();
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

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

    // Regular lead display
    leads.forEach(lead => {
      if (!lead.lat || !lead.lng || lead.solarCategory === 'poor') return;

      const isSelected = lead.id === selectedLeadId;
      const isClaimedByMe = currentUser != null && lead.claimedBy != null && lead.claimedBy === currentUser.id;
      const canClaim = lead.claimedBy == null || isClaimedByMe;
      const isSelectedForAssignment = selectedLeadIdsForAssignment.includes(lead.id);

      // Find disposition for this lead
      const disposition = dispositions.find(d => d.id === lead.status);

      const icon = createCustomIcon(
        lead.solarCategory,
        lead.status,
        Boolean(isSelected || isSelectedForAssignment),
        Boolean(isClaimedByMe),
        Boolean(canClaim),
        Boolean(lead.claimedBy),
        isSelectedForAssignment,
        disposition
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
  }, [leads, selectedLeadId, currentUser, onLeadClick, routeWaypoints, isClient]);

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

        // Call callback with lead IDs
        if (onTerritoryDrawn) {
          onTerritoryDrawn(leadsInside.map(l => l.id));
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

  // Update user position marker (blue dot)
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;

    const map = mapInstanceRef.current;

    if (userPosition) {
      const [lat, lng] = userPosition;

      if (userMarkerRef.current) {
        // Update existing marker position (more performant than remove/recreate)
        userMarkerRef.current.setLatLng([lat, lng]);
      } else {
        // Create blue dot first time
        userMarkerRef.current = L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: '#3b82f6',
          color: '#ffffff',
          weight: 3,
          opacity: 1,
          fillOpacity: 0.9,
        }).addTo(map);

        // Add pulsing effect with CSS
        const element = userMarkerRef.current.getElement() as HTMLElement;
        if (element) {
          element.style.animation = 'pulse 2s infinite';
          element.style.zIndex = '1000';
        }
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

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full min-h-[400px] rounded-xl overflow-hidden shadow-lg" style={{ zIndex: 0 }} />
      
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
  solarCategory: string | undefined,
  status: string,
  isSelected: boolean,
  isClaimedByMe: boolean,
  canClaim: boolean,
  isClaimed: boolean,
  isSelectedForAssignment: boolean = false,
  disposition?: Disposition
): L.DivIcon {
  const size = isSelected ? 44 : 36;
  const border = isSelectedForAssignment 
    ? '4px solid #8b5cf6' // Purple border for assignment selection
    : isSelected 
    ? '3px solid white' 
    : '2px solid white';
  const opacity = isClaimed && !canClaim ? 0.7 : 1;
  
  const solarColors: Record<string, string> = {
    great: '#10b981',
    good: '#3b82f6',
    solid: '#f59e0b',
  };
  
  // PRIORITY: Solar category FIRST (shows lead quality), then disposition color, then fallback
  const color = (solarCategory ? solarColors[solarCategory] : undefined)
    || disposition?.color 
    || (STATUS_COLORS as Record<string, string>)[status] 
    || '#6b7280';
  
  // Use disposition icon if available, otherwise fallback to default
  const icon = disposition 
    ? (ICON_TO_UNICODE[disposition.icon] || '●')
    : '●';
  
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50% 50% 50% 0;transform:rotate(-45deg);opacity:${opacity};box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);color:white;font-size:${size * 0.5}px;font-weight:bold;">${icon}</span>
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
