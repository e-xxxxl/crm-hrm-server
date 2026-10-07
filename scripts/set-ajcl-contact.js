/**
 * One-off: set AJCL's public contact details on its organization profile. Invoice
 * and receipt PDFs/emails print whatever the organization record holds, so this
 * is what makes AJCL's documents show its email, phone and address.
 *
 *   node scripts/set-ajcl-contact.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { Organization } from "../models/hrm/Organization.js";

const CONTACT = {
  email: "info@ajcourierlogistics.com",
  phone: "+2348137598694",
  address: "120, Iju Road, opp Addide, Agege, Lagos",
};

(async () => {
  try {
    await connectDatabases();
    const org = await Organization.findOne({ code: "AJCL" });
    if (!org) throw new Error("No organization with code AJCL");
    logger.info(`before: ${JSON.stringify({ name: org.name, email: org.email, phone: org.phone, address: org.address })}`);
    Object.assign(org, CONTACT);
    await org.save();
    logger.info(`after:  ${JSON.stringify({ name: org.name, email: org.email, phone: org.phone, address: org.address })}`);
    await closeDatabases();
    process.exit(0);
  } catch (err) {
    logger.error("set-ajcl-contact failed:", err);
    await closeDatabases();
    process.exit(1);
  }
})();
