const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'works.json');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// Image upload
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'images', 'uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Ensure data directory and file exist
function initData() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const uploadDir = path.join(__dirname, 'images', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const def = require('./data.js');
    fs.writeFileSync(DATA_FILE, JSON.stringify((()=>{try{return DEFAULT_WORKS}catch(e){return def}})()));
  }
}

function readWorks() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) }
  catch (e) { return [] }
}

function writeWorks(works) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(works, null, 2), 'utf-8');
}

// ====== API Routes ======

// Get all works
app.get('/api/works', (req, res) => {
  const works = readWorks();
  res.json({ success: true, data: works });
});

// Get single work
app.get('/api/works/:id', (req, res) => {
  const works = readWorks();
  const work = works.find(w => w.id === parseInt(req.params.id));
  if (!work) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: work });
});

// Create work
app.post('/api/works', (req, res) => {
  const works = readWorks();
  const maxId = works.reduce((max, w) => Math.max(max, w.id), 0);
  const work = { id: maxId + 1, ...req.body, createdAt: new Date().toISOString() };
  if (!work.title) work.title = '新作品';
  if (!work.detail) work.detail = [];
  if (!work.gallery) work.gallery = [];
  if (!work.specs) work.specs = {};
  works.unshift(work);
  writeWorks(works);
  res.json({ success: true, data: work });
});

// Update work
app.put('/api/works/:id', (req, res) => {
  const works = readWorks();
  const idx = works.findIndex(w => w.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
  works[idx] = { ...works[idx], ...req.body, id: works[idx].id, updatedAt: new Date().toISOString() };
  writeWorks(works);
  res.json({ success: true, data: works[idx] });
});

// Delete work
app.delete('/api/works/:id', (req, res) => {
  let works = readWorks();
  const len = works.length;
  works = works.filter(w => w.id !== parseInt(req.params.id));
  if (works.length === len) return res.status(404).json({ success: false, message: 'Not found' });
  writeWorks(works);
  res.json({ success: true });
});

// Upload image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  const url = '/images/uploads/' + req.file.filename;
  res.json({ success: true, url });
});

// Batch update all works (for admin save)
app.post('/api/works/batch', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ success: false, message: 'Array required' });
  writeWorks(req.body);
  res.json({ success: true, count: req.body.length });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ====== Start ======
initData();
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/works`);
  console.log(`Site: http://localhost:${PORT}/index.html`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
