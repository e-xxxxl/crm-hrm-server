import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { saveUpload, getFileForDownload } from "../services/file.service.js";

export const upload = catchAsync(async (req, res) => {
  if (!req.file) throw AppError.badRequest("No file uploaded (field name must be 'file')");
  const record = await saveUpload(req.orgId, req.file, {
    purpose: req.body.purpose || "general",
    userId: req.auth.userId,
  });
  res.status(201).json({
    data: {
      id: record._id,
      url: `/api/hrm/files/${record._id}`,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
    },
  });
});

export const download = catchAsync(async (req, res) => {
  const { record, filePath } = await getFileForDownload(req.orgId, req.params.id);
  res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download ? "attachment" : "inline"}; filename="${encodeURIComponent(record.originalName || "file")}"`,
  );
  res.sendFile(filePath);
});

export default { upload, download };
