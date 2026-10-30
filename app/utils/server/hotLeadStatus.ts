import {
  collectHistoricalStatusIds,
  isAppointmentSetOrSoldLead,
} from '@/app/utils/historicalTerritoryPins';

/**
 * Cap for the dispositions read that feeds collectHistoricalStatusIds.
 * The historical-pins route reads the whole collection; hot-lead knocks
 * stay bounded so a knock cannot scan an unbounded config collection.
 */
export const HOT_LEAD_DISPOSITION_READ_LIMIT = 100;

/**
 * Current knock only. Appointment Set / Sold (including a custom id whose
 * disposition name matches, and the legacy sold id) become converted.
 * Any other current status is worked, even if this lead was converted before.
 * Only status and disposition are inputs.
 */
export function hotStatusAfterKnock(
  outcome: { status?: string | null; disposition?: string | null },
  dispositions: Array<{ id?: string | null; name?: string | null }>,
): 'worked' | 'converted' {
  const extraStatusIds = new Set(collectHistoricalStatusIds(dispositions));
  return isAppointmentSetOrSoldLead(
    { status: outcome.status, disposition: outcome.disposition },
    extraStatusIds,
  )
    ? 'converted'
    : 'worked';
}
