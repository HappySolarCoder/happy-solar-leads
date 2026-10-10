"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/app/utils/firebase";
import { useLiveLeads } from "@/app/hooks/useLiveLeads";
import {
  getDispositionsAsync,
  isScheduledGoBackLead,
} from "@/app/utils/dispositions";
import { canSeeAllLeads, type Lead, type User } from "@/app/types";
import {
  DEFAULT_DISPOSITIONS,
  type Disposition,
} from "@/app/types/disposition";
import { MobileLoading, MobileNotice } from "./MobileShell";
import {
  observeMobileSession,
  type MobileSession,
} from "../_lib/mobileSession";

import { useFieldData } from '@/app/field/useFieldData';
import { readArea } from '@/app/field/deviceStore';

const EMPTY_LEADS: Lead[] = [];
const MobileDataContext = createContext<ReturnType<
  typeof useSharedMobileData
> | null>(null);

function useSharedMobileData() {
  const router = useRouter();
  const [session, setSession] = useState<MobileSession>({
    user: null,
    loading: true,
    error: "",
  });
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<{
    scope: string;
    dispositions: Disposition[];
  } | null>(null);
  useEffect(() => {
    return observeMobileSession(
      (onUser, onError) => {
        if (!auth || !db) {
          queueMicrotask(onError);
          return () => {};
        }
        return onAuthStateChanged(
          auth,
          (user) => onUser(user?.uid || null),
          onError
        );
      },
      async (id) => {
        if (!navigator.onLine) { const area = await readArea(id); if (area) return area.user; }
        const snapshot = await getDoc(doc(db!, "users", id));
        if (!snapshot.exists()) return null;
        const data = snapshot.data();
        return {
          ...data,
          id,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          lastLogin: data.lastLogin?.toDate?.(),
        } as User;
      },
      setSession
    );
  }, [attempt]);
  useEffect(() => {
    if (session.loading || session.error) return;
    if (!session.user) router.replace("/login");
    else if (session.user.approvalStatus === "pending")
      router.replace("/pending-approval");
  }, [session, router]);
  const user = session.user?.approvalStatus === "pending" ? null : session.user;
  const scope = user ? `${user.id}:${user.role}` : "";
  useEffect(() => {
    if (!scope) return;
    let active = true;
    void getDispositionsAsync()
      .then((dispositions) => {
        if (active) setSettings({ scope, dispositions });
      })
      .catch(() => {
        if (active) setSettings({ scope, dispositions: DEFAULT_DISPOSITIONS });
      });
    return () => {
      active = false;
    };
  }, [scope]);
  const live = useLiveLeads(user);
  const field = useFieldData(user, live?.leads || EMPTY_LEADS);
  const leads = field.leads;
  const preparedOffline = field.offline && !!field.area;
  const followUps = useMemo(
    () =>
      user
        ? leads.filter(
            (lead) =>
              isScheduledGoBackLead(lead) &&
              (canSeeAllLeads(user.role) ||
                lead.claimedBy === user.id ||
                lead.goBackScheduledBy === user.id)
          )
        : EMPTY_LEADS,
    [user, leads]
  );
  const refresh = useCallback(async () => {}, []);
  const retry = useCallback(() => {
    setSession({ user: null, loading: true, error: "" });
    setAttempt((value) => value + 1);
  }, []);
  return {
    user,
    leads,
    followUps,
    field,
    live,
    refresh,
    retry,
    dispositions:
      settings?.scope === scope ? settings.dispositions : DEFAULT_DISPOSITIONS,
    loading: session.loading,
    leadsLoading: !!user && !live && !preparedOffline,
    dataLoading: !!user && !preparedOffline && (!live || settings?.scope !== scope),
    dataUnavailable: !preparedOffline && !!live?.error,
    error:
      session.error ||
      live?.error ||
      (live?.cached
        ? "Showing cached leads. Checking for the latest appointment outcomes."
        : ""),
  };
}

function MobileDataProvider({ children }: { children: ReactNode }) {
  const data = useSharedMobileData();
  if (!data.user)
    return data.error ? (
      <div className="rm-loading">
        <MobileNotice>{data.error}</MobileNotice>
        <button className="rm-primary" onClick={data.retry}>
          Try again
        </button>
      </div>
    ) : (
      <MobileLoading />
    );
  return (
    <MobileDataContext.Provider value={data}>
      <Fragment
        key={data.user ? `${data.user.id}:${data.user.role}` : "signed-out"}
      >
        {children}
      </Fragment>
    </MobileDataContext.Provider>
  );
}

export function MobileDataBoundary({ children }: { children: ReactNode }) {
  const path = usePathname().replace(/\/$/, "");
  // Design galleries and the separate territory editor never subscribe to all leads.
  return [
    "/mobile",
    "/mobile/knocking",
    "/mobile/follow-ups",
    "/mobile/stats",
    "/mobile/more",
    "/mobile/field-tools",
    "/mobile/field-tools/settings",
  ].includes(path) ? (
    <MobileDataProvider>{children}</MobileDataProvider>
  ) : (
    children
  );
}

export function useOptionalMobileData() { return useContext(MobileDataContext); }

export function useMobileData() {
  const data = useContext(MobileDataContext);
  if (!data)
    throw new Error("Mobile data must be used inside MobileDataBoundary");
  return data;
}
