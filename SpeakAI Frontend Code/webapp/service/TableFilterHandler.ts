import WebSocketClient, { ServerMessage } from "./WebSocketClient";

/**
 * Specification of a single table filter condition coming from the backend.
 * key: PropertyInfo key (NOT the raw binding path)
 * operator: UI5 condition operator (EQ, BT, GE, LE, Contains, StartsWith, EndsWith, etc.)
 * value1 / value2: first (and optional second) values passed to the condition.
 */
export interface TableFilterSpec {
    key: string;
    operator?: string;
    value1: any;
    value2?: any;
}

/**
 * Payload container used inside a ServerMessage (type: "table").
 * mode:
 *  - replace (default): wipe all existing conditions then apply new list
 *  - merge: add on top of existing (dedupe by key+operator optional)
 *  - clear: remove all conditions
 */
export interface TableMessagePayload {
    mode?: "replace" | "merge" | "clear";
    filters?: TableFilterSpec[];
}

/** Internal helper: verify that external state has no remaining filter conditions */
async function verifyFiltersCleared(table: any, StateUtil: any): Promise<boolean> {
    try {
        const state = await StateUtil.retrieveExternalState(table) || {};
        if (!state.filter) return true; // no filter object => nothing set
        // Shape A
        if (state.filter.conditions) {
            return Object.values(state.filter.conditions).every((arr: any) => !arr || (Array.isArray(arr) && arr.length === 0));
        }
        // Shape B
        return Object.values(state.filter).every((arr: any) => !arr || (Array.isArray(arr) && arr.length === 0));
    } catch {
        return false;
    }
}

/** Robust clear: attempts Engine FullReplace, then dual-shape StateUtil application */
async function clearAllFiltersRobust(table: any): Promise<{ cleared: boolean; method?: string; errorMessages?: string[] }> {
    const errors: string[] = [];
    // Try Engine path first
    try {
        await new Promise<void>((resolve) => {
            (sap.ui.require as any)(["sap/ui/mdc/enums/ProcessingStrategy"], (ProcessingStrategy: any) => {
                try {
                    const engine = table.getEngine && table.getEngine();
                    if (engine && engine.createChanges) {
                        engine.createChanges({
                            control: table,
                            key: "Filter",
                            state: [],
                            applyAbsolute: ProcessingStrategy && ProcessingStrategy.FullReplace ? ProcessingStrategy.FullReplace : true
                        });
                        if (engine.waitForChanges) {
                            engine.waitForChanges(table).then(() => resolve()).catch(() => resolve());
                        } else {
                            resolve();
                        }
                    } else {
                        resolve();
                    }
                } catch (e) { const err = e as any; errors.push("engine:" + (err && err.message ? err.message : String(err))); resolve(); }
            });
        });
    } catch (e) { errors.push("engine-outer:" + (e as any)?.message); }
    // Verify via StateUtil
    try {
        await new Promise<void>((resolve) => {
            (sap.ui.require as any)(["sap/ui/mdc/p13n/StateUtil"], async (StateUtil: any) => {
                if (StateUtil && StateUtil.retrieveExternalState) {
                    const cleared = await verifyFiltersCleared(table, StateUtil);
                    if (cleared) {
                        console.warn("[TableFilterHandler] Clear via Engine verified empty");
                        resolve();
                        return;
                    }
                    // Need dual-shape attempts
                    let shapeAApplied = false;
                    try {
                        const current = await StateUtil.retrieveExternalState(table) || {};
                        const shapeA = { ...current, filter: { conditions: {} } };
                        const shapeB = { ...current, filter: {} };
                        const primary = (current.filter && current.filter.conditions) ? shapeA : shapeB;
                        const secondary = primary === shapeA ? shapeB : shapeA;
                        try { await StateUtil.applyExternalState(table, primary); shapeAApplied = true; } catch (e) { const err = e as any; errors.push("clear-primary:" + (err && err.message ? err.message : String(err))); }
                        let ok = await verifyFiltersCleared(table, StateUtil);
                        if (!ok) {
                            try { await StateUtil.applyExternalState(table, secondary); } catch (e) { const err2 = e as any; errors.push("clear-secondary:" + (err2 && err2.message ? err2.message : String(err2))); }
                            ok = await verifyFiltersCleared(table, StateUtil);
                        }
                        if (ok) {
                            console.warn("[TableFilterHandler] Clear via dual-shape StateUtil", { primaryApplied: shapeAApplied });
                        } else {
                            errors.push("dual-shape failed to clear");
                        }
                    } catch (e) { errors.push("dual-shape-outer:" + (e as any)?.message); }
                }
                resolve();
            });
        });
    } catch (e) { errors.push("stateutil-outer:" + (e as any)?.message); }

    // Final verification
    let finalCleared = false;
    try {
        await new Promise<void>((resolve) => {
            (sap.ui.require as any)(["sap/ui/mdc/p13n/StateUtil"], async (StateUtil: any) => {
                if (StateUtil) {
                    finalCleared = await verifyFiltersCleared(table, StateUtil);
                }
                resolve();
            });
        });
    } catch {/* ignore */}
    return { cleared: finalCleared, method: finalCleared ? "engine/stateutil" : undefined, errorMessages: errors.length ? errors : undefined };
}

