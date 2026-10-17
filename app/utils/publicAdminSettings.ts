export type NotificationType = 'discord' | 'googlechat' | 'slack' | 'webhook';

/** Settings the browser is allowed to see. The Discord webhook is not one of them. */
export interface AdminSettings {
  schedulingManagerPhone: string;
  notificationType: NotificationType;
}

const NOTIFICATION_TYPES = new Set<NotificationType>(['discord', 'googlechat', 'slack', 'webhook']);

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && NOTIFICATION_TYPES.has(value as NotificationType);
}

/**
 * Copy only the fields the client may hold. Callers pass the raw Firestore
 * document; the webhook field is never copied onto the result.
 */
export function toPublicAdminSettings(raw: unknown): AdminSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    schedulingManagerPhone: typeof record.schedulingManagerPhone === 'string'
      ? record.schedulingManagerPhone
      : '',
    notificationType: isNotificationType(record.notificationType) ? record.notificationType : 'discord',
  };
}
