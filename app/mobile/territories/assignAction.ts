import type { TerritoryPoint } from '@/app/types/territory';
import {
  mayReceiveTerritory,
  validateTerritoryPolygon,
  type ManagedTerritory,
  type TerritoryMember,
} from '@/app/utils/territoryManager';
import { continueAssignment, type AssignmentResult } from './assignment';

/** One fresh summary, then either the background queue or the paged
 * begin/continue actions production still accepts. Neither path edits a
 * saved polygon, and a failed continue leaves that boundary in place. */
export class TerritoryAssignmentPaused extends Error {
  readonly boundarySaved = true;
  readonly progress: AssignmentResult;
  constructor(message: string, progress: AssignmentResult) {
    super(message);
    this.name = 'TerritoryAssignmentPaused';
    this.progress = progress;
  }
}

export type TerritoryCapabilitySummary = {
  capabilities?: { pagedAssignments?: boolean; backgroundAssignments?: boolean };
  members: TerritoryMember[];
  territories: ManagedTerritory[];
};

export type TerritoryCaller = <T = TerritoryCapabilitySummary>(
  body?: Record<string, unknown>,
) => Promise<T>;

export type TerritorySaveInput =
  | { kind: 'create'; name: string; userId: string; polygon: unknown; requestId: string }
  | { kind: 'transfer'; id: string; version: string; userId: string; requestId: string };

export type TerritorySaveResult = {
  id: string;
  changed: number;
  skipped: number;
  background: boolean;
  queueError: string;
  message: string;
};

type Hooks = {
  onSummary?: (summary: TerritoryCapabilitySummary) => void;
  onProgress?: (progress: AssignmentResult) => void;
};

type BackgroundResult = AssignmentResult & { queueError?: string };

const REQUEST_ID = /^[\da-f-]{36}$/i;

function statusOf(error: unknown) {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

export function backgroundAssignmentUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const status = statusOf(error);
  return (status === 400 && message === 'Unknown territory action.')
    || (status === 503 && /backend configuration/i.test(message));
}

function sameRequestConflict(error: unknown) {
  return statusOf(error) === 409
    && error instanceof Error
    && error.message === 'This request was already used for another assignment.';
}

function fail(message: string): never {
  throw new Error(message);
}

function boundarySentence(kind: 'create' | 'transfer') {
  return kind === 'create' ? 'Your drawing is unchanged.' : 'The boundary was not changed.';
}

function rethrow(error: unknown, kind: 'create' | 'transfer', sent: boolean): never {
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : 'Please try again.';
  const ambiguous = sent && status !== 400 && status !== 401 && status !== 403;
  if (ambiguous || /unchanged|not changed|already exists|refresh your list|refresh before/i.test(message)) {
    throw error instanceof Error ? error : new Error(message);
  }
  const next = new Error(`${message} ${boundarySentence(kind)}`);
  if (status) Object.assign(next, { status });
  throw next;
}

function pauseMessage(changed: number) {
  return `Your boundary is saved (${changed} pins assigned so far). Assignment paused. Tap Save territory or Retry assignment to continue. Nothing was discarded.`;
}

async function finishOnPhone(
  request: TerritoryCaller,
  initial: AssignmentResult,
  onProgress?: (progress: AssignmentResult) => void,
) {
  let latest = initial;
  try {
    return await continueAssignment(request, initial, (progress) => {
      latest = progress;
      onProgress?.(progress);
    });
  } catch (error) {
    const detail = error instanceof Error && error.message
      ? error.message
      : 'Assignment paused before it finished.';
    throw new TerritoryAssignmentPaused(
      `${pauseMessage(latest.changed)} ${detail}`,
      latest,
    );
  }
}

function pagedMessage(saved: AssignmentResult, retry: boolean) {
  const skipped = saved.skipped || 0;
  const counts = `${saved.changed} pins assigned. ${skipped} worked or changed pins stayed with their current rep.`;
  return retry
    ? `Assignment finished on this phone. ${counts} Your boundary is kept.`
    : `Territory saved. ${counts} Background assignment was not available, so this phone finished the save. Your boundary is kept.`;
}

