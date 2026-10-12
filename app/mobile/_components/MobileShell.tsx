"use client";

import Link from "next/link";
import Image from "next/image";
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
  Map,
  Crosshair,
} from "lucide-react";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { MOBILE_BUILD_LABEL } from '../_lib/startupDiagnostics';

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
        <Image
          src="/brand/raydar-v5/raydar-primary-v5.svg"
          alt="Raydar"
          width={150}
          height={48}
          priority
        />
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
      <Image
        src="/brand/raydar-v5/raydar-mark-v5.svg"
        alt="Raydar Signal R"
        width={64}
        height={70}
        priority
      />
      <h1>Getting your day ready</h1>
      <LoaderCircle className="rm-spin" size={22} />
      <span>Loading your Raydar workspace</span>
      <small>{MOBILE_BUILD_LABEL}</small>
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
  showTeamAreas,
  onToggleTeamAreas,
  areaMode, onAreaMode, onZoomMine, areasLoading,
  onSearch,
  onFilter,
  filterCount,
  name = "Team",
  knocks,
}: {
  areaMode?: "off" | "mine" | "team";
  onAreaMode?: (mode: "off" | "mine" | "team") => void;
  onZoomMine?: () => void;
  areasLoading?: boolean;
  showTeamAreas: boolean;
  onToggleTeamAreas: () => void;
  onSearch: () => void;
  onFilter: () => void;
  filterCount: number;
  name?: string;
  knocks?: number;
  // Retained for existing preview callers; GPS lives on the map.
  accuracy?: number; gpsError?: boolean; gpsLoading?: boolean; onLocate?: () => void;
}) {
  const [areasOpen, setAreasOpen] = useState(false);
  const areaRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!areasOpen) return;
    const close = (e: PointerEvent) => { if (!areaRoot.current?.contains(e.target as Node)) setAreasOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAreasOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [areasOpen]);
  return (
    <div className="rm-field-toolbar" aria-label="Knocking controls">
      <Image className="rm-toolbar-brand" src="/brand/raydar-v5/raydar-mark-v5.svg" alt="Raydar" width={26} height={30} />
      <button className="rm-search-icon" aria-label="Search address" onClick={onSearch}>
        <Search size={19} />

      </button>
      <span
        className="rm-knock-counter"
        title={
          knocks === undefined
            ? "Loading today’s knocks"
            : `${knocks} doors knocked today`
        }
        aria-label={
          knocks === undefined
            ? "Loading today’s knocks"
            : `${knocks} doors knocked today`
        }
      >
        <DoorOpen size={19} />
        <b>{knocks ?? "—"}</b><span className="rm-doors-label">Doors</span>
      </span>
      <div className="rm-areas-control" ref={areaRoot}>
        <button className="rm-areas-toggle" onClick={()=>onAreaMode?setAreasOpen(v=>!v):onToggleTeamAreas()}
          aria-label="Areas" aria-expanded={areasOpen} aria-controls="field-area-options" aria-pressed={showTeamAreas}>
          <Map size={18}/><span>Areas</span>
        </button>
        {areasOpen && <div className="rm-areas-menu" id="field-area-options" role="group" aria-label="Territory visibility">
          {([['mine','My territories'],['team','Team territories'],['off','Off']] as const).map(([mode,label])=><button key={mode} aria-pressed={areaMode===mode} onClick={()=>{onAreaMode?.(mode);setAreasOpen(false);}}>{label}{areaMode===mode?' ✓':''}</button>)}
          <button onClick={()=>{onZoomMine?.();setAreasOpen(false);}}>Zoom to mine</button>
          {areasLoading && <small role="status">Loading areas…</small>}
        </div>}
      </div>
      <button
        className={`rm-filter ${filterCount ? "is-active" : ""}`}
        onClick={onFilter}
        aria-label={`Filters${filterCount ? `, ${filterCount} active` : ""}`}
      >
        <SlidersHorizontal size={19} />
        {filterCount > 0 && <span>{filterCount}</span>}
      </button>
      <Link className="rm-toolbar-account" href="/mobile/more" aria-label="Open account and tools">
        {name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase() || '?'}
      </Link>
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  onAction,
  href,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <div className="rm-section-heading">
      <h2>{title}</h2>
      {action &&
        (href ? (
          <Link href={href}>
            {action}
            <ArrowUpRight size={15} />
          </Link>
        ) : (
          <button onClick={onAction}>
            {action}
            <ArrowUpRight size={15} />
          </button>
        ))}
    </div>
  );
}
