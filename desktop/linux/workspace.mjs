import { spawn } from 'node:child_process';
import { childEnvironment, localOrigin } from './security.mjs';

export class WorkspaceProcess {
  constructor({ runtime, server, launch, onFailure = () => {}, timeout = 30000, stopTimeout = 3000 }) {
    Object.assign(this, { runtime, server, launch, onFailure, timeout, stopTimeout });
  }
  async start() {
    if (this.child || this.closing) throw new Error('Workspace already started or closed.');
    const child = this.child = spawn(this.runtime, [this.server], {
      shell: false, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Never persist or forward child output: it may contain private provider diagnostics.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    try {
      return await new Promise((resolve, reject) => {
        let buffer = '', ready = false, settled = false;
        const timer = setTimeout(() => rejectStart(new Error('Local workspace startup timed out.')), this.timeout);
        const rejectStart = error => {
          if (settled) return;
          settled = true; clearTimeout(timer); this.cancelStart = undefined; reject(error);
        };
        this.cancelStart = () => rejectStart(new Error('Local workspace startup cancelled.'));
        const fail = () => {
          if (!settled) rejectStart(new Error('The local workspace failed to start. Check Node.js 24, node:sqlite, sharp and the desktop build.'));
          else if (ready && !this.closing) { ready = false; this.onFailure(); }
        };
        child.once('error', fail);
        child.once('exit', fail);
        child.stdout.on('data', chunk => {
          if (settled) return; // Continue draining output without retaining it.
          buffer += chunk.toString('utf8');
          if (buffer.length > 4096) return rejectStart(new Error('Invalid workspace startup response.'));
          if (!buffer.includes('\n')) return;
          try {
            const message = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
            if (message.event !== 'ready' || !localOrigin(message.origin)) throw new Error();
            ready = true; settled = true; buffer = ''; clearTimeout(timer); this.cancelStart = undefined;
            resolve(message.origin);
          } catch { rejectStart(new Error('Invalid workspace startup response.')); }
        });
        this.send(this.launch).catch(fail);
        this.launch = undefined; // Do not retain the initial provider credentials.
      });
    } catch (error) { await this.stop(); throw error; }
  }
  send(value) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.closing) return reject(new Error('Workspace is closed.'));
      this.child.stdin.write(JSON.stringify(value) + '\n', error => error ? reject(new Error('Workspace pipe failed.')) : resolve());
    });
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.closing = true;
    this.cancelStart?.();
    const child = this.child;
    this.stopping = new Promise(resolve => {
      if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill('SIGKILL'), this.stopTimeout);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end(); // Existing server treats EOF as orderly shutdown.
    });
    return this.stopping;
  }
}
