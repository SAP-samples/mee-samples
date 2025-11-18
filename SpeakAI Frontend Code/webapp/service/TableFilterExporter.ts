import WebSocketClient from "./WebSocketClient";

/**
 * Export current filters of an sap.ui.mdc.Table on demand and send via WebSocket.
 * This uses StateUtil (if available); falls back to ConditionModel otherwise.
 */
/** Internal helper to compute current table filters snapshot (without sending). */
async function _computeCurrentFiltersSnapshot(
  table: any,
  opts?: { includeRowCount?: boolean; tableIdOverride?: string }
): Promise<{ tableId: string; filters: any[]; count: number; rowCount?: number; timestamp: string; via: string }> {
  if (!table) return { tableId: opts?.tableIdOverride || "unknown", filters: [], count: 0, timestamp: new Date().toISOString(), via: "none" };
  const tableId = opts?.tableIdOverride || table.getId();
  let external: any = {};
  let usedStateUtil = false;
  try {
    await new Promise<void>((resolve) => {
      (sap.ui.require as any)(["sap/ui/mdc/p13n/StateUtil"], async (StateUtil: any) => {
        try {
          if (StateUtil && StateUtil.retrieveExternalState) {
            external = await StateUtil.retrieveExternalState(table) || {};
            usedStateUtil = true;
          }
        } catch {/* ignore */ }
        resolve();
      });
    });
  } catch {/* ignore */ }

  const normalized: any[] = [];
  if (usedStateUtil) {
    const filterPart = external.filter || {};
    const container = filterPart.conditions || filterPart;
    Object.keys(container || {}).forEach(k => {
      const list = container[k] || [];
      list.forEach((c: any) => { if (c) normalized.push({ key: k, operator: c.operator, values: c.values }); });
    });
  } else {
    try {
      const inbuilt = table.getInbuiltFilter && table.getInbuiltFilter();
      let cm: any;
      if (inbuilt) {
        if (inbuilt.getConditionModel && typeof inbuilt.getConditionModel === "function") {
          cm = inbuilt.getConditionModel();
        } else {
          cm = inbuilt.oConditionModel || inbuilt.conditionModel || inbuilt._oConditionModel;
        }
      }
      if (cm && cm.getAllConditions) {
        const all = cm.getAllConditions();
        Object.keys(all || {}).forEach(k => {
          (all[k] || []).forEach((c: any) => normalized.push({ key: k, operator: c.operator, values: c.values }));
        });
      }
    } catch {/* ignore */ }
  }

  let rowCount: number | undefined;
  if (opts?.includeRowCount) {
    try {
      const binding = table.getBinding && (table.getBinding("items") || table.getBinding("rows"));
      if (binding && typeof binding.getLength === "function") {
        rowCount = binding.getLength();
      }
    } catch {/* ignore */ }
  }

  return {
    tableId,
    filters: normalized,
    count: normalized.length,
    rowCount,
    timestamp: new Date().toISOString(),
    via: usedStateUtil ? "StateUtil" : "ConditionModel"
  };
}

/** Export current filters and send as a dedicated frame. */
export async function sendCurrentTableFilters(
  table: any,
  wsClient: WebSocketClient,
  opts?: { includeRowCount?: boolean; tableIdOverride?: string }
): Promise<void> {
  if (!table || !wsClient) return;
  const snapshot = await _computeCurrentFiltersSnapshot(table, opts);
  wsClient.sendTableFilters(snapshot.tableId, snapshot);
}

/** Capture current filters (without sending) for given table instance. */
export async function captureCurrentTableFilters(
  table: any,
  opts?: { includeRowCount?: boolean; tableIdOverride?: string }
): Promise<{ tableId: string; filters: any[]; count: number; rowCount?: number; timestamp: string; via: string }> {
  return _computeCurrentFiltersSnapshot(table, opts);
}

/** Convenience helper to locate table by ID and send filters */
export async function sendCurrentTableFiltersById(
  tableId: string,
  wsClient: WebSocketClient,
  opts?: { includeRowCount?: boolean }
): Promise<void> {
  const table = sap.ui.getCore().byId(tableId);
  if (!table) return;
  return sendCurrentTableFilters(table, wsClient, { ...opts, tableIdOverride: tableId });
}

/** Convenience: capture snapshot by ID (no sending). */
export async function captureCurrentTableFiltersById(
  tableId: string,
  opts?: { includeRowCount?: boolean }
): Promise<{ tableId: string; filters: any[]; count: number; rowCount?: number; timestamp: string; via: string } | null> {
  const table = sap.ui.getCore().byId(tableId);
  if (!table) return null;
  return captureCurrentTableFilters(table, { ...opts, tableIdOverride: tableId });
}
