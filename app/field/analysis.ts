import type { FieldConfig, FieldFlags } from "./types";

/**
 * Capture pause and phone-timezone checks for POST /api/field-work.
 * The functions match the field branch. Scoring helpers are not part of this route.
 */
export function pilotFlags(
  config: FieldConfig,
  userId: string,
): { flags: FieldFlags; group: "pilot" | "control" } {
  let hash = 2166136261;
  for (const c of `${config.experiment}:${userId}`)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const inScope =
    !config.allowedUsers.length || config.allowedUsers.includes(userId);
  const pilot = inScope && (hash >>> 0) % 100 < config.pilotPercent;
  return {
    flags: Object.fromEntries(
      Object.entries(config.enabled).map(([k, v]) => [
        k,
        !!v && (k === "capture" ? inScope : pilot),
      ]),
    ) as FieldFlags,
    group: pilot ? "pilot" : "control",
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function localParts(at: Date, timeZone: string) {
  try {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
        weekday: "short",
      });
      if (formatters.size >= 8) formatters.clear();
      formatters.set(timeZone, formatter);
    }
    const p = formatter.formatToParts(at);
    return {
      hour: Number(p.find((x) => x.type === "hour")?.value),
      day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        p.find((x) => x.type === "weekday")?.value || "",
      ),
    };
  } catch {
    return { hour: NaN, day: -1 };
  }
}
