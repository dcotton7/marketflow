/* When the ticker changes on Fidelity Trade+, tell the local helper.
   Thinkorswim is driven by the helper if it is up. MarketFlow polls the helper.
   If this tab is closed, ToSLink from MarketFlow still works. */
(function () {
  if (window.__mfFidLead) return;
  window.__mfFidLead = true;

  const TICKER = /^[A-Z][A-Z0-9.]{0,6}$/;
  const SKIP = {
    BUY: 1, SELL: 1, LAST: 1, CHART: 1, NEWS: 1, MORE: 1, QUOTE: 1,
    TRADE: 1, CASH: 1, MENU: 1, VIEW: 1, HELP: 1, HOME: 1, ACCOUNT: 1,
    POSITIONS: 1, WATCHLIST: 1, ORDERS: 1, ACTIVITY: 1, SUMMARY: 1,
    OPTIONS: 1, RESEARCH: 1, TRANSFER: 1, PORTFOLIO: 1, MARKET: 1,
    SYMBOL: 1, TICKER: 1, PRICE: 1, CHANGE: 1, VOLUME: 1, SHARES: 1,
    FILTER: 1, SEARCH: 1, CLOSE: 1, CANCEL: 1, SUBMIT: 1, LOGIN: 1,
    FIDELITY: 1, TRADER: 1, WEB: 1, MAIN: 1, TAB: 1, ROW: 1,
  };
  let last = "";
  let lastSentAt = 0;

  function clean(raw) {
    const up = String(raw || "").trim().toUpperCase().replace(/^\$/, "");
    if (!TICKER.test(up) || SKIP[up]) return "";
    return up;
  }

  function tickersIn(text) {
    const bits = String(text || "").toUpperCase().split(/[^A-Z0-9.]+/);
    const found = [];
    for (let i = 0; i < bits.length; i++) {
      const value = clean(bits[i]);
      if (value) found.push(value);
    }
    return found;
  }

  function tickerBesidePrice(text) {
    const bits = String(text || "").toUpperCase().replace(/,/g, "").split(/\s+/);
    for (let i = 0; i < bits.length; i++) {
      const value = clean(bits[i].replace(/^\$/, ""));
      const next = bits[i + 1] || "";
      if (value && /^\$?-?[0-9]/.test(next)) return value;
    }
    return "";
  }

  function fromAttrs(node) {
    if (!node || !node.getAttribute) return "";
    const keys = ["data-symbol", "data-ticker", "data-s", "symbol", "ticker"];
    for (let i = 0; i < keys.length; i++) {
      const value = clean(node.getAttribute(keys[i]));
      if (value) return value;
    }
    return clean(String(node.getAttribute("aria-label") || "").split(/[\s,|/]/)[0]);
  }

  function rowOf(node) {
    let cur = node;
    for (let i = 0; i < 16 && cur && cur !== document.body; i++) {
      const role = (cur.getAttribute && cur.getAttribute("role")) || "";
      const name = (cur.tagName || "").toLowerCase();
      const cls = String(cur.className || "");
      if (
        name === "tr" ||
        role === "row" ||
        role === "option" ||
        /row|position|watch|holding|security|issue/i.test(cls)
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return node;
  }

  function fromKnown() {
    const el = document.querySelector(
      "#symbol_search, input[id*='symbol' i], input[name*='symbol' i], input[placeholder*='Symbol' i], input[aria-label*='symbol' i]"
    );
    if (!el) return "";
    return clean(el.value || el.getAttribute("value") || el.textContent);
  }

  function fromInputs() {
    const known = fromKnown();
    if (known) return known;
    const nodes = document.querySelectorAll("input, [role='combobox'], [contenteditable='true']");
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      if (box.width < 12 || box.height < 8) continue;
      const value = clean(node.value || node.getAttribute("value") || node.textContent);
      if (value) return value;
    }
    return "";
  }

  function fromSelected() {
    const picked = document.querySelector(
      "[aria-selected='true'], [aria-current='true'], [data-selected='true'], .ag-row-selected, .pvd-row-selected"
    );
    if (!picked) return "";
    return tickerBesidePrice(picked.innerText || picked.textContent) || tickersIn(picked.textContent)[0] || "";
  }

  function fromQuote() {
    const marked = document.querySelector("[data-symbol], [data-ticker], [aria-label*='symbol' i], [aria-label*='ticker' i]");
    if (marked) {
      const value = fromAttrs(marked) || clean(marked.textContent);
      if (value) return value;
    }
    const header = document.querySelector("h1, h2, [class*='quote' i], [class*='symbol' i]");
    if (header) {
      const value = tickerBesidePrice(header.innerText || header.textContent) || clean(header.textContent);
      if (value) return value;
    }
    return tickerBesidePrice((document.body && document.body.innerText) || "");
  }

  function fromClick(target) {
    let node = target;
    for (let i = 0; i < 12 && node; i++) {
      const attr = fromAttrs(node);
      if (attr) return attr;
      node = node.parentElement;
    }
    const row = rowOf(target);
    const rowText = (row && (row.innerText || row.textContent)) || "";
    return tickerBesidePrice(rowText) || tickersIn(rowText)[0] || "";
  }

  function readSymbol() {
    return fromSelected() || fromInputs() || fromQuote() || clean(document.title.split(/[\s|/-]/)[0]);
  }

  function send(symbol, force) {
    const now = Date.now();
    if (!force && symbol === last && now - lastSentAt < 400) return;
    last = symbol;
    lastSentAt = now;
    try {
      chrome.runtime.sendMessage({ symbol: symbol }, function () {
        void chrome.runtime.lastError;
      });
    } catch (err) {}
  }

  function fromPoint(event) {
    if (!event || !document.elementsFromPoint) return "";
    const stack = document.elementsFromPoint(event.clientX, event.clientY) || [];
    for (let i = 0; i < stack.length; i++) {
      const value = fromClick(stack[i]);
      if (value) return value;
    }
    return "";
  }

  function huntAfterClick(target, event) {
    const first = fromPoint(event) || fromClick(target) || readSymbol();
    if (first) send(first, true);
    let n = 0;
    const id = setInterval(function () {
      const symbol = fromKnown() || fromSelected() || fromClick(target) || readSymbol();
      if (symbol) send(symbol, true);
      if (++n >= 12) clearInterval(id);
    }, 150);
  }

  function tick() {
    const symbol = readSymbol();
    if (symbol) send(symbol);
  }

  document.addEventListener("click", function (event) {
    huntAfterClick(event.target, event);
  }, true);
  document.addEventListener("dblclick", function (event) {
    huntAfterClick(event.target, event);
  }, true);
  document.addEventListener("focusin", function (event) {
    const symbol = fromKnown() || fromClick(event.target) || readSymbol();
    if (symbol) send(symbol, true);
  }, true);
  document.addEventListener("input", function (event) {
    const symbol = fromKnown() || fromClick(event.target) || readSymbol();
    if (symbol) send(symbol, true);
  }, true);

  try {
    chrome.runtime.sendMessage({ hello: true, href: String(location.href || "") }, function () {
      void chrome.runtime.lastError;
    });
  } catch (err) {}

  tick();
  setInterval(tick, 800);
})();
