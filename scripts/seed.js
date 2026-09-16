/**
 * Idempotent seed: creates the three organizations and a Super Admin user with a
 * membership in each. Safe to re-run — existing records are updated, not
 * duplicated.
 *
 *   SEED_ADMIN_PASSWORD=... npm run seed
 *
 * Also exported as `seed()` so the in-memory dev bootstrap can call it directly.
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { Organization } from "../models/hrm/Organization.js";
import { User } from "../models/hrm/User.js";
import { ensureBrands } from "../services/crm/brand.service.js";

export const ORG_SEED = [
  {
    name: "9jaTradiesPages",
    slug: "9jatradiespages",
    code: "NTP",
    type: "marketplace",
    payrollStrategy: "fixed-monthly",
    legalName: "9jaTradiesPages Ltd",
    state: "Lagos",
    lga: "Ikeja",
  },
  {
    name: "QuickShipAfrica",
    slug: "quickshipafrica",
    code: "QSA",
    type: "logistics",
    payrollStrategy: "hybrid",
    legalName: "QuickShip Africa Ltd",
    state: "Lagos",
    lga: "Eti-Osa",
  },
  {
    name: "AJCourierLogistics",
    slug: "ajcourierlogistics",
    code: "AJCL",
    type: "courier",
    payrollStrategy: "allowance-based",
    legalName: "AJ Courier Logistics Ltd",
    state: "Lagos",
    lga: "Surulere",
  },
];

export async function seed({ password } = {}) {
  const adminPassword =
    password ||
    env.seedAdminPassword ||
    (() => {
      const generated = crypto.randomBytes(9).toString("base64url");
      logger.warn(`SEED_ADMIN_PASSWORD not set — generated a password: ${generated}`);
      return generated;
    })();

  const orgDocs = [];
  for (const spec of ORG_SEED) {
    const org = await Organization.findOneAndUpdate(
      { code: spec.code },
      { $set: spec },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    orgDocs.push(org);
    logger.info(`org ok: ${org.name} (${org.code})`);
  }

  const email = env.seedAdminEmail.toLowerCase().trim();
  let admin = await User.findOne({ email }).select("+passwordHash");
  const memberships = orgDocs.map((o, i) => ({
    organization: o._id,
    role: "Super Admin",
    status: "active",
    isPrimary: i === 0,
  }));

  if (!admin) {
    admin = new User({ name: "Platform Administrator", email, memberships });
    await admin.setPassword(adminPassword);
    admin.mustChangePassword = true;
    await admin.save();
    logger.info(`created Super Admin: ${email}`);
  } else {
    for (const m of memberships) {
      if (!admin.membershipFor(m.organization)) admin.memberships.push(m);
    }
    if (password || env.seedAdminPassword) await admin.setPassword(adminPassword);
    await admin.save();
    logger.info(`updated Super Admin: ${email}`);
  }

  const brands = await ensureBrands();
  logger.info(`crm brands ok (${brands.created} created, ${brands.total} total)`);

  return { organizations: orgDocs, admin };
}

// Run as a CLI when invoked directly.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed.js")) {
  (async () => {
    try {
      await connectDatabases();
      await seed();
      logger.info("seed complete");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("seed failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
