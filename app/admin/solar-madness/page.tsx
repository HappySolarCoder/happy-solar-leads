'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/app/utils/firebase';

export default function SolarMadnessAdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const pretty = useMemo(() => {
    try {
      const obj = raw ? JSON.parse(raw) : null;
      return obj ? JSON.stringify(obj, null, 2) : '';
    } catch {
      return '';
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
        const res = await fetch('/api/admin/solar-madness-config', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setRaw(JSON.stringify(data.config || {
          enabled: false,
          seasonName: 'Solar Madness',
          // Firestore timestamps allowed here if pasted from console; for UI, use ISO strings
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          baseOddsRegular: 0.05,
          baseOddsAppointment: 0.25,
          regularPrizes: [],
          appointmentPrizes: [],
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
      const parsed = JSON.parse(raw);
      const res = await fetch('/api/admin/solar-madness-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ config: parsed }),
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
        <h1 className="text-2xl font-extrabold text-[#2D3748]">Solar Madness (Admin)</h1>
        <p className="text-sm text-[#718096] mt-1">Edit the config JSON for odds + prize pools. Changes apply immediately.</p>
        <div className="mt-3">
          <a className="text-sm font-semibold text-[#4299E1] hover:underline" href="/admin/solar-madness-bracket">Configure Bracket →</a>
        </div>

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
              <label className="text-xs font-semibold text-[#2D3748]">Config JSON</label>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                className="w-full min-h-[420px] font-mono text-xs rounded-xl border border-[#E2E8F0] p-3"
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="h-11 px-5 rounded-xl bg-[#FF5F5A] text-white font-bold disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {pretty && (
                  <span className="text-xs text-[#718096]">JSON parsed OK</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
