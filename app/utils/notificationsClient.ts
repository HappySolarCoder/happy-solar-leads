import { auth } from './firebase';

export async function postDiscordNotification(body: Record<string, unknown>): Promise<Response> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Sign in again.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return fetch('/api/notifications/discord', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Show a server error only when it cannot carry a URL or other secret. */
export async function readNotificationError(response: Response): Promise<string> {
  let error = '';
  try {
    const data = await response.json();
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      error = (data as { error: string }).error;
    }
  } catch {
    error = '';
  }

  if (!error || error.length > 200 || /https?:|webhook/i.test(error)) {
    return `Failed to send notification (${response.status}).`;
  }
  return error;
}
