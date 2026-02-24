// Background service worker
// Tracks the current Google Doc and manages side panel state

let currentDoc = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOC_DETECTED') {
    currentDoc = {
      docId: message.docId,
      docTitle: message.docTitle,
      url: message.url,
    };
    // Enable the side panel for this tab
    if (sender.tab?.id) {
      chrome.sidePanel.setOptions({
        tabId: sender.tab.id,
        path: 'sidepanel.html',
        enabled: true,
      });
    }
  }

  if (message.type === 'GET_CURRENT_DOC') {
    sendResponse(currentDoc);
    return true;
  }
});

// Open side panel on action button click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
