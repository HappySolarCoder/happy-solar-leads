import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Server-side AI coach: returns structured JSON.
// Uses server-side Gemini API key via GEMINI_API_KEY (preferred). Falls back to NEXT_PUBLIC_GEMINI_API_KEY only if present.

function extractJson(text: string) {
  if (!text) return null;
  const trimmed = text.trim();

  // Strip ```json fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Try direct parse
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to locate first JSON object
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = candidate.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const metrics = body?.metrics;
    if (!metrics) {
      return NextResponse.json({ ok: false, error: 'Missing metrics' }, { status: 400 });
    }

    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    // Key is optional: if missing or AI call fails, we return a deterministic coaching JSON fallback.
    const hasKey = Boolean(key);

    const topReasons = Object.entries(metrics?.breakdown?.notInterestedReasons || {})
      .sort((a: any, b: any) => (b?.[1]?.count || 0) - (a?.[1]?.count || 0))
      .slice(0, 5)
      .map(([id, v]: any) => ({ id, label: v?.label || id, count: v?.count || 0 }));

    const primeShare = Number(metrics?.totals?.primeSharePct || 0);
    const repName = metrics?.rep?.repName || 'Rep';

    const fallbackCoach = {
      summary: [
        `${repName}: ${metrics?.totals?.attempts || 0} attempts, ${metrics?.totals?.successAppointments || 0} appointments (${metrics?.totals?.appointmentRatePct || 0}% rate).`,
        `Prime-time utilization (4–7pm): ${primeShare}%.`,
        topReasons.length
          ? `Top Not Interested reasons: ${topReasons.map((r) => `${r.label} (${r.count})`).join(', ')}.`
          : 'Not Interested reasons not available in this range.',
      ],
      timingDiagnosis: {
        primeSharePct: primeShare,
        recommendation:
          primeShare < 35
            ? 'Increase prime-time knocking (4–7pm) on weekdays; that is when homeowners are most available.'
            : 'Prime-time utilization is solid; keep it consistent and focus on tightening objection handling.',
        bestNextWeekSchedule: ['Mon 4:00-7:00pm', 'Tue 4:00-7:00pm', 'Wed 4:00-7:00pm', 'Thu 4:00-7:00pm'],
        whatToDoOutsidePrime: [
          'Prep turf + route planning',
          'Follow-ups and go-backs',
          '5-minute objection roleplay reps before heading out',
        ],
      },
      dispositionInsights: {
        topNotInterestedReasons: topReasons,
        callouts: [
          'If Not Home is high, shift activity toward 4–7pm blocks and weekends.',
          'If Not Interested is high, shorten the opener and lead with a permission-based micro-commitment.',
        ],
      },
      scripts: {
        notInterestedRebuttals: [
          'Totally fair — most people say that at first. Quick question: is it the cost, the hassle, or you already have a plan?',
          'No worries. If we could show you a 2-minute breakdown and you can decide after, would that be fair?',
        ],
        next10DoorsScript: {
          opener: "Hey! I’m working with homeowners nearby — quick question.",
          qualifier: 'Do you own the home and is your power bill usually over $150? ',
          valueHook: 'We’re helping people lock in a lower bill with solar — no pressure, just information.',
          appointmentAsk: 'If it makes sense, would today at 5:30 or tomorrow at 6:15 work for a quick 10-min assessment?',
        },
      },
      practicePlan: {
        drills: ['5-min “Not Interested” roleplay (cost / trust / hassle)', 'Objection-to-question drill: convert statements into questions'],
        goals: [
          primeShare < 35
            ? 'Move +20% of attempts into 4–7pm this week.'
            : 'Increase appointment rate by +0.5–1.0% via tighter objection handling.',
        ],
      },
    };

    if (!hasKey) {
      return NextResponse.json({ ok: true, parsed: true, coach: fallbackCoach, used: 'fallback', aiOk: false });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-pro';

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'Return ONLY valid JSON (no markdown). Use the provided metrics exactly.' },
                  { text: 'Metrics JSON:\n' + JSON.stringify(metrics) },
                ],
              },
            ],
            generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
          }),
        }
      );

      const data: any = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = extractJson(text);

      if (!parsed) {
        return NextResponse.json({ ok: true, parsed: true, coach: fallbackCoach, used: 'fallback', aiOk: false });
      }

      return NextResponse.json({ ok: true, parsed: true, coach: parsed, used: 'ai', aiOk: true });
    } catch {
      return NextResponse.json({ ok: true, parsed: true, coach: fallbackCoach, used: 'fallback', aiOk: false });
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
