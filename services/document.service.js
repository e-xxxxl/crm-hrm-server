import mongoose from "mongoose";
import { HrDocument } from "../models/hrm/HrDocument.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../utils/query.js";
import { deleteFile } from "./file.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

export async function listDocuments(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.employee) filter.employee = query.employee;
  if (query.orgLevel === "true") filter.employee = null;
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  if (query.expiringWithinDays) {
    const n = Number(query.expiringWithinDays);
    filter.expiryDate = { $gte: new Date(), $lte: new Date(Date.now() + n * 86400000) };
  }
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), "i");

  const [items, total] = await Promise.all([
    HrDocument.find(filter)
      .sort({ expiryDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId"),
    HrDocument.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getDocument(orgId, id) {
  const doc = await HrDocument.findOne({ _id: id, organizationId: orgId }).populate(
    "employee",
    "firstName lastName employeeId",
  );
  if (!doc) throw AppError.notFound("Document not found");
  return doc;
}

export async function createDocument(orgId, actor, input) {
  if (input.employee) {
    const ok = await Employee.exists({ _id: input.employee, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown employee");
  }
  const doc = new HrDocument({ ...input, organizationId: orgId, uploadedBy: actor.userId });
  doc.refreshStatus();
  await doc.save();
  return doc;
}

export async function updateDocument(orgId, id, input) {
  const doc = await HrDocument.findOne({ _id: id, organizationId: orgId });
  if (!doc) throw AppError.notFound("Document not found");
  const fields = ["name", "description", "category", "issueDate", "expiryDate", "fileUrl", "fileName", "fileType", "fileSize"];
  for (const f of fields) if (input[f] !== undefined) doc[f] = input[f];
  if (input.expiryDate !== undefined) doc.alertsSent = [];
  doc.refreshStatus();
  await doc.save();
  return doc;
}

export async function archiveDocument(orgId, id) {
  const doc = await HrDocument.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: { status: "archived", archivedAt: new Date() } },
    { new: true },
  );
  if (!doc) throw AppError.notFound("Document not found");
  return doc;
}

export async function deleteDocument(orgId, id) {
  const doc = await HrDocument.findOne({ _id: id, organizationId: orgId });
  if (!doc) throw AppError.notFound("Document not found");
  // If the file URL is a managed upload, remove the bytes too.
  const m = /\/hrm\/files\/([a-f\d]{24})/i.exec(doc.fileUrl || "");
  if (m) await deleteFile(orgId, m[1]);
  await doc.deleteOne();
  return { ok: true };
}

export async function expirySummary(orgId) {
  const oidOrg = oid(orgId);
  const now = new Date();
  const rows = await HrDocument.aggregate([
    { $match: { organizationId: oidOrg, status: { $ne: "archived" }, expiryDate: { $ne: null } } },
    {
      $project: {
        bucket: {
          $switch: {
            branches: [
              { case: { $lt: ["$expiryDate", now] }, then: "expired" },
              { case: { $lte: ["$expiryDate", new Date(now.getTime() + 7 * 86400000)] }, then: "7" },
              { case: { $lte: ["$expiryDate", new Date(now.getTime() + 14 * 86400000)] }, then: "14" },
              { case: { $lte: ["$expiryDate", new Date(now.getTime() + 30 * 86400000)] }, then: "30" },
            ],
            default: "ok",
          },
        },
      },
    },
    { $group: { _id: "$bucket", n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const upcoming = await HrDocument.find({
    organizationId: orgId,
    status: { $ne: "archived" },
    expiryDate: { $gte: now, $lte: new Date(now.getTime() + 30 * 86400000) },
  })
    .sort({ expiryDate: 1 })
    .limit(15)
    .populate("employee", "firstName lastName employeeId")
    .select("name category expiryDate employee status");
  return {
    expired: counts.expired || 0,
    within7: counts["7"] || 0,
    within14: counts["14"] || 0,
    within30: counts["30"] || 0,
    upcoming,
  };
}

export default {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  archiveDocument,
  deleteDocument,
  expirySummary,
};
