'use client';

import { useEffect, useMemo, useState } from 'react';
import HeatmapView from '@/app/components/Heatmap';
import type { Heatmap, HeatmapMode, RepHeatmaps } from '@/app/data/knockers';
import { getLeadsAsync } from '@/app/utils/storage';
import type { Lead } from '@/app/types';

type HeatmapResp = {
  ok: boolean;
  windowDays: number;
  timezone: string;
  team: RepHeatmaps & { totals: { appointments: number; knocks: number } };
  reps: Array<RepHeatmaps & { totals: { appointments: number; knocks: number } }>;
};

type CoachingResp = {
  ok: boolean;
  rep: { repId: string; repName: string };
  timezone: string;
  totals: {
    attempts: number;
    successAppointments: number;
    moderateSuccess: number;
    appointmentRatePct: number;
    moderateSuccessRatePct: number;
    primeAttempts: number;
    primeSharePct: number;
  };
  breakdown: {
    byStatus: Record<string, number>;
    notInterestedReasons: Record<string, { count: number; label: string }>;
  };
  samples: {
    objections: Array<{ ts: string; type: string; label: string; notes: string }>;
    notes: Array<{ ts: string; notes: string }>;
  };
};

type TrendPoint = {
  day: string; // YYYY-MM-DD in America/New_York
  attempts: number;
  appointments: number;
  appointmentRatePct: number;
  moderate: number;
  moderateSuccessRatePct: number;
  notInterested: number;
  notInterestedRatePct: number;
  primeSharePct: number;
};

