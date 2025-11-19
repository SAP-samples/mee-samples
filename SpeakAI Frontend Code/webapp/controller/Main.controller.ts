import MessageBox from "sap/m/MessageBox";
import BaseController from "./BaseController";
import JSONModel from "sap/ui/model/json/JSONModel";
import Input from "sap/m/Input";
import Log from "sap/base/Log";
import Component from "../Component";
import WebSocketClient, { ServerMessage } from "../service/WebSocketClient";
import { wireTableMessage } from "../service/TableFilterHandler";
import { captureCurrentTableFilters, captureCurrentTableFiltersById } from "../service/TableFilterExporter"; // capture filters snapshot for metadata
import ScrollContainer from "sap/m/ScrollContainer";
import ResizeHandler from "sap/ui/core/ResizeHandler";
import SplitterLayoutData from "sap/ui/layout/SplitterLayoutData"; // for typing only

/**
 * @namespace com.sap.aiagentspeaker.controller
 */
export default class Main extends BaseController {
  private agentModel!: JSONModel;
  private wsClient!: WebSocketClient;
  private _tableWire?: { detach: () => void };

  private _scrollElem?: HTMLElement;
  private _boundNativeScroll?: (e: Event) => void;
  private _boundResize?: () => void;
  private _resizeRegId?: string;
  private _tableWidthInitialized = false;
  private _tableWidthAttempts = 0;

  private readonly onSocketOpen = (): void => {
    this.agentModel.setProperty("/status", "connected");
    this.agentModel.setProperty("/error", null);
  };

  private readonly onSocketClose = (): void => {
    this.agentModel.setProperty("/status", "disconnected");
    this.agentModel.setProperty("/currentAction", null);
  };

  private readonly onSocketError = (error?: unknown): void => {
    const message = error instanceof Error ? error.message : this._toString(error);
    this.agentModel.setProperty("/status", "error");
    this.agentModel.setProperty("/error", message);
    Log.error("WebSocket error", this._toString(error));
  };

  private readonly onSocketMessage = (payload?: unknown): void => {
    if (!payload) {
      return;
    }
    const message = payload as ServerMessage;

    // Ignore table messages in chat log (handled separately)
    if (message.type === "table") {
      return;
    }

    if (message.type === "xai") {
      const action = (message.content ?? "").trim() || null;
      this.agentModel.setProperty("/currentAction", action);
      return;
    }

    this.agentModel.setProperty("/currentAction", null);

    if (message.type === "response") {
      this.agentModel.setProperty("/status", "connected");
    }

    if (!message.content) {
      return;
    }

    const currentMessages = (this.agentModel.getProperty("/messages") as ChatMessage[]) ?? [];
    const entry: ChatMessage = {
      id: this._uuid(),
      role: message.type === "response" ? "agent" : "error",
      type: message.type,
      content: message.content,
      timestamp: message.timestamp ?? new Date().toISOString()
    };

    this.agentModel.setProperty("/messages", [...currentMessages, entry]);

    // Update scroll button visibility after new message (post-render)
    setTimeout(() => this._updateScrollToBottomVisibility(), 0);
    this._updateSplashVisibility();

    if (message.type === "error") {
      this.agentModel.setProperty("/status", "error");
      this.agentModel.setProperty("/error", message.content);
    }
  };

