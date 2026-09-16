/**
 * Cross-module CRM registry.
 *
 * The Customer-360 view and the global customer search need data that lives in
 * brand-specific modules (orders, shipments, tickets, payments, communications).
 * Those modules — built in later phases — register providers here at import
 * time, so Phase 7 can ship the aggregation framework without a hard dependency
 * on modules that don't exist yet.
 */

/** @type {Array<{ system: string, resolve: (tenantId: string, term: string) => Promise<Array> }>} */
const customerResolvers = [];

/** @type {Array<{ source: string, load: (tenantId: string, customerId: string, opts?: object) => Promise<Array> }>} */
const historyProviders = [];

/** @type {Array<{ event: string, handler: Function }>} */
const eventHandlers = [];

/**
 * Register a resolver that maps a free-text term (order no, tracking no, …) to
 * customer references: [{ customerId, label, matchedOn }].
 */
export function registerCustomerResolver(system, resolve) {
  customerResolvers.push({ system, resolve });
}

/**
 * Register a history provider returning timeline entries:
 * [{ type, title, description, at, status, amount, link, meta }]
 */
export function registerHistoryProvider(source, load) {
  historyProviders.push({ source, load });
}

/** Subscribe to a CRM domain event (e.g. "ticket.created"). */
export function onCrmEvent(event, handler) {
  eventHandlers.push({ event, handler });
}

/** Emit a CRM domain event to every subscriber (best-effort, non-blocking failures). */
export async function emitCrmEvent(event, payload) {
  await Promise.allSettled(
    eventHandlers.filter((h) => h.event === event).map((h) => h.handler(payload)),
  );
}

export async function resolveCustomersByTerm(tenantId, term) {
  const results = await Promise.allSettled(
    customerResolvers.map((r) => r.resolve(tenantId, term)),
  );
  return results.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
}

export async function loadCustomerHistory(tenantId, customerId, opts = {}) {
  const results = await Promise.allSettled(
    historyProviders.map((p) => p.load(tenantId, customerId, opts)),
  );
  const entries = results.flatMap((r) =>
    r.status === "fulfilled" && Array.isArray(r.value) ? r.value : [],
  );
  return entries.sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function registeredHistorySources() {
  return historyProviders.map((p) => p.source);
}

export default {
  registerCustomerResolver,
  registerHistoryProvider,
  onCrmEvent,
  emitCrmEvent,
  resolveCustomersByTerm,
  loadCustomerHistory,
  registeredHistorySources,
};
