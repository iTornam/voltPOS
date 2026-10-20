// Builds worker.js = worker.src.js + viewer.html embedded as a string.
// Run after editing either file:   node build.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, 'viewer.html'), 'utf8');
const src = fs.readFileSync(path.join(dir, 'worker.src.js'), 'utf8');
if (!src.includes('__VIEWER_HTML__')) throw new Error('placeholder missing in worker.src.js');
const out = path.join(dir, 'worker.js');
fs.writeFileSync(out, src.replace('__VIEWER_HTML__', () => JSON.stringify(html)));
console.log('built worker.js (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
