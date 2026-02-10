'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { RouteWaypoint } from './RouteBuilder';

interface LeadMapProps {
  leads: Lead[];
  currentUser: User | null;
  onLeadClick: (lead: Lead) => void;
  selectedLeadId?: string;
  routeWaypoints?: RouteWaypoint[];
  center?: [number, number];
  zoom?: number;
}

export default function LeadMap({ 
  leads: leadsProp, 
  currentUser, 
  onLeadClick, 
  selectedLeadId,
  routeWaypoints,
  center = [43.0884, -77.6758],
  zoom = 12,
}: LeadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const [isClient, setIsClient] = useState(false);

  const leads = useMemo(() => leadsProp, [leadsProp]);

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

      const icon = createCustomIcon(
        lead.solarCategory,
        lead.status,
        Boolean(isSelected),
        Boolean(isClaimedByMe),
        Boolean(canClaim),
        Boolean(lead.claimedBy)
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

  return (
    <div ref={mapRef} className="w-full h-full min-h-[400px] rounded-xl overflow-hidden shadow-lg" style={{ zIndex: 0 }} />
  );
}

function createCustomIcon(
  solarCategory: string | undefined,
  status: string,
  isSelected: boolean,
  isClaimedByMe: boolean,
  canClaim: boolean,
  isClaimed: boolean
): L.DivIcon {
  const size = isSelected ? 44 : 36;
  const border = isSelected ? '3px solid white' : '2px solid white';
  const opacity = isClaimed && !canClaim ? 0.7 : 1;
  
  const solarColors: Record<string, string> = {
    great: '#10b981',
    good: '#3b82f6',
    solid: '#f59e0b',
  };
  
  const color = solarCategory ? solarColors[solarCategory] || (STATUS_COLORS as Record<string, string>)[status] || '#6b7280' : (STATUS_COLORS as Record<string, string>)[status] || '#6b7280';
  
  const statusIcons: Record<string, string> = {
    unclaimed: '●',
    claimed: '◆',
    'not-home': '○',
    interested: '★',
    'not-interested': '✗',
    appointment: '📅',
    sale: '💰',
  };
  
  const icon = statusIcons[status] || '●';
  
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
