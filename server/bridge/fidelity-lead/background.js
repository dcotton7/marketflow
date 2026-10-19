/* KILL SWITCH — Fidelity Lead disabled. Does nothing. */
try {
  chrome.action.setBadgeBackgroundColor({ color: "#666666" });
  chrome.action.setBadgeText({ text: "OFF" });
} catch (e) {}

chrome.runtime.onMessage.addListener(function () {
  /* no-op: ignore symbol / hello from any leftover content scripts */
  return false;
});

chrome.runtime.onMessageExternal.addListener(function () {
  /* no-op: ignore pokeFidelityLead from MarketFlow */
  return false;
});

/* Do not inject, do not call 7737 /from-fidelity or /ext-hello */
