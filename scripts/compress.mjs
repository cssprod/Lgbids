// After `vite build`: write .br and .gz copies of the text files in dist/web so
// the server can send them compressed (@fastify/static `preCompressed`).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist/web';
const TEXT = /\.(?:js|css|html|svg|json|webmanifest|txt)$/;
let count = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (TEXT.test(name) && statSync(path).size > 1024) {
      const data = readFileSync(path);
      writeFileSync(`${path}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
      count += 1;
    }
  }
}

walk(root);
console.log(`Compressed ${count} files in ${root}.`);
