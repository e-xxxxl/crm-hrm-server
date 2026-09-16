import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const UPLOAD_ROOT = path.resolve(env.uploadDir);
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (_req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) || path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new AppError(415, `Unsupported file type: ${file.mimetype}`));
  }
  cb(null, true);
}

export const uploadSingle = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.maxUploadBytes, files: 1 },
}).single("file");

/**
 * Magic-byte signatures for the binary types we accept. A file whose declared
 * mimetype doesn't match its actual content is rejected and deleted — this stops
 * an attacker renaming an executable to `.pdf`.
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
  try {
    const fd = fs.openSync(req.file.path, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (!contentMatchesType(buf, req.file.mimetype)) {
      fs.unlink(req.file.path, () => {});
      return next(AppError.badRequest("File content does not match its declared type", { code: "BAD_FILE_CONTENT" }));
    }
  } catch {
    /* couldn't read it back — treat as a disk issue, not an attack */
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

export const UPLOAD_DIR = UPLOAD_ROOT;
export default upload;