function backgroundMessage(saved: BackgroundResult, id: string): TerritorySaveResult {
  const queueError = saved.queueError || '';
  return {
    id: saved.id || id,
    changed: saved.changed || 0,
    skipped: saved.skipped || 0,
    background: true,
    queueError,
    message: queueError
      || (saved.done
        ? 'Assignment is already complete. Your boundary is kept.'
        : 'Territory saved. Pins are assigning in the background—you can draw the next area.'),
  };
}

async function resumeSaved(
  request: TerritoryCaller,
  area: ManagedTerritory,
  background: boolean,
  hooks: Hooks,
  retry: boolean,
): Promise<TerritorySaveResult> {
  const assignment = area.assignment!;
  if (background) {
    try {
      const saved = await request<BackgroundResult>({
        action: 'retry-background-assignment',
        id: area.id,
      });
      const queueError = saved.queueError || '';
      return {
        id: saved.id || area.id,
        changed: saved.changed ?? assignment.changed,
        skipped: saved.skipped || 0,
        background: true,
        queueError,
        message: queueError
          || (saved.done
            ? 'Assignment is already complete. Your boundary is kept.'
            : 'Background assignment queued. You can leave this screen.'),
      };
    } catch (error) {
      if (!backgroundAssignmentUnavailable(error)) throw error;
    }
  }
  const finished = await finishOnPhone(request, {
    id: area.id,
    operationId: assignment.id,
    changed: assignment.changed,
    skipped: 0,
    scanned: assignment.scanned,
    done: false,
  }, hooks.onProgress);
  return {
    id: finished.id,
    changed: finished.changed,
    skipped: finished.skipped || 0,
    background: false,
    queueError: '',
    message: pagedMessage(finished, retry),
  };
}

function createBody(action: string, name: string, userId: string, polygon: TerritoryPoint[], requestId: string) {
  return { action, kind: 'create', requestId, name, userId, polygon };
}

function transferBody(action: string, id: string, version: string, userId: string, requestId: string) {
  return { action, kind: 'transfer', requestId, id, version, userId };
}

