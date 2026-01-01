const MENU_ID = 'chatgpt-toc-add-bookmark';
const DOCUMENT_URL_PATTERNS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

function ensureContextMenu() {
  chrome.contextMenus.remove(MENU_ID, () => {
    chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Add to TOC',
      contexts: ['selection'],
      documentUrlPatterns: DOCUMENT_URL_PATTERNS
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup?.addListener(ensureContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }
  chrome.tabs.sendMessage(tab.id, {
    type: 'CHATGPT_TOC_CREATE_BOOKMARK',
    selectionText: info.selectionText || ''
  });
});
