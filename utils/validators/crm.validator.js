import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

const contactPoint = z.union([
  z.string().min(3).max(120),
  z.object({
    value: z.string().min(3).max(120),
    label: z.string().max(40).optional(),
    primary: z.boolean().optional(),
  }),
]);

const address = z.object({
  label: z.string().max(40).optional(),
  line1: z.string().max(160).optional(),
  line2: z.string().max(160).optional(),
  city: z.string().max(80).optional(),
  lga: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  landmark: z.string().max(160).optional(),
  coordinates: z.array(z.number()).length(2).optional(),
  isDefault: z.boolean().optional(),
});

const consent = z.object({
  marketingEmail: z.boolean().optional(),
  marketingSms: z.boolean().optional(),
});

export const createCustomerSchema = z.object({
  type: z.enum(["individual", "business"]).optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  businessName: z.string().max(160).optional(),
  rcNumber: z.string().max(40).optional(),
  gender: z.enum(["Male", "Female", ""]).optional(),
  dateOfBirth: z.coerce.date().optional(),
  emails: z.array(contactPoint).max(5).optional(),
  phones: z.array(contactPoint).max(5).optional(),
  addresses: z.array(address).max(5).optional(),
  source: z.string().max(60).optional(),
  segment: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  owner: objectId.optional(),
  ownerName: z.string().max(120).optional(),
  consent: consent.optional(),
  metadata: z.record(z.any()).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const customerListQuerySchema = z.object({
  status: z.enum(["active", "inactive", "blocked"]).optional(),
  type: z.enum(["individual", "business"]).optional(),
  owner: objectId.optional(),
  segment: z.string().max(60).optional(),
  tag: z.string().max(40).optional(),
  search: z.string().max(120).optional(),
  sort: z.string().max(40).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const customerSearchQuerySchema = z.object({
  q: z.string().max(120).optional(),
  term: z.string().max(120).optional(),
});

export const customerNoteSchema = z.object({ body: z.string().min(1).max(2000) });

export const customerStatusSchema = z.object({
  status: z.enum(["active", "inactive", "blocked"]),
  reason: z.string().max(300).optional(),
});

export const updateBrandSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  logoUrl: z.string().max(400).optional(),
  primaryColor: z.string().max(20).optional(),
  supportChannels: z
    .object({
      email: z.string().max(160).optional(),
      phone: z.string().max(40).optional(),
      whatsapp: z.string().max(40).optional(),
      website: z.string().max(200).optional(),
    })
    .optional(),
  settings: z
    .object({
      trackingPrefix: z.string().max(12).optional(),
      ticketPrefix: z.string().max(12).optional(),
      codEnabled: z.boolean().optional(),
      slaHours: z.coerce.number().int().min(1).max(720).optional(),
    })
    .optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export default {
  createCustomerSchema,
  updateCustomerSchema,
  customerListQuerySchema,
  customerSearchQuerySchema,
  customerNoteSchema,
  customerStatusSchema,
  updateBrandSchema,
};
