import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { StoredFile } from "../models/hrm/StoredFile.js";
import { UPLOAD_DIR } from "../middleware/upload.js";
import cloudinary, { cloudinaryEnabled } from "../config/cloudinary.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

function uploadBufferToCloudinary(buffer, { folder, originalName }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", filename_override: originalName, use_filename: true, unique_filename: true },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    Readable.from(buffer).pipe(stream);
  });
}

export async function saveUpload(orgId, file, { purpose = "general", userId } = {}) {
  if (!file) throw AppError.badRequest("No file provided");

  if (!cloudinaryEnabled) {
    // Should not happen once CLOUD_NAME/CLOUD_API_KEY/CLOUD_API_SECRET are
    // set — surfaced clearly rather than silently losing the upload.
    throw AppError.badRequest("File storage is not configured — ask an admin to set the Cloudinary environment variables");
  }

  const result = await uploadBufferToCloudinary(file.buffer, {
    folder: `crm-hrm/${orgId}/${purpose}`,
    originalName: file.originalname,
  });

  const doc = await StoredFile.create({
    organizationId: orgId,
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    purpose,
    uploadedBy: userId,
  });
  return doc;
}

export async function getFileForDownload(orgId, id) {
  const record = await StoredFile.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("File not found");

  if (record.url) return { record, remoteUrl: record.url };

  // Legacy local-disk record.
  const filePath = path.join(UPLOAD_DIR, record.key);
  if (!fs.existsSync(filePath)) throw AppError.notFound("File is missing from storage");
  return { record, filePath };
}

export async function deleteFile(orgId, id) {
  const record = await StoredFile.findOne({ _id: id, organizationId: orgId });
  if (!record) return;

  if (record.publicId) {
    try {
      await cloudinary.uploader.destroy(record.publicId, { resource_type: record.resourceType || "raw" });
    } catch (err) {
      logger.warn(`[cloudinary] failed to delete ${record.publicId}: ${err.message}`);
    }
  } else if (record.key) {
    const filePath = path.join(UPLOAD_DIR, record.key);
    fs.rm(filePath, { force: true }, () => {});
  }
  await record.deleteOne();
}

export default { saveUpload, getFileForDownload, deleteFile };
