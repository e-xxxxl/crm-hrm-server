import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/AppError.js";

/**
 * verifyToken — first link in the auth chain.
 *
 * Reads the bearer access token, verifies it, and attaches the authorization
 * context to `req.auth`. Everything a handler needs to authorize a request is
 * in the token, so this never touches the database.
 */
export function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(AppError.unauthorized("Missing bearer token"));
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    return next(err); // errorHandler maps JsonWebTokenError / TokenExpiredError
  }

  req.auth = {
    userId: claims.userId,
    name: claims.name,
    role: claims.role,
    organizationId: claims.organizationId,
    organizationName: claims.organizationName,
    organizationStrategy: claims.organizationStrategy,
    permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
  };
  next();
}

/**
 * Optional variant — attaches `req.auth` when a valid token is present but does
 * not reject anonymous requests. Used by endpoints with mixed access.
 */
export function optionalToken(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      const claims = verifyAccessToken(token);
      req.auth = {
        userId: claims.userId,
        name: claims.name,
        role: claims.role,
        organizationId: claims.organizationId,
        organizationName: claims.organizationName,
        permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
      };
    } catch {
      /* ignore — treated as anonymous */
    }
  }
  next();
}

export default { verifyToken, optionalToken };
