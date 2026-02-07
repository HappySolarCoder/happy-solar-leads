import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, component, message, data } = body;

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [${component}] ${message} | ${JSON.stringify(data)}\n`;

    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logPath = path.join(logsDir, 'upload-debug.log');
    fs.appendFileSync(logPath, logEntry);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const logPath = path.join(process.cwd(), 'logs', 'upload-debug.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      return NextResponse.json({ logs: content });
    }
    return NextResponse.json({ logs: '' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