/** Build a list of condition objects for a property list using UI5 Condition API if available */
function buildConditionsForSpec(specs: TableFilterSpec[], Condition: any, ConditionValidated: any, operatorTransform?: (op: string)=>string): Record<string, any[]> & { __count?: number } {
    const map: Record<string, any[]> & { __count?: number } = { __count: 0 } as any;
    (specs || []).forEach(f => {
        if (!f || !f.key || f.value1 === undefined) return;
        const opRaw = (f.operator || 'EQ').toUpperCase();
        // Synonym mapping (allow more human-friendly variants from backend)
        const synonymMap: Record<string,string> = {
            'GTE': 'GE', // >=
            'LTE': 'LE', // <=
            'NEQ': 'NE',
            'NOTEQ': 'NE'
        };
        const opSyn = synonymMap[opRaw] || opRaw;
        // Normalize operators: UI5 expects specific casing for certain textual ones
        let normalized: string;
        switch (opSyn) {
            case 'CONTAINS':
                normalized = 'Contains'; break;
            case 'STARTSWITH':
                normalized = 'StartsWith'; break;
            case 'ENDSWITH':
                normalized = 'EndsWith'; break;
            default:
                normalized = opSyn; // operators like EQ, BT, GE, LE, GT, LT, NE remain uppercase
        }
        const operator = operatorTransform ? operatorTransform(normalized) : normalized;
        // Minimal validation: warn if operator not in the typical allowed set
        const allowed = ['EQ','BT','GE','LE','GT','LT','NE','Contains','StartsWith','EndsWith','IN'];
        if (!allowed.includes(operator)) {
            try { console.warn('[TableFilterHandler] Unrecognized operator received, passing through:', operator, 'raw:', f.operator); } catch {/*noop*/}
        }
        if (operator === 'IN') {
            const list = Array.isArray(f.value1) ? f.value1 : [f.value1];
            const seen = new Set<any>();
            list.forEach(v => {
                if (seen.has(v)) return; seen.add(v);
                const cond = (Condition && Condition.createCondition)
                    ? Condition.createCondition('EQ', [v], null, null, (ConditionValidated && ConditionValidated.Validated) || null)
                    : { operator: 'EQ', values: [v], validated: 'Validated' };
                const bucket = map[f.key] || (map[f.key] = []);
                bucket.push(cond);
                (map.__count as number)++;
            });
            return;
        }
        const values = f.value2 !== undefined ? [f.value1, f.value2] : [f.value1];
        const cond = (Condition && Condition.createCondition)
            ? Condition.createCondition(operator, values, null, null, (ConditionValidated && ConditionValidated.Validated) || null)
            : { operator, values, validated: 'Validated' };
        const bucket = map[f.key] || (map[f.key] = []);
        bucket.push(cond);
        (map.__count as number)++;
    });
    return map;
}

