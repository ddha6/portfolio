/**
 * Portfolio Backend — Production-Grade Express Server
 *
 * Architecture:
 *   1. Security middleware (headers, CORS)
 *   2. Observability  (structured logging, health)
 *   3. Rate limiting  (in-memory sliding window)
 *   4. Static serving  (with cache policies)
 *   5. API routes      (thin controllers → data store)
 *   6. Error handler   (centralized, typed errors)
 *   7. Graceful shutdown (SIGTERM/SIGINT)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { execSync } = require('child_process');
const config = require('./config');

// ═══════════════════════════════════════════
//  Data Store — atomic, backed-up, validated
// ═══════════════════════════════════════════

class DataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.lock = false;
    this.queue = [];
    this.writeCount = 0;
    this._ensureExists();
  }

  _ensureExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Check existing data is a valid array
    if (fs.existsSync(this.filePath)) {
      const existing = this.read();
      if (Array.isArray(existing) && existing.length > 0) return;
      console.log('Data file empty or corrupt, loading defaults...');
    }
    this._loadDefaults();
  }

  _loadDefaults() {
    try {
      const src = config.defaultDataFile;
      if (fs.existsSync(src)) {
        const vm = require('vm');
        const sandbox = { console: null, setTimeout: null, setInterval: null, require: null, DEFAULT_WORKS: [] };
        const code = fs.readFileSync(src, 'utf-8');
        vm.createContext(sandbox);
        vm.runInContext(code, sandbox);
        const defaults = Array.isArray(sandbox.DEFAULT_WORKS) ? sandbox.DEFAULT_WORKS : [];
        this._writeSync(defaults);
        console.log(`Loaded ${defaults.length} works from defaults`);
      } else {
        this._writeSync([]);
      }
    } catch (e) {
      console.error('Failed to load default data:', e.message);
      this._writeSync([]);
    }
  }

  _writeSync(data) {
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        console.error('Data file is not an array, resetting...');
        this._loadDefaults();
        return this.read();
      }
      return data;
    } catch {
      console.error('Corrupted data file, resetting...');
      this._loadDefaults();
      return this.read();
    }
  }

  async write(data) {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      if (!this.lock) this._processQueue();
    });
  }

  _processQueue() {
    if (this.queue.length === 0) { this.lock = false; return; }
    this.lock = true;
    const { data, resolve, reject } = this.queue.shift();
    try {
      this._writeSync(data);
      this.writeCount++;
      // Probabilistic backup
      if (Math.random() < config.backup.backupFrequency) {
        this._createBackup(data);
      }
      resolve();
    } catch (e) {
      console.error('Write failed:', e.message);
      reject(e);
    }
    setImmediate(() => this._processQueue());
  }

  _createBackup(data) {
    try {
      if (!fs.existsSync(config.backupDir)) {
        fs.mkdirSync(config.backupDir, { recursive: true });
      }
      const f = path.join(config.backupDir, `works-${Date.now()}.json`);
      fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf-8');
      // Rotate old backups
      const files = fs.readdirSync(config.backupDir)
        .filter(f => f.startsWith('works-'))
        .sort();
      while (files.length > config.backup.maxBackups) {
        fs.unlinkSync(path.join(config.backupDir, files.shift()));
      }
    } catch (e) { /* backup failure is non-fatal */ }
  }

  stats() {
    try {
      const stat = fs.statSync(this.filePath);
      return { size: stat.size, writes: this.writeCount, lastModified: stat.mtime.toISOString() };
    } catch { return { writes: this.writeCount }; }
  }
}

// ═══════════════════════════════════════════
//  Validation
// ═══════════════════════════════════════════

const VALID_CATEGORIES = ['电商设计', '海报设计'];

function validateWork(body) {
  const e = [];
  if (body.title !== undefined && typeof body.title !== 'string') e.push('title: must be string');
  if (body.category !== undefined && !VALID_CATEGORIES.includes(body.category)) e.push('category: invalid');
  if (body.client !== undefined && typeof body.client !== 'string') e.push('client: must be string');
  if (body.price !== undefined && typeof body.price !== 'string') e.push('price: must be string');
  if (body.detail !== undefined && !Array.isArray(body.detail)) e.push('detail: must be array');
  if (body.gallery !== undefined && !Array.isArray(body.gallery)) e.push('gallery: must be array');
  return e;
}

function sanitizeWork(body) {
  return {
    title: String(body.title || '新作品').slice(0, 200),
    category: VALID_CATEGORIES.includes(body.category) ? body.category : '电商设计',
    client: String(body.client || '').slice(0, 100),
    price: String(body.price || '').slice(0, 20),
    img: String(body.img || '').slice(0, 500),
    detail: Array.isArray(body.detail) ? body.detail.slice(0, 50) : [],
    gallery: Array.isArray(body.gallery) ? body.gallery.slice(0, 20) : [],
    specs: (body.specs && typeof body.specs === 'object') ? body.specs : {},
  };
}

// ═══════════════════════════════════════════
//  Multer Setup
// ═══════════════════════════════════════════

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, crypto.randomBytes(10).toString('hex') + ext);
    },
  }),
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP'));
    }
  },
});

