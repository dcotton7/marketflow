function helperGet(path) {
  const urls = [
    "http://127.0.0.1:7737" + path,
    "http://localhost:7737" + path,
  ];
  const opts = { method: "GET", mode: "cors", credentials: "omit", targetAddressSpace: "loopback" };
  return fetch(urls[0], opts).catch(function () {
    return fetch(urls[1], opts);
  }).catch(function () {
    return fetch(urls[0]).catch(function () {
      return fetch(urls[1]);
    });
  });
}

function mark(symbol) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#335533" });
    chrome.action.setBadgeText({ text: String(symbol || "").slice(0, 4) });
  } catch (err) {}
}

function injectTab(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },
    files: ["content.js"],
  }, function () {
    void chrome.runtime.lastError;
  });
}

function injectAll() {
  chrome.tabs.query({ url: ["https://*.fidelity.com/*", "http://*.fidelity.com/*"] }, function (tabs) {
    (tabs || []).forEach(function (tab) {
      if (tab.id) injectTab(tab.id);
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.hello) {
    helperGet("/ext-hello?href=" + encodeURIComponent(msg.href || "")).catch(function () {});
    return;
  }
  const symbol = String((msg && msg.symbol) || "").trim().toUpperCase();
  if (!symbol) return;
  mark(symbol);
  helperGet("/from-fidelity?symbol=" + encodeURIComponent(symbol)).catch(function () {});
});

chrome.runtime.onMessageExternal.addListener(function (msg) {
  if (msg && msg.poke) injectAll();
});

chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
  const url = String((tab && tab.url) || info.url || "");
  if (url.indexOf("fidelity.com") < 0) return;
  if (info.status === "complete" || info.url) injectTab(tabId);
});

chrome.action.onClicked.addListener(function (tab) {
  if (tab && tab.id) injectTab(tab.id);
  injectAll();
});

chrome.runtime.onInstalled.addListener(function () {
  helperGet("/ext-hello?href=installed").catch(function () {});
  injectAll();
});
chrome.runtime.onStartup.addListener(function () {
  helperGet("/ext-hello?href=startup").catch(function () {});
  injectAll();
});

injectAll();