export default function DataAnalysisPage() {
  const [repId, setRepId] = useState<string>('team');
  const [mode, setMode] = useState<HeatmapMode>('rate');
  const [data, setData] = useState<HeatmapResp | null>(null);
  const [coaching, setCoaching] = useState<CoachingResp | null>(null);
  const [coachText, setCoachText] = useState<any | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);

  const [trends, setTrends] = useState<TrendPoint[] | null>(null);
  const [trendsDays, setTrendsDays] = useState<14 | 30>(14);
  const [trendsError, setTrendsError] = useState<string | null>(null);

  const [bench, setBench] = useState<null | {
    windowDays: number;
    team: {
      median: Record<string, number>;
      p75: Record<string, number>;
    };
    rep?: {
      repId: string;
      repName: string;
      metrics: Record<string, number>;
      flags: string[];
      signature: { primary: string; secondary?: string; reasons: string[] };
    };
  }>(null);

  const [error, setError] = useState<string | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    const t = setTimeout(() => ctrl.abort(), 12000);

    const qs = new URLSearchParams({
      repId,
      start: applied.start,
      end: applied.end,
      tz: 'America/New_York',
    });

    fetch(`/api/analytics/coaching?${qs.toString()}`, { cache: 'no-store', signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.ok === false) {
          setCoachError(j?.error || 'Failed to load coaching metrics');
          setCoaching(null);
          return;
        }
        setCoachError(null);
        setCoaching(j);
      })
      .catch((e) => {
        if (cancelled) return;
        setCoachError(e?.name === 'AbortError' ? 'Coaching request timed out' : (e?.message || 'Failed to load coaching metrics'));
        setCoaching(null);
      })
      .finally(() => clearTimeout(t));

    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(t);
    };
  }, [repId, applied.start, applied.end]);

  // V2 Trends + Benchmarks: compute client-side using same Firestore browser SDK pathway as /setter-stats.
  useEffect(() => {
    let cancelled = false;

    const tz = 'America/New_York';
    const PRIME_START = 16;
    const PRIME_END = 19;

    const toYmd = (utcMs: number) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(utcMs));
      const get = (t: string) => parts.find((p) => p.type === t)?.value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    };

    const hourInTz = (utcMs: number) =>
      Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(utcMs)));

    const parseEntryDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v === 'string' || typeof v === 'number') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if ((v as any)?.toDate) return (v as any).toDate();
      if (v instanceof Date) return v;
      return null;
    };

    const ATTEMPT_LABELS = new Set([
      'not home',
      'interested',
      'not interested',
      'appointment set',
      'go back',
      'sale',
      'sale!',
      'dq credit',
      'shade dq',
      'callback scheduled',
      'follow up later',
      'renter',
    ]);

    const isAttempt = (label: string) => ATTEMPT_LABELS.has(label);
    const isAppointment = (label: string) => label === 'appointment set' || label === 'appointment';
    const isModerate = (label: string) => label === 'go back' || label === 'interested';
    const isNotInterested = (label: string) => label === 'not interested';
    const isNotHome = (label: string) => label === 'not home';

    const quantile = (arr: number[], q: number) => {
      const xs = [...arr].sort((a, b) => a - b);
      if (!xs.length) return 0;
      const pos = (xs.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (xs[base + 1] !== undefined) return xs[base] + rest * (xs[base + 1] - xs[base]);
      return xs[base];
    };

    const run = async () => {
      try {
        setTrendsError(null);
        setTrends(null);
        setBench(null);

        const leads: Lead[] = await getLeadsAsync();

        const endMs = Date.now();
        const startMs = endMs - trendsDays * 24 * 60 * 60_000;

        // -------- Trends (selected rep/team) --------
        const byDay: Record<string, { attempts: number; appointments: number; moderate: number; notInterested: number; primeAttempts: number }> = {};
        const ensureDay = (day: string) =>
          (byDay[day] ||= { attempts: 0, appointments: 0, moderate: 0, notInterested: 0, primeAttempts: 0 });

        // -------- Benchmarks (per rep aggregate) --------
        const byRep: Record<string, {
          attempts: number;
          appointments: number;
          moderate: number;
          notInterested: number;
          notHome: number;
          primeAttempts: number;
          activeDays: Set<string>;
        }> = {};
        const ensureRep = (rid: string) =>
          (byRep[rid] ||= {
            attempts: 0,
            appointments: 0,
            moderate: 0,
            notInterested: 0,
            notHome: 0,
            primeAttempts: 0,
            activeDays: new Set<string>(),
          });

        for (const lead of leads) {
          const hist = Array.isArray((lead as any).dispositionHistory) ? (lead as any).dispositionHistory : [];
          for (const e of hist) {
            const dt = parseEntryDate(e?.timestamp);
            if (!dt) continue;
            const ts = dt.getTime();
            if (ts < startMs || ts > endMs) continue;

            const uid = String(e?.userId ?? '');
            if (!uid) continue;

            const label = String(e?.disposition ?? '').trim().toLowerCase();
            if (!isAttempt(label)) continue;

            // selected trends filter
            if (repId === 'team' || uid === repId) {
              const day = toYmd(ts);
              const agg = ensureDay(day);
              agg.attempts += 1;
              if (isAppointment(label)) agg.appointments += 1;
              if (isModerate(label)) agg.moderate += 1;
              if (isNotInterested(label)) agg.notInterested += 1;
              const hr = hourInTz(ts);
              if (hr >= PRIME_START && hr <= PRIME_END) agg.primeAttempts += 1;
            }

            // per-rep aggregate for benchmarks
            const repAgg = ensureRep(uid);
            repAgg.attempts += 1;
            if (isAppointment(label)) repAgg.appointments += 1;
            if (isModerate(label)) repAgg.moderate += 1;
            if (isNotInterested(label)) repAgg.notInterested += 1;
            if (isNotHome(label)) repAgg.notHome += 1;
            const hr = hourInTz(ts);
            if (hr >= PRIME_START && hr <= PRIME_END) repAgg.primeAttempts += 1;
            repAgg.activeDays.add(toYmd(ts));
          }
        }

        const daysSorted = Object.keys(byDay).sort();
        const series: TrendPoint[] = daysSorted.map((day) => {
          const d = byDay[day];
          const appointmentRatePct = d.attempts ? +((d.appointments / d.attempts) * 100).toFixed(2) : 0;
          const moderateSuccessRatePct = d.attempts ? +((d.moderate / d.attempts) * 100).toFixed(2) : 0;
          const notInterestedRatePct = d.attempts ? +((d.notInterested / d.attempts) * 100).toFixed(2) : 0;
          const primeSharePct = d.attempts ? +((d.primeAttempts / d.attempts) * 100).toFixed(2) : 0;
          return {
            day,
            attempts: d.attempts,
            appointments: d.appointments,
            appointmentRatePct,
            moderate: d.moderate,
            moderateSuccessRatePct,
            notInterested: d.notInterested,
            notInterestedRatePct,
            primeSharePct,
          };
        });

        // Compute team distribution arrays
        const repRows = Object.entries(byRep)
          .map(([rid, a]) => {
            const activeDays = Math.max(1, a.activeDays.size);
            const attemptsPerDay = a.attempts / activeDays;
            const apptRate = a.attempts ? (a.appointments / a.attempts) * 100 : 0;
            const niRate = a.attempts ? (a.notInterested / a.attempts) * 100 : 0;
            const primeShare = a.attempts ? (a.primeAttempts / a.attempts) * 100 : 0;
            const notHomeRate = a.attempts ? (a.notHome / a.attempts) * 100 : 0;
            return {
              rid,
              attemptsPerDay,
              apptRate,
              niRate,
              primeShare,
              notHomeRate,
              attempts: a.attempts,
            };
          })
          .filter((r) => r.attempts > 0);

        const dist = {
          attemptsPerDay: repRows.map((r) => r.attemptsPerDay),
          apptRate: repRows.map((r) => r.apptRate),
          niRate: repRows.map((r) => r.niRate),
          primeShare: repRows.map((r) => r.primeShare),
        };

        const teamMedian = {
          attemptsPerDay: +quantile(dist.attemptsPerDay, 0.5).toFixed(2),
          apptRate: +quantile(dist.apptRate, 0.5).toFixed(2),
          niRate: +quantile(dist.niRate, 0.5).toFixed(2),
          primeShare: +quantile(dist.primeShare, 0.5).toFixed(2),
        };

        const teamP75 = {
          attemptsPerDay: +quantile(dist.attemptsPerDay, 0.75).toFixed(2),
          apptRate: +quantile(dist.apptRate, 0.75).toFixed(2),
          niRate: +quantile(dist.niRate, 0.75).toFixed(2),
          primeShare: +quantile(dist.primeShare, 0.75).toFixed(2),
        };

        let repBench: any = undefined;
        if (repId !== 'team') {
          const row = repRows.find((r) => r.rid === repId);
          if (row) {
            const flags: string[] = [];
            if (row.primeShare < teamMedian.primeShare - 10) flags.push('Prime-time underutilized');
            if (row.apptRate < teamMedian.apptRate - 1) flags.push('Low appointment rate');
            if (row.niRate > teamMedian.niRate + 5) flags.push('High Not Interested rate');

            const reasons: string[] = [];
            const sig: { primary: string; secondary?: string; reasons: string[] } = { primary: 'Normal', reasons };

            const timingScore = (teamMedian.primeShare - row.primeShare) + (row.notHomeRate > 0 ? (row.notHomeRate - 40) : 0);
            const pitchScore = (teamMedian.apptRate - row.apptRate);
            const sentimentScore = (row.niRate - teamMedian.niRate);

            const ranked = [
              { k: 'Timing issue', v: timingScore },
              { k: 'Pitch/close issue', v: pitchScore },
              { k: 'Negative sentiment issue', v: sentimentScore },
            ].sort((a, b) => b.v - a.v);

            if (ranked[0].v > 5) {
              sig.primary = ranked[0].k;
              sig.secondary = ranked[1].v > 3 ? ranked[1].k : undefined;
              if (sig.primary === 'Timing issue') reasons.push('Prime-time share is materially below team median and/or Not Home rate is high.');
              if (sig.primary === 'Pitch/close issue') reasons.push('Attempts are present but appointment rate is below team median.');
              if (sig.primary === 'Negative sentiment issue') reasons.push('Not Interested rate is above team median.');
            }

            repBench = {
              repId,
              repName: selected?.repName || repId,
              metrics: {
                attemptsPerDay: +row.attemptsPerDay.toFixed(2),
                apptRate: +row.apptRate.toFixed(2),
                niRate: +row.niRate.toFixed(2),
                primeShare: +row.primeShare.toFixed(2),
              },
              flags,
              signature: sig,
            };
          }
        }

        if (cancelled) return;
        setTrends(series);
        setBench({ windowDays: trendsDays, team: { median: teamMedian, p75: teamP75 }, rep: repBench });
      } catch (e: any) {
        if (cancelled) return;
        setTrendsError(e?.message || 'Failed to compute trends');
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [repId, trendsDays]);

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
            {/* KPIs */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
              <div className="text-sm font-semibold text-[#2D3748] mb-2">KPIs ({repId === 'team' ? 'Team' : selected.repName})</div>
              {coachError ? (
                <div className="text-sm text-red-700">{coachError}</div>
              ) : coaching ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-[#F7FAFC] rounded-xl p-3">
                    <div className="text-xs text-[#718096]">Attempts</div>
                    <div className="text-xl font-bold text-[#2D3748] tabular-nums">{coaching.totals.attempts}</div>
                  </div>
                  <div className="bg-[#F7FAFC] rounded-xl p-3">
                    <div className="text-xs text-[#718096]">Appointments</div>
                    <div className="text-xl font-bold text-[#2D3748] tabular-nums">{coaching.totals.successAppointments}</div>
                    <div className="text-xs text-[#718096] tabular-nums">{coaching.totals.appointmentRatePct}% rate</div>
                  </div>
                  <div className="bg-[#F7FAFC] rounded-xl p-3">
                    <div className="text-xs text-[#718096]">Moderate Success</div>
                    <div className="text-xl font-bold text-[#2D3748] tabular-nums">{coaching.totals.moderateSuccess}</div>
                    <div className="text-xs text-[#718096] tabular-nums">{coaching.totals.moderateSuccessRatePct}%</div>
                  </div>
                  <div className="bg-[#F7FAFC] rounded-xl p-3">
                    <div className="text-xs text-[#718096]">Prime Time (4–7pm)</div>
                    <div className="text-xl font-bold text-[#2D3748] tabular-nums">{coaching.totals.primeSharePct}%</div>
                    <div className="text-xs text-[#718096] tabular-nums">{coaching.totals.primeAttempts} attempts</div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-[#718096]">Loading KPIs…</div>
              )}
            </div>

            {/* Benchmarks & Diagnosis (V2.2) */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
              <div className="text-sm font-semibold text-[#2D3748]">Benchmarks & Diagnosis</div>
              <div className="text-xs text-[#718096] mt-1">Rep vs Team (median + p75) • window {bench?.windowDays ?? trendsDays}d • EST</div>

              {!bench ? (
                <div className="mt-3 text-sm text-[#718096]">Computing benchmarks…</div>
              ) : repId === 'team' ? (
                <div className="mt-3 text-sm text-[#718096]">Select a rep to see diagnosis vs Team benchmarks.</div>
              ) : !bench.rep ? (
                <div className="mt-3 text-sm text-[#718096]">No benchmark data for this rep in the current window.</div>
              ) : (
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-[#F7FAFC] rounded-xl p-3">
                    <div className="text-sm font-semibold text-[#2D3748]">{bench.rep.repName}</div>
                    <div className="text-xs text-[#718096] mt-1">Signature: <span className="font-semibold text-[#2D3748]">{bench.rep.signature.primary}</span>{bench.rep.signature.secondary ? ` • Secondary: ${bench.rep.signature.secondary}` : ''}</div>
                    {bench.rep.signature.reasons?.length ? (
                      <ul className="mt-2 text-xs text-[#4A5568] list-disc pl-5">
                        {bench.rep.signature.reasons.slice(0, 3).map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : null}
                    {bench.rep.flags.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {bench.rep.flags.map((f) => (
                          <span key={f} className="text-xs font-semibold px-2 py-1 rounded-full bg-[#FF5F5A]/10 text-[#C53030]">
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-[#718096]">No outlier flags.</div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] w-full text-sm">
                      <thead>
                        <tr className="text-xs text-[#718096]">
                          <th className="text-left font-semibold py-2">Metric</th>
                          <th className="text-right font-semibold py-2">Rep</th>
                          <th className="text-right font-semibold py-2">Team median</th>
                          <th className="text-right font-semibold py-2">Team p75</th>
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { k: 'attemptsPerDay', label: 'Attempts/day', fmt: (v: number) => v.toFixed(2) },
                          { k: 'apptRate', label: 'Appt rate %', fmt: (v: number) => v.toFixed(2) + '%' },
                          { k: 'niRate', label: 'Not Interested %', fmt: (v: number) => v.toFixed(2) + '%' },
                          { k: 'primeShare', label: 'Prime-time share %', fmt: (v: number) => v.toFixed(2) + '%' },
                        ] as const).map((m) => (
                          <tr key={m.k} className="border-t border-[#EDF2F7]">
                            <td className="py-2 text-[#2D3748] font-medium">{m.label}</td>
                            <td className="py-2 text-right tabular-nums">{m.fmt(bench.rep!.metrics[m.k])}</td>
                            <td className="py-2 text-right tabular-nums">{m.fmt((bench.team.median as any)[m.k])}</td>
                            <td className="py-2 text-right tabular-nums">{m.fmt((bench.team.p75 as any)[m.k])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Trends (V2) */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#2D3748]">Trends</div>
                  <div className="text-xs text-[#718096]">Daily buckets (EST) • computed client-side like /setter-stats</div>
                </div>
                <div className="inline-flex rounded-lg border border-[#E2E8F0] overflow-hidden">
                  <button
                    onClick={() => setTrendsDays(14)}
                    className={`px-3 py-2 text-sm font-medium ${trendsDays === 14 ? 'bg-[#2D3748] text-white' : 'bg-white text-[#2D3748]'}`}
                  >
                    14d
                  </button>
                  <button
                    onClick={() => setTrendsDays(30)}
                    className={`px-3 py-2 text-sm font-medium ${trendsDays === 30 ? 'bg-[#2D3748] text-white' : 'bg-white text-[#2D3748]'}`}
                  >
                    30d
                  </button>
                </div>
              </div>

              {trendsError ? (
                <div className="mt-3 text-sm text-red-700">{trendsError}</div>
              ) : !trends ? (
                <div className="mt-3 text-sm text-[#718096]">Loading trends…</div>
              ) : trends.length === 0 ? (
                <div className="mt-3 text-sm text-[#718096]">No trend data in this window.</div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[#718096]">
                        <th className="text-left font-semibold py-2">Day</th>
                        <th className="text-right font-semibold py-2">Attempts</th>
                        <th className="text-right font-semibold py-2">Appts</th>
                        <th className="text-right font-semibold py-2">Appt %</th>
                        <th className="text-right font-semibold py-2">Moderate %</th>
                        <th className="text-right font-semibold py-2">NI %</th>
                        <th className="text-right font-semibold py-2">Prime %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trends.slice(-30).map((d) => (
                        <tr key={d.day} className="border-t border-[#EDF2F7]">
                          <td className="py-2 text-[#2D3748] font-medium">{d.day}</td>
                          <td className="py-2 text-right tabular-nums">{d.attempts}</td>
                          <td className="py-2 text-right tabular-nums">{d.appointments}</td>
                          <td className="py-2 text-right tabular-nums">{d.appointmentRatePct}%</td>
                          <td className="py-2 text-right tabular-nums">{d.moderateSuccessRatePct}%</td>
                          <td className="py-2 text-right tabular-nums">{d.notInterestedRatePct}%</td>
                          <td className="py-2 text-right tabular-nums">{d.primeSharePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Not Interested reasons */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#2D3748]">Not Interested reasons</div>
                  <div className="text-xs text-[#718096]">From objectionType</div>
                </div>
              </div>
              {coaching ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(coaching.breakdown.notInterestedReasons || {}).slice(0, 10).map(([id, v]) => (
                    <div key={id} className="flex items-center justify-between bg-[#F7FAFC] rounded-xl px-3 py-2">
                      <div className="text-sm text-[#2D3748]">{v.label}</div>
                      <div className="text-sm font-semibold text-[#2D3748] tabular-nums">{v.count}</div>
                    </div>
                  ))}
                  {Object.keys(coaching.breakdown.notInterestedReasons || {}).length === 0 ? (
                    <div className="text-sm text-[#718096]">No objection reasons found in this range.</div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-[#718096] mt-2">Loading…</div>
              )}
            </div>

            {/* AI Coach */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#2D3748]">AI Coach</div>
                  <div className="text-xs text-[#718096]">Expert solar D2D coaching based on timing + dispositions</div>
                </div>
                <button
                  onClick={async () => {
                    if (!coaching) return;
                    setCoachLoading(true);
                    setCoachText(null);
                    try {
                      const r = await fetch('/api/ai/coaching', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ metrics: coaching }),
                      });
                      const j = await r.json();
                      setCoachText(j);
                    } finally {
                      setCoachLoading(false);
                    }
                  }}
                  disabled={!coaching || coachLoading}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#FF5F5A] text-white hover:bg-[#e45550] disabled:opacity-60"
                >
                  {coachLoading ? 'Generating…' : 'Generate coaching report'}
                </button>
              </div>

              {coachText ? (
                <pre className="mt-3 text-xs bg-[#0B1020] text-white rounded-xl p-3 overflow-auto">{JSON.stringify(coachText, null, 2)}</pre>
              ) : (
                <div className="mt-3 text-sm text-[#718096]">Click generate to get a structured coaching report.</div>
              )}
            </div>

            {/* Heatmaps */}
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
