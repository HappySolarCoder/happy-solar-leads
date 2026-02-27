import { NextRequest, NextResponse } from 'next/server';

// In-memory debug log storage (resets on server restart)
const debugLogs: { timestamp: string; level: string; message: string; data?: any }[] = [];
const MAX_LOGS = 100;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, message, data } = body;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level || 'info',
      message: message || '',
      data: data || null,
    };
    
    debugLogs.push(logEntry);
    
    // Keep only last MAX_LOGS entries
    if (debugLogs.length > MAX_LOGS) {
      debugLogs.shift();
    }
    
    console.log(`[DEBUG-${level?.toUpperCase()}] ${message}`, data || '');
    
    return NextResponse.json({ success: true, logCount: debugLogs.length });
  } catch (error) {
    console.error('Debug log error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function GET() {
  // Return recent logs
  return NextResponse.json({
    logs: debugLogs.slice(-20), // Last 20 logs
    total: debugLogs.length,
  });
}
