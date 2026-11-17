import { config } from 'zod';

// zod probes whether it may compile code at runtime (new Function) when object
// schemas are created. In the browser the page's content security policy forbids
// that, and the probe shows up as a console error, so the browser build turns the
// compiled fast path off. schemas.ts imports this first, so it runs before any
// schema exists, whatever order the bundler puts the chunks in. The server keeps
// the fast path.
if ('document' in globalThis) config({ jitless: true });
