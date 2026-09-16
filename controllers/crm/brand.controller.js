import * as service from "../../services/crm/brand.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";
import { hasPermission } from "../../utils/permissions.js";

export const current = catchAsync(async (req, res) => {
  res.json({ data: await service.getCurrentBrand(req.tenantId) });
});

export const list = catchAsync(async (req, res) => {
  // Group-level roles see every brand; others only their own.
  if (hasPermission(req.auth.permissions, "org:read") && req.query.all === "true") {
    return res.json({ data: await service.listBrands() });
  }
  res.json({ data: [await service.getCurrentBrand(req.tenantId)] });
});

export const update = catchAsync(async (req, res) => {
  const brand = await service.updateBrand(req.tenantId, req.body);
  await recordAudit(req, {
    action: "brand.update",
    entityType: "Brand",
    entityId: brand._id,
    entityLabel: brand.name,
    summary: `Updated brand settings for ${brand.name}`,
  });
  res.json({ data: brand });
});

export default { current, list, update };
