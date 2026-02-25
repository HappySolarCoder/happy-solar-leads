'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface TeamMember {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  lastUpdate: Date;
  status: string;
  doorsToday?: number;
  appointmentsToday?: number;
}

interface Props {
  teamMembers: TeamMember[];
  onMemberClick?: (member: TeamMember) => void;
}

export default function TeamMapView({ teamMembers, onMemberClick }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!mapRef.current) {
      // Initialize map - Rochester/Buffalo area for admin oversight
      const map = L.map('team-map', { attributionControl: false }).setView([43.1566, -77.6088], 11); // Rochester, NY
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;
    const currentMarkers = markersRef.current;

    // Remove markers for users no longer active
    currentMarkers.forEach((marker, userId) => {
      if (!teamMembers.find(m => m.id === userId)) {
        marker.remove();
        currentMarkers.delete(userId);
      }
    });

    // Add or update markers
    teamMembers.forEach((member) => {
      let marker = currentMarkers.get(member.id);

      if (!marker) {
        // Create new marker with custom icon
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `
            <div style="position: relative;">
              <div style="
                width: 48px;
                height: 48px;
                background: ${member.color};
                border: 4px solid white;
                border-radius: 50%;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 18px;
                animation: markerPulse 2s ease-in-out infinite;
              ">
                ${member.name.charAt(0)}
              </div>
              <div style="
                position: absolute;
                bottom: -24px;
                left: 50%;
                transform: translateX(-50%);
                background: white;
                padding: 4px 8px;
                border-radius: 8px;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                color: #2D3748;
              ">
                ${member.name}
              </div>
            </div>
          `,
          iconSize: [48, 48],
          iconAnchor: [24, 48],
        });

        marker = L.marker([member.lat, member.lng], { icon })
          .addTo(map)
          .on('click', () => {
            if (onMemberClick) {
              onMemberClick(member);
            }
          })
          .bindPopup(`
            <div style="font-family: sans-serif; min-width: 150px;">
              <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; color: ${member.color};">
                ${member.name}
              </div>
              <div style="font-size: 12px; color: #718096;">
                ${member.status}
              </div>
              <div style="font-size: 11px; color: #A0AEC0; margin-top: 4px;">
                Updated ${Math.round((Date.now() - member.lastUpdate.getTime()) / 1000 / 60)}m ago
              </div>
            </div>
          `);

        currentMarkers.set(member.id, marker);
      } else {
        // Update existing marker position with smooth animation
        const currentLatLng = marker.getLatLng();
        const newLatLng = L.latLng(member.lat, member.lng);
        
        if (currentLatLng.lat !== newLatLng.lat || currentLatLng.lng !== newLatLng.lng) {
          // Animate to new position
          animateMarker(marker, currentLatLng, newLatLng, 1000);
        }

        // Update popup
        marker.setPopupContent(`
          <div style="font-family: sans-serif; min-width: 150px;">
            <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; color: ${member.color};">
              ${member.name}
            </div>
            <div style="font-size: 12px; color: #718096;">
              ${member.status}
            </div>
            <div style="font-size: 11px; color: #A0AEC0; margin-top: 4px;">
              Updated ${Math.round((Date.now() - member.lastUpdate.getTime()) / 1000 / 60)}m ago
            </div>
          </div>
        `);
      }
    });

    // Auto-fit bounds if we have markers
    if (teamMembers.length > 0) {
      const bounds = L.latLngBounds(teamMembers.map(m => [m.lat, m.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }

  }, [teamMembers]);

  function animateMarker(marker: L.Marker, start: L.LatLng, end: L.LatLng, duration: number) {
    const startTime = Date.now();
    
    function update() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const lat = start.lat + (end.lat - start.lat) * eased;
      const lng = start.lng + (end.lng - start.lng) * eased;
      
      marker.setLatLng([lat, lng]);
      
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }
    
    update();
  }

  return (
    <>
      <div id="team-map" className="w-full h-full" />
      <style jsx global>{`
        @keyframes markerPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
            opacity: 0.9;
          }
        }
        
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
        
        .leaflet-popup-content-wrapper {
          border-radius: 12px !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important;
        }
        
        .leaflet-popup-tip {
          display: none !important;
        }
      `}</style>
    </>
  );
}
