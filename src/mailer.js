import fsp from 'node:fs/promises';
import path from 'node:path';

// Keep raw binary attachments <= 18 MB so Base64-encoded email payloads stay below Gmail's 25 MB limit.
export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function isValidWebhookUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function getMailConfig(options = {}, env = process.env) {
  const teamEmail = String(options.teamEmail ?? env.TEAM_EMAIL ?? 'imastik.co@gmail.com').trim();
  const senderEmail = String(options.senderEmail ?? env.SENDER_EMAIL ?? '').trim();
  const senderName = sanitizeHeaderValue(options.senderName ?? env.SENDER_NAME ?? 'imastik Studio') || 'imastik Studio';
  const gmailWebhookUrl = String(options.gmailWebhookUrl ?? env.GMAIL_WEBHOOK_URL ?? '').trim();
  const gmailWebhookSecret = String(options.gmailWebhookSecret ?? env.GMAIL_WEBHOOK_SECRET ?? '').trim();
  const brevoApiKey = String(options.brevoApiKey ?? env.BREVO_API_KEY ?? '').trim();
  const resendApiKey = String(options.resendApiKey ?? env.RESEND_API_KEY ?? '').trim();

  let provider = null;
  if (isValidWebhookUrl(gmailWebhookUrl)) {
    provider = 'gmail_webhook';
  } else if (brevoApiKey) {
    provider = 'brevo';
  } else if (resendApiKey) {
    provider = 'resend';
  }

  return {
    provider,
    configured: Boolean(provider && teamEmail),
    teamEmail,
    senderEmail,
    senderName,
    gmailWebhookUrl,
    gmailWebhookSecret,
    brevoApiKey,
    resendApiKey,
  };
}

export async function loadOrderAttachments(files, orderUploadDir, maxBytes = MAX_EMAIL_ATTACHMENT_BYTES) {
  const attached = [];
  const omitted = [];
  if (!Array.isArray(files) || !files.length || !orderUploadDir) {
    return { attached, omitted };
  }

  const resolvedRoot = path.resolve(orderUploadDir) + path.sep;
  let runningBytes = 0;

  for (const entry of files) {
    const safeName = path.basename(String(entry?.filename || ''));
    if (!safeName) continue;
    const fullPath = path.resolve(orderUploadDir, safeName);
    if (!fullPath.startsWith(resolvedRoot)) continue;

    let buf;
    try {
      buf = await fsp.readFile(fullPath);
    } catch {
      omitted.push({ name: entry.originalName || safeName, reason: 'unreadable' });
      continue;
    }

    if (runningBytes + buf.length > maxBytes) {
      omitted.push({ name: entry.originalName || safeName, reason: 'exceeds_18mb_email_limit' });
      continue;
    }

    runningBytes += buf.length;
    attached.push({
      field: entry.field,
      filename: safeName,
      originalName: entry.originalName || safeName,
      mimeType: entry.mimeType || 'application/octet-stream',
      size: buf.length,
      base64: buf.toString('base64'),
    });
  }

  return { attached, omitted };
}

