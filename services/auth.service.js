import bcrypt from "bcryptjs";
import { User } from "../models/hrm/User.js";
import { Organization } from "../models/hrm/Organization.js";
import { AppError } from "../utils/AppError.js";
import { resolvePermissions } from "../utils/permissions.js";
import * as totp from "../utils/totp.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  durationToMs,
} from "../utils/jwt.js";
import { env } from "../config/env.js";

const REFRESH_MS = durationToMs(env.refreshTokenTtl);

// A valid bcrypt hash of a random string, used only to equalise failed-login timing.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO.3n1p1qkFz8sQ2wJh5Qy0m3Xk1cV1oK";

/**
 * Step 1 of login. Validates credentials only; does NOT issue a JWT. Returns the
 * organizations the user may act in so the client can either auto-continue
 * (single org) or show an org picker (multiple).
 */
export async function login(email, password) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() })
    .select("+passwordHash")
    .populate("memberships.organization", "name slug code status payrollStrategy");

  const genericFail = AppError.unauthorized("Invalid email or password");
  if (!user) {
    // Spend roughly the same time as a real bcrypt comparison so a missing
    // account isn't obviously faster to probe.
    await bcrypt.compare(String(password), DUMMY_HASH);
    throw genericFail;
  }

  const ok = await user.verifyPassword(password);
  if (!ok) throw genericFail;
  if (user.status !== "active") {
    throw AppError.forbidden("This account has been disabled. Contact your administrator.");
  }

  const organizations = user.memberships
    .filter((m) => m.status === "active" && m.organization && m.organization.status === "active")
    .map((m) => ({
      id: String(m.organization._id),
      name: m.organization.name,
      code: m.organization.code,
      strategy: m.organization.payrollStrategy,
      role: m.role,
    }));

  if (organizations.length === 0) {
    throw AppError.forbidden("Your account is not attached to any active organization.");
  }

  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    twoFactorRequired: user.twoFactor?.enabled === true,
    organizations,
  };
}

/**
 * Step 2 of login. Confirms the user belongs to the chosen org, then issues the
 * access token (with full permission context) and a refresh token bound to a
 * new server-side session.
 */
export async function selectOrg(userId, organizationId, ctx = {}) {
  const user = await User.findById(userId)
    .select("+twoFactor.secret +twoFactor.recoveryCodes +sessions")
    .populate("memberships.organization", "name slug code type status payrollStrategy logoUrl");
  if (!user || user.status !== "active") {
    throw AppError.unauthorized("Account not found or disabled");
  }

  // Second factor, when the account has one enrolled.
  if (user.twoFactor?.enabled) {
    const code = String(ctx.totp || "").trim();
    if (!code) {
      throw AppError.unauthorized("A two-factor code is required", { code: "TOTP_REQUIRED" });
    }
    const totpOk = totp.verifyToken(user.twoFactor.secret, code);
    let recoveryUsed = false;
    if (!totpOk) {
      const hash = totp.hashRecoveryCode(code);
      const idx = (user.twoFactor.recoveryCodes || []).indexOf(hash);
      if (idx === -1) throw AppError.unauthorized("Invalid two-factor code", { code: "TOTP_INVALID" });
      user.twoFactor.recoveryCodes.splice(idx, 1);
      recoveryUsed = true;
    }
    if (recoveryUsed) user.markModified("twoFactor");
  }

  const membership = user.membershipFor(organizationId);
  if (!membership || membership.status !== "active") {
    throw AppError.forbidden("You do not belong to that organization");
  }
  const org = membership.organization;
  if (!org || org.status !== "active") {
    throw AppError.forbidden("That organization is not active");
  }

  const permissions = resolvePermissions(membership.role, {
    grant: membership.permissionsGrant,
    revoke: membership.permissionsRevoke,
  });

  const claims = {
    userId: String(user._id),
    name: user.name,
    role: membership.role,
    organizationId: String(org._id),
    organizationName: org.name,
    organizationType: org.type,
    organizationLogoUrl: org.logoUrl || null,
    organizationStrategy: org.payrollStrategy,
    permissions,
  };

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken({ userId: claims.userId, organizationId: claims.organizationId });

  const now = new Date();
  user.sessions = (user.sessions || []).filter((s) => s.expiresAt > now);
  user.sessions.push({
    tokenHash: hashToken(refreshToken),
    organization: org._id,
    userAgent: ctx.userAgent || "",
    ip: ctx.ip || "",
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_MS),
  });
  user.lastLoginAt = now;
  await user.save();

  return { user, accessToken, refreshToken, claims };
}

/**
 * Switch the active organization for an already-signed-in user — used by the
 * in-app org switcher (Super Admin / Group Admin, who typically belong to
 * every org) so they don't have to log out and back in. No 2FA re-check: the
 * user already proved possession of their second factor for this session: it
 * is tied to the account, not the org.
 */
