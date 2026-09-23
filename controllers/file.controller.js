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
  const { record, remoteUrl, filePath } = await getFileForDownload(req.orgId, req.params.id);

  if (remoteUrl) {
    // Cloudinary-hosted — redirect there. `fl_attachment` forces a download
    // (with the original filename) instead of an inline view.
    const url = req.query.download
      ? remoteUrl.replace("/upload/", `/upload/fl_attachment:${encodeURIComponent(record.originalName || "file")}/`)
      : remoteUrl;
    return res.redirect(302, url);
  }

  // Legacy local-disk record.
  res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download ? "attachment" : "inline"}; filename="${encodeURIComponent(record.originalName || "file")}"`,
  );
  res.sendFile(filePath);
});

export default { upload, download };
