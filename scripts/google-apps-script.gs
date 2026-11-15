/**
 * Google Apps Script web app for imastik automatic order emails.
 *
 * Deploy once inside the imastik.co@gmail.com Google account:
 * 1. Go to https://script.google.com -> New project
 * 2. Paste this file into Code.gs and save
 * 3. (Optional) Project Settings -> Script Properties -> add WEBHOOK_SECRET
 * 4. Click Deploy -> New deployment -> Web app:
 *    - Execute as: Me (imastik.co@gmail.com)
 *    - Who has access: Anyone
 * 5. Copy the Web app URL and set GMAIL_WEBHOOK_URL (and GMAIL_WEBHOOK_SECRET if used) on Render.
 */

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

    if (expectedSecret && String(payload.secret || '') !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized webhook request' });
    }

    var to = String(payload.to || Session.getActiveUser().getEmail() || 'imastik.co@gmail.com').trim();
    var subject = String(payload.subject || 'New imastik order');
    var textBody = String(payload.text || '');
    var htmlBody = String(payload.html || '');
    var replyTo = String(payload.replyTo || '').trim();

    var blobs = [];
    var rawAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    for (var i = 0; i < rawAttachments.length; i++) {
      var att = rawAttachments[i];
      if (!att || !att.base64) continue;
      var bytes = Utilities.base64Decode(att.base64);
      var mime = String(att.mimeType || 'application/octet-stream');
      var name = String(att.filename || ('attachment-' + (i + 1)));
      blobs.push(Utilities.newBlob(bytes, mime, name));
    }

    var emailOptions = {
      name: 'imastik Orders',
    };
    if (htmlBody) emailOptions.htmlBody = htmlBody;
    if (replyTo) emailOptions.replyTo = replyTo;
    if (blobs.length) emailOptions.attachments = blobs;

    GmailApp.sendEmail(to, subject, textBody, emailOptions);
    return jsonResponse({ ok: true, attachmentsCount: blobs.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String((err && err.message) || err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
