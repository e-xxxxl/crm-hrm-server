import { Customer } from "../../models/crm/Customer.js";
import { Shipment, SHIPMENT_STATUSES } from "../../models/crm/Shipment.js";
import { Order } from "../../models/crm/Order.js";
import { Business } from "../../models/crm/Business.js";
import { Lead } from "../../models/crm/Lead.js";
import { Review } from "../../models/crm/Review.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AjclUser, AjclBooking } from "../../models/external/ajcl.js";
import { QuickShipUser, QuickShipShipment } from "../../models/external/quickship.js";
import { TradiesUser, TradiesProvider, TradiesJob, TradiesReview } from "../../models/external/tradies.js";
import { sourceStatus } from "../../config/externalSources.js";
import { normalizePhone } from "./customer.service.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../utils/logger.js";

/**
 * Pulls real records from each brand's own live production database (read
 * only — see config/externalSources.js) and mirrors them into this
 * platform's CRM so the existing customer/shipment/order/business UI shows
 * real data instead of what was seeded for development.
 *
 * Idempotent: every imported document carries `externalRef` ("<source>:<id>")
 * and is upserted on it, so re-running a sync updates rather than duplicates.
 * CRM-only fields (owner, tags, notes, status changes made inside this app)
 * are never overwritten by a re-sync — only the source-of-truth fields are
 * refreshed.
 */

const DEFAULT_LIMIT = 2000;

function emailPhoneFilter(email, phone) {
  const or = [];
  if (email) or.push({ "emails.value": String(email).toLowerCase().trim() });
  if (phone) or.push({ "phones.value": normalizePhone(phone) });
  return or;
}

async function upsertCustomer(tenantId, source, externalId, input) {
  const email = input.email ? String(input.email).toLowerCase().trim() : "";
  const phone = input.phone ? normalizePhone(input.phone) : "";
  const or = emailPhoneFilter(email, phone);
  if (or.length === 0) return null;

  let customer = await Customer.findOne({ tenantId, $or: or });
  if (customer) {
    let changed = false;
    if (email && !customer.emails.some((e) => e.value === email)) {
      customer.emails.push({ value: email, label: source, primary: customer.emails.length === 0 });
      changed = true;
    }
    if (phone && !customer.phones.some((p) => p.value === phone)) {
      customer.phones.push({ value: phone, label: source, primary: customer.phones.length === 0 });
      changed = true;
    }
    if (!customer.metadata?.externalId) {
      customer.metadata = { ...(customer.metadata || {}), externalSource: source, externalId: String(externalId) };
      changed = true;
    }
    if (input.state && !customer.addresses?.length) {
      customer.addresses = [{ label: "Primary", city: input.city, state: input.state, isDefault: true }];
      changed = true;
    }
    // A person who shows up again as a service provider is worth tagging even
    // on an existing (e.g. already-a-customer) record — never removed, only added.
    if (input.tags?.length) {
      const missing = input.tags.filter((t) => !customer.tags?.includes(t));
      if (missing.length) {
        customer.tags = [...(customer.tags || []), ...missing];
        changed = true;
      }
    }
    if (changed) await customer.save();
    return customer;
  }

  const customerId = await nextCode("CUS", `${tenantId}:customer`, 5);
  return Customer.create({
    tenantId,
    customerId,
    type: input.type || "individual",
    firstName: input.firstName,
    lastName: input.lastName,
    businessName: input.businessName,
    emails: email ? [{ value: email, primary: true }] : [],
    phones: phone ? [{ value: phone, primary: true }] : [],
    addresses: input.state ? [{ label: "Primary", city: input.city, state: input.state, isDefault: true }] : [],
    source,
    segment: input.segment,
    tags: input.tags || [],
    metadata: { externalSource: source, externalId: String(externalId) },
  });
}

/* ============================== AJCL ============================== */