// ═══════════════════════════════════════════
//  App Assembly
// ═══════════════════════════════════════════

const app = express();
const store = new DataStore(config.dataFile);

// --- Security Headers (Helmet-lite, no extra deps) ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // deprecated but still blocks in older browsers
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

// --- CORS (allow admin.html cross-origin access if needed) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Body Parsing ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Request Logging ---
if (config.logging.logApiRequests) {
  app.use((req, res, next) => {
    if (!req.url.startsWith('/api/')) return next();
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
      console.log(`[${level}] ${req.method} ${req.url} → ${res.statusCode} (${ms}ms)`);
    });
    next();
  });
}

// --- Rate Limiter (sliding window, per-IP) ---
const rateWindows = new Map();
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const win = config.rateLimit.windowMs;
  const max = config.rateLimit.maxRequestsPerWindow;

  if (!rateWindows.has(ip)) rateWindows.set(ip, []);
  const history = rateWindows.get(ip).filter(t => t > now - win);
  history.push(now);
  rateWindows.set(ip, history);

  res.setHeader('X-RateLimit-Limit', max);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, max - history.length));
  res.setHeader('X-RateLimit-Reset', Math.ceil((history[0] + win) / 1000));

  if (history.length > max) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Retry after ' + Math.ceil(win / 1000) + 's.',
    });
  }
  next();
});

// --- Static Files ---
app.use(express.static(config.rootDir, {
  maxAge: config.cache.default * 1000,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', `public, max-age=${config.cache.js}`);
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
      res.setHeader('Cache-Control', `public, max-age=${config.cache.images}, immutable`);
    }
  },
}));

// ═══════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════

// Health check (also used by monitors/load balancers)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    works: store.read().length,
    store: store.stats(),
  });
});

// GET all works
app.get('/api/works', (req, res) => {
  res.json({ success: true, data: store.read() });
});

// GET single work
app.get('/api/works/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
  const work = store.read().find(w => w.id === id);
  if (!work) return res.status(404).json({ success: false, message: 'Work not found' });
  res.json({ success: true, data: work });
});

// POST create work
app.post('/api/works', async (req, res, next) => {
  try {
    const errors = validateWork(req.body);
    if (errors.length) return res.status(400).json({ success: false, message: errors.join('; ') });
    const works = store.read();
    const maxId = works.reduce((max, w) => Math.max(max, w.id), 0);
    const work = {
      id: maxId + 1,
      ...sanitizeWork(req.body),
      createdAt: new Date().toISOString(),
    };
    works.unshift(work);
    await store.write(works);
    res.status(201).json({ success: true, data: work });
  } catch (e) { next(e); }
});

// PUT update work
app.put('/api/works/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
    const errors = validateWork(req.body);
    if (errors.length) return res.status(400).json({ success: false, message: errors.join('; ') });
    const works = store.read();
    const idx = works.findIndex(w => w.id === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Work not found' });
    works[idx] = {
      ...works[idx],
      ...sanitizeWork(req.body),
      id: works[idx].id, // ID is immutable
      updatedAt: new Date().toISOString(),
    };
    await store.write(works);
    res.json({ success: true, data: works[idx] });
  } catch (e) { next(e); }
});

// DELETE work
app.delete('/api/works/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });
    const works = store.read();
    const before = works.length;
    const filtered = works.filter(w => w.id !== id);
    if (filtered.length === before) return res.status(404).json({ success: false, message: 'Work not found' });
    await store.write(filtered);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// POST upload image
app.post('/api/upload', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: err.message });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    res.json({ success: true, url: '/images/uploads/' + req.file.filename });
  });
});

// POST batch sync
app.post('/api/works/batch', async (req, res, next) => {
  try {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: 'Body must be an array' });
    }
    if (req.body.length > config.upload.maxBatchSize) {
      return res.status(400).json({ success: false, message: `Max ${config.upload.maxBatchSize} items` });
    }
    await store.write(req.body);
    res.json({ success: true, count: req.body.length });
  } catch (e) { next(e); }
});

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' });
});

// ═══════════════════════════════════════════
//  Error Handler (centralized)
// ═══════════════════════════════════════════

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = config.env === 'production' && status === 500
    ? 'Internal server error'
    : err.message || 'Unknown error';

  console.error(`[ERROR] ${req.method} ${req.url}:`, err.stack || err.message);

  res.status(status).json({
    success: false,
    message,
    ...(config.env !== 'production' && { stack: err.stack }),
  });
});

// ═══════════════════════════════════════════
//  Startup & Graceful Shutdown
// ═══════════════════════════════════════════

// Ensure directories exist
[config.dataDir, config.uploadDir, config.backupDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const server = app.listen(config.port, () => {
  console.log('═'.repeat(50));
  console.log(`  Portfolio Backend  v2.0`);
  console.log(`  Environment: ${config.env}`);
  console.log(`  http://localhost:${config.port}`);
  console.log(`  API:  http://localhost:${config.port}/api/works`);
  console.log(`  Admin: http://localhost:${config.port}/admin.html`);
  console.log('═'.repeat(50));
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed. Goodbye.');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejection safety net
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { app, store, shutdown };