  public onInit(): void {
    const component = this.getOwnerComponent() as Component;
    this.agentModel = component.getModel("agent") as JSONModel;
    this.wsClient = component.getWebSocketClient();

    this.wsClient.on("open", this.onSocketOpen);
    this.wsClient.on("close", this.onSocketClose);
    this.wsClient.on("error", this.onSocketError);
    this.wsClient.on("message", this.onSocketMessage);
    // Wire table filter application (Approach 1 via utility)
    this._tableWire = wireTableMessage(this.wsClient, () => {
      const innerView: any = this.byId("tablePropInfosView");
      return innerView?.byId ? innerView.byId("speakersTable") : undefined;
    });

    const clientId = this.agentModel.getProperty("/clientId") as string;
    this.agentModel.setProperty("/status", "connecting");
    this.wsClient.connect(clientId);

    // Quick test: fetch history for thread "demo" and log result
    // this.wsClient
    //     .fetchHistory("demo")
    //     .then((messages) => {
    //         console.log("fetchHistory('demo') returned", messages);
    //     })
    //     .catch((err) => {
    //         console.error("fetchHistory('demo') error", err);
    //     });

    // Initial visibility check (post initial render)
    setTimeout(() => this._updateScrollToBottomVisibility(), 0);
    this._updateSplashVisibility();

    // Attach semantic enrichment AFTER table subview is loaded
    const semanticDebug = /[?&]semanticDebug=true/i.test(location.search) || (window as any).__SEMANTIC_DEBUG__;
    const log = (...a: any[]) => {
      if (semanticDebug) {
        // eslint-disable-next-line no-console
        console.log("[SemanticAttach]", ...a);
      }
    };
    const warn = (...a: any[]) => {
      if (semanticDebug) {
        // eslint-disable-next-line no-console
        console.warn("[SemanticAttach]", ...a);
      }
    };

    let attempts = 0;
    const maxAttempts = 40; // ~4s with 100ms interval

    const tryAttach = () => {
      attempts++;
      try {
        const innerView: any = this.byId("tablePropInfosView");
        const table = innerView?.byId ? innerView.byId("speakersTable") : undefined;
        if (!table) {
          if (attempts < maxAttempts) {
            if (attempts % 5 === 0) {
              log("Waiting for table... attempt", attempts);
            }
            setTimeout(tryAttach, 100);
          } else {
            warn("Table not found after attempts", attempts);
          }
          return;
        }
        log("Table resolved id=", table.getId());
        // Semantic enrichment feature removed (previously attached expansion-based filters).
      } catch (e) {
        warn("Unexpected error while resolving table", e);
      }
    };
    setTimeout(tryAttach, 0);
  }

  public onBeforeRendering(): void {
    // detach listeners before DOM re-renders
    this._teardownScrollBinding();
  }

  public onAfterRendering(): void {
    // Ensure correct state after render and bind native scroll listener
    this._ensureScrollBinding();
    this._updateScrollToBottomVisibility();
    this._adjustChatLayout();
    this._registerChatResize();
    this._initTablePaneWidth();
  }

  public onExit(): void {
    if (!this.wsClient) {
      return;
    }
    this.wsClient.off("open", this.onSocketOpen);
    this.wsClient.off("close", this.onSocketClose);
    this.wsClient.off("error", this.onSocketError);
    this.wsClient.off("message", this.onSocketMessage);
    this._tableWire?.detach();
    this.wsClient.disconnect();
    this._teardownScrollBinding();
    this._deregisterChatResize();
  }

