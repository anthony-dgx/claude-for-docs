// Content script: runs on docs.google.com/document/* pages
// Extracts the document ID from the URL and sends it to the background worker
(function () {
  const match = window.location.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const docId = match[1];
    const docTitle = document.title.replace(/ - Google Docs$/, '');
    chrome.runtime.sendMessage({
      type: 'DOC_DETECTED',
      docId,
      docTitle,
      url: window.location.href,
    });
  }
})();
