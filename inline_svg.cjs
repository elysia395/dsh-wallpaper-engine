const fs = require('fs');
const srcPath = 'src/client.js';
let src = fs.readFileSync(srcPath, 'utf8');
const svg = fs.readFileSync('08b5f70da6268b9d8d4f320718fdb21d.svg', 'utf8')
  .replace(/\r\n/g, '\n').replace(/^\s+/, '').replace(/\s+$/, '');

const startMarker = 'const ROPE_SVG = [';
const endMarker = "].join('\\n');";
const si = src.indexOf(startMarker);
if (si < 0) { console.error('start marker not found'); process.exit(1); }
const ei = src.indexOf(endMarker, si);
if (ei < 0) { console.error('end marker not found'); process.exit(1); }
const end = ei + endMarker.length;

const replacement = 'const ROPE_SVG = `\n' + svg + '\n`;';
src = src.slice(0, si) + replacement + src.slice(end);
fs.writeFileSync(srcPath, src);
console.log('replaced ROPE_SVG; new src length', src.length, 'svg chars', svg.length);
