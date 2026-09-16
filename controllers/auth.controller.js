import * as authService from "../services/auth.service.js";
import { User } from "../models/hrm/User.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from "../utils/cookies.js";

function requestContext(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  };
}

/** POST /api/auth/login — step 1: verify credentials, return org list. */
export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.json({ data: result });
});

/**
 * POST /api/auth/select-org — step 2: issue JWT for the chosen org.
 * The client calls this directly after login when the user has a single org.
 */
export const selectOrg = catchAsync(async (req, res) => {
  const { userId, organizationId, totp } = req.body;
  const { user, accessToken, refreshToken, claims } = await authService.selectOrg(
    userId,
    organizationId,
    { ...requestContext(req), totp },
  );
  setRefreshCookie(res, refreshToken);
  res.json({ data: { user, accessToken, session: claims } });
});

/** POST /api/auth/refresh — rotate the refresh token, return a new access token. */
export const refresh = catchAsync(async (req, res) => {
  const token = readRefreshCookie(req);
  const { accessToken, refreshToken, claims } = await authService.refresh(
    token,
    requestContext(req),
  );
  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken, session: claims } });
});

/** POST /api/auth/logout — revoke this session. */
export const logout = catchAsync(async (req, res) => {
  const token = readRefreshCookie(req);
  await authService.logout(token);
  clearRefreshCookie(res);
  res.json({ data: { ok: true } });
});

/** GET /api/auth/me — the caller's current context + fresh profile. */
export const me = catchAsync(async (req, res) => {
  const user = await User.findById(req.auth.userId).populate(
    "memberships.organization",
    "name code slug status",
  );
  if (!user) throw AppError.unauthorized();
  res.json({
    data: {
      user,
      session: {
        role: req.auth.role,
        organizationId: req.auth.organizationId,
        organizationName: req.auth.organizationName,
        organizationStrategy: req.auth.organizationStrategy,
        permissions: req.auth.permissions,
      },
    },
  });
});

/** POST /api/auth/register — admin-gated user creation. */
export const register = catchAsync(async (req, res) => {
  const user = await authService.registerUser(req.body, req.auth);
  res.status(201).json({ data: { user } });
});

/** POST /api/auth/change-password — caller changes own password. */
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.auth.userId, currentPassword, newPassword);
  clearRefreshCookie(res);
  res.json({ data: { ok: true } });
});

/* -------------------------------- 2FA -------------------------------- */

export const twoFactorStatus = catchAsync(async (req, res) => {
  res.json({ data: await authService.twoFactorStatus(req.auth.userId) });
});

export const setup2FA = catchAsync(async (req, res) => {
  res.json({ data: await authService.begin2FASetup(req.auth.userId) });
});

export const confirm2FA = catchAsync(async (req, res) => {
  res.json({ data: await authService.confirm2FASetup(req.auth.userId, req.body.code) });
});

export const disable2FA = catchAsync(async (req, res) => {
  res.json({ data: await authService.disable2FA(req.auth.userId, req.body.password) });
});

/* --------------------------- sessions --------------------------- */

export const sessions = catchAsync(async (req, res) => {
  res.json({ data: await authService.listSessions(req.auth.userId, readRefreshCookie(req)) });
});

export const revokeSession = catchAsync(async (req, res) => {
  res.json({ data: await authService.revokeSession(req.auth.userId, req.params.id) });
});

export const revokeAllSessions = catchAsync(async (req, res) => {
  await authService.revokeAllSessions(req.auth.userId);
  clearRefreshCookie(res);
  res.json({ data: { ok: true } });
});

export default {
  login,
  selectOrg,
  refresh,
  logout,
  me,
  register,
  changePassword,
  twoFactorStatus,
  setup2FA,
  confirm2FA,
  disable2FA,
  sessions,
  revokeSession,
  revokeAllSessions,
};
