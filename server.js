import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { createOrderMailer } from './src/mailer.js';
import { calculateStickerPrice, clampQuantity, formatEuro } from './src/pricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MAX_PHOTOS = 8;
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const IMAGE_MIME_EXT = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const AUDIO_MIME_EXT = new Map([
  ['audio/webm', '.webm'],
  ['audio/mp4', '.m4a'],
  ['audio/x-m4a', '.m4a'],
  ['audio/aac', '.aac'],
  ['audio/ogg', '.ogg'],
  ['audio/wav', '.wav'],
  ['audio/mpeg', '.mp3'],
]);

function loadDotEnvIfPresent(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeMime(mimetype) {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

function normalizeOrderMode(mode, emailConfigured = false) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'server') return 'server';
  if (normalized === 'mailto') return 'mailto';
  return emailConfigured ? 'server' : 'mailto';
}

function sanitizeBaseName(originalName, fallback) {
  const base = path.basename(String(originalName || ''), path.extname(String(originalName || '')));
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || fallback;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function cleanupOrderDir(dirPath) {
  if (!dirPath) return;
  await fsp.rm(dirPath, { recursive: true, force: true }).catch(() => {});
}

export function createApp(options = {}) {
  const rootDir = options.rootDir || __dirname;
  const publicDir = options.publicDir || path.join(rootDir, 'public');
  const dataDir = options.dataDir || path.join(rootDir, 'data');
  const uploadDir = options.uploadDir || path.join(rootDir, 'uploads');
  const ordersFile = path.join(dataDir, 'orders.json');

  const getTeamEmail = () =>
    String(options.teamEmail ?? (process.env.TEAM_EMAIL || 'imastik.co@gmail.com')).trim();
  const mailer =
    options.mailer ||
    createOrderMailer({
      teamEmail: options.teamEmail,
      senderEmail: options.senderEmail,
      senderName: options.senderName,
      gmailWebhookUrl: options.gmailWebhookUrl,
      gmailWebhookSecret: options.gmailWebhookSecret,
      brevoApiKey: options.brevoApiKey,
      resendApiKey: options.resendApiKey,
      fetchImpl: options.mailFetch,
    });
  const getOrderMode = (emailConfigured = mailer.getStatus().configured) =>
    normalizeOrderMode(options.orderMode ?? process.env.ORDER_MODE, emailConfigured);
  const getAdminPassword = () => String(options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '').trim();

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  // Serialize writes to orders.json so concurrent uploads never interleave.
  let writeQueue = Promise.resolve();
  function appendOrderRecord(record) {
    const task = writeQueue.then(async () => {
      let existing = [];
      try {
        const raw = await fsp.readFile(ordersFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) existing = parsed;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      existing.unshift(record);
      const tmpFile = `${ordersFile}.${crypto.randomUUID()}.tmp`;
      await fsp.writeFile(tmpFile, JSON.stringify(existing, null, 2), 'utf8');
      await fsp.rename(tmpFile, ordersFile);
    });
    writeQueue = task.catch(() => {});
    return task;
  }

  async function readOrderRecords() {
    try {
      const raw = await fsp.readFile(ordersFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        if (!req.orderUploadDir) {
          req.orderId = crypto.randomUUID();
          req.orderUploadDir = path.join(uploadDir, req.orderId);
        }
        fs.mkdirSync(req.orderUploadDir, { recursive: true });
        cb(null, req.orderUploadDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const mime = normalizeMime(file.mimetype);
      const ext =
        IMAGE_MIME_EXT.get(mime) ||
        AUDIO_MIME_EXT.get(mime) ||
        path.extname(file.originalname || '').toLowerCase() ||
        '.bin';
      const prefix = sanitizeBaseName(file.originalname, file.fieldname);
      const token = crypto.randomBytes(4).toString('hex');
      cb(null, `${file.fieldname}-${prefix}-${token}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
      files: MAX_PHOTOS + 3,
    },
    fileFilter: (_req, file, cb) => {
      const mime = normalizeMime(file.mimetype);
      if (file.fieldname === 'voiceNote') {
        if (AUDIO_MIME_EXT.has(mime)) return cb(null, true);
        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported audio format for voiceNote'));
      }
      if (['photos', 'sketch'].includes(file.fieldname)) {
        if (IMAGE_MIME_EXT.has(mime)) return cb(null, true);
        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported image format (use JPG, PNG, or WebP)'));
      }
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unexpected upload field: ${file.fieldname}`));
    },
  });

  const uploadFields = upload.fields([
    { name: 'photos', maxCount: MAX_PHOTOS },
    { name: 'sketch', maxCount: 1 },
    { name: 'voiceNote', maxCount: 1 },
  ]);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  app.use(
    express.static(publicDir, {
      extensions: ['html'],
      maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
      setHeaders: (res, filePath) => {
        if (path.extname(filePath).toLowerCase() === '.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'imastik',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/api/config', (_req, res) => {
    const teamEmail = getTeamEmail();
    const mailStatus = mailer.getStatus();
    res.json({
      teamEmail,
      hasTeamEmail: isValidEmail(teamEmail),
      orderMode: getOrderMode(mailStatus.configured),
      autoEmailEnabled: mailStatus.configured,
      maxPhotos: MAX_PHOTOS,
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    });
  });

  app.post('/api/orders', (req, res, next) => {
    uploadFields(req, res, async (err) => {
      if (err) {
        await cleanupOrderDir(req.orderUploadDir);
        if (err instanceof multer.MulterError) {
          return res.status(400).json({
            ok: false,
            error: err.field ? `${err.message} (${err.field})` : err.message,
          });
        }
        return next(err);
      }

      try {
        const name = String(req.body?.name ?? '').trim();
        const email = String(req.body?.email ?? '').trim();
        const idea = String(req.body?.idea ?? '').trim().slice(0, 4000);
        const sharePermission = String(req.body?.sharePermission ?? '') === 'yes';
        const storePermission = String(req.body?.storePermission ?? '') === 'yes';
        const storeDesignId = String(req.body?.storeDesignId ?? '')
          .trim()
          .replace(/[^a-z0-9-]/gi, '')
          .slice(0, 64);
        const quantity = clampQuantity(req.body?.quantity);
        const estimatedPrice = calculateStickerPrice(quantity);

        if (!name || name.length > 120) {
          await cleanupOrderDir(req.orderUploadDir);
          return res.status(400).json({ ok: false, error: 'Please provide your name (max 120 characters).' });
        }

        if (!isValidEmail(email)) {
          await cleanupOrderDir(req.orderUploadDir);
          return res.status(400).json({ ok: false, error: 'Please provide a valid email address.' });
        }

        const orderId = req.orderId || crypto.randomUUID();
        const fileEntries = [];
        for (const field of ['photos', 'sketch', 'voiceNote']) {
          const list = req.files?.[field] || [];
          for (const f of list) {
            fileEntries.push({
              field,
              filename: f.filename,
              originalName: f.originalname,
              mimeType: normalizeMime(f.mimetype),
              size: f.size,
            });
          }
        }

        const record = {
          orderId,
          createdAt: new Date().toISOString(),
          name,
          email,
          idea,
          quantity,
          estimatedPrice,
          estimatedPriceFormatted: formatEuro(estimatedPrice),
          sharePermission,
          storePermission,
          storeDesignId: storeDesignId || null,
          files: fileEntries,
        };

        const emailResult = await mailer.sendOrderEmail(record, req.orderUploadDir);
        if (emailResult.error) {
          console.error('[imastik] automatic order email failed:', emailResult.provider, emailResult.error);
        }
        record.emailDelivery = {
          sent: Boolean(emailResult.sent),
          provider: emailResult.provider || null,
          messageId: emailResult.messageId || null,
          error: emailResult.error || null,
          omittedAttachments: emailResult.omittedAttachments || [],
        };

        await appendOrderRecord(record);

        return res.status(201).json({
          ok: true,
          orderId,
          createdAt: record.createdAt,
          quantity,
          estimatedPrice,
          estimatedPriceFormatted: record.estimatedPriceFormatted,
          filesCount: fileEntries.length,
          emailSent: record.emailDelivery.sent,
          emailError: record.emailDelivery.error ? 'Automatic email delivery was unavailable.' : null,
          omittedAttachments: record.emailDelivery.omittedAttachments,
        });
      } catch (innerErr) {
        await cleanupOrderDir(req.orderUploadDir);
        return next(innerErr);
      }
    });
  });

  function requireAdminAuth(req, res, next) {
    const expected = getAdminPassword();
    if (!expected) {
      return res.status(503).json({
        ok: false,
        error: 'ADMIN_PASSWORD is not configured on this server.',
      });
    }

    const header = String(req.headers.authorization || '');
    if (header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (safeEqual(token, expected)) return next();
    } else if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const providedPassword = sep >= 0 ? decoded.slice(sep + 1) : decoded;
      if (safeEqual(providedPassword, expected)) return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="imastik Orders"');
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  app.get('/api/orders', requireAdminAuth, async (_req, res, next) => {
    try {
      const orders = await readOrderRecords();
      res.json({ ok: true, count: orders.length, orders });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/orders/:orderId/files/:fileName', requireAdminAuth, (req, res) => {
    const { orderId, fileName } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'Invalid orderId.' });
    }
    const safeName = path.basename(fileName);
    if (!safeName || safeName !== fileName) {
      return res.status(400).json({ ok: false, error: 'Invalid file name.' });
    }
    const targetPath = path.resolve(uploadDir, orderId, safeName);
    const allowedParent = path.resolve(uploadDir, orderId) + path.sep;
    if (!targetPath.startsWith(allowedParent) || !fs.existsSync(targetPath)) {
      return res.status(404).json({ ok: false, error: 'File not found.' });
    }
    return res.sendFile(targetPath);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API route not found.' });
  });

  app.use((err, _req, res, _next) => {
    console.error('[imastik] unhandled error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error.' });
  });

  return app;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  loadDotEnvIfPresent(path.join(__dirname, '.env'));
  const port = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`imastik server listening on http://localhost:${port}`);
  });
}
