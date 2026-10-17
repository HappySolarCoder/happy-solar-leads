import type { TerritoryReview } from '@/app/utils/territoryManager';
type Request = <T>(body?: Record<string, unknown>) => Promise<T>;
export type AssignmentResult = {
    id: string;
    operationId: string;
    changed: number;
    skipped?: number;
    scanned: number;
    done: boolean;
};
export async function reviewAllPins(request: Request, body: Record<string, unknown>, onProgress: (scanned: number, eligible: number) => void) {
    const result: TerritoryReview = { candidates: [], eligible: 0, skipped: 0, truncated: false };
    let cursor: TerritoryReview['nextCursor'] = null, scanned = 0;
    const seen = new Set<string>();
    do {
        const page: TerritoryReview = await request<TerritoryReview>({ ...body, action: 'preview-v2', cursor });
        scanned += page.scanned || 0;
        for (const c of page.candidates)
            if (!seen.has(c.id)) {
                seen.add(c.id);
                result.candidates.push(c);
                if (c.eligible)
                    result.eligible++;
                else
                    result.skipped++;
            }
        onProgress(scanned, result.eligible);
        if (page.nextCursor && JSON.stringify(page.nextCursor) === JSON.stringify(cursor))
            throw Error('The territory review stopped advancing. Please retry.');
        cursor = page.nextCursor;
    } while (cursor);
    return result;
}
export async function continueAssignment(request: Request, initial: AssignmentResult, onProgress: (result: AssignmentResult) => void) {
    let result = initial;
    while (!result.done) {
        const scanned = result.scanned;
        onProgress(result);
        result = await request<AssignmentResult>({ action: 'continue-assignment', id: result.id, operationId: result.operationId });
        // A page that does not advance would repeat the same bounded read forever.
        if (!result.done && result.scanned === scanned)
            throw Error('The territory assignment stopped advancing. Please retry.');
    }
    onProgress(result);
    return result;
}
