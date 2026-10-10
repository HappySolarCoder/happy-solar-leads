"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  LogOut,
  MapPinned,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import AppointmentSyncPanel from "../_components/AppointmentSyncPanel";
import { signOut } from "@/app/utils/auth";
import { canManageUsers, canAssignLeads } from "@/app/types";
import {
  MobileHeader,
  MobileLoading,
  MobileNav,
  MobileNotice,
} from "../_components/MobileShell";
import { useMobileData } from "../_components/useMobileData";

export default function MorePage() {
  const { user, loading } = useMobileData();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  if (loading) return <MobileLoading />;
  const links = [
    {
      href: "/mobile/field-tools",
      title: "Field tools",
      text: "Return sweeps, insights and scheduling handoffs",
      icon: Wrench,
    },
    {
      href: "/appointments",
      title: "Appointments & outcomes",
      text: "GHL results and scheduled appointments",
      icon: CalendarDays,
    },
    {
      href: "/setter-stats",
      title: "Team performance",
      text: "See how the team is doing",
      icon: ChartNoAxesCombined,
    },
    ...(user && canAssignLeads(user.role)
      ? [
          {
            href: "/mobile/territories",
            title: "Manage territories",
            text: "Draw areas, assign reps, and manage your team",
            icon: MapPinned,
          },
          {
            href: "/mobile/team-map",
            title: "Team map",
            text: "Recent team locations and activity",
            icon: Users,
          },
        ]
      : []),
    ...(user && canManageUsers(user.role)
      ? [
          {
            href: "/mobile/workspace",
            title: "Manage workspace",
            text: "Manage user accounts",
            icon: Settings,
          },
        ]
      : []),
  ];
  async function logout() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }
  return (
    <div className="rm-shell">
      <MobileHeader name={user?.name} />
      <main className="rm-content rm-enter">
        <Link className="rm-back" href="/mobile">
          <ArrowLeft size={17} />
          Today
        </Link>
        <div className="rm-page-heading">
          <span className="rm-eyebrow">YOUR WORKSPACE</span>
          <h1>{user?.name || "Account"}</h1>
          <p>Everything you need for a good day in the field.</p>
        </div>
        <div className="rm-agenda">
          {links.map(({ href, title, text, icon: Icon }) => (
            <Link href={href} className="rm-menu-row" key={href}>
              <span className="rm-metric-icon sage">
                <Icon size={21} />
              </span>
              <span>
                <strong>{title}</strong>
                <small>{text}</small>
              </span>
              <ArrowUpRight size={19} />
            </Link>
          ))}
        </div>
        {user && ["admin", "manager"].includes(user.role) && (
          <AppointmentSyncPanel />
        )}
        {error && <MobileNotice>{error}</MobileNotice>}
        <button className="rm-signout" onClick={logout} disabled={signingOut}>
          <LogOut size={18} />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        <p className="rm-version">Raydar Next · v12.2 · Field ready</p>
      </main>
      <MobileNav />
    </div>
  );
}
