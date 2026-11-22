import { APP_VERSION, isLoopback, shutdownGracefully, startServer, timeZoneWarning } from './bootstrap.js';
import { loadConfig } from './config.js';

/** `npm start`: read the configuration from the environment, start the server and the schedule. */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (!isLoopback(config.host) && !config.appPassword && process.env.ALLOW_NO_PASSWORD !== '1') {
    console.error(
      `Refusing to start: the server would listen on ${config.host}, where other computers can reach it, but no APP_PASSWORD is set.\n` +
        'Set APP_PASSWORD to require a sign-in, or set HOST=127.0.0.1 to keep it on this computer.\n' +
        'If something else in front of it already controls access, set ALLOW_NO_PASSWORD=1.',
    );
    process.exit(1);
  }
  const warning = timeZoneWarning();
  if (warning) console.warn(warning);

  const server = await startServer(config);
  console.log(`Lgbids ${APP_VERSION} is running at ${server.url}${config.appPassword ? ' (sign-in required)' : ''}`);
  if (!config.webDir) console.log('The web UI has not been built; run `npm run build` to build it.');

  let stopping = false;
  const shutdown = (signal: string) => {
    // A second Ctrl+C means "now".
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`Received ${signal}, shutting down.`);
    shutdownGracefully(server, { log: (line) => console.log(line) }).then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(err);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unexpected error:', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
