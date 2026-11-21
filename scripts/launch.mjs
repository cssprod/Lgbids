// `npm run app`, or double-click "Start Lgbids": everything needed to use the app on
// this computer in one step. Checks Node.js, installs and builds when needed, starts
// the server, opens the browser once it answers, and stops the server on Ctrl+C.
// Plain Node.js only: it has to run before the dependencies are installed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// A namespace import, so an old Node.js without parseEnv still reaches the version check.
import * as util from 'node:util';

const MIN_NODE = [22, 13];
const HEALTH_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 10_000;

/** True when `version` (like "22.13.1" or "v24.0.0") is at least 22.13. */
export function isSupportedNode(version) {
  const [major = 0, minor = 0] = String(version).replace(/^v/, '').split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/**
 * The address a browser on this computer should use. The server may listen on every
 * interface (0.0.0.0 or ::), which a browser cannot open, so those become loopback.
 */
export function appUrl(env = process.env) {
  const rawHost = (env.HOST ?? '').trim() || '127.0.0.1';
  const rawPort = (env.PORT ?? '').trim();
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : 3000;
  let host = rawHost;
  if (host === '0.0.0.0') host = '127.0.0.1';
  else if (host === '::' || host === '[::]') host = '::1';
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return `http://${host}:${port}/`;
}

/** The command that opens `url` in the default browser on `platform`. */
export function browserCommand(platform, url) {
  // `start` is built into cmd; the empty "" is the window title it would otherwise take from the URL.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url], verbatim: true };
  if (platform === 'darwin') return { command: 'open', args: [url], verbatim: false };
  return { command: 'xdg-open', args: [url], verbatim: false };
}

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function newestIn(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestIn(path) : mtime(path));
  }
  return newest;
}

const BUILD_STAMP = join('dist', '.launcher-build');

/** Why dependencies must be installed first, or '' when they are in place. */
export function installReason(root) {
  if (!existsSync(join(root, 'node_modules'))) return 'missing';
  // npm writes node_modules/.package-lock.json on every install; an older one means
  // package-lock.json changed since (after an update), so the installed set is stale.
  const installed = mtime(join(root, 'node_modules', '.package-lock.json'));
  if (installed && mtime(join(root, 'package-lock.json')) > installed) return 'outdated';
  return '';
}

/** Why the app must be built first, or '' when the build is newer than the sources. */
export function buildReason(root) {
  const outputs = [join(root, 'dist', 'server', 'index.js'), join(root, 'dist', 'web', 'index.html')];
  if (outputs.some((path) => !existsSync(path))) return 'missing';
  // The compiler may leave unchanged files untouched, so a successful launcher build also counts.
  const builtAt = Math.max(Math.min(...outputs.map(mtime)), mtime(join(root, BUILD_STAMP)));
  const inputs = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'vite.config.ts'];
  const newest = Math.max(newestIn(join(root, 'src')), ...inputs.map((name) => mtime(join(root, name))));
  return newest > builtAt ? 'outdated' : '';
}

/** Settings from a .env file in the app folder; variables already set win. */
export function readEnvFile(path, env = process.env) {
  if (!existsSync(path)) return { ...env };
  const fromFile = util.parseEnv(readFileSync(path, 'utf8'));
  return { ...fromFile, ...env };
}

async function isHealthy(url) {
  try {
    const res = await fetch(new URL('api/health', url), { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function npm(root, args) {
  // npm is a .cmd script on Windows, which Node only runs through the shell.
  const result =
    process.platform === 'win32'
      ? spawnSync(`npm ${args.join(' ')}`, { cwd: root, stdio: 'inherit', shell: true })
      : spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not run npm (${result.error.message}). npm comes with Node.js; reinstalling Node.js from https://nodejs.org usually fixes this.`);
    return false;
  }
  return result.status === 0;
}

function openBrowser(url) {
  const { command, args, verbatim } = browserCommand(process.platform, url);
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: verbatim });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser opener on this system; the address is printed above.
  }
}

async function main() {
  if (!isSupportedNode(process.versions.node)) {
    console.error(
      `Lgbids needs Node.js ${MIN_NODE.join('.')} or newer, but this computer has Node.js ${process.versions.node}. ` +
        'Install the current LTS release from https://nodejs.org, then start Lgbids again.',
    );
    process.exit(1);
  }

  const root = fileURLToPath(new URL('..', import.meta.url));
  const env = readEnvFile(join(root, '.env'));
  const noBrowser = process.argv.includes('--no-browser') || env.LGBIDS_NO_BROWSER === '1';
  const url = appUrl(env);

  if (await isHealthy(url)) {
    console.log(`Lgbids is already running at ${url}`);
    if (!noBrowser) openBrowser(url);
    return;
  }

  const install = installReason(root);
  if (install) {
    console.log(install === 'missing' ? 'Installing the parts Lgbids needs (first start only; this takes a minute or two).' : 'Updating the installed parts to match this version of Lgbids.');
    const hasLock = existsSync(join(root, 'package-lock.json'));
    if (!npm(root, [hasLock ? 'ci' : 'install'])) {
      console.error('Installing failed. Check the internet connection and the messages above, then try again.');
      process.exit(1);
    }
  }

  if (buildReason(root)) {
    console.log('Building the app (this takes a little while after an install or an update).');
    if (!npm(root, ['run', 'build'])) {
      console.error('Building the app failed. The messages above say what went wrong.');
      process.exit(1);
    }
    try {
      writeFileSync(join(root, BUILD_STAMP), new Date().toISOString());
    } catch {
      // Without the stamp the next start may build once more; nothing else is affected.
    }
  }

  // Data lives in ./data relative to the working directory unless DATA_DIR says otherwise,
  // so run from the app folder wherever the launcher was started from.
  const windows = process.platform === 'win32';
  const child = spawn(process.execPath, [resolve(root, 'dist', 'server', 'index.js')], {
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    // Its own process group, so Ctrl+C in a terminal reaches it once (from us), not twice.
    // Windows has no process groups; there the console delivers Ctrl+C to it directly.
    detached: !windows,
  });

  let exited = false;
  let stopping = false;
  child.on('error', (err) => {
    console.error(`Could not start the server: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    if (!stopping && code !== 0) console.error('Lgbids stopped unexpectedly. The messages above say why.');
    process.exit(code ?? (signal ? 1 : 0));
  });
  process.on('exit', () => {
    if (!exited) child.kill('SIGKILL');
  });

  const stop = (signal) => {
    if (stopping) {
      // A second Ctrl+C: do not wait any longer.
      child.kill('SIGKILL');
      return;
    }
    stopping = true;
    if (!(windows && signal === 'SIGINT')) child.kill(windows ? undefined : signal === 'SIGHUP' ? 'SIGTERM' : signal);
    setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal));

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (!exited && Date.now() < deadline) {
    if (await isHealthy(url)) {
      if (noBrowser) console.log(`Open ${url} in your browser. Press Ctrl+C here to stop Lgbids.`);
      else {
        console.log(`Opening ${url} in your browser. If it does not open, go to that address yourself. Press Ctrl+C here to stop Lgbids.`);
        openBrowser(url);
      }
      return;
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  if (!exited) console.warn(`Lgbids did not answer within ${HEALTH_TIMEOUT_MS / 1000} seconds. It may still be starting; open ${url} yourself in a moment.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
