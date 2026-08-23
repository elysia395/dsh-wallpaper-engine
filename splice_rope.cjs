const fs = require('fs');
const srcPath = 'src/client.js';
const b64 = fs.readFileSync('_rope_small.png').toString('base64');
let src = fs.readFileSync(srcPath, 'utf8');

const marker = 'const ROPE_SVG = ';
const si = src.indexOf(marker);
if (si < 0) { console.error('start marker not found'); process.exit(1); }
const open = si + marker.length;             // points at the opening backtick
const close = src.indexOf('`', open + 1);    // closing backtick (content has none)
if (close < 0) { console.error('closing backtick not found'); process.exit(1); }
let end = close + 1;                          // after closing backtick
while (end < src.length && (src[end] === ' ' || src[end] === '\n' || src[end] === '\r' || src[end] === '\t')) end++;
if (src[end] !== ';') { console.error('semicolon not found after ROPE_SVG; got: ' + JSON.stringify(src.slice(end, end+5))); process.exit(1); }
end = end + 1;

const dataUri = 'data:image/png;base64,' + b64;
const replacement = 'const ROPE_IMG = "' + dataUri + '";';
src = src.slice(0, si) + replacement + src.slice(end);
fs.writeFileSync(srcPath, src);
console.log('replaced with ROPE_IMG; removed', (end - si), 'chars; b64 len', b64.length, '; new src length', src.length);