export async function syncAjcl(tenantId, { limit = DEFAULT_LIMIT } = {}) {
  if (!AjclUser || !AjclBooking) {
    throw AppError.badRequest("AJCL_SOURCE_DB_URI is not configured");
  }
  const stats = { customers: 0, shipments: 0, errors: 0 };

  const users = await AjclUser.find({}).limit(limit).lean();
  const customerByExternalUser = new Map();
  for (const u of users) {
    try {
      const c = await upsertCustomer(tenantId, "ajcl", u._id, {
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        segment: "Customer",
        tags: ["ajcl"],
      });
      if (c) {
        customerByExternalUser.set(String(u._id), c._id);
        stats.customers += 1;
      }
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[sync:ajcl] user ${u._id}: ${err.message}`);
    }
  }

  const STATUS_MAP = {
    pending: "created",
    processing: "pickup_requested",
    in_transit: "in_transit",
    delivered: "delivered",
    cancelled: "returned",
    exception: "failed",
    draft: "created",
  };

  const bookings = await AjclBooking.find({}).limit(limit).lean();
  for (const b of bookings) {
    try {
      const externalRef = `ajcl:${b._id}`;
      const status = STATUS_MAP[b.status] || (SHIPMENT_STATUSES.includes(b.status) ? b.status : "created");
      await Shipment.findOneAndUpdate(
        { tenantId, externalRef },
        {
          $set: {
            tenantId,
            externalRef,
            trackingNumber: b.bookingReference || `AJCL-EXT-${String(b._id).slice(-8)}`,
            customer: customerByExternalUser.get(String(b.user)) || undefined,
            sender: shapeParty(b.sender, b.pickup),
            recipient: shapeParty(b.recipient, b.destination),
            description: b.package?.description,
            packageType: mapPackageType(b.package?.category),
            declaredValue: b.package?.declaredValue || 0,
            deliveryFee: b.pricing?.total || 0,
            paymentStatus: b.payment?.status === "paid" ? "paid" : b.payment?.status === "refunded" ? "waived" : "unpaid",
            status,
            deliveredAt: b.deliveredAt,
            riderName: b.assignedDriver?.name,
            riderPhone: b.assignedDriver?.phone,
          },
          $setOnInsert: {
            statusHistory: (b.statusHistory || []).map((h) => ({
              status: STATUS_MAP[h.status] || h.status,
              note: h.note,
              at: h.at || b.createdAt,
              byName: h.changedByRole,
            })),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      stats.shipments += 1;
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[sync:ajcl] booking ${b._id}: ${err.message}`);
    }
  }

  return stats;
}

function shapeParty(contact, place) {
  return {
    name: contact?.name,
    phone: contact?.phone,
    email: contact?.email,
    address: place?.formattedAddress,
    coordinates: place?.lng != null && place?.lat != null ? [place.lng, place.lat] : undefined,
  };
}

function mapPackageType(category) {
  const known = ["document", "parcel", "fragile", "perishable", "bulky"];
  return known.includes(category) ? category : "parcel";
}

/* ============================= QuickShip ============================= */