export async function saveTerritoryAssignment(
  request: TerritoryCaller,
  input: TerritorySaveInput,
  hooks: Hooks = {},
): Promise<TerritorySaveResult> {
  if (!REQUEST_ID.test(input.requestId)) fail('This save could not be started. Nothing was changed.');
  if (!input.userId) fail(`Choose a rep. ${boundarySentence(input.kind)}`);
  let name = '';
  let polygon: TerritoryPoint[] | undefined;
  if (input.kind === 'create') {
    try {
      polygon = validateTerritoryPolygon(input.polygon);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redraw the boundary and try again.';
      fail(`${message} Your drawing is unchanged.`);
    }
    name = input.name.trim();
    if (!name || name.length > 60) fail('Give your territory a short name. Your drawing is unchanged.');
  } else if (!input.id || !input.version) {
    fail('Choose a territory. The boundary was not changed.');
  }

  let summary: TerritoryCapabilitySummary;
  try {
    summary = await request();
  } catch (error) {
    rethrow(error, input.kind, false);
  }
  hooks.onSummary?.(summary);

  const territoryId = input.kind === 'create' ? input.requestId : input.id;
  const existing = summary.territories.find((area) => area.id === territoryId);
  const resuming = !!existing?.assignment && !existing.assignment.done && existing.assignment.id === input.requestId;
  if (!resuming && !(existing?.assignment?.done && existing.assignment.id === input.requestId)) {
    const recipient = summary.members.find((member) => member.id === input.userId);
    if (!recipient || !mayReceiveTerritory(recipient)) {
      fail(`Choose an active, approved rep on your team. ${boundarySentence(input.kind)}`);
    }
  }
  if (input.kind === 'create' && existing && !resuming && existing.assignment?.id !== input.requestId) {
    fail('This territory already exists. Refresh your list. Your drawing is unchanged.');
  }
  if (input.kind === 'transfer' && !resuming) {
    if (!existing) fail('This territory is no longer in your list. The boundary was not changed.');
    if (existing.version !== input.version) {
      fail('This territory changed while this screen was open. Close this dialog and try the transfer again. The boundary was not changed.');
    }
    if (existing.assignment && !existing.assignment.done) {
      fail('Finish the unfinished assignment with Retry assignment before transferring. The boundary was not changed.');
    }
  }
  if (existing?.assignment?.done && existing.assignment.id === input.requestId) {
    return {
      id: existing.id,
      changed: existing.assignment.changed,
      skipped: 0,
      background: false,
      queueError: '',
      message: 'This assignment is already complete. Your boundary is kept.',
    };
  }
  if (resuming && existing) return resumeSaved(request, existing, !!summary.capabilities?.backgroundAssignments, hooks, false);

  const background = !!summary.capabilities?.backgroundAssignments;
  const backgroundRequest = input.kind === 'create'
    ? createBody('save-background-assignment', name, input.userId, polygon!, input.requestId)
    : transferBody('save-background-assignment', input.id, input.version, input.userId, input.requestId);
  const pagedRequest = input.kind === 'create'
    ? createBody('begin-assignment', name, input.userId, polygon!, input.requestId)
    : transferBody('begin-assignment', input.id, input.version, input.userId, input.requestId);

  if (background) {
    try {
      return backgroundMessage(await request<BackgroundResult>(backgroundRequest), territoryId);
    } catch (error) {
      if (sameRequestConflict(error)) {
        return resumeSaved(request, {
          id: territoryId,
          assignment: {
            id: input.requestId,
            done: false,
            changed: existing?.assignment?.changed || 0,
            scanned: existing?.assignment?.scanned || 0,
            targetId: input.userId,
          },
        } as ManagedTerritory, true, hooks, false);
      }
      if (!backgroundAssignmentUnavailable(error)) rethrow(error, input.kind, true);
    }
  }

  let started: AssignmentResult;
  try {
    started = await request<AssignmentResult>(pagedRequest);
  } catch (error) {
    if (sameRequestConflict(error)) {
      started = {
        id: territoryId,
        operationId: input.requestId,
        changed: existing?.assignment?.changed || 0,
        scanned: existing?.assignment?.scanned || 0,
        done: false,
      };
    } else if (backgroundAssignmentUnavailable(error)) {
      fail(`Territory assignment is not available on the server right now. ${boundarySentence(input.kind)}`);
    } else {
      rethrow(error, input.kind, true);
    }
  }
  const finished = await finishOnPhone(request, started, hooks.onProgress);
  return {
    id: finished.id,
    changed: finished.changed,
    skipped: finished.skipped || 0,
    background: false,
    queueError: '',
    message: pagedMessage(finished, false),
  };
}

export async function retryTerritoryAssignment(
  request: TerritoryCaller,
  area: { id: string; assignment?: ManagedTerritory['assignment'] },
  hooks: Hooks = {},
): Promise<TerritorySaveResult> {
  if (!area.assignment || area.assignment.done) fail('This assignment is already finished. Refresh the list.');
  let summary: TerritoryCapabilitySummary;
  try {
    summary = await request();
  } catch (error) {
    rethrow(error, 'transfer', false);
  }
  hooks.onSummary?.(summary);
  const current = summary.territories.find((item) => item.id === area.id);
  if (!current) fail('This territory is no longer in your list. Refresh and check the saved boundary.');
  if (!current.assignment || current.assignment.done) {
    return {
      id: current.id,
      changed: current.assignment?.changed ?? area.assignment.changed,
      skipped: 0,
      background: false,
      queueError: '',
      message: 'Assignment is already complete. Your boundary is kept.',
    };
  }
  return resumeSaved(request, current, !!summary.capabilities?.backgroundAssignments, hooks, true);
}
