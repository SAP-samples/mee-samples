export type OutboundUserMessage = {
    message: string;
    user_id?: string;
    // Optional explicit metadata override (will be merged with auto filter metadata)
    metadata?: Record<string, any>;
};

export type MessageType = "response" | "xai" | "error" | "table" | "table_meta";

export type ServerMessage = {
    content: string;
    type: MessageType;
    user_id?: string;
    timestamp?: string;
    // Optional arbitrary payload for table messages (e.g. filters, rows, meta)
    data?: unknown;
};

// Added dedicated 'table' event which is emitted in addition to the generic 'message' event
type EventName = "open" | "close" | "error" | "message" | "table";
type Listener = (payload?: unknown) => void;

export default class WebSocketClient {
    private socket?: WebSocket;
    private readonly baseUrl: string;
    private readonly reconnectDelay = 2000;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 5;
    private pendingMessages: OutboundUserMessage[] = [];
    private listeners: Map<EventName, Set<Listener>> = new Map();
    // Last known filter snapshot (updated via sendTableFilters)
    private lastFilterMeta?: {
        tableId: string;
        filters: any[];
        count: number;
        rowCount?: number;
        timestamp?: string;
        via?: string;
    };

    constructor(baseUrl?: string) {
        // Derive default from current origin so approuter + local dev both work.
        let dynamic: string | undefined;
        try {
            if (typeof window !== "undefined" && window.location.origin) {
                dynamic = window.location.origin.replace(/^http/, 'ws') + '/api/ws';
            }
        } catch {/* ignore */}
        const supplied = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : undefined;
        let chosen = supplied || dynamic || 'ws://localhost:8000/api/ws';
        // Normalize protocol if page served via https
        try {
            if (typeof window !== 'undefined' && window.location.protocol === 'https:' && chosen.startsWith('ws://')) {
                chosen = chosen.replace(/^ws:\/\//, 'wss://');
            }
        } catch {/* ignore */}
        this.baseUrl = chosen;
    }

    connect(clientId: string): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            return;
        }

        const url = `${this.baseUrl}/${encodeURIComponent(clientId)}`;
        this.socket = new WebSocket(url);

        this.socket.addEventListener("open", () => {
            this.reconnectAttempts = 0;
            this.flushQueue();
            this.emit("open");
        });

        this.socket.addEventListener("close", (event) => {
            this.emit("close", event);
            // Auth failure codes (custom close codes from backend): 4401 unauthorized, 4403 forbidden
            if ([4401, 4403].includes(event.code)) {
                // Do not attempt reconnect; surface error
                this.reconnectAttempts = this.maxReconnectAttempts;
                this.emit("error", new Error(event.code === 4401 ? "Authentication failed" : "Forbidden (scope)"));
                return;
            }
            this.tryReconnect(clientId);
        });

        this.socket.addEventListener("error", (event) => {
            this.emit("error", event);
            this.socket?.close();
        });

        this.socket.addEventListener("message", (event) => {
            try {
                const payload = JSON.parse(event.data) as ServerMessage;
                this.emit("message", payload);
                if (payload.type === "table") {
                    this.emit("table", payload);
                }
            } catch (err) {
                this.emit("error", err);
            }
        });
    }

    disconnect(): void {
        this.reconnectAttempts = this.maxReconnectAttempts;
        this.socket?.close();
        this.socket = undefined;
    }

    send(message: OutboundUserMessage): void {
       
        const enriched = this.enrichWithMetadata(message);
        // if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        //     this.pendingMessages.push(enriched);
        //     return;
        // }
        this.socket.send(JSON.stringify(enriched));
    }

    // Send table filter metadata (does not expect server to respond). The backend accepts a 'message' field,
    // so we embed a short label plus a 'table_filters' object.
    sendTableFilters(tableId: string, payload: Record<string, unknown>): void {
        // Persist snapshot for subsequent user messages
        const snapshot = { tableId, ...(payload as any) };
        try {
            const { filters, count, rowCount, timestamp, via } = snapshot as any;
            this.lastFilterMeta = { tableId, filters: filters || [], count: count || 0, rowCount, timestamp, via };
        } catch {/* ignore */}
        const outbound: any = {
            message: "table_filters_update",
            table_filters: snapshot
        };
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.pendingMessages.push(outbound);
            return;
        }
        // We also attach metadata so the server can treat it uniformly if desired
        outbound.metadata = { tableFilters: this.lastFilterMeta };
        this.socket.send(JSON.stringify(outbound));
    }

    /** Manual override / injection in case host app wants to set filters without sending update */
    public updateFilterMetadata(meta: { tableId: string; filters: any[]; count: number; rowCount?: number; via?: string; timestamp?: string }): void {
        this.lastFilterMeta = meta;
    }

    private enrichWithMetadata(message: OutboundUserMessage): OutboundUserMessage {
        if (!this.lastFilterMeta) return message;
        const mergedMeta = {
            ...(message.metadata || {}),
            tableFilters: this.lastFilterMeta
        };
        return { ...message, metadata: mergedMeta };
    }

    on(event: EventName, handler: Listener): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
    }

    off(event: EventName, handler: Listener): void {
        this.listeners.get(event)?.delete(handler);
    }

    async fetchHistory(threadId: string, limit: number = 100): Promise<ServerMessage[]> {
        const httpBase = this.baseUrl
            .replace(/^ws/, "http")
            .replace(/^wss/, "https")
            // strip trailing /ws after /api
            .replace(/\/api\/ws$/, "/api");
        const url = `${httpBase}/history/${encodeURIComponent(threadId)}?limit=${limit}`;
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) {
            throw new Error(`History fetch failed: ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json();
        const messages = (data && (data.messages as ServerMessage[])) || [];
        return messages;
    }

    /** Fetch authenticated user info (Approuter /userinfo; requires forwardAuthToken). */
    async fetchUserInfo(): Promise<any | null> {
        const httpBase = this.baseUrl
            .replace(/^ws/, "http")
            .replace(/^wss/, "https")
            .replace(/\/api\/ws$/, "/api");
        // Standard approuter user info endpoint is /userinfo
        const url = `${httpBase}/health`; // use protected endpoint to get minimal user id if /userinfo not exposed
        try {
            const resp = await fetch(url, { credentials: "include" });
            if (!resp.ok) {
                return null;
            }
            const data = await resp.json();
            // health returns { status, active_connections, user }
            return data.user ? { user_name: data.user } : data;
        } catch {
            return null;
        }
    }

    private emit(event: EventName, payload?: unknown): void {
        this.listeners.get(event)?.forEach((handler) => handler(payload));
    }

    private flushQueue(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        while (this.pendingMessages.length > 0) {
            const item = this.pendingMessages.shift();
            if (item) {
                this.socket.send(JSON.stringify(item));
            }
        }
    }

    private tryReconnect(clientId: string): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            return;
        }
        this.reconnectAttempts += 1;
        window.setTimeout(() => this.connect(clientId), this.reconnectDelay);
    }

    // Type guards & helpers -------------------------------------------------
    static isTableMessage(msg: ServerMessage): boolean {
        return msg.type === "table";
    }
}