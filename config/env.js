import dotenv from "dotenv";

dotenv.config();

/**
 * Central environment configuration with validation.
 *
 * Every value the application depends on is read and checked here once at
 * boot. If a required variable is missing the process exits immediately with a
 * clear message rather than failing deep inside a request handler later.
 */

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";
// True when the SPA is served from an https origin (see cookie defaults below).
const httpsClient = (process.env.CLIENT_ORIGINS || "")
  .split(",")
  .some((o) => o.trim().toLowerCase().startsWith("https://"));

/** Read a required string variable. */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    missing.push(name);
    return "";
  }
  return value;
}

/** Read an optional string variable with a fallback. */
function optional(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** Read an integer variable with a fallback. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    invalid.push(`${name} must be an integer (got "${raw}")`);
    return fallback;
  }
  return parsed;
}

const missing = [];
const invalid = [];

export const env = {
  nodeEnv: NODE_ENV,
  isProd,
  isDev: NODE_ENV === "development",
  isTest: NODE_ENV === "test",

  port: int("PORT", 5000),

  // Two logical databases. Both can live on the same cluster; the connection
  // layer selects the database name from these URIs.
  crmDbUri: required("CRM_DB_URI"),
  hrmDbUri: required("HRM_DB_URI"),

  // Optional READ-ONLY source databases — each brand's own live production app
  // (separate Atlas clusters). When set, the CRM can sync real customers and
  // transactions in from them (services/crm/externalSync.service.js). Any one
  // left unset simply disables sync for that brand — never required to boot.
  ajclSourceDbUri: optional("AJCL_SOURCE_DB_URI", ""),
  quickshipSourceDbUri: optional("QUICKSHIP_SOURCE_DB_URI", ""),
  tradiesSourceDbUri: optional("TRADIES_SOURCE_DB_URI", ""),

  // Auth
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  accessTokenTtl: optional("ACCESS_TOKEN_TTL", "2h"),
  refreshTokenTtl: optional("REFRESH_TOKEN_TTL", "7d"),
  refreshCookieName: optional("REFRESH_COOKIE_NAME", "crmhrm_rt"),

  // CORS — comma-separated list of allowed browser origins.
  clientOrigins: optional("CLIENT_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Cookie behaviour differs between local dev (http, same site) and prod
  // (https, cross site on a different domain). The refresh cookie only works
  // cross-site as Secure + SameSite=None, so the defaults follow the real
  // deployment shape — NODE_ENV=production *or* any https client origin —
  // rather than depending on NODE_ENV alone. A host that doesn't set NODE_ENV
  // used to fall back to SameSite=Lax/insecure, which silently drops the cookie
  // on every cross-site request and signs everyone out on each page reload.
  cookieSecure: optional("COOKIE_SECURE", isProd || httpsClient ? "true" : "false") === "true",
  cookieSameSite: optional("COOKIE_SAMESITE", isProd || httpsClient ? "none" : "lax"),
  cookieDomain: optional("COOKIE_DOMAIN", ""),

  // File uploads — stored on Cloudinary (local disk doesn't survive a
  // redeploy on most hosts), falls back to local disk only if unset.
  uploadDir: optional("UPLOAD_DIR", "uploads"),
  maxUploadBytes: int("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  cloudName: optional("CLOUD_NAME", ""),
  cloudApiKey: optional("CLOUD_API_KEY", ""),
  cloudApiSecret: optional("CLOUD_API_SECRET", ""),

  // Reverse geocoding for GPS attendance. When unset the API stores raw
  // coordinates and leaves the address blank rather than failing.
  geocodeProvider: optional("GEOCODE_PROVIDER", "nominatim"),
  geocodeApiKey: optional("GEOCODE_API_KEY", ""),
  nominatimUrl: optional("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),

  // Outbound email (notifications). Optional in dev — messages are logged.
  smtpHost: optional("SMTP_HOST", ""),
  smtpPort: int("SMTP_PORT", 587),
  smtpUser: optional("SMTP_USER", ""),
  smtpPass: optional("SMTP_PASS", ""),
  mailFrom: optional("MAIL_FROM", "CRM+HRM <no-reply@localhost>"),

  // Customer-facing email (invoices/receipts, the CRM "Emails" tab) — sent via
  // Resend. Each brand can have its own sending domain/key; a request falls
  // back to the generic RESEND_API_KEY/RESEND_FROM_EMAIL when the brand-
  // specific pair isn't set. Left unset, sends are refused with a clear error
  // rather than silently failing or falling back to another brand's identity.
  resendApiKey: optional("RESEND_API_KEY", ""),
  resendFromEmail: optional("RESEND_FROM_EMAIL", ""),
  resendApiKeyAjcl: optional("RESEND_API_KEY_AJCL", ""),
  resendFromEmailAjcl: optional("RESEND_FROM_EMAIL_AJCL", ""),
  resendApiKeyQsa: optional("RESEND_API_KEY_QSA", ""),
  resendFromEmailQsa: optional("RESEND_FROM_EMAIL_QSA", ""),
  resendApiKeyNtp: optional("RESEND_API_KEY_NTP", ""),
  resendFromEmailNtp: optional("RESEND_FROM_EMAIL_NTP", ""),

  // Seed super admin (used only by scripts/seed.js)
  seedAdminEmail: optional("SEED_ADMIN_EMAIL", "admin@crmhrm.local"),
  seedAdminPassword: optional("SEED_ADMIN_PASSWORD", ""),
};

if (missing.length || invalid.length) {
  const lines = ["Environment configuration error:"];
  if (missing.length) {
    lines.push(`  Missing required variables: ${missing.join(", ")}`);
  }
  for (const problem of invalid) lines.push(`  ${problem}`);
  lines.push("  Copy server/.env.example to server/.env and fill in the values.");
  // eslint-disable-next-line no-console
  console.error(lines.join("\n"));
  process.exit(1);
}

export default env;
