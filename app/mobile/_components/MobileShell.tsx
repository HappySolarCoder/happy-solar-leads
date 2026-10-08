"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Compass,
  DoorOpen,
  Home,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  List,
  Map,
  Crosshair,
} from "lucide-react";
import type { ReactNode } from "react";

export const mobileTabs = [
  { href: "/mobile", label: "Today", icon: Home },
  { href: "/mobile/knocking", label: "Knock", icon: Compass },
  { href: "/mobile/follow-ups", label: "Follow-ups", icon: CalendarDays },
  { href: "/mobile/stats", label: "Progress", icon: ChartNoAxesCombined },
];

export function MobileNav({
  active,
  onNavigate,
}: {
  active?: string;
  onNavigate?: (href: string) => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="rm-nav" aria-label="Main navigation">
      {mobileTabs.map(({ href, label, icon: Icon }) => {
        const selected = (active || pathname.replace(/\/$/, "")) === href;
        const content = (
          <>
            <span className="rm-nav-icon">
              <Icon size={22} strokeWidth={selected ? 2.4 : 1.8} />
            </span>
            <span>{label}</span>
          </>
        );
        return onNavigate ? (
          <button
            key={href}
            aria-current={selected ? "page" : undefined}
            onClick={() => onNavigate(href)}
          >
            {content}
          </button>
        ) : (
          <Link
            key={href}
            href={href}
            aria-current={selected ? "page" : undefined}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileHeader({
  name = "Team",
  title,
  onAccount,
}: {
  name?: string;
  title?: string;
  onAccount?: () => void;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
  return (
    <header className="rm-header">
      <div className="rm-brand">
        <span className="rm-brand-mark">
          <Compass size={23} />
        </span>
        <span>
          raydar<span className="rm-brand-dot">.</span>
        </span>
        <span className="rm-edition">NEXT</span>
      </div>
      {title && <span className="rm-header-title">{title}</span>}
      {onAccount ? (
        <button
          className="rm-avatar"
          onClick={onAccount}
          aria-label="Open account and tools"
        >
          {initials}
        </button>
      ) : (
        <Link
          className="rm-avatar"
          href="/mobile/more"
          aria-label="Open account and tools"
        >
          {initials}
        </Link>
      )}
    </header>
  );
}

export function MobileLoading() {
  return (
    <div className="rm-loading" role="status">
      <span className="rm-brand-mark">
        <Compass size={30} />
      </span>
      <h1>Getting your day ready</h1>
      <LoaderCircle className="rm-spin" size={22} />
      <span>Loading your Raydar workspace</span>
    </div>
  );
}

export function MobileNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rm-notice" role="status">
      {children}
    </div>
  );
}

export function FieldToolbar({
  mode,
  onMode,
  onSearch,
  onFilter,
  filterCount,
  accuracy,
  gpsError,
  gpsLoading,
  knocks,
  onLocate,
}: {
  mode: "map" | "list";
  onMode: (mode: "map" | "list") => void;
  onSearch: () => void;
  onFilter: () => void;
  filterCount: number;
  accuracy?: number;
  gpsError: boolean;
  gpsLoading: boolean;
  knocks: number;
  onLocate: () => void;
}) {
  return (
    <div className="rm-field-toolbar" aria-label="Knocking controls">
      <button className="rm-search" onClick={onSearch}>
        <Search size={19} />
        <span>Search</span>
      </button>
      <span
        className="rm-knock-counter"
        title={`${knocks} doors knocked today`}
        aria-label={`${knocks} doors knocked today`}
      >
        <DoorOpen size={16} />
        <b>{knocks}</b>
      </span>
      <button
        className="rm-mode-toggle"
        onClick={() => onMode(mode === "map" ? "list" : "map")}
      >
        {mode === "map" ? <List size={18} /> : <Map size={18} />}
        <span>{mode === "map" ? "List" : "Map"}</span>
      </button>
      <button
        className={`rm-filter ${filterCount ? "is-active" : ""}`}
        onClick={onFilter}
        aria-label={`Filters${filterCount ? `, ${filterCount} active` : ""}`}
      >
        <SlidersHorizontal size={19} />
        {filterCount > 0 && <span>{filterCount}</span>}
      </button>
      <button
        className={`rm-gps ${gpsError || (accuracy !== undefined && accuracy > 50) ? "is-warning" : ""}`}
        onClick={onLocate}
        disabled={gpsError || accuracy === undefined}
        aria-label={
          gpsError
            ? "Location unavailable"
            : gpsLoading || accuracy === undefined
              ? "Finding GPS"
              : `Center map on my location, GPS accuracy ${Math.round(accuracy)} meters`
        }
        title={
          gpsError
            ? "Location unavailable"
            : accuracy === undefined
              ? "Finding GPS…"
              : `GPS ±${Math.round(accuracy)} m`
        }
      >
        <Crosshair size={20} />
      </button>
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rm-section-heading">
      <h2>{title}</h2>
      {action && (
        <button onClick={onAction}>
          {action}
          <ArrowUpRight size={15} />
        </button>
      )}
    </div>
  );
}