export async function syncQuickShip(tenantId, { limit = DEFAULT_LIMIT } = {}) {
  if (!QuickShipUser || !QuickShipShipment) {
    throw AppError.badRequest("QUICKSHIP_SOURCE_DB_URI is not configured");
  }
  const stats = { customers: 0, orders: 0, errors: 0 };

  const users = await QuickShipUser.find({}).limit(limit).lean();
  const customerByExternalUser = new Map();
  for (const u of users) {
    try {
      const c = await upsertCustomer(tenantId, "quickship", u._id, {
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.fullPhoneNumber || u.phoneNumber,
        segment: "Customer",
        tags: ["quickship"],
      });
      if (c) {
        customerByExternalUser.set(String(u._id), c._id);
        stats.customers += 1;
      }
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[sync:quickship] user ${u._id}: ${err.message}`);
    }
  }

  const STATUS_MAP = {
    draft: "draft",
    pending: "quoted",
    processing: "confirmed",
    in_transit: "in_transit",
    delivered: "delivered",
    cancelled: "cancelled",
    exception: "returned",
  };

  const shipments = await QuickShipShipment.find({}).limit(limit).lean();
  for (const s of shipments) {
    try {
      const externalRef = `quickship:${s._id}`;
      const orderNumber = await ensureOrderNumber(tenantId, externalRef);
      await Order.findOneAndUpdate(
        { tenantId, externalRef },
        {
          $set: {
            tenantId,
            externalRef,
            orderNumber,
            trackingNumber: s.trackingNumber || s.terminalShipmentId,
            customer: customerByExternalUser.get(String(s.user)) || undefined,
            pickup: shapeQsParty(s.sender),
            dropoff: shapeQsParty(s.receiver),
            package: {
              category: "general",
              weightKg: s.parcel?.weight || 0,
              quantity: s.parcel?.items?.length || 1,
              value: (s.parcel?.items || []).reduce((sum, i) => sum + (i.value || 0), 0),
            },
            "quote.total": s.shipping?.amount || 0,
            "quote.quotedAt": s.createdAt,
            paymentMethod: s.payment?.method || "transfer",
            paymentStatus: s.payment?.status === "paid" ? "paid" : s.payment?.status === "failed" ? "failed" : "pending",
            paidAt: s.payment?.paidAt,
            status: STATUS_MAP[s.status] || "confirmed",
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      stats.orders += 1;
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[sync:quickship] shipment ${s._id}: ${err.message}`);
    }
  }

  return stats;
}

async function ensureOrderNumber(tenantId, externalRef) {
  const existing = await Order.findOne({ tenantId, externalRef }).select("orderNumber");
  return existing?.orderNumber || nextCode("ORD", `${tenantId}:order`, 6);
}

function shapeQsParty(p) {
  return { name: p?.name, phone: p?.phone, address: p?.address, city: p?.city, state: p?.state };
}

/* ============================== 9jaTradies ============================== */

