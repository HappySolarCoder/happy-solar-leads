import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

const SETTINGS_DOC_ID = 'global';
const WEBHOOK_TIMEOUT_MS = 8000;

type NotificationType = 'discord' | 'googlechat' | 'slack' | 'webhook';

function buildWebhookPayload(notificationType: NotificationType | undefined, leadInfo: string) {
  // Same shape as LeadEditorModal / Admin Settings test send
  if (notificationType === 'googlechat' || notificationType === 'slack') {
    return { text: leadInfo };
  }
  if (notificationType === 'webhook') {
    return { message: leadInfo };
  }
  return { content: leadInfo };
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    await adminAuth().verifyIdToken(idToken);

    const body = await request.json().catch(() => null);
    const leadInfo = typeof body?.leadInfo === 'string' ? body.leadInfo.trim() : '';
    if (!leadInfo) {
      return NextResponse.json({ error: 'Missing leadInfo' }, { status: 400 });
    }

    const settingsSnap = await adminDb().collection('adminSettings').doc(SETTINGS_DOC_ID).get();
    const settings = settingsSnap.exists ? (settingsSnap.data() as {
      notificationWebhook?: string;
      notificationType?: NotificationType;
    }) : null;

    const webhookUrl = typeof settings?.notificationWebhook === 'string'
      ? settings.notificationWebhook.trim()
      : '';
    if (!webhookUrl) {
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(webhookUrl)) {
      return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 400 });
    }

    const payload = buildWebhookPayload(settings?.notificationType, leadInfo);

    let webhookRes: Response;
    try {
      webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      console.error('[Scheduling Manager Notify] webhook error:', timedOut ? 'timeout' : err?.message);
      return NextResponse.json(
        { error: timedOut ? 'Notification timed out' : (err?.message || 'Webhook request failed') },
        { status: timedOut ? 504 : 502 }
      );
    }

    if (!webhookRes.ok) {
      console.error('[Scheduling Manager Notify] webhook status:', webhookRes.status, webhookRes.statusText);
      return NextResponse.json(
        { error: `Webhook failed: ${webhookRes.status} ${webhookRes.statusText}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Scheduling Manager Notify] POST error:', error);
    const message = error?.message || 'Internal error';
    const unauthorized = /id.?token|auth|credential|unauthorized/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: unauthorized ? 401 : 500 }
    );
  }
}
