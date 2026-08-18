import L from 'leaflet';
import { Lead, STATUS_COLORS, STATUS_LABELS, User } from '@/app/types';
import { Disposition } from '@/app/utils/dispositions';
import { RouteWaypoint } from './RouteBuilder';
import { formatTimeEST } from '@/app/utils/timezone';

// Helper function to check if point is inside polygon
export function isPointInPolygon(point: L.LatLng, polygon: L.LatLng[]): boolean {
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

export function createCustomIcon(
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
  const leadType = (lead.leadType === 'sale' ? 'customer' : lead.leadType) || 'prospect';
  const isCustomerPin = leadType === 'customer';
  const isManuallyAdded = lead.source === 'manually-added';
  const isHomeownerLead = tags && (tags.includes('homeowner') || tags.includes('home-data'));
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
  if (isManuallyAdded && disposition) {
    showIcon = true;
    baseSize = Math.max(baseSize, 18);
  }
  if (isHomeownerLead) {
    baseSize = Math.round(baseSize * 0.7);
  }
  const size = isSelected ? baseSize * 1.2 : baseSize;
  const isSimpleDot = zoom < 14;
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
  let color: string;
  let border: string;
  if (isManuallyAdded) {
    color = '#FF5F5A';
    if (isSelectedForAssignment) {
      border = '3px solid #8b5cf6';
    } else if (isSelected) {
      border = '3px solid white';
    } else if (isSimpleDot) {
      border = 'none';
    } else {
      border = '3px solid white';
    }
  } else if (isHomeownerLead) {
    color = '#6b7280';
    const solarBorderColor = solarCategory ? solarColors[solarCategory] : undefined;
    if (isSelectedForAssignment) {
      border = '3px solid #8b5cf6';
    } else if (isSelected) {
      border = '2px solid white';
    } else if (solarBorderColor) {
      border = `3px solid ${solarBorderColor}`;
    } else if (isSimpleDot) {
      border = 'none';
    } else {
      border = '2px solid #9ca3af';
    }
  } else {
    let territoryColor: string | undefined;
    if (viewMode === 'assignments') {
      const assignedUser = lead.assignedTo ? users.find(u => u.id === lead.assignedTo) : null;
      const claimedUser = lead.claimedBy ? users.find(u => u.id === lead.claimedBy) : null;
      territoryColor = assignedUser?.color || claimedUser?.color;
    }
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
  const icon = disposition 
    ? (ICON_TO_UNICODE[disposition.icon] || '●')
    : '●';
  if (isSimpleDot) {
    const html = `
      <div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50%;opacity:${opacity};box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>
    `;
    return L.divIcon({ html, className: 'custom-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
  }
  const fontSize = showIcon ? size * 0.5 : 0;
  const iconDisplay = showIcon ? icon : '';
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50% 50% 50% 0;transform:rotate(-45deg);opacity:${opacity};box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      ${showIcon ? `<span style="transform:rotate(45deg);color:white;font-size:${fontSize}px;font-weight:bold;">${iconDisplay}</span>` : ''}
    </div>
  `;
  return L.divIcon({ html, className: 'custom-marker', iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size] });
}

export function createPopupContent(lead: Lead): string {
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
        ${lead.phone ? `<p style="margin:8px 0 0 0;font-size:13px;color:#4b5563;">📞 ${lead.phone}</p>` : ''}
      </div>
    `;
  }
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

export function createRouteNumberIcon(order: number): L.DivIcon {
  const size = 36;
  const html = `
    <div style="width:${size}px;height:${size}px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      <span style="color:white;font-size:16px;font-weight:bold;">${order}</span>
    </div>
  `;
  return L.divIcon({ html, className: 'route-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export function createRoutePopupContent(wp: RouteWaypoint): string {
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

export function createActivityMarkerIcon(order: number, color: string): L.DivIcon {
  const size = 32;
  const html = `
    <div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
      <span style="color:white;font-size:14px;font-weight:bold;">${order}</span>
    </div>
  `;
  return L.divIcon({ html, className: 'activity-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export function createPersonMarkerIcon(color: string): L.DivIcon {
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

export function createActivityPopupContent(wp: RouteWaypoint, userName: string): string {
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
