import { config } from 'zod';

// zod probes for eval support when schemas are first used, and the page's content
// security policy (no unsafe-eval) reports that probe as a violation. This module is
// imported before anything else so the probe is skipped.
config({ jitless: true });
