import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.js';
import { buildOrderEmail, loadOrderAttachments } from '../src/mailer.js';
import { calculateStickerPrice, clampQuantity, formatEuro } from '../src/pricing.js';

// Minimal valid 1x1 PNG bytes for multipart upload tests
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function startTestServer(appOptions = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imastik-test-'));
  const app = createApp({
    dataDir: path.join(tmpDir, 'data'),
    uploadDir: path.join(tmpDir, 'uploads'),
    ...appOptions,
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    tmpDir,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

test('pricing formula calculates expected euro amounts and clamps bounds', () => {
  assert.equal(calculateStickerPrice(5), 5);
  assert.equal(calculateStickerPrice(10), 8);
  assert.equal(calculateStickerPrice(15), 11.5);
  assert.equal(calculateStickerPrice(20), 15);
  assert.equal(calculateStickerPrice(25), 18.75);
  assert.equal(formatEuro(calculateStickerPrice(10)), '€8.00');
  assert.equal(clampQuantity(-5), 5);
  assert.equal(clampQuantity(1), 5);
  assert.equal(clampQuantity(250), 200);
});

test('GET /health and GET / serve streamlined imastik app with process infographic, pricing, and ordering system', async () => {
  const srv = await startTestServer({ teamEmail: 'team@imastik.lt', orderMode: 'mailto' });
  try {
    const healthRes = await fetch(`${srv.baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.service, 'imastik');

    const cfgRes = await fetch(`${srv.baseUrl}/api/config`);
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.equal(cfg.teamEmail, 'team@imastik.lt');
    assert.equal(cfg.hasTeamEmail, true);
    assert.equal(cfg.orderMode, 'mailto');

    const htmlRes = await fetch(`${srv.baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /\/images\/imastik-logo\.png/);
    assert.match(html, /\/images\/imastik-icon\.png/);
    assert.match(html, /imastik\.co@gmail\.com/);
    assert.match(html, /instagram\.com\/imastik\.co/);
    assert.match(html, /class="hero-ornaments"/);
    assert.match(html, /id="why-sticky"/);
    assert.match(html, /class="process-diagram"/);
    assert.match(html, /id="prices"/);
    assert.match(html, /id="orderForm"/);
    assert.match(html, /id="napkinCanvas"/);
    assert.match(html, /id="sketchExpand"/);
    assert.match(html, /id="sketchModalRotate"/);
    assert.match(html, /id="napkinCanvasFull"/);
    assert.match(html, /id="voiceToggle"/);
    assert.match(html, /name="share_permission"/);
    assert.match(html, /name="store_permission"/);

    // Fluff sections removed
    assert.doesNotMatch(html, /id="stick-anywhere"/);
    assert.doesNotMatch(html, /id="play"/);
    assert.doesNotMatch(html, /id="story"/);
    assert.doesNotMatch(html, /playground\.js/);
    assert.doesNotMatch(html, /SELECT THIS PACK/);
    assert.doesNotMatch(html, /class="pricecard[^"]*is-selected"/);
    assert.doesNotMatch(html, /<button[^>]*pricecard/i);
    assert.doesNotMatch(html, /YOUR-TEAM-EMAIL@example\.com/);
    assert.doesNotMatch(html, /STICKY CLUB/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);

    // Verify section order: hero -> process diagram -> pricing -> order form
    const topIdx = html.indexOf('id="top"');
    const whyIdx = html.indexOf('id="why-sticky"');
    const infographicIdx = html.indexOf('class="process-diagram"');
    const pricesIdx = html.indexOf('id="prices"');
    const orderIdx = html.indexOf('id="order"');
    assert.ok(
      topIdx > 0 &&
        whyIdx > topIdx &&
        infographicIdx > whyIdx &&
        pricesIdx > infographicIdx &&
        orderIdx > pricesIdx,
    );
  } finally {
    await srv.close();
  }
});

test('POST /api/orders validates input, saves multipart attachments, and enforces admin auth on reads', async () => {
  const srv = await startTestServer({
    orderMode: 'server',
    adminPassword: 'super-secret-password',
  });

  try {
    // 1. Invalid email should return 400
    const badFd = new FormData();
    badFd.set('name', 'Alex');
    badFd.set('email', 'not-an-email');
    badFd.set('quantity', '2');
    const badRes = await fetch(`${srv.baseUrl}/api/orders`, { method: 'POST', body: badFd });
    assert.equal(badRes.status, 400);

    // 2. Invalid file mime type should return 400
    const badFileFd = new FormData();
    badFileFd.set('name', 'Alex');
    badFileFd.set('email', 'alex@example.com');
    badFileFd.append('photos', new Blob(['pdf'], { type: 'application/pdf' }), 'doc.pdf');
    const badFileRes = await fetch(`${srv.baseUrl}/api/orders`, { method: 'POST', body: badFileFd });
    assert.equal(badFileRes.status, 400);

    // 3. Valid order with photo, napkin sketch, and voice note
    const fd = new FormData();
    fd.set('name', 'Milda');
    fd.set('email', 'milda@uni.example');
    fd.set('idea', 'Cat wearing sunglasses');
    fd.set('quantity', '10');
    fd.set('sharePermission', 'yes');
    fd.set('storePermission', 'yes');
    fd.set('storeDesignId', 'coffee-powered');
    fd.append('photos', new Blob([TINY_PNG], { type: 'image/png' }), 'cat.png');
    fd.append('sketch', new Blob([TINY_PNG], { type: 'image/png' }), 'sketch.png');
    fd.append('voiceNote', new Blob([Buffer.from('fake-webm')], { type: 'audio/webm;codecs=opus' }), 'voice.webm');

    const okRes = await fetch(`${srv.baseUrl}/api/orders`, { method: 'POST', body: fd });
    assert.equal(okRes.status, 201);
    const created = await okRes.json();
    assert.equal(created.ok, true);
    assert.equal(created.quantity, 10);
    assert.equal(created.estimatedPrice, 8);
    assert.equal(created.estimatedPriceFormatted, '€8.00');
    assert.equal(created.filesCount, 3);

    // 4. Unauthenticated GET /api/orders returns 401
    const unauthRes = await fetch(`${srv.baseUrl}/api/orders`);
    assert.equal(unauthRes.status, 401);

    // 5. Authenticated GET /api/orders returns saved order + downloadable files
    const authHeader = `Basic ${Buffer.from('admin:super-secret-password').toString('base64')}`;
    const listRes = await fetch(`${srv.baseUrl}/api/orders`, {
      headers: { Authorization: authHeader },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.count, 1);
    assert.equal(listData.orders[0].orderId, created.orderId);
    assert.equal(listData.orders[0].storePermission, true);
    assert.equal(listData.orders[0].storeDesignId, 'coffee-powered');
    assert.equal(listData.orders[0].files.length, 3);

    const firstFile = listData.orders[0].files[0].filename;
    const fileRes = await fetch(
      `${srv.baseUrl}/api/orders/${created.orderId}/files/${encodeURIComponent(firstFile)}`,
      { headers: { Authorization: authHeader } },
    );
    assert.equal(fileRes.status, 200);
    const downloaded = Buffer.from(await fileRes.arrayBuffer());
    assert.deepEqual(downloaded, TINY_PNG);
  } finally {
    await srv.close();
  }
});

test('GET /api/orders returns 503 when ADMIN_PASSWORD is not set', async () => {
  const srv = await startTestServer({ adminPassword: '' });
  try {
    const res = await fetch(`${srv.baseUrl}/api/orders`);
    assert.equal(res.status, 503);
  } finally {
    await srv.close();
  }
});

test('ORDER_MODE=auto resolves to mailto without transport and switches to auto-email server mode with Gmail webhook', async () => {
  const noMailSrv = await startTestServer({ orderMode: 'auto', teamEmail: 'imastik.co@gmail.com' });
  try {
    const cfg = await (await fetch(`${noMailSrv.baseUrl}/api/config`)).json();
    assert.equal(cfg.orderMode, 'mailto');
    assert.equal(cfg.autoEmailEnabled, false);
  } finally {
    await noMailSrv.close();
  }

  const webhookRequests = [];
  const webhookSrv = await startTestServer({
    orderMode: 'auto',
    teamEmail: 'imastik.co@gmail.com',
    gmailWebhookUrl: 'https://script.google.com/macros/s/test-deploy/exec',
    gmailWebhookSecret: 'top-secret-hook',
    adminPassword: 'admin-pass-for-test',
    mailFetch: async (url, init) => {
      webhookRequests.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, messageId: 'gmail-msg-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  try {
    const cfg = await (await fetch(`${webhookSrv.baseUrl}/api/config`)).json();
    assert.equal(cfg.orderMode, 'server');
    assert.equal(cfg.autoEmailEnabled, true);

    const fd = new FormData();
    fd.set('name', 'Dovile');
    fd.set('email', 'dovile@example.com');
    fd.set('idea', '<script>alert(1)</script> Cute duck sticker');
    fd.set('quantity', '20');
    fd.set('sharePermission', 'yes');
    fd.append('photos', new Blob([TINY_PNG], { type: 'image/png' }), 'duck.png');
    fd.append('sketch', new Blob([TINY_PNG], { type: 'image/png' }), 'napkin.png');
    fd.append('voiceNote', new Blob([Buffer.from('audio-bytes')], { type: 'audio/webm' }), 'voice.webm');

    const res = await fetch(`${webhookSrv.baseUrl}/api/orders`, { method: 'POST', body: fd });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.emailSent, true);
    assert.equal(created.filesCount, 3);
    assert.equal(webhookRequests.length, 1);

    const sent = webhookRequests[0].body;
    assert.equal(webhookRequests[0].url, 'https://script.google.com/macros/s/test-deploy/exec');
    assert.equal(sent.secret, 'top-secret-hook');
    assert.equal(sent.to, 'imastik.co@gmail.com');
    assert.equal(sent.replyTo, 'dovile@example.com');
    assert.match(sent.subject, /20x \(€15\.00\) — Dovile/);
    assert.doesNotMatch(sent.html, /<script>alert/);
    assert.match(sent.html, /&lt;script&gt;alert/);
    assert.equal(sent.attachments.length, 3);
    assert.deepEqual(Buffer.from(sent.attachments[0].base64, 'base64'), TINY_PNG);
  } finally {
    await webhookSrv.close();
  }

  // Non-JSON 200 HTML response (e.g., Google login redirect when Apps Script access != Anyone) must NOT report emailSent=true
  const htmlLoginSrv = await startTestServer({
    orderMode: 'server',
    gmailWebhookUrl: 'https://script.google.com/macros/s/test-deploy/exec',
    mailFetch: async () => new Response('<html><body>Sign in</body></html>', { status: 200 }),
  });
  try {
    const fd = new FormData();
    fd.set('name', 'Test');
    fd.set('email', 'test@example.com');
    const res = await fetch(`${htmlLoginSrv.baseUrl}/api/orders`, { method: 'POST', body: fd });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.emailSent, false);
  } finally {
    await htmlLoginSrv.close();
  }
});

test('Brevo mail failure still preserves order safely on server and respects attachment byte caps', async () => {
  const brevoCalls = [];
  const srv = await startTestServer({
    orderMode: 'server',
    teamEmail: 'imastik.co@gmail.com',
    brevoApiKey: 'xkeysib-test-only',
    adminPassword: 'brevo-admin-password',
    mailFetch: async (url, init) => {
      brevoCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ message: 'internal provider failure url=secret' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  try {
    const fd = new FormData();
    fd.set('name', 'Tomas');
    fd.set('email', 'tomas@example.com');
    fd.set('idea', 'Skateboard sticker');
    fd.set('quantity', '5');
    fd.append('photos', new Blob([TINY_PNG], { type: 'image/png' }), 'board.png');

    const res = await fetch(`${srv.baseUrl}/api/orders`, { method: 'POST', body: fd });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.ok, true);
    assert.equal(created.emailSent, false);
    assert.equal(created.emailError, 'Automatic email delivery was unavailable.');

    assert.equal(brevoCalls.length, 1);
    assert.equal(brevoCalls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(brevoCalls[0].headers['api-key'], 'xkeysib-test-only');
    assert.equal(brevoCalls[0].body.attachment.length, 1);

    const authHeader = `Basic ${Buffer.from('admin:brevo-admin-password').toString('base64')}`;
    const saved = await (await fetch(`${srv.baseUrl}/api/orders`, { headers: { Authorization: authHeader } })).json();
    assert.equal(saved.orders[0].emailDelivery.sent, false);
    assert.equal(saved.orders[0].emailDelivery.provider, 'brevo');
  } finally {
    await srv.close();
  }

  // Verify loadOrderAttachments omits oversized files cleanly and buildOrderEmail notes omission
  const tmpAttachDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imastik-attach-'));
  try {
    await fs.writeFile(path.join(tmpAttachDir, 'small.png'), TINY_PNG);
    await fs.writeFile(path.join(tmpAttachDir, 'big.png'), Buffer.alloc(128, 7));
    const { attached, omitted } = await loadOrderAttachments(
      [
        { field: 'photos', filename: 'small.png', originalName: 'small.png', mimeType: 'image/png' },
        { field: 'photos', filename: 'big.png', originalName: 'big.png', mimeType: 'image/png' },
      ],
      tmpAttachDir,
      80,
    );
    assert.equal(attached.length, 1);
    assert.equal(omitted.length, 1);
    assert.equal(omitted[0].name, 'big.png');

    const email = buildOrderEmail(
      {
        orderId: 'test-id',
        createdAt: '2026-11-15T12:00:00Z',
        name: 'Test',
        email: 't@example.com',
        quantity: 5,
        estimatedPriceFormatted: '€5.00',
        idea: 'Sticker',
        sharePermission: false,
        storePermission: false,
      },
      { attached, omitted },
    );
    assert.match(email.text, /big\.png \(omitted: exceeds_18mb_email_limit\)/);
  } finally {
    await fs.rm(tmpAttachDir, { recursive: true, force: true });
  }
});
