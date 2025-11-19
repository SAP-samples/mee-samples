import UIComponent from "sap/ui/core/UIComponent";
import models from "./model/models";
import Device from "sap/ui/Device";
import JSONModel from "sap/ui/model/json/JSONModel";
import WebSocketClient from "./service/WebSocketClient";
import Theming from "sap/ui/core/Theming";
// import includeStylesheet from "sap/ui/dom/includeStylesheet";

/**
 * @namespace com.sap.aiagentspeaker
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"]
  };

  private contentDensityClass: string;
  private wsClient: WebSocketClient;
  private nowTimer?: number; // timer for updating date/time

  public init(): void {
    // Force German language BEFORE base init so manifest models (i18n) load in 'de'
    try {
      if (!/[?&]sap-language=/i.test(location.search)) {
        sap.ui.getCore().getConfiguration().setLanguage("de");
      }
    } catch {
      /* ignore */
    }

    // call the base component's init function (creates i18n model now in target language)
    super.init();

    // Removed custom semantic filter operator and related enrichment feature.
    // includeStylesheet(sap.ui.require.toUrl("com/sap/aiagentspeaker/css/style.css"));
    Theming.setTheme("sap_horizon");

    // Configure loader path for third-party modules (markdown-it, DOMPurify)
    // Maps module IDs like "thirdparty/markdown-it" to "webapp/thirdparty/markdown-it.min.js"
    sap.ui.loader.config({
      paths: {
        thirdparty: sap.ui.require.toUrl("com/sap/aiagentspeaker/thirdparty")
      },
      // Shim non-AMD third-party scripts so UI5 loader can provide module values
      shim: {
        "thirdparty/markdown-it.min": {
          amd: false,
          deps: [],
          exports: "markdownit"
        },
        "thirdparty/purify.min": {
          amd: false,
          deps: [],
          exports: "DOMPurify"
        }
      }
    });

    // initialize WebSocket client (read optional wsBaseUrl from manifest config)
    const ui5 = (this.getManifestEntry("sap.ui5") as any) || {};
    const wsBase = ui5?.config?.wsBaseUrl as string | undefined;
    this.wsClient = new WebSocketClient(wsBase);
    const clientId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `client-${Date.now()}`;
    const agentModel = new JSONModel({
      clientId,
      status: "disconnected",
      messages: [],
      error: null,
      currentAction: null,
      statusDescription: null,
      user: null
    });
    this.setModel(agentModel, "agent");

    // Inject an initial assistant greeting message if empty (first app load)
    this._injectInitialGreeting(agentModel);

    // create the device model
    this.setModel(models.createDeviceModel(), "device");

    // UI model for dynamic date/time in subheader and chat UI state
    const uiModel = new JSONModel({
      dateLabel: "",
      timeLabel: "",
      showScrollToBottom: false,
      sidebarOpen: false,
      showSplash: true
    });
    const updateNow = () => {
      const d = new Date();
      uiModel.setProperty(
        "/dateLabel",
        d.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric"
        })
      );
      uiModel.setProperty(
        "/timeLabel",
        d.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit"
        })
      );
    };
    updateNow();
    this.nowTimer = window.setInterval(updateNow, 60000);
    this.setModel(uiModel, "ui");

    // Removed Showdown warm-load to prevent 404 in environments where the module is not shipped
    // (sap/ui/thirdparty/showdown is not present in your current UI5 runtime)

    // create the views based on the url/hash
    this.getRouter().initialize();

    // Attempt to load authenticated user info (optional; ignore errors)
    this.wsClient
      .fetchUserInfo?.()
      .then((info: any) => {
        if (info) {
          agentModel.setProperty("/user", info);
        }
      })
      .catch(() => {
        /* silent */
      });
  }

  public getWebSocketClient(): WebSocketClient {
    return this.wsClient;
  }

  /**
   * This method can be called to determine whether the sapUiSizeCompact or sapUiSizeCozy
   * design mode class should be set, which influences the size appearance of some controls.
   * @public
   * @returns css class, either 'sapUiSizeCompact' or 'sapUiSizeCozy' - or an empty string if no css class should be set
   */
  public getContentDensityClass(): string {
    if (this.contentDensityClass === undefined) {
      // check whether FLP has already set the content density class; do nothing in this case
      if (document.body.classList.contains("sapUiSizeCozy") || document.body.classList.contains("sapUiSizeCompact")) {
        this.contentDensityClass = "";
      } else if (!Device.support.touch) {
        // apply "compact" mode if touch is not supported
        this.contentDensityClass = "sapUiSizeCompact";
      } else {
        // "cozy" in case of touch support; default for most sap.m controls, but needed for desktop-first controls like sap.ui.table.Table
        this.contentDensityClass = "sapUiSizeCozy";
      }
    }
    return this.contentDensityClass;
  }

  public destroy(): void {
    if (this.nowTimer) {
      window.clearInterval(this.nowTimer);
      this.nowTimer = undefined;
    }
    super.destroy();
  }

  /**
   * Safely inject the initial greeting after i18n is available. If the resource bundle loads
   * asynchronously (UI5 async content creation), we wait for the promise. If already loaded,
   * we read immediately. Guard against multiple injections.
   */
  private _injectInitialGreeting(agentModel: JSONModel): void {
    try {
      const existing = agentModel.getProperty("/messages");
      if (!Array.isArray(existing) || existing.length > 0) {
        return; // already has messages
      }
      const i18nModel: any = this.getModel("i18n");
      if (!i18nModel || typeof i18nModel.getResourceBundle !== "function") {
        this._appendGreeting(agentModel, "__GREETING_FALLBACK__");
        return;
      }
      const rbOrPromise = i18nModel.getResourceBundle();
      // Handle promise (async) vs direct bundle
      if (rbOrPromise && typeof rbOrPromise.then === "function") {
        (rbOrPromise as Promise<any>)
          .then((rb) => {
            // Re-check messages in case something arrived meanwhile
            const again = agentModel.getProperty("/messages");
            const localized = rb?.getText ? rb.getText("initialAssistantGreeting") : "Welcome";
            if (Array.isArray(again) && again.length === 0) {
              this._appendGreeting(agentModel, localized);
            } else if (Array.isArray(again) && again.length === 1) {
              // Always replace if we see placeholder token or English greeting snippet
              const first = again[0]?.content || "";
              const englishSnippet = "I'm your Speaker Database AI assistant"; // part of original English string
              if (first === "__GREETING_FALLBACK__" || first === "Welcome" || first.includes(englishSnippet)) {
                agentModel.setProperty("/messages/0/content", localized);
              }
            }
          })
          .catch(() => {
            const again = agentModel.getProperty("/messages");
            if (Array.isArray(again) && again.length === 0) {
              this._appendGreeting(agentModel, "__GREETING_FALLBACK__");
            }
          });
      } else {
        const text = rbOrPromise?.getText ? rbOrPromise.getText("initialAssistantGreeting") : "__GREETING_FALLBACK__";
        this._appendGreeting(agentModel, text);
      }
    } catch {
      // fallback injection
      const again = agentModel.getProperty("/messages");
      if (Array.isArray(again) && again.length === 0) {
        this._appendGreeting(agentModel, "__GREETING_FALLBACK__");
      }
    }
  }

  private _appendGreeting(agentModel: JSONModel, content: string): void {
    const initialMessage = {
      id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: "agent" as const,
      type: "response",
      content,
      timestamp: new Date().toISOString()
    };
    agentModel.setProperty("/messages", [initialMessage]);
  }
}
