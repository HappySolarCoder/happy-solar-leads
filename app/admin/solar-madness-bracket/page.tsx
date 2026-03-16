'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/app/utils/firebase';

export default function SolarMadnessBracketAdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const parsedOk = useMemo(() => {
    try {
      if (!raw) return true;
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }, [raw]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const token = await auth?.currentUser?.getIdToken();
        if (!token) {
          setError('Not logged in');
          return;
        }
        const res = await fetch('/api/admin/solar-madness-bracket', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setRaw(JSON.stringify(data.bracket || {
          seasonName: 'Solar Madness',
          participants: [],
          matchups: [],
        }, null, 2));
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const token = await auth?.currentUser?.getIdToken();
      if (!token) {
        setError('Not logged in');
        return;
      }
      const bracket = JSON.parse(raw);
      const res = await fetch('/api/admin/solar-madness-bracket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bracket }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSuccess('Saved');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-extrabold text-[#2D3748]">Solar Madness Bracket (Admin)</h1>
        <p className="text-sm text-[#718096] mt-1">Define participants + matchups windows. Scoring is computed from Solar Madness points/events.</p>

        {loading ? (
          <div className="mt-6 text-[#718096]">Loading…</div>
        ) : (
          <>
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}
            {success && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-4">
              <label className="text-xs font-semibold text-[#2D3748]">Bracket JSON</label>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                className="w-full min-h-[420px] font-mono text-xs rounded-xl border border-[#E2E8F0] p-3"
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !parsedOk}
                  className="h-11 px-5 rounded-xl bg-[#FF5F5A] text-white font-bold disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <span className="text-xs text-[#718096]">{parsedOk ? 'JSON parsed OK' : 'JSON invalid'}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
