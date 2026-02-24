// Background service worker
// Tracks Google Docs per tab and notifies the side panel on tab switches

const tabDocs = new Map(); // tabId -> { docId, docTitle }

function extractDocId(url) {
  const match = url?.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function notifySidePanel(docId, docTitle) {
  chrome.runtime.sendMessage({
    type: 'TAB_CHANGED',
    docId: docId || null,
    docTitle: docTitle || null,
  }).catch(() => {
    // Side panel may not be open — ignore
  });
}

// When content script detects a doc, store it for that tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOC_DETECTED') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      tabDocs.set(tabId, {
        docId: message.docId,
        docTitle: message.docTitle,
      });
      chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true,
      });
    }
  }

  if (message.type === 'GET_CURRENT_DOC') {
    // Return doc for the active tab
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const doc = tab ? tabDocs.get(tab.id) : null;
      sendResponse(doc || null);
    });
    return true; // async sendResponse
  }
});

// Tab activated — resolve doc from stored map or from the tab URL
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  let doc = tabDocs.get(tabId);
  if (!doc) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const docId = extractDocId(tab.url);
      if (docId) {
        const title = tab.title?.replace(/ - Google Docs$/, '') || '';
        doc = { docId, docTitle: title };
        tabDocs.set(tabId, doc);
      }
    } catch {
      // Tab may have been removed
    }
  }
  notifySidePanel(doc?.docId, doc?.docTitle);
});

// Tab URL updated (navigation within a tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const docId = extractDocId(tab.url);
  if (docId) {
    const title = tab.title?.replace(/ - Google Docs$/, '') || '';
    tabDocs.set(tabId, { docId, docTitle: title });
  } else {
    tabDocs.delete(tabId);
  }
  // Only notify if this is the active tab
  chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
    if (activeTab?.id === tabId) {
      const doc = tabDocs.get(tabId);
      notifySidePanel(doc?.docId, doc?.docTitle);
    }
  });
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabDocs.delete(tabId);
});

// Open side panel on action button click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
