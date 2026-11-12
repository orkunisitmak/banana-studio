import path from 'node:path';

export function workspaceResources({ packaged, resourcesPath, developmentRoot, runtime }) {
  if (packaged) {
    const workspace = path.join(resourcesPath, 'workspace');
    return { runtime: path.join(resourcesPath, 'runtime/bin/node'), server: path.join(workspace, 'server.mjs'), web: path.join(workspace, 'web'), cwd: workspace };
  }
  return { runtime, server: path.join(developmentRoot, '.build/desktop/server.mjs'), web: path.join(developmentRoot, 'dist'), cwd: developmentRoot };
}
