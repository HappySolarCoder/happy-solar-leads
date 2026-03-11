import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Server-side AI coach: returns structured JSON.
// Uses Gemini API key (existing in repo as NEXT_PUBLIC_GEMINI_API_KEY).

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
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

    const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Missing NEXT_PUBLIC_GEMINI_API_KEY' }, { status: 500 });
    }

    const prompt = `You are an expert door-to-door solar canvassing manager and coach.

You will be given JSON metrics for either the TEAM or a single SETTER.
Your job: produce a concise, actionable coaching report.

RULES:
- Output MUST be valid JSON ONLY (no markdown).
- Do not include any PII. Notes were already sanitized.
- Be specific: include exact recommended time windows and 3 concrete changes.

Return this JSON shape:
{
  "summary": ["...", "...", "..."],
  "timingDiagnosis": {
    "primeSharePct": number,
    "recommendation": "string",
    "bestNextWeekSchedule": ["Mon 4:00-7:00pm", "Tue 4:00-7:00pm"],
    "whatToDoOutsidePrime": ["..."]
  },
  "dispositionInsights": {
    "topNotInterestedReasons": [{"id":"too-expensive","label":"Too Expensive","count":12}],
    "callouts": ["..."]
  },
  "scripts": {
    "notInterestedRebuttals": ["...", "..."],
    "next10DoorsScript": {
      "opener": "...",
      "qualifier": "...",
      "valueHook": "...",
      "appointmentAsk": "..."
    }
  },
  "practicePlan": {
    "drills": ["..."],
    "goals": ["..."]
  }
}

Here are the metrics JSON:
${JSON.stringify(metrics)}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        }),
      }
    );

    const data: any = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const parsed = safeJsonParse(text);
    if (!parsed) {
      return NextResponse.json({
        ok: true,
        parsed: false,
        raw: text,
      });
    }

    return NextResponse.json({ ok: true, parsed: true, coach: parsed });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
