(function (root) {
  "use strict";

  const CACHE_KEY = "dew_gate_state_v1";

  function clampOpenUpTo(value, total, fallback) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const parsed = Number.parseInt(value, 10);
    const safeFallback = Math.min(safeTotal, Math.max(1, Number.parseInt(fallback, 10) || 1));
    if (!Number.isFinite(parsed)) return safeFallback;
    return Math.min(safeTotal, Math.max(1, parsed));
  }

  function sanitizeState(raw, total, fallbackOpenUpTo) {
    const data = raw && raw.data && typeof raw.data === "object" ? raw.data : (raw || {});
    return {
      openUpTo: clampOpenUpTo(
        data.openUpTo !== undefined ? data.openUpTo : data.open_up_to,
        total,
        fallbackOpenUpTo
      ),
      version: Number.parseInt(data.version, 10) || 0,
      updatedAt: data.updatedAt || data.updated_at || null,
      online: data.online !== false,
      source: data.source || "remote",
      error: data.error || ""
    };
  }

  function isUnlocked(index, state) {
    return Number.isInteger(index) && index >= 0 && index < Math.max(1, state && state.openUpTo || 1);
  }

  class GateClient {
    constructor(options) {
      const opts = options || {};
      this.apiUrl = String(opts.apiUrl || "").trim();
      this.total = Math.max(1, Number(opts.total) || 1);
      this.fallbackOpenUpTo = clampOpenUpTo(opts.fallbackOpenUpTo, this.total, 1);
      this.refreshMs = Math.max(10000, Number(opts.refreshMs) || 30000);
      this.fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(root) : null);
      this.storage = opts.storage || (function () {
        try { return root.localStorage; } catch (_) { return null; }
      })();
      this.onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
      this.onError = typeof opts.onError === "function" ? opts.onError : function () {};
      this._timer = null;
      this._visibilityHandler = null;
      this._focusHandler = null;

      const cached = this._readCache();
      this.state = cached
        ? sanitizeState(Object.assign({}, cached, { source: "cache", online: false }), this.total, this.fallbackOpenUpTo)
        : sanitizeState({
            openUpTo: this.fallbackOpenUpTo,
            source: "fallback",
            online: false
          }, this.total, this.fallbackOpenUpTo);
    }

    _readCache() {
      if (!this.storage) return null;
      try {
        const raw = this.storage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    _writeCache(state) {
      if (!this.storage) return;
      try {
        this.storage.setItem(CACHE_KEY, JSON.stringify({
          openUpTo: state.openUpTo,
          version: state.version,
          updatedAt: state.updatedAt
        }));
      } catch (_) {}
    }

    _emit() {
      this.onChange(Object.assign({}, this.state));
    }

    async refresh() {
      if (!this.apiUrl || !this.fetchImpl) {
        this._emit();
        return Object.assign({}, this.state);
      }

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller ? setTimeout(function () { controller.abort(); }, 7000) : null;
      try {
        const separator = this.apiUrl.indexOf("?") >= 0 ? "&" : "?";
        const response = await this.fetchImpl(this.apiUrl + separator + "_=" + Date.now(), {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          signal: controller ? controller.signal : undefined
        });
        if (!response || !response.ok) {
          throw new Error("闸门接口返回 " + (response ? response.status : "空响应"));
        }
        const payload = await response.json();
        this.state = sanitizeState(Object.assign({}, payload, {
          source: "remote",
          online: true,
          error: ""
        }), this.total, this.fallbackOpenUpTo);
        this._writeCache(this.state);
        this._emit();
        return Object.assign({}, this.state);
      } catch (error) {
        this.state = Object.assign({}, this.state, {
          online: false,
          source: this.state.source === "remote" ? "cache" : this.state.source,
          error: error && error.name === "AbortError" ? "连接老师控制台超时" : "暂时连不上老师控制台"
        });
        this.onError(error, Object.assign({}, this.state));
        this._emit();
        return Object.assign({}, this.state);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    start() {
      if (this._timer) return;
      this.refresh();
      this._timer = setInterval(() => this.refresh(), this.refreshMs);
      if (root.document && root.addEventListener) {
        this._visibilityHandler = () => {
          if (root.document.visibilityState === "visible") this.refresh();
        };
        this._focusHandler = () => this.refresh();
        root.document.addEventListener("visibilitychange", this._visibilityHandler);
        root.addEventListener("focus", this._focusHandler);
      }
    }

    stop() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      if (root.document && this._visibilityHandler) {
        root.document.removeEventListener("visibilitychange", this._visibilityHandler);
      }
      if (root.removeEventListener && this._focusHandler) {
        root.removeEventListener("focus", this._focusHandler);
      }
      this._visibilityHandler = null;
      this._focusHandler = null;
    }
  }

  const api = { CACHE_KEY, clampOpenUpTo, sanitizeState, isUnlocked, GateClient };
  root.CourseGate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
