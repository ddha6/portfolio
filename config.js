/**
 * Application Configuration
 * Central place for all tunables — nothing hardcoded in server logic.
 */
const path = require('path');

module.exports = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',

  // Paths
  rootDir: __dirname,
  dataDir: path.join(__dirname, 'data'),
  dataFile: path.join(__dirname, 'data', 'works.json'),
  backupDir: path.join(__dirname, 'data', 'backups'),
  uploadDir: path.join(__dirname, 'images', 'uploads'),
  defaultDataFile: path.join(__dirname, 'data.js'),

  // Upload
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxBatchSize: 500,
  },

  // Rate limiting
  rateLimit: {
    windowMs: 60_000,
    maxRequestsPerWindow: 100,
    trustProxy: true,
  },

  // Static file caching (seconds)
  cache: {
    html: 0,
    js: 3600,
    css: 3600,
    images: 86400,
    default: 3600,
  },

  // Backup
  backup: {
    maxBackups: 20,
    backupFrequency: 0.1, // probability per write
  },

  // Security
  security: {
    // CSP would go here in production
    frameAncestors: "'none'",
  },

  // Logging
  logging: {
    logApiRequests: true,
    logFormat: 'short', // short | json
  },
};
