import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Resolve which Resend key/from-address to send as for a brand. A
 * brand-specific pair (RESEND_API_KEY_<CODE> / RESEND_FROM_EMAIL_<CODE>)
 * takes priority; the generic pair is the fallback. Nothing is hardcoded
 * beyond the three known brand codes — the actual keys are the user's to
 * add to the deployed environment.
 */
function resendConfigFor(brandCode) {
  const perBrand = {
    AJCL: { key: env.resendApiKeyAjcl, from: env.resendFromEmailAjcl },
    QSA: { key: env.resendApiKeyQsa, from: env.resendFromEmailQsa },
    NTP: { key: env.resendApiKeyNtp, from: env.resendFromEmailNtp },
  }[(brandCode || "").toUpperCase()] || {};
  return {
    key: perBrand.key || env.resendApiKey,
    from: perBrand.from || env.resendFromEmail,
  };
}

export function emailConfigured(brandCode) {
  const { key, from } = resendConfigFor(brandCode);
  return Boolean(key && from);
}

/**
 * Send a single email via Resend's HTTP API (no SDK — it's one POST).
 * `attachments` is [{ filename, content: Buffer }].
 */
export async function sendEmail(brandCode, { to, subject, html, text, attachments } = {}) {
  const { key, from } = resendConfigFor(brandCode);
  if (!key || !from) {
    throw AppError.badRequest(
      `Email sending isn't configured for ${brandCode || "this organization"} yet — set RESEND_API_KEY_${(brandCode || "").toUpperCase()} and RESEND_FROM_EMAIL_${(brandCode || "").toUpperCase()} (or the generic RESEND_API_KEY / RESEND_FROM_EMAIL) on the server.`,
    );
  }
  if (!to) throw AppError.badRequest("Recipient email is required");
  if (!subject) throw AppError.badRequest("Subject is required");

  const payload = {
    from,
    to: [to],
    subject,
    html: html || undefined,
    text: text || (html ? undefined : " "),
  };
  if (attachments?.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw AppError.badRequest(`Email failed to send (${res.status}): ${body}`.slice(0, 500));
  }
  return res.json();
}

export default { emailConfigured, sendEmail };
