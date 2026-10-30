import { validateWorkspaceConfig, type WorkspaceConfig } from './runtimeConfig';
import { retryTransientRead } from '../shared/transientRead';

export class WorkspaceSetupError extends Error {}

/** Bounded startup reads. Never used around paid submissions or mutations. */
export const loadWorkspace = (fetcher: typeof fetch = fetch): Promise<WorkspaceConfig> => retryTransientRead(async () => {
  const response = await fetcher('/api/workspace-config', {
    cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (data?.code === 'WORKSPACE_NOT_CONFIGURED') throw new WorkspaceSetupError('Workspace setup is required.');
    throw Object.assign(new Error('The workspace could not be reached.'), { status: response.status });
  }
  try { return validateWorkspaceConfig(data); }
  catch { throw new WorkspaceSetupError('Workspace setup is required.'); }
});
