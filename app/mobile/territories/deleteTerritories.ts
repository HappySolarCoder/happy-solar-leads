import type { ManagedTerritory } from '@/app/utils/territoryManager';

/** Use the deployed single-boundary action. Never touch leads or ownership. */
export async function deleteUserTerritories(
  userId: string,
  territories: ManagedTerritory[],
  request: (body: Record<string, unknown>) => Promise<unknown>,
  operationIds: Map<string, string>,
  onRemoved: (id: string, count: number) => void,
) {
  if (!userId) throw Error('Choose a user first.');
  const targets = territories.filter(area => area.userId === userId);
  let count = 0;
  for (const area of targets) {
    const key = JSON.stringify([area.id, area.version]);
    let requestId = operationIds.get(key);
    if (!requestId) { requestId = crypto.randomUUID(); operationIds.set(key, requestId); }
    // Keep the same requestId after uncertain acknowledgement, so retry is safe.
    await request({ action: 'archive', id: area.id, version: area.version, requestId });
    operationIds.delete(key);
    onRemoved(area.id, ++count);
  }
  return count;
}
