import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  handleDiscordNotification,
  postDiscordWebhook,
  resolveDiscordWebhookUrl,
} from '@/app/utils/server/discordNotification';

const SETTINGS_DOC_ID = 'global';

export async function POST(request: NextRequest) {
  try {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const result = await handleDiscordNotification({
      authorization: request.headers.get('authorization'),
      body,
      deps: {
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        getUser: async (uid) => {
          const doc = await adminDb().collection('users').doc(uid).get();
          return { exists: doc.exists, data: doc.data() };
        },
        resolveWebhookUrl: () => resolveDiscordWebhookUrl({
          envValue: process.env.DISCORD_NOTIFICATION_WEBHOOK_URL,
          readStoredWebhook: async () => {
            const snap = await adminDb().collection('adminSettings').doc(SETTINGS_DOC_ID).get();
            return snap.exists ? snap.get('notificationWebhook') : null;
          },
        }),
        postDiscord: postDiscordWebhook,
      },
    });

    return NextResponse.json(result.body, {
      status: result.status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...result.headers,
      },
    });
  } catch {
    console.error('[notifications/discord] failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
