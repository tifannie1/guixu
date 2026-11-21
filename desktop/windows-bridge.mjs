import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createWindowsBridge(scriptName, { timeout = 6500, retryDelay = 15000 } = {}) {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = fileURLToPath(new URL('./' + scriptName, import.meta.url));
  const pending = new Map();
  let worker = null;
  let sequence = 0;
  let closed = false;
  let retryAt = 0;

  function fail(current) {
    if (worker !== current) return;
    worker = null;
    retryAt = Date.now() + retryDelay;
    current.kill();
    for (const { timer, reject } of pending.values()) {
      clearTimeout(timer);
      reject(new Error('Windows integration is unavailable.'));
    }
    pending.clear();
  }

  function start() {
    const current = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], { windowsHide: true });
    worker = current;
    current.once('error', () => fail(current));
    current.once('exit', () => fail(current));
    current.stdin.on('error', () => fail(current));
    current.stderr.resume();
    createInterface({ input: current.stdout, crlfDelay: Infinity }).on('line', line => {
      if (worker !== current) return;
      let result;
      try { result = JSON.parse(line); } catch { return; }
      const request = pending.get(result.id);
      if (!request) return;
      pending.delete(result.id);
      clearTimeout(request.timer);
      if (result.ok) request.resolve(result.value);
      else request.reject(new Error('Windows rejected this operation.'));
    });
    return current;
  }

  return {
    request(action, fields = {}) {
      if (closed || process.platform !== 'win32' || Date.now() < retryAt) {
        return Promise.reject(new Error('Windows integration is unavailable.'));
      }
      const current = worker ?? start();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(current), timeout);
        pending.set(id, { timer, resolve, reject });
        current.stdin.write(JSON.stringify({ id, action, ...fields }) + '\n', error => {
          if (error) fail(current);
        });
      });
    },
    close() {
      closed = true;
      worker?.stdin.end();
    },
  };
}
