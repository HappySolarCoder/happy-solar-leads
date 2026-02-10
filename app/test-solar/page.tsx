'use client';

import { useState } from 'react';

export default function SolarTest() {
  const [output, setOutput] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  function out(msg: string, type: 'pass' | 'fail' | 'info' | 'warn' = 'info') {
    const colors: Record<string, string> = {
      pass: '#44ff44',
      fail: '#ff4444',
      info: '#66b3ff',
      warn: '#ffaa00',
    };
    setOutput(prev => [...prev, `%c${msg}%c`]);
  }

  async function testSolar() {
    setIsLoading(true);
    setOutput(['☀️ Solar API Test']);

    const leads = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');
    const lead = leads.find((l: any) => l.lat && l.lng);

    if (!lead) {
      setOutput(['❌ No leads with coords']);
      setIsLoading(false);
      return;
    }

    setOutput([`Lead: ${lead.name}`, `${lead.lat}, ${lead.lng}`, '', 'Fetching...']);

    try {
      const resp = await fetch('/api/solar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lead.lat, lng: lead.lng })
      });

      const data = await resp.json();

      if (data.error) {
        setOutput(prev => [...prev, `❌ ${data.error}`]);
      } else {
        // Show only key metrics
        const solar = data.solarPotential;
        if (solar) {
          setOutput([
            `✅ ${lead.name}`,
            `☀️ Max Sunshine: ${solar.maxSunshineHoursPerYear?.toFixed(0) || '?'} hrs/yr`,
            `🔋 Max Panels: ${solar.maxArrayPanelsCount || '?'}`,
            `⚡ Yearly Energy: ${solar.maxArrayAreaMeters2?.toFixed(1) || '?'} kWh`,
            '',
            '💰 Financial (sample bill):',
            '  Payback: ~16 years',
            '  Lifetime savings: varies',
            '  See console for full data'
          ]);
          
          // Log full data to console for debugging
          console.log('Full Solar API Response:', data);
        } else {
          setOutput(prev => [...prev, '⚠️ No solar data for this location']);
        }
      }
    } catch (e: any) {
      setOutput(prev => [...prev, `❌ ${e.message}`]);
    }

    setIsLoading(false);
  }

  return (
    <div style={{ padding: '20px', background: '#1a1a1a', minHeight: '100vh', color: '#eee', fontFamily: 'Arial' }}>
      <h1 style={{ color: '#fff' }}>☀️ Solar API Quick Test</h1>
      <button onClick={testSolar} disabled={isLoading} style={{ padding: '12px 24px', background: '#0066cc', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
        {isLoading ? 'Testing...' : '☀️ Quick Test'}
      </button>
      <pre style={{ background: '#222', color: '#0f0', padding: '15px', borderRadius: '5px', marginTop: '15px', whiteSpace: 'pre-wrap', maxHeight: '400px' }}>
        {output.join('\n')}
      </pre>
      <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
        Full data available in browser console (F12)
      </p>
    </div>
  );
}
