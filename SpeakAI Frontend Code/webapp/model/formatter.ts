let __md: any;
let __purify: any;

const getMarkdownIt = (): any => {
  if (__md) {
    return __md;
  }
  try {
    const requireSync = (sap.ui as any)?.requireSync;
    let mod: any;
    if (typeof requireSync === "function") {
      mod = requireSync("thirdparty/markdown-it.min") || requireSync("thirdparty/markdown-it");
    }
    const MarkdownIt = mod?.default || (window as any).markdownit;
    if (MarkdownIt) {
      __md = MarkdownIt({
        html: false,
        linkify: true,
        breaks: true,
        typographer: true
      });
    }
  } catch {
    // ignore
  }
  return __md;
};

const getDOMPurify = (): any => {
  if (__purify) {
    return __purify;
  }
  try {
    const requireSync = (sap.ui as any)?.requireSync;
    let mod: any;
    if (typeof requireSync === "function") {
      mod = requireSync("thirdparty/purify.min") || requireSync("thirdparty/purify");
    }
    __purify = mod?.default || mod || (window as any).DOMPurify;
  } catch {
    __purify = (window as any).DOMPurify;
  }
  return __purify;
};

const formatMarkdown = (value?: string): string => {
  if (!value) {
    return "";
  }
  // Try markdown-it
  const md = getMarkdownIt();
  let rawHtml = "";
  if (md) {
    try {
      rawHtml = md.render(value);
    } catch {
      // ignore and use fallback
    }
  }
  // If conversion failed, return safely-escaped plain text with <br>
  if (!rawHtml) {
    const escaped = value.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
    return escaped.replace(/\n/g, "<br>");
  }
  // Sanitize with DOMPurify if available
  const purify = getDOMPurify();
  const safeHtml = purify ? purify.sanitize(rawHtml) : rawHtml;
  return safeHtml;
};

// Removed busyStates and rely solely on connection state + last message role
const isComposerEnabled = (status?: string, messages?: { role?: string }[]): boolean => {
  return status === "connected" && !isLastMessageFromUser(messages);
};

const getSendIcon = (status?: string, messages?: { role?: string }[]): string => {
  return isComposerEnabled(status, messages) ? "sap-icon://paper-plane" : "sap-icon://pending";
};

const isLastMessageFromUser = (messages?: { role?: string }[]): boolean => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  return messages[messages.length - 1]?.role === "user";
};

const eventTypeIcon = (value?: string): string => {
  if (!value) {
    return "";
  }
  switch (value) {
    case "External Event":
      return "sap-icon://world";
    case "Consumption Event":
      return "sap-icon://bar-chart";
    case "Sales Event":
      return "sap-icon://suitcase";
    default:
      return "";
  }
};

const eventTypeText = (value?: string): string => {
  if (!value) {
    return "";
  }
  // Turn "External Event" into a shorter label like "External"
  const short = value.replace(/\s*Event$/i, "");
  return short;
};

export default {
  formatValue: (value: string) => {
    return value?.toUpperCase();
  },
  /**
   * Converts values that may be:
   *  - an array (['A','B'])
   *  - a JSON encoded array string ("[\"A\",\"B\"]")
   *  - a simple string
   * into a readable comma separated list (A, B).
   * Removes duplicates, trims whitespace, and preserves order.
   */
  formatArrayish: (value: any): string => {
    if (value == null) {
      return "";
    }
    let arr: any[] = [];
    if (Array.isArray(value)) {
      arr = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      // Detect JSON array string
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            arr = parsed;
          }
        } catch {
          // fall back to splitting
        }
      }
      if (arr.length === 0) {
        // fallback: split on delimiters if no json parse result
        arr = trimmed.split(/[;,]/g);
      }
    } else {
      // any other primitive -> toString
      arr = [String(value)];
    }
    // Normalize entries
    arr = arr.map((v) => (v == null ? "" : String(v).trim())).filter((v) => v.length > 0);
    // De-duplicate preserving order
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const item of arr) {
      if (!seen.has(item)) {
        seen.add(item);
        dedup.push(item);
      }
    }
    return dedup.join(", ");
  },
  /**
   * Normalize a user-entered or raw URL string to a safe absolute URL.
   * - Adds https:// if protocol missing
   * - Trims whitespace
   * - Returns empty string if looks unsafe (javascript:, data:)
   */
  normalizeUrl: (value?: string): string => {
    if (!value) {
      return "";
    }
    let url = value.trim();
    if (!url) {
      return "";
    }
    // If it is a SharePoint or OneDrive link with spaces encoded incorrectly, just keep as-is
    // Basic safety: disallow javascript: or data:
    if (/^(javascript:|data:)/i.test(url)) {
      return "";
    }
    // Prepend protocol if missing
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url.replace(/^\/\//, "");
    }
    return url;
  },
  formatMarkdown,
  isComposerEnabled,
  getSendIcon,
  isLastMessageFromUser,
  eventTypeIcon,
  eventTypeText
};
