import { NextResponse } from 'next/server';
import { getEasterEggsAsync } from '@/app/utils/easterEggs';

export async function GET() {
  try {
    const eggs = await getEasterEggsAsync();
    
    return NextResponse.json({
      total: eggs.length,
      active: eggs.filter(e => e.active).length,
      inactive: eggs.filter(e => !e.active).length,
      eggs: eggs.map(e => ({
        id: e.id,
        prizeName: e.prizeName,
        type: e.type,
        active: e.active,
        leadId: e.leadId,
        zipCode: e.zipCode,
        territoryFilter: e.territoryFilter,
        winners: e.wonBy?.length || 0
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