export function buildOrderEmail(record, { attached = [], omitted = [] } = {}) {
  const safeName = sanitizeHeaderValue(record.name);
  const safeEmail = sanitizeHeaderValue(record.email);
  const subject = `[imastik Order] ${record.quantity}x (${record.estimatedPriceFormatted}) — ${safeName}`;

  const attachmentLines = attached.map(
    (a) => `- [${a.field}] ${a.originalName} (${Math.max(1, Math.round(a.size / 1024))} KB)`,
  );
  const omittedLines = omitted.map((o) => `- ${o.name} (omitted: ${o.reason})`);

  const textLines = [
    `New imastik Sticker Request (#${record.orderId})`,
    `Received: ${record.createdAt}`,
    '',
    `Customer: ${safeName}`,
    `Customer Email: ${safeEmail}`,
    `Pack: ${record.quantity} copies (1 ${record.storeDesignId ? 'Store archive' : 'custom sticker'} design)`,
    `Estimated Total: ${record.estimatedPriceFormatted} (Revolut / bank transfer / cash after preview approval)`,
    ...(record.storeDesignId ? [`Store Design ID: #${record.storeDesignId}`] : []),
    '',
    'Customer Idea:',
    record.idea || '(No written description — see attachments)',
    '',
    `Timelapse contact permission: ${record.sharePermission ? 'YES (ask approval before sharing)' : 'No'}`,
    `Public Store permission: ${record.storePermission ? 'YES' : 'No'}`,
    '',
    `Email Attachments (${attached.length}):`,
    ...(attachmentLines.length ? attachmentLines : ['- None']),
    ...(omittedLines.length ? ['', 'Omitted Attachments (download from server /api/orders if needed):', ...omittedLines] : []),
  ];

  const htmlAttachments = attached.length
    ? `<ul>${attached
        .map(
          (a) =>
            `<li><strong>${escapeHtml(a.field)}:</strong> ${escapeHtml(a.originalName)} (${Math.max(
              1,
              Math.round(a.size / 1024),
            )} KB)</li>`,
        )
        .join('')}</ul>`
    : '<p>None</p>';

  const htmlOmitted = omitted.length
    ? `<p style="color:#a1241c;"><strong>Omitted from email:</strong> ${omitted
        .map((o) => `${escapeHtml(o.name)} (${escapeHtml(o.reason)})`)
        .join(', ')}</p>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#111;background:#fff9e9;border:2px solid #111;border-radius:14px;padding:20px;">
      <h2 style="margin:0 0 6px;color:#111;">New imastik Sticker Order</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#555;">Order ID: ${escapeHtml(record.orderId)} · ${escapeHtml(
        record.createdAt,
      )}</p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #111;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>Customer</strong></td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(
          safeName,
        )}</td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>Email</strong></td><td style="padding:8px 12px;border-bottom:1px solid #eee;"><a href="mailto:${escapeHtml(
          safeEmail,
        )}">${escapeHtml(safeEmail)}</a></td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>Pack</strong></td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(
          record.quantity,
        )} copies · <strong>${escapeHtml(record.estimatedPriceFormatted)}</strong></td></tr>
        ${
          record.storeDesignId
            ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>Store Design</strong></td><td style="padding:8px 12px;border-bottom:1px solid #eee;">#${escapeHtml(
                record.storeDesignId,
              )}</td></tr>`
            : ''
        }
        <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>Timelapse</strong></td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${
          record.sharePermission ? 'Yes — contact before sharing' : 'No'
        }</td></tr>
        <tr><td style="padding:8px 12px;"><strong>Store Listing</strong></td><td style="padding:8px 12px;">${
          record.storePermission ? 'Yes' : 'No'
        }</td></tr>
      </table>
      <h3 style="margin:18px 0 6px;">Customer Idea</h3>
      <div style="background:#fff;border:1px solid #111;border-radius:10px;padding:12px;white-space:pre-wrap;">${escapeHtml(
        record.idea || '(No written description — see attachments)',
      )}</div>
      <h3 style="margin:18px 0 6px;">Attachments (${attached.length})</h3>
      ${htmlAttachments}
      ${htmlOmitted}
    </div>
  `.trim();

  return {
    subject,
    text: textLines.join('\n'),
    html,
  };
}

async function sendViaGmailWebhook({ cfg, record, content, attached, fetchImpl }) {
  const res = await fetchImpl(cfg.gmailWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      secret: cfg.gmailWebhookSecret,
      to: cfg.teamEmail,
      replyTo: sanitizeHeaderValue(record.email),
      replyToName: sanitizeHeaderValue(record.name),
      subject: content.subject,
      text: content.text,
      html: content.html,
      orderId: record.orderId,
      createdAt: record.createdAt,
      attachments: attached.map((a) => ({
        filename: a.originalName || a.filename,
        mimeType: a.mimeType,
        base64: a.base64,
      })),
    }),
  });

  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok || parsed?.ok !== true) {
    throw new Error(parsed?.error || `Gmail webhook HTTP ${res.status} (unexpected response)`);
  }

  return { messageId: parsed?.messageId || null };
}

async function sendViaBrevo({ cfg, record, content, attached, fetchImpl }) {
  const fromEmail = cfg.senderEmail || cfg.teamEmail;
  const payload = {
    sender: { name: cfg.senderName, email: fromEmail },
    to: [{ email: cfg.teamEmail }],
    replyTo: { email: sanitizeHeaderValue(record.email), name: sanitizeHeaderValue(record.name) },
    subject: content.subject,
    textContent: content.text,
    htmlContent: content.html,
  };
  if (attached.length) {
    payload.attachment = attached.map((a) => ({
      name: a.originalName || a.filename,
      content: a.base64,
    }));
  }

  const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': cfg.brevoApiKey,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || `Brevo API HTTP ${res.status}`);
  }
  return { messageId: data?.messageId || null };
}

async function sendViaResend({ cfg, record, content, attached, fetchImpl }) {
  const explicitSender = cfg.senderEmail && !cfg.senderEmail.toLowerCase().endsWith('@gmail.com')
    ? cfg.senderEmail
    : 'onboarding@resend.dev';

  const payload = {
    from: `${cfg.senderName} <${explicitSender}>`,
    to: [cfg.teamEmail],
    reply_to: sanitizeHeaderValue(record.email),
    subject: content.subject,
    text: content.text,
    html: content.html,
  };
  if (attached.length) {
    payload.attachments = attached.map((a) => ({
      filename: a.originalName || a.filename,
      content: a.base64,
    }));
  }

  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.resendApiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || `Resend API HTTP ${res.status}`);
  }
  return { messageId: data?.id || null };
}

export function createOrderMailer(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  function resolveConfig() {
    return getMailConfig(options, process.env);
  }

  return {
    getStatus() {
      const cfg = resolveConfig();
      return {
        configured: cfg.configured,
        provider: cfg.provider,
      };
    },

    async sendOrderEmail(record, orderUploadDir) {
      const cfg = resolveConfig();
      if (!cfg.configured) {
        return {
          sent: false,
          provider: null,
          reason: 'not_configured',
          omittedAttachments: [],
        };
      }

      const { attached, omitted } = await loadOrderAttachments(record.files, orderUploadDir);
      const content = buildOrderEmail(record, { attached, omitted });

      try {
        let info;
        if (cfg.provider === 'gmail_webhook') {
          info = await sendViaGmailWebhook({ cfg, record, content, attached, fetchImpl });
        } else if (cfg.provider === 'brevo') {
          info = await sendViaBrevo({ cfg, record, content, attached, fetchImpl });
        } else {
          info = await sendViaResend({ cfg, record, content, attached, fetchImpl });
        }

        return {
          sent: true,
          provider: cfg.provider,
          messageId: info?.messageId || null,
          attachmentsSent: attached.length,
          omittedAttachments: omitted.map((o) => o.name),
        };
      } catch (err) {
        return {
          sent: false,
          provider: cfg.provider,
          error: err?.message || 'Email delivery failed.',
          omittedAttachments: omitted.map((o) => o.name),
        };
      }
    },
  };
}
