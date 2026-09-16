import mongoose from "mongoose";
import { Ticket } from "../../models/crm/Ticket.js";
import { Shipment } from "../../models/crm/Shipment.js";
import { Order } from "../../models/crm/Order.js";
import { Rider } from "../../models/crm/Rider.js";
import { Customer } from "../../models/crm/Customer.js";
import { Lead } from "../../models/crm/Lead.js";
import { Business } from "../../models/crm/Business.js";
import { Organization } from "../../models/hrm/Organization.js";
import { Employee } from "../../models/hrm/Employee.js";
import { getCurrentBrand } from "./brand.service.js";
import { roleRank } from "../../utils/permissions.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

function range(query) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  return { from, to };
}

/* =========================== Support report =========================== */

export async function supportReport(tenantId, query = {}) {
  const t = oid(tenantId);
  const { from, to } = range(query);
  const inRange = { $gte: from, $lte: to };

  const [opened, closedResolved, byCategory, byAgent, resolutionAgg, reopened, escalated, backlog] = await Promise.all([
    Ticket.countDocuments({ tenantId: t, createdAt: inRange }),
    Ticket.countDocuments({ tenantId: t, status: { $in: ["resolved", "closed"] }, resolvedAt: inRange }),
    Ticket.aggregate([
      { $match: { tenantId: t, createdAt: inRange } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Ticket.aggregate([
      { $match: { tenantId: t, resolvedAt: inRange, assignee: { $exists: true } } },
      {
        $group: {
          _id: { assignee: "$assignee", name: "$assigneeName" },
          resolved: { $sum: 1 },
          avgHours: { $avg: { $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 3600000] } },
        },
      },
      { $sort: { resolved: -1 } },
      { $limit: 20 },
    ]),
    Ticket.aggregate([
      { $match: { tenantId: t, resolvedAt: inRange } },
      { $group: { _id: null, avgHours: { $avg: { $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 3600000] } }, avgFirstResponse: { $avg: { $divide: [{ $subtract: ["$firstResponseAt", "$createdAt"] }, 3600000] } } } },
    ]),
    Ticket.countDocuments({ tenantId: t, reopenedCount: { $gt: 0 }, updatedAt: inRange }),
    Ticket.countDocuments({ tenantId: t, escalated: true, escalatedAt: inRange }),
    Ticket.countDocuments({ tenantId: t, status: { $in: ["open", "pending", "on_hold", "reopened"] } }),
  ]);

  const res = resolutionAgg[0] || {};
  return {
    period: { from, to },
    opened,
    closed: closedResolved,
    backlog,
    reopened,
    escalated,
    avgResolutionHours: res.avgHours != null ? Math.round(res.avgHours * 10) / 10 : null,
    avgFirstResponseHours: res.avgFirstResponse != null ? Math.round(res.avgFirstResponse * 10) / 10 : null,
    slaBreached: await Ticket.countDocuments({ tenantId: t, slaBreached: true, createdAt: inRange }),
    byCategory: byCategory.map((c) => ({ category: c._id || "general", count: c.count })),
    byAgent: byAgent.map((a) => ({ name: a._id.name || "Unknown", resolved: a.resolved, avgResolutionHours: Math.round(a.avgHours * 10) / 10 })),
  };
}

/* ========================== Logistics report ========================== */

export async function logisticsReport(tenantId, query = {}) {
  const brand = await getCurrentBrand(tenantId);
  const t = oid(tenantId);
  const { from, to } = range(query);
  const inRange = { $gte: from, $lte: to };
  const Model = brand.kind === "logistics" ? Order : Shipment;
  const deliveredField = brand.kind === "logistics" ? "deliveredAt" : "deliveredAt";
  const failStatus = brand.kind === "logistics" ? "returned" : "failed";

  const [created, delivered, failed, deliveryTimeAgg, byHub, riderPerf, codAgg] = await Promise.all([
    Model.countDocuments({ tenantId: t, createdAt: inRange }),
    Model.countDocuments({ tenantId: t, status: "delivered", [deliveredField]: inRange }),
    Model.countDocuments({ tenantId: t, status: failStatus, updatedAt: inRange }),
    Model.aggregate([
      { $match: { tenantId: t, status: "delivered", [deliveredField]: inRange } },
      { $group: { _id: null, avgHours: { $avg: { $divide: [{ $subtract: [`$${deliveredField}`, "$createdAt"] }, 3600000] } } } },
    ]),
    brand.kind === "logistics"
      ? Promise.resolve([])
      : Shipment.aggregate([
          { $match: { tenantId: t, createdAt: inRange } },
          { $group: { _id: "$destinationHub", total: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } } } },
          { $sort: { total: -1 } },
          { $limit: 15 },
        ]),
    Model.aggregate([
      { $match: { tenantId: t, rider: { $exists: true }, createdAt: inRange } },
      {
        $group: {
          _id: { rider: "$rider", name: "$riderName" },
          assigned: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", failStatus] }, 1, 0] } },
        },
      },
      { $sort: { delivered: -1 } },
      { $limit: 25 },
    ]),
    brand.kind === "logistics"
      ? Promise.resolve([])
      : Shipment.aggregate([
          { $match: { tenantId: t, codAmount: { $gt: 0 }, createdAt: inRange } },
          {
            $group: {
              _id: null,
              totalCod: { $sum: "$codAmount" },
              collected: { $sum: { $cond: ["$codCollected", "$codAmount", 0] } },
              remitted: { $sum: { $cond: [{ $gt: ["$codRemittedAt", null] }, "$codAmount", 0] } },
            },
          },
        ]),
  ]);

  const dt = deliveryTimeAgg[0] || {};
  const cod = codAgg[0] || { totalCod: 0, collected: 0, remitted: 0 };
  return {
    period: { from, to },
    brandKind: brand.kind,
    created,
    delivered,
    failed,
    successRate: delivered + failed > 0 ? Math.round((delivered / (delivered + failed)) * 100) : null,
    avgDeliveryHours: dt.avgHours != null ? Math.round(dt.avgHours * 10) / 10 : null,
    hubPerformance: byHub.map((h) => ({
      hub: h._id || "Unassigned",
      total: h.total,
      delivered: h.delivered,
      rate: h.total ? Math.round((h.delivered / h.total) * 100) : null,
    })),
    riderPerformance: riderPerf.map((r) => ({
      name: r._id.name || "Unknown",
      assigned: r.assigned,
      delivered: r.delivered,
      failed: r.failed,
      successRate: r.delivered + r.failed > 0 ? Math.round((r.delivered / (r.delivered + r.failed)) * 100) : null,
    })),
    codReconciliation: {
      total: cod.totalCod,
      collected: cod.collected,
      remitted: cod.remitted,
      inField: cod.totalCod - cod.collected,
      awaitingRemittance: cod.collected - cod.remitted,
    },
  };
}

