import { z } from "zod";

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email").transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
});

export const selectOrgSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  organizationId: z.string().min(1, "organizationId is required"),
  totp: z.string().min(6).max(20).optional(),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name is required").max(120),
  email: z.string().email("Enter a valid email").transform((s) => s.toLowerCase().trim()),
  phone: z.string().max(30).optional(),
  password,
  organizationId: z.string().min(1, "organizationId is required"),
  role: z.string().min(1, "role is required"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different",
    path: ["newPassword"],
  });

export default { loginSchema, selectOrgSchema, registerSchema, changePasswordSchema };
