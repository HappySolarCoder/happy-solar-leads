/**
 * One dialog per save. The 15s "still saving" timer is cleared on dispose
 * (unmount). A second arm while a timer is running does nothing, so a
 * double-click cannot stack timers. A failure cancels a pending still-saving
 * dialog and is the only alert; if that dialog was already shown, the failure
 * text replaces it and a second alert is not opened.
 */
export const SLOW_SAVE_MS = 15000;
export const SLOW_SAVE_MESSAGE = 'Still saving, check your connection';

export type SlowSaveAlert = {
  /** Start the 15s timer. False when a save or timer is already running. */
  arm: () => boolean;
  /** Show the failure. Replaces a pending or already-shown still-saving alert. */
  fail: (message: string) => void;
  /** Save finished. Cancels a pending still-saving timer. */
  finish: () => void;
  /** Unmount. Cancels a pending timer so it cannot alert later. */
  dispose: () => void;
  /** Text the screen should show. Failure replaces a still-saving notice. */
  notice: () => string | null;
};

export function createSlowSaveAlert<T>(deps: {
  alert: (message: string) => void;
  setTimer: (fn: () => void, ms: number) => T;
  clearTimer: (id: T) => void;
  onNotice?: (message: string | null) => void;
}): SlowSaveAlert {
  let timer: T | null = null;
  let deferred: T | null = null;
  let inFlight = false;
  let alerted = false;
  let pending: string | null = null;
  let notice: string | null = null;
  let disposed = false;

  const publish = (message: string | null) => {
    notice = message;
    deps.onNotice?.(message);
  };

  const clear = () => {
    if (timer != null) {
      deps.clearTimer(timer);
      timer = null;
    }
    if (deferred != null) {
      deps.clearTimer(deferred);
      deferred = null;
    }
  };

  const showPending = () => {
    if (disposed || alerted || pending == null) return;
    const message = pending;
    pending = null;
    alerted = true;
    publish(message);
    deps.alert(message);
  };

  return {
    arm() {
      if (disposed || inFlight || timer != null) return false;
      inFlight = true;
      alerted = false;
      pending = null;
      publish(null);
      timer = deps.setTimer(() => {
        timer = null;
        if (!inFlight || alerted || disposed) return;
        pending = SLOW_SAVE_MESSAGE;
        // A failure queued in this turn overwrites `pending` before the dialog.
        deferred = deps.setTimer(() => {
          deferred = null;
          showPending();
        }, 0);
      }, SLOW_SAVE_MS);
      return true;
    },
    fail(message: string) {
      clear();
      // Overwrites a still-saving message that has not opened yet.
      pending = message;
      if (alerted) {
        // The still-saving dialog already opened. Replace its text.
        // Do not open a second dialog.
        publish(message);
        pending = null;
        return;
      }
      showPending();
    },
    finish() {
      clear();
      inFlight = false;
      if (pending === SLOW_SAVE_MESSAGE) pending = null;
      if (notice === SLOW_SAVE_MESSAGE) publish(null);
    },
    dispose() {
      disposed = true;
      clear();
      inFlight = false;
      pending = null;
    },
    notice() {
      return notice;
    },
  };
}
