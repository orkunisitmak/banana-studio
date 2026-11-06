import { validateCloudPublicConfig, type CloudPublicConfig } from './publicConfig';
export type LocalPublicConfig = { mode: 'local'; userId: string; sessionId: string };
export type WorkspaceConfig = CloudPublicConfig | LocalPublicConfig;
declare global { interface Window { __BANANA_STUDIO_CONFIG__?: WorkspaceConfig } }
export function validateWorkspaceConfig(value: unknown): WorkspaceConfig {
  const input = value as Partial<LocalPublicConfig>;
  if (input?.mode !== 'local') return validateCloudPublicConfig(value);
  if (!['127.0.0.1','localhost'].includes(location.hostname) || !/^[0-9a-f-]{36}$/i.test(input.userId || '') || !/^[0-9a-f-]{36}$/i.test(input.sessionId || '')) throw new Error('Invalid local workspace.');
  return { mode: 'local', userId: input.userId!, sessionId: input.sessionId! };
}
export function getWorkspaceConfig(): WorkspaceConfig {
  if (!window.__BANANA_STUDIO_CONFIG__) throw new Error('Workspace configuration is missing.');
  return window.__BANANA_STUDIO_CONFIG__;
}
export const isLocalWorkspace = () => getWorkspaceConfig().mode === 'local';
export function getCloudPublicConfig(): CloudPublicConfig {
  const config=getWorkspaceConfig();if(config.mode!=='cloud')throw new Error('A cloud workspace is required.');return config;
}
