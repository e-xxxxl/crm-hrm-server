import path from "node:path";
import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

// Legacy: where files were written before Cloudinary was wired in. Only read
// from now, for records uploaded before this migration.
export const UPLOAD_DIR = path.resolve(env.uploadDir);

const ALLOWED = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["text/csv", ".csv"],
  ["text/plain", ".txt"],
]);

export const EXT_FOR_MIME = ALLOWED;

function fileFilter(_req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new AppError(415, `Unsupported file type: ${file.mimetype}`));
  }
  cb(null, true);
}

// In-memory buffer — the file is streamed straight to Cloudinary (see
// services/file.service.js) rather than touching local disk, which is
// ephemeral on most hosts and never survives a redeploy.
const uploadSingle = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: env.maxUploadBytes, files: 1 },
}).single("file");

/**
 * Magic-byte signatures for the binary types we accept. A file whose declared
 * mimetype doesn't match its actual content is rejected — this stops an
 * attacker renaming an executable to `.pdf`.
 */
const SIGNATURES = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4b, 0x03, 0x04]],
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0]],
  "application/vnd.ms-excel": [[0xd0, 0xcf, 0x11, 0xe0]],
};

function contentMatchesType(buf, mimetype) {
  const sigs = SIGNATURES[mimetype];
  if (!sigs) return true; // text/plain, text/csv have no reliable signature
  return sigs.some((sig) => sig.every((byte, i) => buf[i] === byte));
}

function verifyMagicBytes(req, next) {
  if (!req.file) return next();
  if (!contentMatchesType(req.file.buffer, req.file.mimetype)) {
    return next(AppError.badRequest("File content does not match its declared type", { code: "BAD_FILE_CONTENT" }));
  }
  next();
}

/** Wrap multer so its errors become AppErrors the global handler understands. */
export function upload(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(AppError.badRequest(`File exceeds the ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB limit`));
        }
        return next(AppError.badRequest(err.message));
      }
      return next(err);
    }
    verifyMagicBytes(req, next);
  });
}

export default upload;
