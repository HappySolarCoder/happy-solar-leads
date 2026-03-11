'use client';

import type { Heatmap } from '@/app/data/knockers';

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function HeatmapView({
  title,
  subtitle,
  // If provided, show rate (numerator/denominator) as percent.
  numerator,
  denominator,
  data,
  palette = 'emerald',
  mode = 'count',
  showTotals = false,
}: {
  title: string;
  subtitle?: string;
  mode?: 'count' | 'rate';
  data?: Heatmap;
  numerator?: Heatmap;
  denominator?: Heatmap;
  palette?: 'emerald' | 'blue' | 'orange';
  showTotals?: boolean;
}) {
  const base = mode === 'rate' ? numerator : data;
  if (!base) return null;

  const max =
    mode === 'rate'
      ? 1
      : Math.max(1, ...(base.values ?? []).flat());

  const totals = (() => {
    const dayTotals = base.days.map((_, di) => {
      if (mode === 'rate') {
        const num = (numerator?.values?.[di] ?? []).reduce((a, b) => a + (b ?? 0), 0);
        const den = (denominator?.values?.[di] ?? []).reduce((a, b) => a + (b ?? 0), 0);
        return { num, den };
      }
      const v = (data?.values?.[di] ?? []).reduce((a, b) => a + (b ?? 0), 0);
      return { v } as any;
    });

    const colTotals = base.hours.map((_, hi) => {
      if (mode === 'rate') {
        let num = 0;
        let den = 0;
        for (let di = 0; di < base.days.length; di++) {
          num += numerator?.values?.[di]?.[hi] ?? 0;
          den += denominator?.values?.[di]?.[hi] ?? 0;
        }
        return { num, den };
      }
      let v = 0;
      for (let di = 0; di < base.days.length; di++) v += data?.values?.[di]?.[hi] ?? 0;
      return { v } as any;
    });

    const grand = (() => {
      if (mode === 'rate') {
        const num = dayTotals.reduce((a, x) => a + (x.num ?? 0), 0);
        const den = dayTotals.reduce((a, x) => a + (x.den ?? 0), 0);
        return { num, den };
      }
      const v = dayTotals.reduce((a, x) => a + (x.v ?? 0), 0);
      return { v } as any;
    })();

    return { dayTotals, colTotals, grand };
  })();

  const color = (v: number) => {
    // for rate, v is 0..1
    const t = clamp(mode === 'rate' ? v : v / max, 0, 1);
    const a = 0.06 + t * 0.42;
    const baseColor =
      palette === 'blue'
        ? `rgba(59,130,246,${a})`
        : palette === 'orange'
          ? `rgba(249,115,22,${a})`
          : `rgba(16,185,129,${a})`;
    return baseColor;
  };

  const cellValue = (di: number, hi: number) => {
    if (mode === 'rate') {
      const num = numerator?.values?.[di]?.[hi] ?? 0;
      const den = denominator?.values?.[di]?.[hi] ?? 0;
      return { num, den, rate: den > 0 ? num / den : 0 };
    }
    const v = data?.values?.[di]?.[hi] ?? 0;
    return { v } as any;
  };

  const hourLabel = (h: number) => {
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  };

  const pct = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(2) : '0.00');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold text-[#2D3748]">{title}</div>
          <div className="text-xs text-[#718096]">
            {mode === 'rate' ? 'Appointment rate (% of knocks)' : `Peak cell: ${max}`}
            {subtitle ? ` • ${subtitle}` : ''}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div
            className="grid"
            style={{ gridTemplateColumns: `80px repeat(${base.hours.length}, 1fr)${showTotals ? ' 120px' : ''}` }}
          >
            <div className="text-xs text-[#718096] font-semibold px-2 py-2">Day</div>
            {base.hours.map((h) => (
              <div key={h} className="text-[11px] text-[#718096] font-semibold text-center px-1 py-2">
                {hourLabel(h)}
              </div>
            ))}
            {showTotals ? <div className="text-xs text-[#718096] font-semibold text-center px-1 py-2">Total</div> : null}

            {base.days.map((day, di) => (
              <div key={day} className="contents">
                <div className="text-xs text-[#2D3748] font-semibold px-2 py-2 border-t border-[#EDF2F7]">{day}</div>
                {base.hours.map((h, hi) => {
                  const cv = cellValue(di, hi);
                  const bg = mode === 'rate' ? color(cv.rate) : color(cv.v);
                  const label =
                    mode === 'rate'
                      ? (cv.den > 0 ? `${Math.round(cv.rate * 100)}%` : '')
                      : (cv.v || '');
                  const tip =
                    mode === 'rate'
                      ? `${day} ${hourLabel(h)} — ${cv.num}/${cv.den} = ${Math.round(cv.rate * 100)}%`
                      : `${day} ${hourLabel(h)} — ${cv.v}`;

                  return (
                    <div
                      key={`${day}-${h}`}
                      className="border-t border-l border-[#EDF2F7] h-9 flex items-center justify-center text-xs text-[#2D3748]"
                      style={{ background: bg }}
                      title={tip}
                    >
                      <span className="tabular-nums">{label}</span>
                    </div>
                  );
                })}

                {showTotals ? (
                  <div className="border-t border-l border-[#EDF2F7] h-9 flex items-center justify-center text-xs text-[#2D3748] bg-[#F7FAFC]">
                    <span className="tabular-nums">
                      {mode === 'rate'
                        ? `${totals.dayTotals[di].num}/${totals.dayTotals[di].den} (${pct(totals.dayTotals[di].num, totals.dayTotals[di].den)}%)`
                        : totals.dayTotals[di].v}
                    </span>
                  </div>
                ) : null}
              </div>
            ))}

            {showTotals ? (
              <>
                <div className="text-xs text-[#2D3748] font-semibold px-2 py-2 border-t border-[#EDF2F7]">Total</div>
                {base.hours.map((h, hi) => (
                  <div
                    key={`total-${h}`}
                    className="border-t border-l border-[#EDF2F7] h-9 flex items-center justify-center text-xs text-[#2D3748] bg-[#F7FAFC]"
                    title={`Total ${hourLabel(h)}`}
                  >
                    <span className="tabular-nums">
                      {mode === 'rate'
                        ? `${totals.colTotals[hi].num}/${totals.colTotals[hi].den} (${pct(totals.colTotals[hi].num, totals.colTotals[hi].den)}%)`
                        : totals.colTotals[hi].v}
                    </span>
                  </div>
                ))}
                <div className="border-t border-l border-[#EDF2F7] h-9 flex items-center justify-center text-xs text-[#2D3748] bg-[#EDF2F7] font-semibold">
                  <span className="tabular-nums">
                    {mode === 'rate'
                      ? `${totals.grand.num}/${totals.grand.den} (${pct(totals.grand.num, totals.grand.den)}%)`
                      : totals.grand.v}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
