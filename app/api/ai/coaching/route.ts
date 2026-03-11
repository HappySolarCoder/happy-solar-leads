import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Server-side AI coach: returns structured JSON.
// Uses server-side Gemini API key via GEMINI_API_KEY (preferred). Falls back to NEXT_PUBLIC_GEMINI_API_KEY only if present.

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

    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Missing GEMINI_API_KEY (or GOOGLE_API_KEY)' }, { status: 500 });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'You are an expert door-to-door solar canvassing manager and coach. ' +
                    'Return ONLY valid JSON, no markdown, no commentary.',
                },
                {
                  text: `Return this JSON shape exactly:\n${JSON.stringify(
                    {
                      summary: ['...', '...', '...'],
                      timingDiagnosis: {
                        primeSharePct: 0,
                        recommendation: 'string',
                        bestNextWeekSchedule: ['Mon 4:00-7:00pm'],
                        whatToDoOutsidePrime: ['...'],
                      },
                      dispositionInsights: {
                        topNotInterestedReasons: [{ id: 'too-expensive', label: 'Too Expensive', count: 12 }],
                        callouts: ['...'],
                      },
                      scripts: {
                        notInterestedRebuttals: ['...', '...'],
                        next10DoorsScript: {
                          opener: '...',
                          qualifier: '...',
                          valueHook: '...',
                          appointmentAsk: '...',
                        },
                      },
                      practicePlan: { drills: ['...'], goals: ['...'] },
                    },
                    null,
                    2
                  )}`,
                },
                {
                  text:
                    'Metrics JSON (already sanitized, do not add PII):\n' +
                    JSON.stringify(metrics),
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
          // Enforce JSON output if the API supports it.
          responseMimeType: 'application/json',
        }),
      }
    );

    const data: any = await response.json();

    // When responseMimeType is honored, Google returns JSON in parts[0].text.
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = safeJsonParse(text);
    if (!parsed) {
      return NextResponse.json({ ok: true, parsed: false, raw: text, debug: { hasKey: true } });
    }

    return NextResponse.json({ ok: true, parsed: true, coach: parsed });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
