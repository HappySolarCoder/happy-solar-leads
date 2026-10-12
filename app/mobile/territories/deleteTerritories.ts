import type { ManagedTerritory } from '@/app/utils/territoryManager';
/** Per-boundary, version-checked deletes. A failure does not hide the outcome of
 * successful removals or prevent deleting other unchanged areas for this user. */
export async function deleteUserTerritories(userId: string, territories: ManagedTerritory[], request: (body: Record<string, unknown>) => Promise<unknown>, operationIds: Map<string, string>, onRemoved: (id: string, count: number) => void) {
    if (!userId)
        throw Error('Choose a user first.');
    const targets = territories.filter(t => t.userId === userId), failed: string[] = [];
    let removed = 0;
    for (const area of targets) {
        const key = JSON.stringify([area.id, area.version]);
        let requestId = operationIds.get(key);
        if (!requestId) {
            requestId = crypto.randomUUID();
            operationIds.set(key, requestId);
        }
        try {
            await request({ action: 'archive', id: area.id, version: area.version, requestId });
            operationIds.delete(key);
            onRemoved(area.id, ++removed);
        }
        catch (e) {
            failed.push(`${area.name}: ${e instanceof Error ? e.message : 'Please retry.'}`);
        }
    }
    if (failed.length)
        throw Error(`${removed} deleted; ${failed.length} could not be deleted. ${failed.join(' ')}`);
    return removed;
}
