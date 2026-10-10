import type { User } from "@/app/types";

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
  publish: (session: MobileSession) => void
) {
  let generation = 0;
  let active = true;
  const fail = () => {
    generation++;
    if (active)
      publish({
        user: null,
        loading: false,
        error:
          "Your account could not be loaded. Check your connection and try again.",
      });
  };
  const unsubscribe = subscribe((id) => {
    if (!active) return;
    const request = ++generation;
    publish({ user: null, loading: !!id, error: "" });
    if (!id) return;
    void loadProfile(id)
      .then((user) => {
        if (active && request === generation)
          publish({ user, loading: false, error: "" });
      })
      .catch(() => {
        if (active && request === generation) fail();
      });
  }, fail);
  return () => {
    active = false;
    generation++;
    unsubscribe();
  };
}
