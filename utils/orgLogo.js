import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.join(__dirname, "..", "assets", "logos");

// Mirrors client/src/utils/orgLogo.js's DEFAULT_LOGOS mapping, kept as local
// files here (not a client-bundle URL, which is content-hashed and rebuilt
// on every deploy) so PDF generation can read the bytes straight off disk.
const DEFAULT_LOGO_FILES = {
  courier: "ajcl.png",
  logistics: "quickship.png",
  marketplace: "naijatradies.png",
};

/** Local file path for an org's default brand logo, or null if it has none (generic org type). */
export function defaultLogoPath(organizationType) {
  const file = DEFAULT_LOGO_FILES[organizationType];
  return file ? path.join(LOGOS_DIR, file) : null;
}

/**
 * Bytes for the logo an org's outgoing documents (invoices) should carry —
 * its own uploaded logo (Organization.logoUrl) takes priority, falling back
 * to the brand default for its org type. Returns null if neither exists.
 */
export async function resolveLogoBuffer(organization) {
  if (organization?.logoUrl) {
    try {
      const res = await fetch(organization.logoUrl);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      /* fall through to the default */
    }
  }
  const file = defaultLogoPath(organization?.type);
  if (!file) return null;
  const fs = await import("node:fs/promises");
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

export default { defaultLogoPath, resolveLogoBuffer };