export async function switchOrg(userId, organizationId, ctx = {}) {
  const user = await User.findById(userId)
    .select("+sessions")
    .populate("memberships.organization", "name slug code type status payrollStrategy logoUrl");
  if (!user || user.status !== "active") {
    throw AppError.unauthorized("Account not found or disabled");
  }

  const membership = user.membershipFor(organizationId);
  if (!membership || membership.status !== "active") {
    throw AppError.forbidden("You do not belong to that organization");
  }
  const org = membership.organization;
  if (!org || org.status !== "active") {
    throw AppError.forbidden("That organization is not active");
  }

  const permissions = resolvePermissions(membership.role, {
    grant: membership.permissionsGrant,
    revoke: membership.permissionsRevoke,
  });

  const claims = {
    userId: String(user._id),
    name: user.name,
    role: membership.role,
    organizationId: String(org._id),
    organizationName: org.name,
    organizationType: org.type,
    organizationLogoUrl: org.logoUrl || null,
    organizationStrategy: org.payrollStrategy,
    permissions,
  };

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken({ userId: claims.userId, organizationId: claims.organizationId });

  const now = new Date();
  user.sessions = (user.sessions || []).filter((s) => s.expiresAt > now);
  user.sessions.push({
    tokenHash: hashToken(refreshToken),
    organization: org._id,
    userAgent: ctx.userAgent || "",
    ip: ctx.ip || "",
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_MS),
  });
  await user.save();

  return { user, accessToken, refreshToken, claims };
}

/**
 * Rotate a refresh token. The presented token must match a live session; that
 * session is replaced with a hash of the new token (single-use rotation).
 */
export async function refresh(refreshToken, ctx = {}) {
  if (!refreshToken) throw AppError.unauthorized("No refresh token", { code: "NO_REFRESH_COOKIE" });

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  const user = await User.findById(decoded.userId)
    .select("+sessions")
    .populate("memberships.organization", "name slug code type status payrollStrategy logoUrl");
  if (!user || user.status !== "active") throw AppError.unauthorized("Account not found");

  const presentedHash = hashToken(refreshToken);
  const session = (user.sessions || []).find((s) => s.tokenHash === presentedHash);
  if (!session) {
    // Token not recognised — could be reuse of a rotated token. Be safe: drop
    // every session for this org so a stolen token can't be replayed.
    user.sessions = (user.sessions || []).filter(
      (s) => String(s.organization) !== String(decoded.organizationId),
    );
    await user.save();
    throw AppError.unauthorized("Session no longer valid, please sign in again");
  }
  if (session.expiresAt <= new Date()) {
    user.sessions = user.sessions.filter((s) => s.tokenHash !== presentedHash);
    await user.save();
    throw AppError.unauthorized("Session expired");
  }

  const membership = user.membershipFor(decoded.organizationId);
  if (!membership || membership.status !== "active" || membership.organization?.status !== "active") {
    user.sessions = user.sessions.filter((s) => s.tokenHash !== presentedHash);
    await user.save();
    throw AppError.forbidden("Organization access revoked");
  }

  const org = membership.organization;
  const permissions = resolvePermissions(membership.role, {
    grant: membership.permissionsGrant,
    revoke: membership.permissionsRevoke,
  });
  const claims = {
    userId: String(user._id),
    name: user.name,
    role: membership.role,
    organizationId: String(org._id),
    organizationName: org.name,
    organizationType: org.type,
    organizationLogoUrl: org.logoUrl || null,
    organizationStrategy: org.payrollStrategy,
    permissions,
  };

  const accessToken = signAccessToken(claims);
  const newRefresh = signRefreshToken({ userId: claims.userId, organizationId: claims.organizationId });

  session.tokenHash = hashToken(newRefresh);
  session.lastUsedAt = new Date();
  if (ctx.userAgent) session.userAgent = ctx.userAgent;
  if (ctx.ip) session.ip = ctx.ip;
  await user.save();

  return { accessToken, refreshToken: newRefresh, claims };
}

/** Revoke the session tied to this refresh token. */
export async function logout(refreshToken) {
  if (!refreshToken) return;
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  const user = await User.findById(decoded.userId).select("+sessions");
  if (!user) return;
  const h = hashToken(refreshToken);
  user.sessions = (user.sessions || []).filter((s) => s.tokenHash !== h);
  await user.save();
}

/**
 * Create a user and attach an organization membership. Used by the registration
 * endpoint, which is gated on the `org:manage_members` permission. `actor` is
 * the authenticated caller's context (from the JWT) and constrains which org a
 * new user may be added to.
 */
