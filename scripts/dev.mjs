// `npm run dev`: the API server (restarting on changes) and the Vite dev server
// for the web UI, together in one terminal. Each line is prefixed with where it
// came from; stopping this script (or either process ending) stops both.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const bin = (name) => fileURLToPath(new URL(`../node_modules/.bin/${name}${windows ? '.cmd' : ''}`, import.meta.url));

const color = process.stdout.isTTY ? (code, text) => `\x1b[${code}m${text}\x1b[0m` : (_code, text) => text;

const tasks = [
  { name: 'server', color: 36, command: bin('tsx'), args: ['watch', 'src/server/index.ts'] },
  { name: 'web   ', color: 35, command: bin('vite'), args: [] },
];

const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  // Give them a moment to shut down cleanly, then make sure.
  setTimeout(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    process.exit(code);
  }, 3000).unref();
  Promise.all(children.map((c) => new Promise((done) => (c.exitCode !== null || c.signalCode !== null ? done() : c.once('exit', done))))).then(() =>
    process.exit(code),
  );
}

for (const task of tasks) {
  const child = spawn(task.command, task.args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: windows,
  });
  children.push(child);
  const prefix = color(task.color, `[${task.name}]`);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`${prefix} ${line}`));
  }
  child.on('error', (err) => {
    console.error(`${prefix} could not start: ${err.message}`);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.log(`${prefix} exited (${signal ?? code}); stopping the other process.`);
      stopAll(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
