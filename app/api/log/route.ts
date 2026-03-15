import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * NOTE: Vercel serverless file system is read-only except for /tmp.
 * This route is intended for debugging only.
 */
function getLogPath() {
  // Vercel allows writes to /tmp only.
  if (process.env.VERCEL) return path.join('/tmp', 'upload-debug.log');
  return path.join(process.cwd(), 'logs', 'upload-debug.log');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, component, message, data } = body;

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [${component}] ${message} | ${JSON.stringify(data)}\n`;

    // Always log to stdout for Vercel logs
    console.log(logEntry.trim());

    const logPath = getLogPath();

    // Best-effort file append (works locally; on Vercel uses /tmp)
    try {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logPath, logEntry);
    } catch {
      // ignore file write failures
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const logPath = getLogPath();
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      return NextResponse.json({ logs: content });
    }
    return NextResponse.json({ logs: '' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
