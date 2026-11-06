import { validateCloudPublicConfig, type CloudPublicConfig } from './publicConfig';
/** `server` marks the same local workspace served to a browser by a self-hosted server (Docker). */
export type LocalPublicConfig = { mode: 'local'; userId: string; sessionId: string; server?: true };
export type WorkspaceConfig = CloudPublicConfig | LocalPublicConfig;
declare global { interface Window { __BANANA_STUDIO_CONFIG__?: WorkspaceConfig } }
export function validateWorkspaceConfig(value: unknown): WorkspaceConfig {
  const input = value as Partial<LocalPublicConfig>;
  if (input?.mode !== 'local') return validateCloudPublicConfig(value);
  const server = input.server === true;
  if ((!server && !['127.0.0.1','localhost'].includes(location.hostname)) || !/^[0-9a-f-]{36}$/i.test(input.userId || '') || !/^[0-9a-f-]{36}$/i.test(input.sessionId || '')) throw new Error('Invalid local workspace.');
  return { mode: 'local', userId: input.userId!, sessionId: input.sessionId!, ...(server ? { server: true as const } : {}) };
}
export function getWorkspaceConfig(): WorkspaceConfig {
  if (!window.__BANANA_STUDIO_CONFIG__) throw new Error('Workspace configuration is missing.');
  return window.__BANANA_STUDIO_CONFIG__;
}
export const isLocalWorkspace = () => getWorkspaceConfig().mode === 'local';
/** A local workspace on a self-hosted server: keys come from its environment, sign-in is its access token. */
export const isServerWorkspace = () => { const config = getWorkspaceConfig(); return config.mode === 'local' && config.server === true; };
export function getCloudPublicConfig(): CloudPublicConfig {
  const config=getWorkspaceConfig();if(config.mode!=='cloud')throw new Error('A cloud workspace is required.');return config;
}
