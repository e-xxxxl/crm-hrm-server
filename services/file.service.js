import fs from "node:fs";
import path from "node:path";
import { StoredFile } from "../models/hrm/StoredFile.js";
import { UPLOAD_DIR } from "../middleware/upload.js";
import { AppError } from "../utils/AppError.js";

export async function saveUpload(orgId, file, { purpose = "general", userId } = {}) {
  if (!file) throw AppError.badRequest("No file provided");
  const doc = await StoredFile.create({
    organizationId: orgId,
    key: file.filename,
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
  const filePath = path.join(UPLOAD_DIR, record.key);
  if (!fs.existsSync(filePath)) throw AppError.notFound("File is missing from storage");
  return { record, filePath };
}

export async function deleteFile(orgId, id) {
  const record = await StoredFile.findOne({ _id: id, organizationId: orgId });
  if (!record) return;
  const filePath = path.join(UPLOAD_DIR, record.key);
  fs.rm(filePath, { force: true }, () => {});
  await record.deleteOne();
}

export default { saveUpload, getFileForDownload, deleteFile };
