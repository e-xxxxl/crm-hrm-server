import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";
import { ROLES } from "../../utils/permissions.js";

const { Schema } = mongoose;

/**
 * A platform user. A user can belong to more than one organization; each
 * membership carries its own role, status and optional permission overrides.
 * The active organization is chosen at login (POST /auth/select-org) and baked
 * into the issued JWT — to switch org the user logs out and back in.
 */

const membershipSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    // Optional fine-grained overrides on top of the role's base permissions.
    permissionsGrant: { type: [String], default: [] },
    permissionsRevoke: { type: [String], default: [] },
    // Link to the employee record within this organization (set once onboarded).
    employee: { type: Schema.Types.ObjectId, ref: "Employee" },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true }, // sha256 of the refresh token
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { _id: true },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },

    memberships: { type: [membershipSchema], default: [] },

    status: { type: String, enum: ["active", "disabled"], default: "active" },
    mustChangePassword: { type: Boolean, default: false },

    // 2FA (TOTP) — provisioned in Phase 13, fields defined now so sessions and
    // login flow don't need a later migration.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
      recoveryCodes: { type: [String], select: false, default: [] },
    },

    sessions: { type: [sessionSchema], default: [], select: false },

    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ "memberships.organization": 1 });

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
  this.passwordChangedAt = new Date();
  this.mustChangePassword = false;
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.membershipFor = function membershipFor(orgId) {
  const id = String(orgId);
  return this.memberships.find((m) => String(m.organization?._id ?? m.organization) === id) || null;
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id;
  delete obj._id;
  delete obj.__v;
  delete obj.passwordHash;
  delete obj.sessions;
  if (obj.twoFactor) {
    delete obj.twoFactor.secret;
    delete obj.twoFactor.recoveryCodes;
  }
  return obj;
};

export const User = registerModel(hrmConnection, "User", userSchema);
export default User;