/** Robust replace: first clear, then apply new filters ensuring no merge of stale conditions */
async function replaceAllFiltersRobust(table: any, specs: TableFilterSpec[]): Promise<{ applied: boolean; errorMessages?: string[] }> {
    const errors: string[] = [];
    // Ensure previous filters are gone (best effort)
    await clearAllFiltersRobust(table);
    const r = await applyFilterSpecsStateUtil(table, specs, 'replace');
    if (!r.applied) return { applied: false, errorMessages: r.errors };
    return { applied: true };
}

/** Generic apply for replace/merge using StateUtil (no fallback) */
function applyFilterSpecsStateUtil(table: any, specs: TableFilterSpec[], mode: 'replace' | 'merge'): Promise<{ applied: boolean; nested?: boolean; filterCount: number; errors?: string[] }> {
    const errors: string[] = [];
    return new Promise(resolve => {
        (sap.ui.require as any)([
            "sap/ui/mdc/p13n/StateUtil",
            "sap/ui/mdc/condition/Condition",
            "sap/ui/mdc/enum/ConditionValidated"
        ], async (StateUtil: any, Condition: any, ConditionValidated: any) => {
            try {
                if (!StateUtil || !StateUtil.applyExternalState) {
                    errors.push('StateUtil unavailable');
                    return resolve({ applied: false, filterCount: 0, errors });
                }
                let current: any = {};
                try { current = await StateUtil.retrieveExternalState(table) || {}; } catch {/* ignore */}
                const usesNested = !!(current.filter && current.filter.conditions);
                // Prepare base state
                const base: any = { ...current };
                if (mode === 'replace') {
                    base.filter = usesNested ? { conditions: {} } : {};
                } else { // merge
                    if (!base.filter) base.filter = usesNested ? { conditions: {} } : {};
                    if (usesNested && !base.filter.conditions) base.filter.conditions = {};
                }
                const condMap = buildConditionsForSpec(specs, Condition, ConditionValidated);
                const keys = Object.keys(condMap).filter(k => k !== '__count');
                keys.forEach(k => {
                    if (usesNested) {
                        const bucket = base.filter.conditions[k] || (base.filter.conditions[k] = []);
                        bucket.push(...condMap[k]);
                    } else {
                        const bucket = base.filter[k] || (base.filter[k] = []);
                        bucket.push(...condMap[k]);
                    }
                });
                await StateUtil.applyExternalState(table, base);
                resolve({ applied: true, nested: usesNested, filterCount: condMap.__count || 0 });
            } catch (e) {
                const err = e as any; errors.push('apply:' + (err && err.message ? err.message : String(err)));
                resolve({ applied: false, filterCount: 0, errors });
            }
        });
    });
}

/**
 * Apply table filters directly to the MDC Table's inbuilt filter ConditionModel.
 * This implements Approach 1 (no external FilterBar).
 */
