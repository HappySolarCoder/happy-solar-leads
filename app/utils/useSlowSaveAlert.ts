'use client';

import { useEffect, useRef, useState } from 'react';
import { createSlowSaveAlert, type SlowSaveAlert } from '@/app/utils/slowSaveAlert';

/** Screen notice plus one dialog for a lead save that may take a while. */
export function useSlowSaveAlert() {
  const [notice, setNotice] = useState<string | null>(null);
  const alertRef = useRef<SlowSaveAlert | null>(null);

  useEffect(() => {
    const created = createSlowSaveAlert({
      alert: (message) => window.alert(message),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id),
      onNotice: setNotice,
    });
    alertRef.current = created;
    return () => {
      created.dispose();
      if (alertRef.current === created) alertRef.current = null;
    };
  }, []);

  return {
    notice,
    arm: () => alertRef.current?.arm() ?? false,
    fail: (message: string) => {
      alertRef.current?.fail(message);
    },
    finish: () => {
      alertRef.current?.finish();
    },
  };
}
