/**
 * Extract base64 images from data.js, save as files, generate slim data.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKS_DIR = path.join(__dirname, 'images', 'works');
const DATA_JS_PATH = path.join(__dirname, 'data.js');
const OUTPUT_PATH = path.join(__dirname, 'data-slim.js');

// Ensure output directory
if (!fs.existsSync(WORKS_DIR)) fs.mkdirSync(WORKS_DIR, { recursive: true });

// Load DEFAULT_WORKS from data.js via eval
console.log('Loading data.js...');
const code = fs.readFileSync(DATA_JS_PATH, 'utf-8');
const vm = require('vm');
const sandbox = { console: null, setTimeout: null, setInterval: null, require: null, DEFAULT_WORKS: [] };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const DEFAULT_WORKS = Array.isArray(sandbox.DEFAULT_WORKS) ? sandbox.DEFAULT_WORKS : [];

console.log(`Loaded ${DEFAULT_WORKS.length} works`);

let totalImages = 0;
let totalBytes = 0;

function extractBase64(str) {
  if (!str || typeof str !== 'string') return null;
  // Match data:image/xxx;base64,...
  const m = str.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

function saveImage(base64Str, prefix) {
  const extracted = extractBase64(base64Str);
  if (!extracted) return base64Str; // not base64, return as-is

  const ext = extracted.mime.split('/')[1] === 'jpeg' ? 'jpg' : extracted.mime.split('/')[1];
  const buf = Buffer.from(extracted.data, 'base64');
  const hash = crypto.createHash('md5').update(buf).digest('hex');
  const filename = `${prefix}_${hash}.${ext}`;
  const filepath = path.join(WORKS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, buf);
    totalImages++;
    totalBytes += buf.length;
  }

  return `images/works/${filename}`;
}

// Process each work
for (const work of DEFAULT_WORKS) {
  console.log(`Processing work ${work.id}: ${work.title}`);

  // Main image
  if (work.img) {
    work.img = saveImage(work.img, `w${work.id}`);
  }

  // Gallery images
  if (Array.isArray(work.gallery)) {
    for (let i = 0; i < work.gallery.length; i++) {
      work.gallery[i] = saveImage(work.gallery[i], `w${work.id}_g${i}`);
    }
  }

  // Detail blocks
  if (Array.isArray(work.detail)) {
    for (let i = 0; i < work.detail.length; i++) {
      if (work.detail[i].t === 'image' && work.detail[i].src) {
        work.detail[i].src = saveImage(work.detail[i].src, `w${work.id}_d${i}`);
      }
    }
  }
}

// Write slim data.js
const output = 'var DEFAULT_WORKS=' + JSON.stringify(DEFAULT_WORKS) + ';';
fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');

const outputSize = Buffer.byteLength(output, 'utf-8');
console.log(`\nDone!`);
console.log(`  Images extracted: ${totalImages}`);
console.log(`  Total image size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Slim data.js: ${(outputSize / 1024).toFixed(1)} KB (was ${(fs.statSync(DATA_JS_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
