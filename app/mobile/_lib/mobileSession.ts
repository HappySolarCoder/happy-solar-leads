import type { User } from "@/app/types";
import { startupEvent } from './startupDiagnostics';

export type MobileSession = {
  user: User | null;
  loading: boolean;
  error: string;
};

// A late profile response must never restore the previous signed-in account.
export function observeMobileSession(
  subscribe: (
    onUser: (id: string | null) => void,
    onError: () => void
  ) => () => void,
  loadProfile: (id: string) => Promise<User | null>,
  publish: (session: MobileSession) => void,
  timeoutMs = 12_000
) {
  let generation = 0;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const fail = (message = "Your account could not be loaded. Check your connection and try again.") => {
    clearTimer();
    generation++;
    if (active)
      publish({
        user: null,
        loading: false,
        error: message,
      });
  };
  const armTimeout = (stage: 'session' | 'profile') => {
    clearTimer();
    timer = setTimeout(() => {
      startupEvent(`${stage}-timeout`);
      fail(stage === 'session'
        ? "Sign-in is taking too long to respond. Try again or reload the app."
        : "Your account profile is taking too long to load. Check your connection, then try again.");
    }, timeoutMs);
  };
  startupEvent('session-start');
  armTimeout('session');
  const unsubscribe = subscribe((id) => {
    if (!active) return;
    clearTimer();
    const request = ++generation;
    startupEvent(id ? 'session-signed-in' : 'session-signed-out');
    publish({ user: null, loading: !!id, error: "" });
    if (!id) return;
    const startedAt = Date.now();
    startupEvent('profile-start');
    armTimeout('profile');
    void loadProfile(id)
      .then((user) => {
        if (active && request === generation) {
          clearTimer();
          startupEvent(user ? 'profile-ready' : 'profile-missing', startedAt);
          if (!user) {
            fail("Your sign-in worked, but your Raydar user profile was not found. Contact your manager.");
            return;
          }
          publish({ user, loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (active && request === generation) {
          startupEvent('profile-error', startedAt, error);
          fail();
        }
      });
  }, () => { startupEvent('session-error'); fail(); });
  return () => {
    active = false;
    clearTimer();
    generation++;
    unsubscribe();
  };
}