export async function registerUser(input, actor) {
  const { name, email, phone, password, organizationId, role } = input;

  const isPlatformAdmin = actor.role === "Super Admin" || actor.role === "Group Admin";
  if (!isPlatformAdmin && String(organizationId) !== String(actor.organizationId)) {
    throw AppError.forbidden("You can only add users to your own organization");
  }
  if (role === "Super Admin" && actor.role !== "Super Admin") {
    throw AppError.forbidden("Only a Super Admin can create another Super Admin");
  }

  const org = await Organization.findById(organizationId);
  if (!org) throw AppError.badRequest("Unknown organization");

  const normalisedEmail = String(email).toLowerCase().trim();
  let user = await User.findOne({ email: normalisedEmail }).select("+passwordHash");

  if (user) {
    if (user.membershipFor(organizationId)) {
      throw AppError.conflict("That user is already a member of this organization");
    }
    user.memberships.push({ organization: org._id, role, status: "active" });
    await user.save();
    return user;
  }

  user = new User({ name, email: normalisedEmail, phone, memberships: [{ organization: org._id, role, status: "active", isPrimary: true }] });
  await user.setPassword(password);
  user.mustChangePassword = true;
  await user.save();
  return user;
}

/** Change the caller's own password and revoke all other sessions. */
export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select("+passwordHash +sessions");
  if (!user) throw AppError.unauthorized();
  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw AppError.badRequest("Current password is incorrect");
  await user.setPassword(newPassword);
  user.sessions = [];
  await user.save();
}

/** Revoke every session for a user (force logout everywhere). */
export async function revokeAllSessions(userId) {
  const user = await User.findById(userId).select("+sessions");
  if (!user) return;
  user.sessions = [];
  await user.save();
}

/* ------------------------------ 2FA (TOTP) ----------------------------- */

/** Step 1: generate a secret and return the provisioning URI. Not yet enabled. */
export async function begin2FASetup(userId) {
  const user = await User.findById(userId).select("email name +twoFactor.secret");
  if (!user) throw AppError.unauthorized();
  if (user.twoFactor?.enabled) throw AppError.badRequest("Two-factor is already enabled");

  const secret = totp.generateSecret();
  user.twoFactor.secret = secret;
  user.twoFactor.enabled = false;
  user.markModified("twoFactor");
  await user.save();

  return {
    secret,
    otpauthUrl: totp.otpauthURL({ secret, label: user.email }),
  };
}

/** Step 2: confirm a code from the authenticator app, then enable + issue recovery codes. */
export async function confirm2FASetup(userId, code) {
  const user = await User.findById(userId).select("+twoFactor.secret +twoFactor.recoveryCodes");
  if (!user) throw AppError.unauthorized();
  if (!user.twoFactor?.secret) throw AppError.badRequest("Start the setup first");
  if (user.twoFactor.enabled) throw AppError.badRequest("Two-factor is already enabled");
  if (!totp.verifyToken(user.twoFactor.secret, code)) {
    throw AppError.badRequest("That code is not valid — check your device clock and try again");
  }

  const { plain, hashed } = totp.generateRecoveryCodes();
  user.twoFactor.enabled = true;
  user.twoFactor.recoveryCodes = hashed;
  user.markModified("twoFactor");
  await user.save();
  return { recoveryCodes: plain };
}

/** Disable 2FA — requires the account password. */
export async function disable2FA(userId, password) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw AppError.unauthorized();
  if (!(await user.verifyPassword(password))) throw AppError.badRequest("Password is incorrect");
  user.twoFactor = { enabled: false, secret: undefined, recoveryCodes: [] };
  user.markModified("twoFactor");
  await user.save();
  return { disabled: true };
}

export async function twoFactorStatus(userId) {
  const user = await User.findById(userId).select("+twoFactor.recoveryCodes");
  return {
    enabled: user?.twoFactor?.enabled === true,
    recoveryCodesRemaining: user?.twoFactor?.recoveryCodes?.length || 0,
  };
}

/* --------------------------- session management ---------------------------- */

export async function listSessions(userId, currentRefreshToken) {
  const user = await User.findById(userId)
    .select("+sessions")
    .populate("sessions.organization", "name code");
  if (!user) throw AppError.unauthorized();
  const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;
  const now = new Date();
  return (user.sessions || [])
    .filter((s) => s.expiresAt > now)
    .map((s) => ({
      id: s._id,
      organization: s.organization ? { name: s.organization.name, code: s.organization.code } : null,
      userAgent: s.userAgent || "Unknown device",
      ip: s.ip || "",
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: currentHash != null && s.tokenHash === currentHash,
    }))
    .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));
}

export async function revokeSession(userId, sessionId) {
  const user = await User.findById(userId).select("+sessions");
  if (!user) throw AppError.unauthorized();
  const before = user.sessions.length;
  user.sessions = user.sessions.filter((s) => String(s._id) !== String(sessionId));
  if (user.sessions.length === before) throw AppError.notFound("Session not found");
  await user.save();
  return { revoked: true };
}

export default {
  login,
  selectOrg,
  switchOrg,
  refresh,
  logout,
  registerUser,
  changePassword,
  revokeAllSessions,
  begin2FASetup,
  confirm2FASetup,
  disable2FA,
  twoFactorStatus,
  listSessions,
  revokeSession,
};
