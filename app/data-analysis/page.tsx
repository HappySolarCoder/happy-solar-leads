'use client';

import { useEffect, useMemo, useState } from 'react';

type HeatmapGrid = {
  hours: number[];
  days: string[];
  values: number[][];
};

type RepRow = {
  repId: string;
  repName: string;
  appointments: HeatmapGrid;
  activity: HeatmapGrid;
  totals: { appointments: number; knocks: number };
};

type HeatmapResponse = {
  ok: boolean;
  windowDays: number;
  timeZone: string;
  appointmentDisposition: string;
  reps: RepRow[];
  error?: string;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function cellBg(intensity: number, hue: 'blue' | 'green') {
  const a = clamp01(intensity);
  const base = hue === 'blue' ? [59, 130, 246] : [16, 185, 129]; // tailwind-ish
  const mix = (c: number) => Math.round(255 - (255 - c) * a);
  return `rgb(${mix(base[0])}, ${mix(base[1])}, ${mix(base[2])})`;
}

function maxInGrid(g: HeatmapGrid): number {
  let m = 0;
  for (const row of g.values) for (const v of row) m = Math.max(m, v);
  return m;
}

function sumGrid(g: HeatmapGrid): number {
  let s = 0;
  for (const row of g.values) for (const v of row) s += v;
  return s;
}

function Heatmap({
  title,
  subtitle,
  grid,
  hue,
  showRateAgainst,
}: {
  title: string;
  subtitle?: string;
  grid: HeatmapGrid;
  hue: 'blue' | 'green';
  showRateAgainst?: HeatmapGrid; // if provided, display numerator/denominator in cells
}) {
  const maxVal = useMemo(() => maxInGrid(grid), [grid]);
  const maxDen = useMemo(() => (showRateAgainst ? maxInGrid(showRateAgainst) : 0), [showRateAgainst]);

  return (
    <div className="rounded-2xl border border-black/10 bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-black/5">
        <div className="font-semibold text-gray-900">{title}</div>
        {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : null}
      </div>

      <div className="p-4 overflow-x-auto">
        <table className="min-w-[720px] text-xs">
          <thead>
            <tr>
              <th className="text-left pr-2 text-gray-500 font-medium">Day</th>
              {grid.hours.map(h => (
                <th key={h} className="px-2 text-gray-500 font-medium">{h}</th>
              ))}
              <th className="pl-2 text-gray-500 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.days.map((day, di) => {
              const rowTotal = grid.values[di].reduce((a, b) => a + b, 0);
              const denRowTotal = showRateAgainst ? showRateAgainst.values[di].reduce((a, b) => a + b, 0) : 0;
              return (
                <tr key={day}>
                  <td className="pr-2 font-medium text-gray-700">{day}</td>
                  {grid.hours.map((h, hi) => {
                    const v = grid.values[di][hi];
                    const denom = showRateAgainst ? showRateAgainst.values[di][hi] : 0;
                    const intensity = maxVal > 0 ? v / maxVal : 0;
                    const tooltip = showRateAgainst
                      ? `${day} @ ${h}:00\n${v} appts / ${denom} knocks\nrate: ${denom ? Math.round((v / denom) * 100) : 0}%`
                      : `${day} @ ${h}:00\n${v}`;

                    return (
                      <td key={h} className="px-1 py-1">
                        <div
                          title={tooltip}
                          className="h-7 rounded-md border border-black/5 flex items-center justify-center"
                          style={{ background: cellBg(intensity, hue) }}
                        >
                          <span className="text-[10px] text-gray-900/80">
                            {showRateAgainst ? `${v}/${denom}` : v}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="pl-2 text-gray-600 tabular-nums">
                    {showRateAgainst ? `${rowTotal}/${denRowTotal}` : rowTotal}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className="pr-2 font-semibold text-gray-700">Total</td>
              {grid.hours.map((h, hi) => {
                const col = grid.values.reduce((acc, row) => acc + row[hi], 0);
                const denomCol = showRateAgainst ? showRateAgainst.values.reduce((acc, row) => acc + row[hi], 0) : 0;
                return (
                  <td key={h} className="px-1 py-2 text-gray-600 tabular-nums">
                    <div className="text-center">{showRateAgainst ? `${col}/${denomCol}` : col}</div>
                  </td>
                );
              })}
              <td className="pl-2 font-semibold text-gray-700 tabular-nums">
                {showRateAgainst ? `${sumGrid(grid)}/${sumGrid(showRateAgainst!)}` : sumGrid(grid)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 text-[11px] text-gray-500">
          Max cell: {maxVal}
          {showRateAgainst ? ` (denom max: ${maxDen})` : ''}
        </div>
      </div>
    </div>
  );
}

export default function DataAnalysisPage() {
  const [resp, setResp] = useState<HeatmapResponse | null>(null);
  const [repId, setRepId] = useState<string>('team');
  const [metric, setMetric] = useState<'rate' | 'count'>('rate');

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch('/api/analytics/heatmap?days=14&tz=America/New_York&startHour=9&endHour=19', {
        cache: 'no-store',
      });
      const json = (await r.json()) as HeatmapResponse;
      if (alive) setResp(json);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reps = resp?.reps ?? [];
  const selected = reps.find(r => r.repId === repId) ?? reps[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Analysis</h1>
        <p className="text-sm text-gray-600">
          Time-of-day effectiveness heatmaps. Default metric is appointment rate (appointments / knocks).
        </p>
      </div>

      <div className="rounded-2xl border border-black/10 bg-white shadow-sm mb-6">
        <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-gray-700">
            <div className="font-medium">View</div>
            <div className="text-xs text-gray-500">Team + per-rep • real data (last 14 days)</div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-gray-600">Rep</label>
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={repId}
              onChange={e => setRepId(e.target.value)}
              disabled={!resp?.ok}
            >
              {reps.map(r => (
                <option key={r.repId} value={r.repId}>
                  {r.repName}
                </option>
              ))}
            </select>

            <label className="text-xs text-gray-600">Metric</label>
            <div className="inline-flex rounded-lg overflow-hidden border">
              <button
                className={`px-3 py-2 text-sm ${metric === 'rate' ? 'bg-red-500 text-white' : 'bg-white'}`}
                onClick={() => setMetric('rate')}
                type="button"
              >
                Rate %
              </button>
              <button
                className={`px-3 py-2 text-sm ${metric === 'count' ? 'bg-red-500 text-white' : 'bg-white'}`}
                onClick={() => setMetric('count')}
                type="button"
              >
                Count
              </button>
            </div>
          </div>
        </div>
      </div>

      {!resp ? (
        <div className="text-sm text-gray-600">Loading…</div>
      ) : !resp.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load heatmap: {resp.error || 'Unknown error'}
        </div>
      ) : !selected ? (
        <div className="text-sm text-gray-600">No reps found.</div>
      ) : (
        <div className="grid gap-6">
          <Heatmap
            title={`${selected.repName}: Appointment ${metric === 'rate' ? 'Rate' : 'Count'}`}
            subtitle={
              metric === 'rate'
                ? 'Appointments rate (% of knocks) — cells show appts/knocks'
                : 'Appointments set (count)'
            }
            grid={selected.appointments}
            hue="blue"
            showRateAgainst={metric === 'rate' ? selected.activity : undefined}
          />

          <Heatmap
            title={`${selected.repName}: Activity (Knocks / Working)`}
            subtitle="Count of disposition events (best-effort)"
            grid={selected.activity}
            hue="green"
          />

          <div className="text-xs text-gray-500">
            Data source: Firestore leads.dispositionHistory ({resp.timeZone})
          </div>
        </div>
      )}
    </div>
  );
}
