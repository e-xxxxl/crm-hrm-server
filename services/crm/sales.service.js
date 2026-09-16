import mongoose from "mongoose";
import { Lead } from "../../models/crm/Lead.js";
import { Order } from "../../models/crm/Order.js";
import { Shipment } from "../../models/crm/Shipment.js";
import { getCurrentBrand } from "./brand.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Sales overview for the active brand. Pipeline comes from Leads; revenue comes
 * from whichever transactional model the brand uses (Orders for logistics,
 * Shipment delivery fees for courier, won Leads for the marketplace).
 */
export async function salesOverview(tenantId, { months = 6 } = {}) {
  const t = oid(tenantId);
  const brand = await getCurrentBrand(tenantId);
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [pipeline, leadsBySalesperson, revenueSeries, revenueTotals] = await Promise.all([
    Lead.aggregate([
      { $match: { tenantId: t } },
      { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: { $ifNull: ["$estimatedValue", 0] } } } },
    ]),
    Lead.aggregate([
      { $match: { tenantId: t } },
      {
        $group: {
          _id: { owner: "$owner", name: "$ownerName" },
          total: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ["$stage", "lost"] }, 1, 0] } },
          wonValue: { $sum: { $cond: [{ $eq: ["$stage", "won"] }, { $ifNull: ["$wonValue", 0] }, 0] } },
        },
      },
      { $sort: { wonValue: -1 } },
      { $limit: 20 },
    ]),
    revenueByMonth(brand.kind, t, since),
    revenueTotalsFor(brand.kind, t),
  ]);

  const stageOrder = ["new", "contacted", "qualified", "quoted", "won", "lost"];
  const pipelineMap = Object.fromEntries(pipeline.map((p) => [p._id, p]));
  const openValue = pipeline
    .filter((p) => !["won", "lost"].includes(p._id))
    .reduce((s, p) => s + p.value, 0);
  const won = pipelineMap.won?.count || 0;
  const lost = pipelineMap.lost?.count || 0;

  return {
    brandKind: brand.kind,
    pipeline: stageOrder.map((stage) => ({
      stage,
      count: pipelineMap[stage]?.count || 0,
      value: pipelineMap[stage]?.value || 0,
    })),
    openPipelineValue: openValue,
    conversionRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    salespeople: leadsBySalesperson.map((s) => ({
      name: s._id.name || "Unassigned",
      total: s.total,
      won: s.won,
      lost: s.lost,
      wonValue: s.wonValue,
      winRate: s.won + s.lost > 0 ? Math.round((s.won / (s.won + s.lost)) * 100) : null,
    })),
    revenueSeries,
    revenue: revenueTotals,
  };
}

async function revenueByMonth(kind, t, since) {
  if (kind === "logistics") {
    const rows = await Order.aggregate([
      { $match: { tenantId: t, paymentStatus: "paid", paidAt: { $gte: since } } },
      { $group: { _id: { y: { $year: "$paidAt" }, m: { $month: "$paidAt" } }, amount: { $sum: "$quote.total" }, count: { $sum: 1 } } },
      { $sort: { "_id.y": 1, "_id.m": 1 } },
    ]);
    return rows.map((r) => ({ period: `${r._id.y}-${String(r._id.m).padStart(2, "0")}`, amount: r.amount, count: r.count }));
  }
  if (kind === "courier") {
    const rows = await Shipment.aggregate([
      { $match: { tenantId: t, status: "delivered", deliveredAt: { $gte: since } } },
      { $group: { _id: { y: { $year: "$deliveredAt" }, m: { $month: "$deliveredAt" } }, amount: { $sum: { $ifNull: ["$deliveryFee", 0] } }, count: { $sum: 1 } } },
      { $sort: { "_id.y": 1, "_id.m": 1 } },
    ]);
    return rows.map((r) => ({ period: `${r._id.y}-${String(r._id.m).padStart(2, "0")}`, amount: r.amount, count: r.count }));
  }
  // marketplace — won leads
  const rows = await Lead.aggregate([
    { $match: { tenantId: t, stage: "won", closedAt: { $gte: since } } },
    { $group: { _id: { y: { $year: "$closedAt" }, m: { $month: "$closedAt" } }, amount: { $sum: { $ifNull: ["$wonValue", 0] } }, count: { $sum: 1 } } },
    { $sort: { "_id.y": 1, "_id.m": 1 } },
  ]);
  return rows.map((r) => ({ period: `${r._id.y}-${String(r._id.m).padStart(2, "0")}`, amount: r.amount, count: r.count }));
}

async function revenueTotalsFor(kind, t) {
  if (kind === "logistics") {
    const [paid, pending] = await Promise.all([
      Order.aggregate([{ $match: { tenantId: t, paymentStatus: "paid" } }, { $group: { _id: null, v: { $sum: "$quote.total" } } }]),
      Order.aggregate([{ $match: { tenantId: t, paymentStatus: { $in: ["pending", "cod"] } } }, { $group: { _id: null, v: { $sum: "$quote.total" } } }]),
    ]);
    return { collected: paid[0]?.v || 0, outstanding: pending[0]?.v || 0 };
  }
  if (kind === "courier") {
    const delivered = await Shipment.aggregate([
      { $match: { tenantId: t, status: "delivered" } },
      { $group: { _id: null, v: { $sum: { $ifNull: ["$deliveryFee", 0] } } } },
    ]);
    return { collected: delivered[0]?.v || 0, outstanding: 0 };
  }
  const won = await Lead.aggregate([
    { $match: { tenantId: t, stage: "won" } },
    { $group: { _id: null, v: { $sum: { $ifNull: ["$wonValue", 0] } } } },
  ]);
  return { collected: won[0]?.v || 0, outstanding: 0 };
}

export default { salesOverview };
