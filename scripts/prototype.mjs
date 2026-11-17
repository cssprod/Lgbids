// Builds the hosted beta prototype: the real web UI running on the in-browser
// sample API (src/web/mock.ts), as a static site for Netlify. No server, no
// real data, nothing is sent. Output: dist/prototype (see netlify.toml).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

process.env.VITE_MOCK = '1';
process.env.VITE_PROTOTYPE = '1';

const outDir = fileURLToPath(new URL('../dist/prototype', import.meta.url));
await build({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), build: { outDir, emptyOutDir: true } });
mkdirSync(outDir, { recursive: true });

// Netlify finds forms by reading the deployed HTML, and the app renders its
// feedback form with JavaScript, so a plain copy of the form lives here.
writeFileSync(
  `${outDir}/feedback.html`,
  `<!doctype html>
<html lang="en-CA">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Lgbids beta feedback</title></head>
<body>
<h1>Lgbids beta feedback</h1>
<form name="beta-feedback" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="/feedback-sent.html">
  <p hidden><label>Leave empty <input name="bot-field"></label></p>
  <p><label>Kind <select name="kind"><option>Something is confusing</option><option>Something is broken</option><option>Something is missing</option><option>Something is not needed</option><option>Idea or praise</option></select></label></p>
  <p><label>What happened? <textarea name="message" rows="6" required></textarea></label></p>
  <p><label>Your name or company (optional) <input name="name"></label></p>
  <input type="hidden" name="page"><input type="hidden" name="screen"><input type="hidden" name="browser">
  <p><button type="submit">Send feedback</button></p>
</form>
</body>
</html>
`,
);
writeFileSync(
  `${outDir}/feedback-sent.html`,
  `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Thank you</title></head><body><h1>Thank you</h1><p>Your feedback was sent. <a href="/">Back to Lgbids</a></p></body></html>\n`,
);

// Every app route serves the single-page app.
writeFileSync(`${outDir}/_redirects`, '/*  /index.html  200\n');

// Same security headers as the real server; keep the prototype out of search engines.
writeFileSync(
  `${outDir}/_headers`,
  `/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Robots-Tag: noindex
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
writeFileSync(`${outDir}/robots.txt`, 'User-agent: *\nDisallow: /\n');
console.log(`Prototype built in ${outDir}`);
