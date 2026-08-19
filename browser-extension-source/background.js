// Canvas Capture — service worker (Manifest V3).
// Injects the picker into the active tab when the toolbar action is clicked.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/capture.js", "content/picker.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/picker.css"],
    });
  } catch {
    // Restricted pages (chrome://, the Web Store, file:// without access)
    // cannot be captured; the picker simply stays off.
  }
});
