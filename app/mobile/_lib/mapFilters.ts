import type { Lead } from '@/app/types';
import type { Disposition } from '@/app/types/disposition';
export type KnockPeriod = 'all' | 'week' | 'month' | 'year';
export const KNOCK_PERIODS: {
    id: KnockPeriod;
    label: string;
}[] = [
    { id: 'all', label: 'All time' }, { id: 'week', label: 'Last 7 days' },
    { id: 'month', label: 'Last 30 days' }, { id: 'year', label: 'This year' },
];
export function timestampMillis(value: unknown): number {
    if (!value)
        return NaN;
    if (typeof value === 'object') {
        const v = value as {
            toMillis?: () => number;
            seconds?: number;
            _seconds?: number;
        };
        if (typeof v.toMillis === 'function')
            return v.toMillis();
        const seconds = v.seconds ?? v._seconds;
        if (typeof seconds === 'number')
            return seconds * 1000;
    }
    return new Date(value as string | number | Date).getTime();
}
export function lastKnockedAt(lead: Lead): number {
    const times = [timestampMillis(lead.dispositionedAt), ...(lead.dispositionHistory || []).map(h => timestampMillis(h.timestamp))].filter(Number.isFinite);
    return times.length ? Math.max(...times) : NaN;
}
export function matchesMapFilters(lead: Lead, period: KnockPeriod, selected: string[], dispositions: Disposition[], now = new Date()): boolean {
    if (period !== 'all') {
        const cutoff = period === 'year' ? new Date(now.getFullYear(), 0, 1).getTime() : now.getTime() - (period === 'week' ? 7 : 30) * 86400000;
        const last = lastKnockedAt(lead);
        if (!Number.isFinite(last) || last < cutoff || last > now.getTime())
            return false;
    }
    if (!selected.length)
        return true;
    const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, '-');
    // Status is authoritative. Only old records without it use legacy names/history.
    const status = norm(lead.status || lead.disposition || lead.dispositionHistory?.[0]?.disposition);
    return selected.some(id => status === norm(id) || status === norm(dispositions.find(d => d.id === id)?.name));
}