export async function syncTradies(tenantId, { limit = DEFAULT_LIMIT } = {}) {
  if (!TradiesUser || !TradiesProvider) {
    throw AppError.badRequest("TRADIES_SOURCE_DB_URI is not configured");
  }
  const stats = { customers: 0, businesses: 0, leads: 0, reviews: 0, errors: 0 };

  const users = await TradiesUser.find({}).limit(limit).lean();
  const customerByExternalUser = new Map();
  for (const u of users) {
    try {
      const [firstName, ...rest] = String(u.fullName || "").split(" ");
      const isProvider = u.accountType === "provider";
      const c = await upsertCustomer(tenantId, "tradies", u._id, {
        firstName,
        lastName: rest.join(" "),
        email: u.email,
        phone: u.phone,
        city: u.city,
        state: u.state,
        segment: isProvider ? "Service Provider" : "Customer",
        tags: isProvider ? ["9jatradies", "provider"] : ["9jatradies", "customer"],
      });
      if (c) {
        customerByExternalUser.set(String(u._id), c._id);
        stats.customers += 1;
      }
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[sync:tradies] user ${u._id}: ${err.message}`);
    }
  }

  const VERIFICATION_MAP = { approved: "approved", rejected: "rejected", pending: "pending", submitted: "pending", under_review: "pending" };

  const providers = await TradiesProvider.find({}).limit(limit).lean();
  const businessByExternalProvider = new Map();
  for (const p of providers) {
    try {
      const ownerUser = users.find((u) => String(u._id) === String(p.user));
      const externalRef = `tradies:${p._id}`;
      const businessCode = await ensureBusinessCode(tenantId, externalRef);
      const business = await Business.findOneAndUpdate(
        { tenantId, externalRef },
        {
          $set: {
            tenantId,
            externalRef,
            businessCode,
            name: p.companyName || ownerUser?.fullName || "Unnamed business",
            owner: customerByExternalUser.get(String(p.user)) || undefined,
            ownerName: ownerUser?.fullName,
            category: p.serviceType || "general",
            description: p.businessDescription || p.tagline,
            services: (p.servicesOffered || []).map((s) => s.name).filter(Boolean),
            phone: ownerUser?.phone,
            email: ownerUser?.email,
            address: p.businessAddress?.street,
            city: p.city || p.businessAddress?.city,
            state: p.state || p.businessAddress?.state,
            ninNumber: p.nin?.number,
            identityVerified: Boolean(p.nin?.verified),
            status: VERIFICATION_MAP[p.verificationStatus] || "pending",
            ratingAverage: p.rating || 0,
            ratingCount: p.totalReviews || 0,
            leadsCount: p.completedJobs || 0,
            "subscription.tier": p.subscription?.isActive ? "basic" : "free",
            "subscription.status": p.subscription?.isActive ? "active" : "none",
            "subscription.expiresAt": p.subscription?.expiresAt,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      businessByExternalProvider.set(String(p._id), business._id);
      stats.businesses += 1;
    } catch (err) {
      stats.errors += 1;
      logger.warn(`[sync:tradies] provider ${p._id}: ${err.message}`);
    }
  }

  if (TradiesJob) {
    const STAGE_MAP = { pending: "new", accepted: "contacted", "in-progress": "qualified", completed: "won", cancelled: "lost" };
    const jobs = await TradiesJob.find({}).limit(limit).lean();
    for (const j of jobs) {
      try {
        const externalRef = `tradies:${j._id}`;
        const customerUser = users.find((u) => String(u._id) === String(j.customer));
        await Lead.findOneAndUpdate(
          { tenantId, externalRef },
          {
            $set: {
              tenantId,
              externalRef,
              reference: await ensureLeadReference(tenantId, externalRef),
              customer: customerByExternalUser.get(String(j.customer)) || undefined,
              contactName: customerUser?.fullName,
              contactPhone: customerUser?.phone,
              contactEmail: customerUser?.email,
              title: j.title,
              description: j.description,
              serviceCategory: j.serviceType,
              location: j.location,
              matchedBusiness: j.provider ? findBusinessForProviderUser(providers, businessByExternalProvider, j.provider) : undefined,
              stage: STAGE_MAP[j.status] || "new",
              closedAt: j.completedAt,
              stageEnteredAt: j.updatedAt || j.createdAt,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        stats.leads += 1;
      } catch (err) {
        stats.errors += 1;
        logger.warn(`[sync:tradies] job ${j._id}: ${err.message}`);
      }
    }
  }

  if (TradiesReview) {
    const reviews = await TradiesReview.find({}).limit(limit).lean();
    for (const r of reviews) {
      try {
        const externalRef = `tradies:${r._id}`;
        const businessId = businessByExternalProvider.get(String(r.provider));
        if (!businessId) continue;
        const customerUser = users.find((u) => String(u._id) === String(r.customer));
        await Review.findOneAndUpdate(
          { tenantId, externalRef },
          {
            $set: {
              tenantId,
              externalRef,
              business: businessId,
              customer: customerByExternalUser.get(String(r.customer)) || undefined,
              reviewerName: customerUser?.fullName || "Customer",
              rating: r.rating,
              body: r.comment || "(no comment)",
              status: "published",
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        stats.reviews += 1;
      } catch (err) {
        stats.errors += 1;
        logger.warn(`[sync:tradies] review ${r._id}: ${err.message}`);
      }
    }
  }

  return stats;
}

function findBusinessForProviderUser(providers, businessByExternalProvider, providerUserId) {
  const provider = providers.find((p) => String(p.user) === String(providerUserId));
  return provider ? businessByExternalProvider.get(String(provider._id)) : undefined;
}

async function ensureBusinessCode(tenantId, externalRef) {
  const existing = await Business.findOne({ tenantId, externalRef }).select("businessCode");
  return existing?.businessCode || nextCode("BIZ", `${tenantId}:business`, 5);
}

async function ensureLeadReference(tenantId, externalRef) {
  const existing = await Lead.findOne({ tenantId, externalRef }).select("reference");
  return existing?.reference || nextCode("LEAD", `${tenantId}:lead`, 5);
}

/* ================================ status ================================ */

export function externalSourceStatus() {
  return sourceStatus();
}

export default { syncAjcl, syncQuickShip, syncTradies, externalSourceStatus };
