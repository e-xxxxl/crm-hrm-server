import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const coords = z.array(z.number()).length(2);

export const createRiderSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(40),
  email: z.string().email().max(160).optional(),
  user: objectId.optional(),
  employee: objectId.optional(),
  vehicleType: z.enum(["bike", "bicycle", "car", "van", "truck", "foot"]).optional(),
  plateNumber: z.string().max(20).optional(),
  licenseNumber: z.string().max(40).optional(),
  licenseExpiry: z.coerce.date().optional(),
  assignedHub: z.string().max(80).optional(),
  zones: z.array(z.string().max(80)).max(30).optional(),
  guarantor: z
    .object({
      name: z.string().max(120).optional(),
      phone: z.string().max(40).optional(),
      address: z.string().max(300).optional(),
    })
    .optional(),
  provisionLogin: z.object({ password: z.string().min(8).max(128).optional() }).optional(),
});

export const updateRiderSchema = createRiderSchema.partial().extend({
  status: z.enum(["active", "inactive", "suspended"]).optional(),
});

export const provisionRiderLoginSchema = z.object({ password: z.string().min(8).max(128).optional() });

export const optimizeSchema = z.object({
  riderId: objectId.optional(),
  jobIds: z.array(objectId).min(1).max(50),
  start: coords.optional(),
});

export const riderLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().nonnegative().optional(),
  heading: z.coerce.number().optional(),
  speedKph: z.coerce.number().optional(),
  availability: z.enum(["available", "busy", "offline"]).optional(),
});

export const availabilitySchema = z.object({ availability: z.enum(["available", "busy", "offline"]) });

export const riderActionSchema = z.object({
  location: coords.optional(),
  at: z.enum(["pickup", "dropoff"]).optional(),
  reason: z.string().max(500).optional(),
  recipientName: z.string().max(120).optional(),
  relationship: z.string().max(60).optional(),
  otpVerified: z.boolean().optional(),
  photoUrl: z.string().max(500).optional(),
  signatureUrl: z.string().max(500).optional(),
  codCollected: z.boolean().optional(),
});

export default {
  createRiderSchema,
  updateRiderSchema,
  provisionRiderLoginSchema,
  optimizeSchema,
  riderLocationSchema,
  availabilitySchema,
  riderActionSchema,
};
