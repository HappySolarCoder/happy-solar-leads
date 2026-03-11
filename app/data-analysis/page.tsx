'use client';

import { useEffect, useMemo, useState } from 'react';
import HeatmapView from '@/app/components/Heatmap';
import type { Heatmap, HeatmapMode, RepHeatmaps } from '@/app/data/knockers';

type HeatmapResp = {
  ok: boolean;
  windowDays: number;
  timezone: string;
  team: RepHeatmaps & { totals: { appointments: number; knocks: number } };
  reps: Array<RepHeatmaps & { totals: { appointments: number; knocks: number } }>;
};

export default function DataAnalysisPage() {
  const [repId, setRepId] = useState<string>('team');
  const [mode, setMode] = useState<HeatmapMode>('rate');
  const [data, setData] = useState<HeatmapResp | null>(null);

  const [error, setError] = useState<string | null>(null);

  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const defaultEnd = ymd(new Date());
  const defaultStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return ymd(d);
  })();

  const [start, setStart] = useState<string>(defaultStart);
  const [end, setEnd] = useState<string>(defaultEnd);
  const [applied, setApplied] = useState<{ start: string; end: string }>({ start: defaultStart, end: defaultEnd });

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    const t = setTimeout(() => ctrl.abort(), 9000);

    const qs = new URLSearchParams({ start: applied.start, end: applied.end });

    fetch(`/api/analytics/heatmap?${qs.toString()}`, { cache: 'no-store', signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.ok === false) {
          setError(j?.error || 'Failed to load heatmap');
          setData(null);
          return;
        }
        setError(null);
        setData(j);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.name === 'AbortError' ? 'Heatmap request timed out' : (e?.message || 'Failed to load heatmap'));
        setData(null);
      })
      .finally(() => clearTimeout(t));

    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(t);
    };
  }, [applied.start, applied.end]);

  const selected = useMemo(() => {
    const team = data?.team;
    const reps = data?.reps ?? [];
    if (!team) return null;
    if (repId === 'team') return team;
    return reps.find((r) => r.repId === repId) ?? team;
  }, [repId, data]);

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#2D3748]">Data Analysis</h1>
          <p className="text-sm text-[#718096] mt-1">
            Time-of-day effectiveness heatmaps. Default metric is appointment rate (appointments / knocks).
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 mb-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#2D3748]">View</div>
              <div className="text-xs text-[#718096]">Team + per-rep • {applied.start} → {applied.end} ({data?.timezone ?? '—'})</div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-sm text-[#2D3748]">Dates</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  />
                  <span className="text-sm text-[#718096]">→</span>
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                  />
                  <button
                    onClick={() => setApplied({ start, end })}
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#2D3748] text-white hover:bg-[#1A202C]"
                    title="Apply date range"
                  >
                    Apply
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-[#2D3748]">Rep</label>
                <select
                  value={repId}
                  onChange={(e) => setRepId(e.target.value)}
                  className="px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                >
                  <option value="team">Team</option>
                  {(data?.reps ?? []).map((r) => (
                    <option key={r.repId} value={r.repId}>
                      {r.repName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-[#2D3748]">Metric</label>
                <div className="inline-flex rounded-lg border border-[#E2E8F0] overflow-hidden">
                  <button
                    onClick={() => setMode('rate')}
                    className={`px-3 py-2 text-sm font-medium ${mode === 'rate' ? 'bg-[#FF5F5A] text-white' : 'bg-white text-[#2D3748]'}`}
                  >
                    Rate %
                  </button>
                  <button
                    onClick={() => setMode('count')}
                    className={`px-3 py-2 text-sm font-medium ${mode === 'count' ? 'bg-[#FF5F5A] text-white' : 'bg-white text-[#2D3748]'}`}
                  >
                    Count
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!selected ? (
          <div className="text-sm text-[#718096]">
            {error ? (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4">
                <div className="font-semibold">Heatmap failed to load</div>
                <div className="text-sm mt-1">{error}</div>
              </div>
            ) : (
              'Loading…'
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {/* Appointments: Rate uses appointments as numerator and activity as denominator */}
            <HeatmapView
              title={`${selected.repName}: Appointment ${mode === 'rate' ? 'Rate' : 'Count'}`}
              mode={mode}
              numerator={selected.appointments as Heatmap}
              denominator={selected.activity as Heatmap}
              data={selected.appointments as Heatmap}
              palette="blue"
              showTotals
            />
            <HeatmapView
              title={`${selected.repName}: Activity (Knocks / Working)`}
              data={selected.activity as Heatmap}
              palette="emerald"
              mode="count"
              showTotals
            />
          </div>
        )}

        <div className="mt-6 text-xs text-[#718096]">
          Data source: Firestore <code className="text-[#2D3748]">leads.dispositionHistory[]</code> (bucketed in {data?.timezone ?? '—'})
        </div>
      </div>
    </div>
  );
}
