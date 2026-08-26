import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Weather removed' }, { status: 410 });
}
