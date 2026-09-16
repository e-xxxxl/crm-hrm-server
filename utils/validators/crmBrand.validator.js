import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const coords = z.array(z.number()).length(2);

const party = z.object({
  name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  lga: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  landmark: z.string().max(160).optional(),
  coordinates: coords.optional(),
});

/* ---------- Shipments (AJCL) ---------- */

export const createShipmentSchema = z.object({
  customer: objectId.optional(),
  reference: z.string().max(60).optional(),
  sender: party,
  recipient: party,
  description: z.string().max(500).optional(),
  packageType: z.enum(["document", "parcel", "fragile", "perishable", "bulky"]).optional(),
  weightKg: z.coerce.number().min(0).max(1000).optional(),
  declaredValue: z.coerce.number().min(0).optional(),
  pieces: z.coerce.number().int().min(1).max(1000).optional(),
  serviceLevel: z.enum(["standard", "express", "same_day"]).optional(),
  originHub: z.string().max(80).optional(),
  destinationHub: z.string().max(80).optional(),
  deliveryFee: z.coerce.number().min(0).optional(),
  codAmount: z.coerce.number().min(0).optional(),
  paymentStatus: z.enum(["unpaid", "paid", "cod", "waived"]).optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
});

export const shipmentStatusSchema = z.object({
  status: z.enum([
    "pickup_requested", "rider_assigned", "picked_up", "at_hub", "in_transit",
    "out_for_delivery", "delivered", "failed", "rescheduled", "returned",
  ]),
  note: z.string().max(500).optional(),
  hub: z.string().max(80).optional(),
  location: coords.optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  force: z.boolean().optional(),
});

export const assignRiderSchema = z.object({
  riderId: objectId.optional(),
  riderName: z.string().max(120).optional(),
  riderPhone: z.string().max(40).optional(),
});

export const podSchema = z.object({
  recipientName: z.string().min(1).max(120),
  relationship: z.string().max(60).optional(),
  otpVerified: z.boolean().optional(),
  photoUrl: z.string().max(500).optional(),
  signatureUrl: z.string().max(500).optional(),
  coordinates: coords.optional(),
  codCollected: z.boolean().optional(),
});

/* ---------- Orders (QuickShip) ---------- */

const packageSchema = z.object({
  category: z.string().max(60).optional(),
  description: z.string().max(300).optional(),
  weightKg: z.coerce.number().min(0).max(1000).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  value: z.coerce.number().min(0).optional(),
  fragile: z.boolean().optional(),
});

export const createOrderSchema = z.object({
  customer: objectId.optional(),
  pickup: party,
  dropoff: party,
  deliveryType: z.enum(["standard", "express", "same_day", "scheduled"]).optional(),
  scheduledFor: z.coerce.date().optional(),
  package: packageSchema.optional(),
  paymentMethod: z.enum(["card", "transfer", "wallet", "cash", "cod"]).optional(),
});

export const requoteSchema = z.object({
  pickup: party.optional(),
  dropoff: party.optional(),
  package: packageSchema.optional(),
  deliveryType: z.enum(["standard", "express", "same_day", "scheduled"]).optional(),
});

export const quoteSchema = z.object({
  pickup: party,
  dropoff: party,
  weightKg: z.coerce.number().min(0).optional(),
  deliveryType: z.enum(["standard", "express", "same_day", "scheduled"]).optional(),
  value: z.coerce.number().min(0).optional(),
});

export const orderStatusSchema = z.object({
  status: z.enum(["quoted", "confirmed", "picked_up", "in_transit", "out_for_delivery", "delivered", "cancelled", "returned"]),
  note: z.string().max(400).optional(),
});

export const orderPaymentSchema = z.object({
  method: z.enum(["card", "transfer", "wallet", "cash", "cod"]).optional(),
  status: z.enum(["pending", "paid", "cod", "failed", "refunded"]),
});

/* ---------- 9jaTradies: Business / Lead / Review ---------- */

export const createBusinessSchema = z.object({
  name: z.string().min(2).max(160),
  owner: objectId.optional(),
  ownerName: z.string().max(120).optional(),
  category: z.string().min(2).max(80),
  services: z.array(z.string().max(60)).max(30).optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).optional(),
  whatsapp: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  lga: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  serviceAreas: z.array(z.string().max(80)).max(50).optional(),
  ninNumber: z.string().max(20).optional(),
  documents: z.array(z.object({ label: z.string().max(80), url: z.string().max(500) })).max(20).optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial();

export const moderateBusinessSchema = z.object({
  decision: z.enum(["approve", "reject", "suspend", "reinstate"]),
  reason: z.string().max(500).optional(),
});

export const subscriptionSchema = z.object({
  tier: z.enum(["free", "basic", "premium", "featured"]),
  months: z.coerce.number().int().min(1).max(36).optional(),
  amount: z.coerce.number().min(0).optional(),
  autoRenew: z.boolean().optional(),
});

export const createLeadSchema = z.object({
  customer: objectId.optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  contactEmail: z.string().max(160).optional(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  serviceCategory: z.string().max(80).optional(),
  location: z.string().max(160).optional(),
  state: z.string().max(80).optional(),
  source: z.string().max(60).optional(),
  owner: objectId.optional(),
  ownerName: z.string().max(120).optional(),
  estimatedValue: z.coerce.number().min(0).optional(),
});

export const leadStageSchema = z.object({
  stage: z.enum(["new", "contacted", "qualified", "quoted", "won", "lost"]),
  note: z.string().max(1000).optional(),
  quotedAmount: z.coerce.number().min(0).optional(),
  wonValue: z.coerce.number().min(0).optional(),
  lostReason: z.string().max(500).optional(),
});

export const leadActivitySchema = z.object({
  type: z.enum(["note", "call", "email", "whatsapp", "meeting", "quote"]).optional(),
  body: z.string().min(1).max(2000),
  nextFollowUpAt: z.coerce.date().optional(),
});

export const assignLeadSchema = z.object({
  matchedBusiness: objectId.nullable().optional(),
  owner: objectId.nullable().optional(),
});

export const createReviewSchema = z.object({
  business: objectId,
  customer: objectId.optional(),
  reviewerName: z.string().min(1).max(120),
  reviewerPhone: z.string().max(40).optional(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().max(160).optional(),
  body: z.string().min(3).max(3000),
  jobDate: z.coerce.date().optional(),
});

export const moderateReviewSchema = z.object({
  decision: z.enum(["publish", "reject", "flag"]),
  reason: z.string().max(500).optional(),
});

export const reviewResponseSchema = z.object({ body: z.string().min(1).max(2000) });

export default {
  createShipmentSchema,
  shipmentStatusSchema,
  assignRiderSchema,
  podSchema,
  createOrderSchema,
  requoteSchema,
  quoteSchema,
  orderStatusSchema,
  orderPaymentSchema,
  createBusinessSchema,
  updateBusinessSchema,
  moderateBusinessSchema,
  subscriptionSchema,
  createLeadSchema,
  leadStageSchema,
  leadActivitySchema,
  assignLeadSchema,
  createReviewSchema,
  moderateReviewSchema,
  reviewResponseSchema,
};
