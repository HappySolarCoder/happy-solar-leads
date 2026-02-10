'use client';

import { useState } from 'react';
import { Lead, User } from '@/app/types';
import { MapPin, Navigation, X, Clock, Route } from 'lucide-react';

interface RouteBuilderProps {
  leads: Lead[];
  users: User[];
  onGenerateRoute: (route: RouteWaypoint[]) => void;
  onClearRoute: () => void;
}

export interface RouteWaypoint {
  lead: Lead;
  order: number;
  lat: number;
  lng: number;
  distanceFromPrev?: string;
  durationFromPrev?: string;
}

interface RouteInfo {
  distanceMiles: number;
  durationMinutes: number;
  stopCount: number;
}

export default function RouteBuilder({ leads, users, onGenerateRoute, onClearRoute }: RouteBuilderProps) {
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [filterSetter, setFilterSetter] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeWaypoints, setRouteWaypoints] = useState<RouteWaypoint[]>([]);

  // Filter leads for route
  const filteredLeads = leads.filter(lead => {
    if (filterStatus === 'unclaimed' && lead.status !== 'unclaimed') return false;
    if (filterStatus === 'claimed' && lead.status !== 'claimed') return false;
    if (filterStatus === 'all' && lead.solarCategory === 'poor') return false;
    return true;
  });

  const handleGenerateRoute = async () => {
    if (!startAddress || !endAddress) {
      setError('Please enter both start and end addresses');
      return;
    }

    if (filteredLeads.length < 1) {
      setError('Need at least 1 lead to generate a route');
      return;
    }

    setIsLoading(true);
    setError(null);
    setRouteInfo(null);

    try {
      const waypoints = filteredLeads
        .filter(l => l.lat && l.lng)
        .map(l => ({ lat: l.lat, lng: l.lng }));

      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waypoints,
          startAddress,
          endAddress,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setIsLoading(false);
        return;
      }

      // Set route info
      setRouteInfo({
        distanceMiles: data.distanceMiles || 0,
        durationMinutes: data.durationMinutes || 0,
        stopCount: data.optimizedStops?.length || filteredLeads.length,
      });

      // Use OPTIMIZED order from API - waypointOrder gives us the correct sequence
      const optimizedStops = data.optimizedStops || [];
      
      // Match stops back to leads by location using the optimized order
      const newWaypoints: RouteWaypoint[] = optimizedStops.map((stop: any, index: number) => {
        // Find lead that matches this stop's coordinates
        const matchingLead = filteredLeads.find(l => 
          l.lat && l.lng && stop.lat && stop.lng &&
          Math.abs(l.lat - stop.lat) < 0.001 && 
          Math.abs(l.lng - stop.lng) < 0.001
        );
        
        return {
          lead: matchingLead || filteredLeads[0],
          order: stop.order,
          lat: stop.lat,
          lng: stop.lng,
          distanceFromPrev: stop.distanceMeters ? `${Math.round(stop.distanceMeters * 0.000621371 * 10) / 10} mi` : undefined,
          durationFromPrev: stop.duration,
        };
      });

      setRouteWaypoints(newWaypoints);
      onGenerateRoute(newWaypoints);

    } catch (e: any) {
      setError('Failed to generate route: ' + e.message);
    }

    setIsLoading(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Navigation className="w-5 h-5" />
          <h2 className="font-semibold">Smart Route</h2>
        </div>
        <button
          onClick={onClearRoute}
          className="p-1 hover:bg-blue-700 rounded"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Route Settings */}
      <div className="p-4 border-b border-gray-200">
        {/* Route Summary */}
        {routeInfo && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-green-700">
                <Route className="w-4 h-4" />
                <span className="font-medium">{routeInfo.distanceMiles} mi</span>
              </div>
              <div className="flex items-center gap-1 text-green-700">
                <Clock className="w-4 h-4" />
                <span className="font-medium">{routeInfo.durationMinutes} min</span>
              </div>
              <div className="flex items-center gap-1 text-green-700">
                <MapPin className="w-4 h-4" />
                <span className="font-medium">{routeInfo.stopCount} stops</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start Address</label>
            <input
              type="text"
              value={startAddress}
              onChange={(e) => setStartAddress(e.target.value)}
              placeholder="123 Main St, Rochester NY"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End (approximate area)</label>
            <input
              type="text"
              value={endAddress}
              onChange={(e) => setEndAddress(e.target.value)}
              placeholder="End near..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-3">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="all">All Solar Leads</option>
            <option value="unclaimed">Unclaimed Only</option>
            <option value="claimed">Claimed Only</option>
          </select>

          <select
            value={filterSetter}
            onChange={(e) => setFilterSetter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="all">All Setters</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </div>

        {/* Route Info & Generate */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-600">
            {filteredLeads.length} leads in route
          </span>
          <button
            onClick={handleGenerateRoute}
            disabled={isLoading || filteredLeads.length < 1}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                Optimizing...
              </>
            ) : (
              <>
                <Navigation className="w-4 h-4" />
                Generate Optimized Route
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Route Preview */}
      {routeWaypoints.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          {/* Show optimized order */}
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
            <p className="text-xs text-blue-600 font-medium">OPTIMIZED ORDER</p>
          </div>
          {routeWaypoints.map((wp) => (
            <div
              key={wp.lead.id}
              className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 hover:bg-gray-50"
            >
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                #{wp.order}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{wp.lead.name}</p>
                <p className="text-xs text-gray-500 truncate">{wp.lead.address}, {wp.lead.city}</p>
              </div>
              {wp.lead.estimatedBill && (
                <span className="text-xs text-gray-500">${wp.lead.estimatedBill}/mo</span>
              )}
              {wp.distanceFromPrev && (
                <span className="text-xs text-blue-600">{wp.distanceFromPrev}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