/* =================== Group / brand executive dashboard =================== */

/**
 * Cross-brand rollup. Super Admin / Group Admin see every organization; anyone
 * else sees only the active one.
 */
export async function groupDashboard(actor) {
  const scopeAll = roleRank(actor.role) <= roleRank("Group Admin");
  const orgs = scopeAll
    ? await Organization.find({ status: "active" }).select("name code")
    : await Organization.find({ _id: actor.organizationId }).select("name code");

  const brands = [];
  let totals = { customers: 0, openTickets: 0, overdueTickets: 0, activeShipments: 0, activeOrders: 0, activeRiders: 0, outstandingCod: 0, revenue: 0, headcount: 0 };

  for (const org of orgs) {
    const t = org._id;
    const brand = await getCurrentBrand(t).catch(() => null);
    const kind = brand?.kind || "generic";

    const [customers, openTickets, overdueTickets, activeShipments, activeOrders, activeRiders, headcount, codAgg, revAgg] = await Promise.all([
      Customer.countDocuments({ tenantId: t }),
      Ticket.countDocuments({ tenantId: t, status: { $in: ["open", "pending", "on_hold", "reopened"] } }),
      Ticket.countDocuments({ tenantId: t, status: { $in: ["open", "pending", "on_hold", "reopened"] }, dueAt: { $lt: new Date() } }),
      kind === "courier" ? Shipment.countDocuments({ tenantId: t, status: { $nin: ["delivered", "returned"] } }) : Promise.resolve(0),
      kind === "logistics" ? Order.countDocuments({ tenantId: t, status: { $nin: ["delivered", "cancelled", "returned"] } }) : Promise.resolve(0),
      ["courier", "logistics"].includes(kind) ? Rider.countDocuments({ tenantId: t, status: "active" }) : Promise.resolve(0),
      Employee.countDocuments({ organizationId: t, status: "active" }),
      kind === "courier"
        ? Shipment.aggregate([{ $match: { tenantId: t, codCollected: true, codRemittedAt: { $exists: false } } }, { $group: { _id: null, v: { $sum: "$codAmount" } } }])
        : Promise.resolve([]),
      revenueForKind(kind, t),
    ]);

    const outstandingCod = codAgg[0]?.v || 0;
    const revenue = revAgg;

    brands.push({
      id: org._id,
      name: org.name,
      code: org.code,
      kind,
      customers,
      openTickets,
      overdueTickets,
      activeShipments,
      activeOrders,
      activeRiders,
      outstandingCod,
      revenue,
      headcount,
    });

    totals.customers += customers;
    totals.openTickets += openTickets;
    totals.overdueTickets += overdueTickets;
    totals.activeShipments += activeShipments;
    totals.activeOrders += activeOrders;
    totals.activeRiders += activeRiders;
    totals.outstandingCod += outstandingCod;
    totals.revenue += revenue;
    totals.headcount += headcount;
  }

  return { scope: scopeAll ? "group" : "brand", brands, totals };
}

async function revenueForKind(kind, t) {
  if (kind === "logistics") {
    const r = await Order.aggregate([{ $match: { tenantId: t, paymentStatus: "paid" } }, { $group: { _id: null, v: { $sum: "$quote.total" } } }]);
    return r[0]?.v || 0;
  }
  if (kind === "courier") {
    const r = await Shipment.aggregate([{ $match: { tenantId: t, status: "delivered" } }, { $group: { _id: null, v: { $sum: { $ifNull: ["$deliveryFee", 0] } } } }]);
    return r[0]?.v || 0;
  }
  const r = await Lead.aggregate([{ $match: { tenantId: t, stage: "won" } }, { $group: { _id: null, v: { $sum: { $ifNull: ["$wonValue", 0] } } } }]);
  return r[0]?.v || 0;
}

export default { supportReport, logisticsReport, groupDashboard };