  /**
   * Send a user message enriched with current table filters metadata (snapshot at send time).
   */
  public async onSendMessage(): Promise<void> {
    const input = this.byId("messageInput") as Input;
    if (!input) return;

    // Block sending if not connected or last message is from user
    const status = this.agentModel.getProperty("/status") as string;
    const msgs = (this.agentModel.getProperty("/messages") as ChatMessage[]) ?? [];
    const lastIsUser = msgs.length > 0 && msgs[msgs.length - 1]?.role === "user";
    if (status !== "connected" || lastIsUser) {
      return;
    }

    const value = input.getValue().trim();
    if (!value) {
      return;
    }

    const messages = (this.agentModel.getProperty("/messages") as ChatMessage[]) ?? [];
    const outbound: ChatMessage = {
      id: this._uuid(),
      role: "user",
      type: "user",
      content: value,
      timestamp: new Date().toISOString()
    };
    this.agentModel.setProperty("/messages", [...messages, outbound]);
    this.agentModel.setProperty("/currentAction", null);

    const clientId = this.agentModel.getProperty("/clientId") as string;

    // Capture latest filters (non-blocking if table not found)
    let tableFiltersMeta: any | null = null;
    try {
      // Prefer direct instance resolution (local ID inside nested view) instead of global core lookup.
      const innerView: any = this.byId("tablePropInfosView");
      const table = innerView?.byId ? innerView.byId("speakersTable") : undefined;
      if (table) {
        tableFiltersMeta = await captureCurrentTableFilters(table, { includeRowCount: true, tableIdOverride: table.getId() });
      } else {
        // Fallback: attempt global ID (may fail if view prefixes ID)
        tableFiltersMeta = await captureCurrentTableFiltersById("speakersTable", { includeRowCount: true });
      }
      if (!tableFiltersMeta || tableFiltersMeta.filters.length === 0) {
        console.debug("Table filters snapshot empty or null at send time", tableFiltersMeta);
      } else {
        console.debug("Captured table filters snapshot", tableFiltersMeta);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.debug("Capture table filters failed: " + msg);
    }

    this.wsClient.send({
      message: value,
      user_id: clientId,
      metadata: tableFiltersMeta ? { tableFilters: tableFiltersMeta } : undefined
    });

    input.setValue("");

    // Re-evaluate after DOM updates
    setTimeout(() => this._updateScrollToBottomVisibility(), 0);
    this._updateSplashVisibility();
  }

  public onChatScroll(): void {
    this._updateScrollToBottomVisibility();
  }

  public onToggleSidebar(oEvent: any): void {
    const pressed =
      typeof oEvent?.getParameter === "function"
        ? !!oEvent.getParameter("pressed")
        : !!(oEvent?.getSource && typeof oEvent.getSource?.().getPressed === "function" && oEvent.getSource().getPressed());
    const ui = (this.getOwnerComponent() as Component).getModel("ui") as JSONModel;
    ui.setProperty("/sidebarOpen", pressed);
  }

  public onScrollToBottom(): void {
    const sc = this._getScrollContainer();
    const el = this._getScrollElement();
    if (sc) {
      const del = this._getScrollDelegate(sc);
      const maxTopDelegate = del && typeof del.getMaxScrollTop === "function" ? del.getMaxScrollTop() : undefined;
      const maxTopDom = el ? el.scrollHeight - el.clientHeight : undefined;
      const target = typeof maxTopDelegate === "number" ? maxTopDelegate : typeof maxTopDom === "number" ? maxTopDom : Number.MAX_SAFE_INTEGER;
      sc.scrollTo(0, target, 300);
    }
    const ui = (this.getOwnerComponent() as Component).getModel("ui") as JSONModel;
    ui.setProperty("/showScrollToBottom", false);
  }

  // Helpers
  private _getScrollContainer(): ScrollContainer {
    return this.byId("chatScroll") as ScrollContainer;
  }

  private _getScrollDelegate(sc: ScrollContainer): any {
    return (sc as any).getScrollDelegate ? (sc as any).getScrollDelegate() : (sc as any)._oScroller;
  }

  // Find the native scrolling element inside the ScrollContainer
  private _getScrollElement(): HTMLElement | null {
    const sc = this._getScrollContainer();
    const dom = sc?.getDomRef() as HTMLElement | null;
    if (!dom) return null;
    // Prefer the outer scroll wrapper
    const outer = dom.querySelector(".sapMScrollCont") as HTMLElement | null;
    if (outer) return outer;
    // Fallbacks
    const inner = dom.querySelector(".sapMScrollContScroll") as HTMLElement | null;
    return inner || dom;
  }

  private _isAtBottom(sc?: ScrollContainer): boolean {
    const cont = sc || this._getScrollContainer();
    if (!cont) return true;

    const del = this._getScrollDelegate(cont);
    if (del && typeof del.getScrollTop === "function" && typeof del.getMaxScrollTop === "function") {
      const top = del.getScrollTop();
      const maxTop = del.getMaxScrollTop();
      const threshold = 8;
      return maxTop - top <= threshold;
    }

    // DOM fallback
    const el = this._getScrollElement();
    if (!el) return true;
    const threshold = 8;
    return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold;
  }

  private _updateScrollToBottomVisibility(): void {
    const sc = this._getScrollContainer();
    const ui = (this.getOwnerComponent() as Component).getModel("ui") as JSONModel;
    ui.setProperty("/showScrollToBottom", !this._isAtBottom(sc));
  }

  // Show splash until the first real user message is present in the conversation
  private _updateSplashVisibility(): void {
    const component = this.getOwnerComponent() as Component;
    const ui = component.getModel("ui") as JSONModel;
    const messages = (this.agentModel.getProperty("/messages") as ChatMessage[]) ?? [];
    const hasUser = messages.some((m) => m.role === "user");
    ui.setProperty("/showSplash", !hasUser);
  }

  // Bind native scroll and window resize to keep visibility in sync even if ScrollContainer event doesn't fire
  private _ensureScrollBinding(): void {
    const el = this._getScrollElement();
    if (this._scrollElem === el) {
      return; // already bound to current element
    }
    this._teardownScrollBinding();
    this._scrollElem = el || undefined;

    if (this._scrollElem) {
      this._boundNativeScroll = () => this._updateScrollToBottomVisibility();
      this._scrollElem.addEventListener("scroll", this._boundNativeScroll, { passive: true });
    }

    // Single global resize/orientation handler: keep scroll-to-bottom visibility
    // in sync AND recompute the chat layout (ScrollContainer height).
    this._boundResize = () => {
      this._updateScrollToBottomVisibility();
      this._adjustChatLayout();
    };
    window.addEventListener("resize", this._boundResize);
    window.addEventListener("orientationchange", this._boundResize as any);
  }

  // Dynamically size scroll container so only it scrolls, keeping composer visible without CSS flex hacks
  private _adjustChatLayout(): void {
    try {
      const chatArea = this.byId("chatArea") as any; // VBox
      const scroll = this.byId("chatScroll") as ScrollContainer;
      const composer = this.byId("chatComposer") as any; // Toolbar
      if (!chatArea || !scroll || !chatArea.getDomRef() || !scroll.getDomRef()) return;
      const areaEl = chatArea.getDomRef() as HTMLElement;
      const scrollEl = scroll.getDomRef() as HTMLElement;
      const composerEl = composer?.getDomRef() as HTMLElement | null;
      const total = areaEl.clientHeight;
      const composerH = composerEl ? composerEl.offsetHeight : 0;
      const target = Math.max(32, total - composerH); // ensure minimum height
      // Apply via control API so rerender keeps it
      if (scroll.getHeight() !== target + "px") {
        scroll.setHeight(target + "px");
      }
      // Ensure native scroll works
      scrollEl.style.overflowY = "auto";
    } catch (e) {
      // silently ignore
    }
  }

  /**
   * Initialize the left splitter pane (speakers table container) width to the actual rendered width
   * of the MDC table instead of the percentage defined in the XML. This runs only once after the
   * table has a measurable DOM width. Falls back after a number of attempts to avoid infinite loops.
   */
  private _initTablePaneWidth(): void {
    if (this._tableWidthInitialized) {
      return;
    }
    const MAX_ATTEMPTS = 25; // ~2.5s if each wait is 100ms
    const MIN_WIDTH = 320; // keep in sync with minSize="320" in XML

    const attempt = () => {
      if (this._tableWidthInitialized) {
        return;
      }
      this._tableWidthAttempts++;
      // Resolve inner table
      const innerView: any = this.byId("tablePropInfosView");
      const table = innerView?.byId ? innerView.byId("speakersTable") : undefined;
      const tableDom: HTMLElement | null = table?.getDomRef() || null;
      const width = tableDom ? tableDom.offsetWidth : 0;
      // Only proceed when we have a non-zero width (table fully laid out)
      if (width > 0) {
        try {
          const container = this.byId("speakersTableContainer");
          const layoutData = container?.getLayoutData() as SplitterLayoutData | undefined;
          if (layoutData && typeof layoutData.setSize === "function") {
            let appliedWidth = Math.max(MIN_WIDTH, width) - 15; // account for padding/margin
            layoutData.setSize(appliedWidth + "px");
            this._tableWidthInitialized = true;
          }
        } catch (e) {
          // Log only in debug to avoid noise
          if ((window as any).__SPLITTER_DEBUG__) {
            // eslint-disable-next-line no-console
            console.warn("[SplitterInit] Failed to set initial table width", e);
          }
          this._tableWidthInitialized = true; // prevent endless retries
        }
        return;
      }
      if (this._tableWidthAttempts < MAX_ATTEMPTS) {
        // Retry after short delay until width calculable
        setTimeout(attempt, 100);
      } else {
        // Give up; keep percentage sizing
        this._tableWidthInitialized = true;
        if ((window as any).__SPLITTER_DEBUG__) {
          // eslint-disable-next-line no-console
          console.warn("[SplitterInit] Giving up after attempts", this._tableWidthAttempts);
        }
      }
    };
    // Kick off asynchronous measurement (allow layout to settle)
    setTimeout(attempt, 0);
  }

  private _registerChatResize(): void {
    this._deregisterChatResize();
    const chatArea = this.byId("chatArea") as any;
    if (chatArea && chatArea.getDomRef()) {
      this._resizeRegId = ResizeHandler.register(chatArea.getDomRef(), () => {
        this._adjustChatLayout();
      });
    }
  }

  private _deregisterChatResize(): void {
    if (this._resizeRegId) {
      try {
        ResizeHandler.deregister(this._resizeRegId);
      } catch {
        /* ignore */
      }
      this._resizeRegId = undefined;
    }
  }

  private _teardownScrollBinding(): void {
    if (this._scrollElem && this._boundNativeScroll) {
      this._scrollElem.removeEventListener("scroll", this._boundNativeScroll);
    }
    if (this._boundResize) {
      window.removeEventListener("resize", this._boundResize);
      window.removeEventListener("orientationchange", this._boundResize as any);
    }
    this._scrollElem = undefined;
    this._boundNativeScroll = undefined;
    this._boundResize = undefined;
  }

  private async _quickAsk(textKey: string): Promise<void> {
    const input = this.byId("messageInput") as Input;
    if (!input) {
      return;
    }
    const rb = await this.getResourceBundle();
    const text = rb.getText(textKey);
    input.setValue(text);
    await this.onSendMessage();
    this._updateSplashVisibility();
    setTimeout(() => {
      input.focus();
    }, 0);
  }

  public onQuickAsk1(): void {
    void this._quickAsk("chatSplashQa1");
  }

  public onQuickAsk2(): void {
    void this._quickAsk("chatSplashQa2");
  }

  public onQuickAsk3(): void {
    void this._quickAsk("chatSplashQa3");
  }

  public onQuickAsk4(): void {
    void this._quickAsk("chatSplashQa4");
  }

  public onQuickAsk5(): void {
    void this._quickAsk("chatSplashQa5");
  }

  private _uuid(): string {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private _toString(value: unknown): string {
    if (value instanceof Error) {
      return value.message;
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }

  private _onWebSocketMessage(event: MessageEvent): void {
    const payload = JSON.parse(event.data);
    const agentModel = this.getView().getModel("agent") as JSONModel;
    switch (payload.type) {
      case "xai":
        agentModel.setProperty("/currentAction", payload.content);
        return;
        agentModel.setProperty("/currentAction", null);
    }

    const currentMessages = (agentModel.getProperty("/messages") as ChatMessage[]) ?? [];
    const entry: ChatMessage = {
      id: this._uuid(),
      role: payload.type === "response" ? "agent" : "error",
      type: payload.type,
      content: payload.content,
      timestamp: payload.timestamp ?? new Date().toISOString()
    };

    agentModel.setProperty("/messages", [...currentMessages, entry]);

    if (payload.type === "error") {
      agentModel.setProperty("/status", "error");
      agentModel.setProperty("/error", payload.content);
    }
  }
}

type ChatMessage = {
  id: string;
  role: "user" | "agent" | "status" | "error";
  type: ServerMessage["type"] | "user";
  content: string;
  timestamp: string;
};
