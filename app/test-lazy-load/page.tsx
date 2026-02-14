'use client';

import { useState, useEffect } from 'react';
import { getLeadsInBoundsAsync } from '@/app/utils/storage';
import { Lead } from '@/app/types';

export default function TestLazyLoadPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rochester, NY area bounds
  const rochesterBounds = {
    south: 43.0,
    north: 43.3,
    west: -77.8,
    east: -77.4
  };

  const loadLeads = async () => {
    setLoading(true);
    setError(null);
    try {
      const start = Date.now();
      const loadedLeads = await getLeadsInBoundsAsync(
        rochesterBounds.south,
        rochesterBounds.north,
        rochesterBounds.west,
        rochesterBounds.east,
        2000
      );
      const duration = Date.now() - start;
      
      setLeads(loadedLeads);
      console.log(`Loaded ${loadedLeads.length} leads in ${duration}ms`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
      console.error('Error loading leads:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Lazy Loading Test Page</h1>
      
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-lg font-semibold mb-2">Test Bounds (Rochester, NY)</h2>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <strong>South:</strong> {rochesterBounds.south}
          </div>
          <div>
            <strong>North:</strong> {rochesterBounds.north}
          </div>
          <div>
            <strong>West:</strong> {rochesterBounds.west}
          </div>
          <div>
            <strong>East:</strong> {rochesterBounds.east}
          </div>
        </div>
        
        <button
          onClick={loadLeads}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {loading ? 'Loading...' : 'Load Leads in Bounds'}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          Error: {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-2">Results</h2>
        <div className="text-sm mb-4">
          <strong>Leads Loaded:</strong> {leads.length}
        </div>
        
        {leads.length > 0 && (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Address</th>
                  <th className="px-4 py-2 text-left">Lat/Lng</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t">
                    <td className="px-4 py-2">{lead.name}</td>
                    <td className="px-4 py-2">{lead.address}, {lead.city}</td>
                    <td className="px-4 py-2">
                      {lead.lat?.toFixed(4)}, {lead.lng?.toFixed(4)}
                    </td>
                    <td className="px-4 py-2">{lead.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