export function applyFiltersToTable(table: any, payload: TableMessagePayload): void {
    if (!table || !payload) return;
    const { mode = "replace", filters = [] } = payload;
    const targetMode: string = mode;
    console.warn("[TableFilterHandler] Start applyFiltersToTable", {
        requestedMode: mode,
        effectiveMode: targetMode,
        filterCount: (filters || []).length
    });

    // Async IIFE to allow awaiting StateUtil
    (async () => {
        let lastError: any = null; // capture errors for diagnostics
        if (targetMode === 'clear') {
            const started = performance.now ? performance.now() : Date.now();
            const result = await clearAllFiltersRobust(table);
            console.warn("[TableFilterHandler] Clear result", { durationMs: (performance.now ? performance.now() : Date.now()) - started, ...result });
            if (!result.cleared) {
                console.warn("[TableFilterHandler] Clear not fully verified as empty", result);
            }
            return; // clear handled
        }
        // Ensure columns for all properties (public addItem)
        const filterKeys = (Array.isArray(filters) ? filters : []).map(f => f.key).filter(Boolean);
        const existingCols = table.getColumns ? table.getColumns() : [];
        const existingKeySet: Record<string, boolean> = {};
        existingCols.forEach((c: any) => { try { const k = c.getPropertyKey && c.getPropertyKey(); if (k) existingKeySet[k] = true; } catch (e) {/*noop*/} });

        const missing = filterKeys.filter(k => !existingKeySet[k]);
        let isMissing = missing.length;
        isMissing = 0; // Disable auto-add for now

        if (isMissing) {
            const startedAt = Date.now();
            await new Promise<void>((resolve) => {
                try {
                    (sap.ui.require as any)(["com/sap/aiagentspeaker/delegates/JSONTableDelegate"], async (Delegate: any) => {
                        if (Delegate && typeof Delegate.addItem === "function") {
                            await Promise.all(missing.map(async k => {
                                try {
                                    const col = await Delegate.addItem(table, k);
                                    if (col && table.addColumn) { table.addColumn(col); }
                                } catch (e) { /* ignore single col */ }
                            }));
                        }
                        resolve();
                    });
                } catch (e) { resolve(); }
            });
            console.warn("[TableFilterHandler] Auto-added missing columns for filter keys", { keys: missing, ms: Date.now() - startedAt });
        }

        if (targetMode === 'replace') {
            const started = performance.now ? performance.now() : Date.now();
            const replaceResult = await replaceAllFiltersRobust(table, filters);
            console.warn('[TableFilterHandler] Replace result', { durationMs: (performance.now ? performance.now() : Date.now()) - started, ...replaceResult });
            return;
        }
        if (targetMode === 'merge') {
            const started = performance.now ? performance.now() : Date.now();
            const mergeResult = await applyFilterSpecsStateUtil(table, filters, 'merge');
            console.warn('[TableFilterHandler] Merge result', { durationMs: (performance.now ? performance.now() : Date.now()) - started, ...mergeResult });
            if (!mergeResult.applied) {
                console.warn('[TableFilterHandler] Merge failed', mergeResult.errors);
            }
            return;
        }
    })();
}

/** Rebind the table or refresh its binding if rebind() API is unavailable. */
export function rebindTable(table: any): void {
    if (!table) return;
    if (typeof table.rebind === "function") {
        table.rebind();
        return;
    }
    const binding = table.getBinding && (table.getBinding("items") || table.getBinding("rows"));
    binding?.refresh?.();
}

/**
 * Wire a WebSocketClient to automatically apply incoming table messages to a table.
 * tableRef can be either a string ID (will be resolved via sap.ui.getCore().byId) or a function returning the table instance.
 */
export function wireTableMessage(
    wsClient: WebSocketClient,
    tableRef: string | (() => any),
    options?: { resolveDelayMs?: number; log?: (...args: any[]) => void }
): { detach: () => void } {
    const log = options?.log || (() => {});
    const pending: TableMessagePayload[] = [];
    const resolveDelay = options?.resolveDelayMs ?? 150;

    const resolveTable = (): any => {
        if (typeof tableRef === "function") return tableRef();
        return sap.ui.getCore().byId(tableRef);
    };

    const flush = () => {
        const table = resolveTable();
        if (!table) return;
        while (pending.length) {
            const p = pending.shift();
            if (p) applyFiltersToTable(table, p);
        }
    };

    // Automatic outbound filter sync removed per refactor request.

    const onTable = (payload?: unknown) => {
        if (!payload) return;
        const msg = payload as ServerMessage;
        if (msg.type !== "table") return;
        const data = (msg.data || {}) as TableMessagePayload;
        const table = resolveTable();
        if (!table) {
            pending.push(data);
            // Attempt periodic resolution until table exists
            setTimeout(flush, resolveDelay);
            return;
        }
        applyFiltersToTable(table, data);
    };

    wsClient.on("table", onTable);

    // Attempt a delayed flush in case messages arrive first
    setTimeout(flush, resolveDelay);

    return {
        detach: () => { wsClient.off("table", onTable); }
    };
}

/** Type guard helper */
export function isTableMessage(msg: ServerMessage): boolean {
    return msg.type === "table";
}
