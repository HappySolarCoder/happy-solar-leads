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
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Missing GEMINI_API_KEY (or GOOGLE_API_KEY)' }, { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-1.0-pro';

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
        }),
      }
    );

    const data: any = await response.json();

    // When responseMimeType is honored, Google may return JSON in parts[0].text,
    // but it can also return it in other fields depending on API behavior.
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ||
      data?.text ||
      '';

    const parsed = extractJson(text);
    if (!parsed) {
      return NextResponse.json({ ok: true, parsed: false, raw: text, provider: data }, { status: 200 });
    }

    return NextResponse.json({ ok: true, parsed: true, coach: parsed });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
