'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';

interface LeadMapProps {
  leads: Lead[];
  currentUser: User | null;
  onLeadClick: (lead: Lead) => void;
  selectedLeadId?: string;
  center?: [number, number];
  zoom?: number;
}

export default function LeadMap({ 
  leads: leadsProp, 
  currentUser, 
  onLeadClick, 
  selectedLeadId,
  center = [43.0884, -77.6758],
  zoom = 12,
}: LeadMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Memoize leads to prevent unnecessary re-renders
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

  // Initialize map once
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

    // Create a layer group for markers (easier to manage)
    markersLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    // Fit bounds on initial load
    const leadsWithCoords = leads.filter(l => l.lat && l.lng);
    if (leadsWithCoords.length > 0 && leadsWithCoords.length <= 50) {
      const bounds = L.latLngBounds(leadsWithCoords.map(l => [l.lat!, l.lng!]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [isClient]); // Only run once on mount

  // Update markers when leads change
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !isClient) return;

    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;

    // Clear all markers
    layer.clearLayers();

    // Add markers for each lead
    leads.forEach(lead => {
      if (!lead.lat || !lead.lng) return;

      const isSelected = lead.id === selectedLeadId;
      const isClaimedByMe = currentUser != null && lead.claimedBy != null && lead.claimedBy === currentUser.id;
      const canClaim = lead.claimedBy == null || isClaimedByMe;

      const color = STATUS_COLORS[lead.status];
      const icon = createCustomIcon(
        color, 
        Boolean(isSelected), 
        Boolean(canClaim), 
        Boolean(lead.claimedBy)
      );

      const marker = L.marker([lead.lat, lead.lng], { icon });

      marker.bindPopup(createPopupContent(lead), { maxWidth: 300 });

      marker.on('click', () => {
        onLeadClick(lead);
      });

      if (isSelected) {
        marker.openPopup();
      }

      marker.addTo(layer);
    });

  }, [leads, selectedLeadId, currentUser, onLeadClick, isClient]);

  return (
    <div 
      ref={mapRef} 
      className="w-full h-full min-h-[400px] rounded-xl overflow-hidden shadow-lg"
      style={{ zIndex: 0 }}
    />
  );
}

function createCustomIcon(
  color: string,
  isSelected: boolean,
  canClaim: boolean,
  isClaimed: boolean
): L.DivIcon {
  const size = isSelected ? 40 : 32;
  const border = isSelected ? '3px solid white' : '2px solid white';
  const opacity = isClaimed && !canClaim ? 0.7 : 1;
  
  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      background-color: ${color};
      border: ${border};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      opacity: ${opacity};
      box-shadow: 0 3px 6px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      ${isClaimed && !canClaim ? `
        <div style="
          transform: rotate(45deg);
          color: white;
          font-size: ${size * 0.5}px;
        ">🔒</div>
      ` : ''}
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function createPopupContent(lead: Lead): string {
  const statusColor = STATUS_COLORS[lead.status];
  const statusLabel = STATUS_LABELS[lead.status];
  
  return `
    <div style="padding: 8px; font-family: system-ui, -apple-system, sans-serif;">
      <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1f2937;">${lead.name}</h3>
      <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563;">${lead.address}</p>
      <p style="margin: 0 0 12px 0; font-size: 12px; color: #6b7280;">${lead.city}, ${lead.state} ${lead.zip}</p>
      <div style="display: inline-block; padding: 4px 10px; background-color: ${statusColor}20; color: ${statusColor}; border-radius: 9999px; font-size: 12px; font-weight: 500;">${statusLabel}</div>
      ${lead.phone ? `<p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">📞 ${lead.phone}</p>` : ''}
    </div>
  `;
}
