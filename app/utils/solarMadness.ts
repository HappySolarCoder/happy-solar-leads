import type { SolarMadnessAwardResponse } from '@/app/types/solarMadness';

export async function awardSolarMadnessAsync(params: {
  idToken: string;
  leadId: string;
  dispositionId?: string;
  dispositionName?: string;
}): Promise<SolarMadnessAwardResponse> {
  const res = await fetch('/api/solar-madness/award', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.idToken}`,
    },
    body: JSON.stringify({
      leadId: params.leadId,
      dispositionId: params.dispositionId,
      dispositionName: params.dispositionName,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Solar Madness award failed');
  }

  return res.json();
}
