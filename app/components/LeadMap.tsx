'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { auth } from '@/app/utils/firebase';
import { RouteWaypoint } from './RouteBuilder';
import { Disposition, getDispositionsAsync } from '@/app/utils/dispositions';
import AddLeadModal from './AddLeadModal';
import { getTerritoriesAsync } from '@/app/utils/territories';
import { findLeadTerritory } from '@/app/utils/territoryAssignment';
import { formatTimeEST } from '@/app/utils/timezone';

interface UserRoute {
  userId: string;
  userName: string;
  userColor: string;
  waypoints: RouteWaypoint[];
}

interface LeadMapProps {
  leads: Lead[];
  currentUser: User | null;
  users?: User[]; // All users for territory color mapping
  onLeadClick: (lead: Lead) => void;
  selectedLeadId?: string;
  routeWaypoints?: RouteWaypoint[];
  userRoutes?: UserRoute[]; // Multiple routes (one per user) for activity tracking
  center?: [number, number];
  zoom?: number;
  onMapMove?: (
    center: [number, number],
    zoom: number,
    bounds?: { south: number; north: number; west: number; east: number }
  ) => void; // Callback when map moves
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
}

export default function LeadMap({
  leads: leadsProp,
  currentUser,
  users = [],
  onLeadClick,
  selectedLeadId,
  routeWaypoints,
  userRoutes = [],
  center = [43.1566, -77.6088],
  zoom = 11,
  onMapMove,
  onMapTypeChange,
  assignmentMode = 'none',
  selectedLeadIdsForAssignment = [],
  onTerritoryDrawn,
  userPosition,
  viewMode = 'map',
  territories = [],
  onTerritoryDelete,
  onLeadAdded,
  searchLocation,
  heatCells = [],
  heatCellRadiusMeters = 180,
}: LeadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const drawControlRef = useRef<any>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const hasFitBoundsRef = useRef<boolean>(false);
  const hasFitRouteBoundsRef = useRef<boolean>(false);
  const userInteractedRef = useRef<boolean>(false);
  const [isClient, setIsClient] = useState(false);
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [mapZoom, setMapZoom] = useState(zoom);
  const [zoomTier, setZoomTier] = useState(0);
  const [viewportKey, setViewportKey] = useState(0);
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [dropPinLocation, setDropPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [dropPinAddress, setDropPinAddress] = useState({ address: '', city: '', state: '', zip: '' });
  const tempPinRef = useRef<L.Marker | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const heatLayerRef = useRef<L.LayerGroup | null>(null);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsTileLayerRef = useRef<L.TileLayer | null>(null);
  const hasFitLeadsBoundsRef = useRef(false);
  const hasFitTerritoryBoundsRef = useRef(false);
  const leads = useMemo(() => leadsProp, [leadsProp]);

  useEffect(() => {
    async function loadDispositions() {
      const dispos = await getDispositionsAsync();
      setDispositions(dispos);
    }
    loadDispositions();
  }, []);

  useEffect(() => {
    hasFitBoundsRef.current = false;
  }, [userRoutes]);

  useEffect(() => {
    hasFitRouteBoundsRef.current = false;
  }, [routeWaypoints]);

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

  useEffect(() => {
    hasFitLeadsBoundsRef.current = false;
    hasFitTerritoryBoundsRef.current = false;
  }, [leadsProp]);

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

  useEffect(() => {
    if (!mapInstanceRef.current || !baseTileLayerRef.current || !labelsTileLayerRef.current) return;
    const map = mapInstanceRef.current;
    baseTileLayerRef.current.remove();
    labelsTileLayerRef.current.remove();
    if (mapType === 'satellite') {
      baseTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
      }).addTo(map);
      labelsTileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 19,
        pane: 'shadowPane',
      }).addTo(map);
    } else {
      baseTileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      labelsTileLayerRef.current = L.tileLayer('', { maxZoom: 0 });
    }
  }, [mapType]);

  useEffect(() => {
    if (!isClient || !mapRef.current || mapInstanceRef.current) return;
    const map = L.map(mapRef.current, {
      center,
      zoom,
      zoomControl: true,
      attributionControl: false,
    });
    baseTileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    }).addTo(map);
    labelsTileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
      attribution: '&copy; CARTO',
      maxZoom: 19,
      pane: 'shadowPane',
    }).addTo(map);
    heatLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.markerClusterGroup({
      disableClusteringAtZoom: 15,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
      chunkInterval: 50,
      chunkDelay: 50,
      removeOutsideVisibleBounds: true,
    }).addTo(map);
    mapInstanceRef.current = map;
    map.on('dragstart', () => { userInteractedRef.current = true; });
    map.on('zoomstart', () => { userInteractedRef.current = true; });
    map.on('zoomend', () => {
      const currentZoom = map.getZoom();
      const newCenter: [number, number] = [map.getCenter().lat, map.getCenter().lng];
      setMapZoom(currentZoom);
      let newTier = 0;
      if (currentZoom >= 16) newTier = 3;
      else if (currentZoom >= 14) newTier = 2;
      else if (currentZoom >= 12) newTier = 1;
      setZoomTier(newTier);
      setViewportKey(prev => prev + 1);
      if (onMapMove) {
        const b = map.getBounds();
        onMapMove(newCenter, currentZoom, {
          south: b.getSouth(),
          north: b.getNorth(),
          west: b.getWest(),
          east: b.getEast(),
        });
      }
    });
    map.on('moveend', () => {
      const newCenter: [number, number] = [map.getCenter().lat, map.getCenter().lng];
      const currentZoom = map.getZoom();
      setViewportKey(prev => prev + 1);
      if (onMapMove) {
        const b = map.getBounds();
        onMapMove(newCenter, currentZoom, {
          south: b.getSouth(),
          north: b.getNorth(),
          west: b.getWest(),
          east: b.getEast(),
        });
      }
    });
    map.on('contextmenu', (e: L.LeafletMouseEvent) => { handleDropPin(e.latlng); });
    let longPressTimer: NodeJS.Timeout;
    let longPressStartPos: L.LatLng | null = null;
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      longPressStartPos = e.latlng;
      longPressTimer = setTimeout(() => {
        if (longPressStartPos) handleDropPin(longPressStartPos);
      }, 800);
    });
    map.on('touchstart', (e: any) => {
      const latlng = (e as any).latlng || e.latlng;
      if (latlng) {
        longPressStartPos = latlng;
        longPressTimer = setTimeout(() => {
          if (longPressStartPos) handleDropPin(longPressStartPos);
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

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const targetLat = center?.[0] ?? 43.1566;
    const targetLng = center?.[1] ?? -77.6088;
    const targetZoom = zoom ?? 11;
    const latDiff = Math.abs(currentCenter.lat - targetLat);
    const lngDiff = Math.abs(currentCenter.lng - targetLng);
    const zoomDiff = Math.abs(currentZoom - targetZoom);
    if (latDiff > 0.001 || lngDiff > 0.001 || zoomDiff > 0.5) {
      map.flyTo([targetLat, targetLng], targetZoom, { duration: 1.0, animate: true });
    }
  }, [center?.[0], center?.[1], zoom]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;
    const map = mapInstanceRef.current;
    if (searchMarkerRef.current) {
      searchMarkerRef.current.remove();
      searchMarkerRef.current = null;
    }
    if (searchLocation) {
      const searchIcon = L.divIcon({
        html: `<div style="width:40px;height:40px;background:#3B82F6;border:4px solid white;border-radius:50%;"></div>`,
        className: 'search-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
      searchMarkerRef.current = L.marker([searchLocation.lat, searchLocation.lng], { icon: searchIcon }).addTo(map);
      searchMarkerRef.current.bindPopup('Searched Address', { autoPan: false }).openPopup();
    }
  }, [searchLocation, isClient]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !isClient) return;
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    layer.clearLayers();
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    const currentZoom = map.getZoom();
    const bounds = map.getBounds();
    const padding = 0.5;
    const latDiff = bounds.getNorth() - bounds.getSouth();
    const lngDiff = bounds.getEast() - bounds.getWest();
    const paddedBounds = L.latLngBounds([
      [bounds.getSouth() - latDiff * padding, bounds.getWest() - lngDiff * padding],
      [bounds.getNorth() + latDiff * padding, bounds.getEast() + lngDiff * padding]
    ]);
    const visibleLeads = leads.filter(lead => {
      if (!lead.lat || !lead.lng) return false;
      return paddedBounds.contains([lead.lat, lead.lng]);
    });
    if (userRoutes && userRoutes.length > 0) {
      const allCoords: [number, number][] = [];
      userRoutes.forEach(userRoute => {
        const routeCoords = userRoute.waypoints.map(wp => [wp.lat, wp.lng] as [number, number]);
        allCoords.push(...routeCoords);
        L.polyline(routeCoords, { color: userRoute.userColor, weight: 5, opacity: 0.85 }).addTo(map);
        userRoute.waypoints.forEach((wp, index) => {
          const icon = createActivityMarkerIcon(index + 1, userRoute.userColor);
          const marker = L.marker([wp.lat, wp.lng], { icon });
          marker.bindPopup(createActivityPopupContent(wp, userRoute.userName), { maxWidth: 300 });
          marker.on('click', () => onLeadClick(wp.lead));
          marker.addTo(layer);
        });
      });
      if (allCoords.length > 0 && !hasFitBoundsRef.current && !userInteractedRef.current) {
        map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
        hasFitBoundsRef.current = true;
      }
      return;
    }
    if (routeWaypoints && routeWaypoints.length > 0) {
      const routeCoords = routeWaypoints.map(wp => [wp.lat, wp.lng] as [number, number]);
      routeLineRef.current = L.polyline(routeCoords, { color: '#3b82f6', weight: 4, opacity: 0.8, dashArray: '10, 10' }).addTo(map);
      routeWaypoints.forEach((wp, index) => {
        const icon = createRouteNumberIcon(index + 1);
        const marker = L.marker([wp.lat, wp.lng], { icon });
        marker.bindPopup(createRoutePopupContent(wp), { maxWidth: 300 });
        marker.on('click', () => onLeadClick(wp.lead));
        marker.addTo(layer);
      });
      if (routeCoords.length > 0 && !hasFitRouteBoundsRef.current && !userInteractedRef.current) {
        map.fitBounds(L.latLngBounds(routeCoords), { padding: [50, 50] });
        hasFitRouteBoundsRef.current = true;
      }
      return;
    }
    const KNOCK_STATUSES = ['not-home', 'interested', 'not-interested', 'appointment', 'sale', 'dq-credit', 'shade-dq', 'follow-up-later', 'renter'];
    visibleLeads.forEach(lead => {
      const hasDisposition = lead.status && KNOCK_STATUSES.includes(lead.status);
      if (!lead.lat || !lead.lng) return;
      const isAssignedToMe = currentUser != null && lead.assignedTo != null && lead.assignedTo === currentUser.id;
      const isClaimedByMe = currentUser != null && lead.claimedBy != null && lead.claimedBy === currentUser.id;
      if (lead.solarCategory === 'poor' && !hasDisposition && !isAssignedToMe && !isClaimedByMe) return;
      const isSelected = lead.id === selectedLeadId;
      const canClaim = lead.claimedBy == null || isClaimedByMe;
      const isSelectedForAssignment = selectedLeadIdsForAssignment.includes(lead.id);
      const latestHistoryDisposition = String(lead.dispositionHistory?.[0]?.disposition || '').toLowerCase();
      const disposition = dispositions.find(d => d.id === lead.status)
        || dispositions.find(d => String(d.name || '').toLowerCase() === latestHistoryDisposition);
      const icon = createCustomIcon(
        lead, users, viewMode, lead.solarCategory, lead.status,
        Boolean(isSelected || isSelectedForAssignment), Boolean(isClaimedByMe), Boolean(canClaim),
        Boolean(lead.claimedBy), isSelectedForAssignment, disposition, currentZoom, lead.tags
      );
      const marker = L.marker([lead.lat!, lead.lng!], { icon });
      marker.bindPopup(createPopupContent(lead), { maxWidth: 300, autoPan: false });
      marker.on('click', () => onLeadClick(lead));
      marker.addTo(layer);
    });
    const hasDisposition = (l: any) => l.status && KNOCK_STATUSES.includes(l.status);
    const goodLeads = leads.filter(l => {
      if (!l.lat || !l.lng) return false;
      const assignedToMe = currentUser != null && (l as any).assignedTo != null && (l as any).assignedTo === currentUser.id;
      const claimedByMe = currentUser != null && (l as any).claimedBy != null && (l as any).claimedBy === currentUser.id;
      return ((l.solarCategory && l.solarCategory !== 'poor') || hasDisposition(l) || assignedToMe || claimedByMe);
    });
    const preferGpsCenter = currentUser?.role !== 'admin';
    if (goodLeads.length > 0 && goodLeads.length <= 50 && !hasFitLeadsBoundsRef.current && !userInteractedRef.current && !preferGpsCenter) {
      map.fitBounds(L.latLngBounds(goodLeads.map(l => [l.lat!, l.lng!])), { padding: [50, 50] });
      hasFitLeadsBoundsRef.current = true;
    }
  }, [leads, selectedLeadId, currentUser, onLeadClick, routeWaypoints, isClient, dispositions, zoomTier, viewportKey]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;
    const map = mapInstanceRef.current;
    if (assignmentMode === 'territory') {
      if (map.dragging) map.dragging.disable();
      if (map.touchZoom) map.touchZoom.disable();
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
      if (map.scrollWheelZoom) map.scrollWheelZoom.disable();
      if (map.boxZoom) map.boxZoom.disable();
      if (map.keyboard) map.keyboard.disable();
      map.off('click');
      map.off('dblclick');
      if (mapRef.current) mapRef.current.style.cursor = 'crosshair';
      let drawingPoints: L.LatLng[] = [];
      let tempPolygon: L.Polygon | null = null;
      let isDrawing = false;
      const handleMouseDown = (e: L.LeafletMouseEvent) => {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        isDrawing = true;
        drawingPoints = [e.latlng];
        if (tempPolygon) tempPolygon.remove();
      };
      const handleMouseMove = (e: L.LeafletMouseEvent) => {
        if (!isDrawing) return;
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        const distance = map.distance(lastPoint, e.latlng);
        if (distance > 10) {
          drawingPoints.push(e.latlng);
          if (tempPolygon) tempPolygon.remove();
          if (drawingPoints.length >= 3) {
            tempPolygon = L.polygon(drawingPoints, { color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.2, weight: 3 }).addTo(map);
          } else if (drawingPoints.length >= 2) {
            const line = L.polyline(drawingPoints, { color: '#8b5cf6', weight: 3 }).addTo(map);
            tempPolygon = line as any;
          }
        }
      };
      const handleMouseUp = (e: L.LeafletMouseEvent) => {
        if (!isDrawing) return;
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        isDrawing = false;
        if (drawingPoints.length < 3) {
          if (tempPolygon) tempPolygon.remove();
          drawingPoints = [];
          tempPolygon = null;
          return;
        }
        drawingPoints.push(drawingPoints[0]);
        if (tempPolygon) tempPolygon.remove();
        tempPolygon = L.polygon(drawingPoints, { color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.3, weight: 3 }).addTo(map);
        const polygon = L.polygon(drawingPoints);
        const leadsInside = leads.filter(lead => {
          if (!lead.lat || !lead.lng) return false;
          const point = L.latLng(lead.lat, lead.lng);
          return polygon.getBounds().contains(point) && isPointInPolygon(point, drawingPoints);
        });
        if (onTerritoryDrawn) {
          const polygonCoords: [number, number][] = drawingPoints.map(p => [p.lat, p.lng]);
          onTerritoryDrawn(leadsInside.map(l => l.id), polygonCoords);
        }
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
        if (map.dragging) map.dragging.enable();
        if (map.touchZoom) map.touchZoom.enable();
        if (map.doubleClickZoom) map.doubleClickZoom.enable();
        if (map.scrollWheelZoom) map.scrollWheelZoom.enable();
        if (map.boxZoom) map.boxZoom.enable();
        if (map.keyboard) map.keyboard.enable();
        if (mapRef.current) mapRef.current.style.cursor = '';
        if (tempPolygon) tempPolygon.remove();
      };
    } else {
      if (map.dragging) map.dragging.enable();
      if (map.touchZoom) map.touchZoom.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      if (map.scrollWheelZoom) map.scrollWheelZoom.enable();
      if (map.boxZoom) map.boxZoom.enable();
      if (map.keyboard) map.keyboard.enable();
      if (mapRef.current) mapRef.current.style.cursor = '';
    }
  }, [assignmentMode, leads, onTerritoryDrawn, isClient]);

  useEffect(() => {
    if (!markersLayerRef.current || assignmentMode === 'none') return;
  }, [selectedLeadIdsForAssignment, assignmentMode]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;
    const map = mapInstanceRef.current;
    if (userPosition) {
      const [lat, lng] = userPosition;
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([lat, lng]);
      } else {
        const personIcon = L.divIcon({
          className: 'user-location-marker',
          html: `<div style="width:32px;height:32px;background:#EF4444;border:3px solid #ffffff;border-radius:50%;"></div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
        userMarkerRef.current = L.marker([lat, lng], { icon: personIcon, zIndexOffset: 1000 }).addTo(map);
      }
    } else if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
  }, [userPosition, isClient]);

  useEffect(() => {
    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
    };
  }, []);

  const prevCenterRef = useRef<[number, number] | undefined>(undefined);
  useEffect(() => {
    if (!mapInstanceRef.current || !center) return;
    const prevCenter = prevCenterRef.current;
    const centerChanged = !prevCenter || prevCenter[0] !== center[0] || prevCenter[1] !== center[1];
    if (centerChanged) {
      mapInstanceRef.current.setView(center, mapInstanceRef.current.getZoom());
      prevCenterRef.current = center;
    }
  }, [center]);

  const territoriesLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !isClient) return;
    const map = mapInstanceRef.current;
    if (territoriesLayerRef.current) {
      territoriesLayerRef.current.clearLayers();
    } else {
      territoriesLayerRef.current = L.layerGroup().addTo(map);
    }
    if (viewMode !== 'assignments' && viewMode !== 'territory') return;
    let territoriesToRender = territories;
    if (viewMode === 'territory' && currentUser && currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      territoriesToRender = territories.filter(t => t.userId === currentUser.id);
    }
    if (territoriesToRender.length === 0) return;
    territoriesToRender.forEach(territory => {
      if (!territory.polygon || territory.polygon.length < 3) return;
      const leafletCoords: [number, number][] = territory.polygon.map((p: any) => [p.lat, p.lng]);
      const polygon = L.polygon(leafletCoords, {
        color: territory.userColor,
        fillColor: territory.userColor,
        fillOpacity: 0.2,
        weight: 4,
        opacity: 1,
      });
      polygon.addTo(territoriesLayerRef.current!);
    });
    return () => {
      if (territoriesLayerRef.current) territoriesLayerRef.current.clearLayers();
    };
  }, [territories, viewMode, isClient]);

  const handleDropPin = async (latlng: L.LatLng) => {
    if (!mapInstanceRef.current || assignmentMode !== 'none') return;
    const map = mapInstanceRef.current;
    if (tempPinRef.current) tempPinRef.current.remove();
    const tempPin = L.marker([latlng.lat, latlng.lng]).addTo(map);
    tempPinRef.current = tempPin;
    setDropPinLocation({ lat: latlng.lat, lng: latlng.lng });
    setShowAddLeadModal(true);
  };

  const handleSaveDroppedLead = async (leadData: Partial<Lead>) => {
    const firebaseUid = auth?.currentUser?.uid;
    if (!firebaseUid) throw new Error('Auth not ready');
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newLead: Lead = {
      ...leadData,
      id,
      status: (leadData.status as any) || 'available',
      createdAt: new Date(),
      setterId: firebaseUid,
      claimedBy: firebaseUid,
      claimedAt: new Date(),
      source: 'manually-added',
    } as Lead;
    const { saveLeadAsync } = await import('@/app/utils/storage');
    await saveLeadAsync(newLead);
    if (tempPinRef.current) {
      tempPinRef.current.remove();
      tempPinRef.current = null;
    }
    setShowAddLeadModal(false);
    setDropPinLocation(null);
    if (onLeadAdded) onLeadAdded();
  };

  const handleLocateMe = () => {
    if (!mapInstanceRef.current || !userPosition) return;
    mapInstanceRef.current.setView([userPosition[0], userPosition[1]], 17, { animate: true, duration: 0.5 });
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full min-h-[400px] rounded-xl overflow-hidden shadow-lg" style={{ zIndex: 0 }} />
      <button
        onClick={() => {
          const newType = mapType === 'satellite' ? 'street' : 'satellite';
          setMapType(newType);
          if (onMapTypeChange) onMapTypeChange(newType);
        }}
        className="absolute top-6 right-6 px-4 py-2 bg-white rounded-lg shadow-lg z-20"
      >
        {mapType === 'satellite' ? 'Street' : 'Satellite'}
      </button>
      {userPosition && (
        <button onClick={handleLocateMe} className="absolute bottom-6 right-6 w-12 h-12 bg-white rounded-full shadow-lg z-20" title="Center on my location" />
      )}
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

function isPointInPolygon(point: L.LatLng, polygon: L.LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    const intersect = ((yi > point.lng) !== (yj > point.lng)) && (point.lat < (xj - xi) * (point.lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const ICON_TO_UNICODE: Record<string, string> = { 'circle': '\u25cf', 'target': '\u25c6', 'home': 'home' };

function createCustomIcon(
  lead: Lead, users: User[], viewMode: 'map' | 'assignments' | 'territory',
  solarCategory: string | undefined, status: string, isSelected: boolean,
  isClaimedByMe: boolean, canClaim: boolean, isClaimed: boolean,
  isSelectedForAssignment: boolean = false, disposition?: Disposition,
  zoom: number = 12, tags?: string[]
): L.DivIcon {
  const size = isSelected ? 36 : 24;
  const color = disposition?.color || '#6b7280';
  const html = `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;"></div>`;
  return L.divIcon({ html, className: 'custom-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function createPopupContent(lead: Lead): string {
  return `<div><h3>${lead.name}</h3><p>${lead.address}</p></div>`;
}

function createRouteNumberIcon(order: number): L.DivIcon {
  const html = `<div>${order}</div>`;
  return L.divIcon({ html, className: 'route-marker', iconSize: [36, 36], iconAnchor: [18, 18] });
}

function createRoutePopupContent(wp: RouteWaypoint): string {
  return `<div>Stop #${wp.order} ${wp.lead.name}</div>`;
}

function createActivityMarkerIcon(order: number, color: string): L.DivIcon {
  const html = `<div style="background:${color}">${order}</div>`;
  return L.divIcon({ html, className: 'activity-marker', iconSize: [32, 32], iconAnchor: [16, 16] });
}

function createPersonMarkerIcon(color: string): L.DivIcon {
  const html = `<div style="background:${color}"></div>`;
  return L.divIcon({ html, className: 'person-marker', iconSize: [24, 24], iconAnchor: [12, 12] });
}

function createActivityPopupContent(wp: RouteWaypoint, userName: string): string {
  return `<div>${userName} - Stop #${wp.order} ${wp.lead.name}</div>`;
}
