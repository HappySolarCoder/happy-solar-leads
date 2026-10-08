import type { Lead } from "@/app/types";

export type AppointmentOutcome = {
  label: string;
  color: string;
  background: string;
  symbol: string;
  key: string;
};
const OUTCOMES: Record<string, AppointmentOutcome> = {
  sold: {
    key: "sold",
    label: "Sold",
    color: "#257250",
    background: "#e7f2e9",
    symbol: "✓",
  },
  show: {
    key: "show",
    label: "Show",
    color: "#34738d",
    background: "#e7f2f5",
    symbol: "S",
  },
  noshow: {
    key: "noshow",
    label: "No show",
    color: "#bd5146",
    background: "#fff0eb",
    symbol: "!",
  },
  rescheduled: {
    key: "rescheduled",
    label: "Rescheduled",
    color: "#956522",
    background: "#fff3d9",
    symbol: "↻",
  },
  cancelled: {
    key: "cancelled",
    label: "Cancelled",
    color: "#7b6584",
    background: "#f1eaf4",
    symbol: "×",
  },
  lost: {
    key: "lost",
    label: "Lost",
    color: "#72777c",
    background: "#edf0f2",
    symbol: "−",
  },
  scheduled: {
    key: "scheduled",
    label: "Scheduled",
    color: "#5d6aa3",
    background: "#eef0fa",
    symbol: "A",
  },
};
const ALIASES: Record<string, string> = {
  won: "sold",
  closedwon: "sold",
  sale: "sold",
  sold: "sold",
  showed: "show",
  show: "show",
  noshow: "noshow",
  noshowed: "noshow",
  reschedule: "rescheduled",
  rescheduled: "rescheduled",
  canceled: "cancelled",
  cancelled: "cancelled",
  lost: "lost",
  closedlost: "lost",
  scheduled: "scheduled",
  confirmed: "scheduled",
  appointmentset: "scheduled",
};

// Only a recorded outcome is an outcome. A generic GHL pipeline status such as
// "open" must not be presented as an appointment result or change a disposition.
export function getAppointmentOutcome(
  lead: Pick<Lead, "appointmentOutcome" | "historicalTerritoryPin">,
): AppointmentOutcome | null {
  if (
    lead.historicalTerritoryPin ||
    typeof lead.appointmentOutcome !== "string"
  )
    return null;
  const raw = lead.appointmentOutcome.trim();
  if (!raw) return null;
  const key = ALIASES[raw.toLowerCase().replace(/[^a-z0-9]/g, "")];
  return (
    OUTCOMES[key] || {
      key: "other",
      label: raw.slice(0, 80),
      color: "#536a70",
      background: "#eaf0ef",
      symbol: "•",
    }
  );
}

export const appointmentOutcomeLegend = Object.values(OUTCOMES);
