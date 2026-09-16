import { z } from "zod";

const PAYROLL_STRATEGIES = ["fixed-monthly", "hybrid", "allowance-based"];
const ORG_TYPES = ["marketplace", "logistics", "courier", "generic"];

const settings = z
  .object({
    timezone: z.string().optional(),
    currency: z.string().optional(),
    workweek: z.array(z.number().int().min(0).max(6)).optional(),
    standardClockIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lateGraceMinutes: z.number().int().min(0).max(240).optional(),
    standardWorkHours: z.number().min(1).max(24).optional(),
    minBranchCoverage: z.number().int().min(0).optional(),
    payDayOfMonth: z.number().int().min(1).max(31).optional(),
    probationMonths: z.number().int().min(0).max(24).optional(),
    contractAlertDays: z.array(z.number().int().positive()).optional(),
  })
  .partial();

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and hyphens only"),
  code: z.string().min(2).max(10).regex(/^[A-Za-z0-9]+$/),
  type: z.enum(ORG_TYPES).optional(),
  payrollStrategy: z.enum(PAYROLL_STRATEGIES),
  legalName: z.string().max(160).optional(),
  rcNumber: z.string().max(40).optional(),
  tin: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  website: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  state: z.string().max(60).optional(),
  lga: z.string().max(60).optional(),
  logoUrl: z.string().max(400).optional(),
  settings: settings.optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const orgStatusSchema = z.object({ status: z.enum(["active", "inactive"]) });

export default { createOrganizationSchema, updateOrganizationSchema, orgStatusSchema };
