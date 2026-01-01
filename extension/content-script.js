(function () {
  if (window.__chatgptTocInjected) {
    return;
  }
  window.__chatgptTocInjected = true;

  const DB_NAME = 'chatgpt_toc';
  const DB_VERSION = 4;
  const STORE_NAME = 'bookmarks';
  const ANSWER_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-testid="assistant-response"]',
    '[data-testid="chat-message"]'
  ];

  const state = {
    answers: new Map(),
    overlay: null,
    contextTarget: null,
    selectionText: '',
    conversationId: null
  };

  const dbPromise = openDatabase();
  const ID_PREFIX = 'bm';

  function generateBookmarkId() {
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${ID_PREFIX}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function init() {
    state.overlay = createOverlay();
    state.conversationId = getConversationId();
    scanExistingAnswers();
    observeAnswers();
    document.addEventListener('contextmenu', captureContextInfo, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    setupNavigationListeners();
    setupRuntimeListeners();
  }

  function setupRuntimeListeners() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      return;
    }
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'CHATGPT_TOC_CREATE_BOOKMARK') {
        handleBookmarkCreate(message.selectionText || '');
      }
    });
  }

  function captureContextInfo(event) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      state.contextTarget = null;
      state.selectionText = '';
      return;
    }
    state.selectionText = selection.toString().trim();
    state.contextTarget = findBookmarkableElement(event.target) || findSelectionElement(selection);
  }

  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      state.selectionText = '';
      if (!state.contextTarget?.isConnected) {
        state.contextTarget = null;
      }
      return;
    }
    state.selectionText = selection.toString().trim();
    if (!state.contextTarget || !state.contextTarget.isConnected) {
      state.contextTarget = findSelectionElement(selection);
    }
  }

  function findSelectionElement(selection) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const candidates = [
      selection.anchorNode?.parentElement,
      selection.focusNode?.parentElement,
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer?.parentElement
    ];
    for (const candidate of candidates) {
      const element = findBookmarkableElement(candidate);
      if (element) {
        return element;
      }
    }
    return null;
  }

  function scanExistingAnswers() {
    ANSWER_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => registerAnswer(el));
    });
  }

  function observeAnswers() {
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          if (matchesAnswer(node)) {
            registerAnswer(node);
          }
          node.querySelectorAll &&
            ANSWER_SELECTORS.forEach((selector) => {
              node.querySelectorAll(selector).forEach((el) => registerAnswer(el));
            });
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupNavigationListeners() {
    const checkConversationChange = () => {
      const currentId = getConversationId();
      if (currentId === state.conversationId) {
        return;
      }
      state.conversationId = currentId;
      state.answers.clear();
      state.contextTarget = null;
      state.selectionText = '';
      scanExistingAnswers();
      refreshOverlay();
    };

    const wrapHistory = (methodName) => {
      const original = history[methodName];
      if (typeof original !== 'function') {
        return;
      }
      history[methodName] = function (...args) {
        const result = original.apply(this, args);
        checkConversationChange();
        return result;
      };
    };

    wrapHistory('pushState');
    wrapHistory('replaceState');
    window.addEventListener('popstate', checkConversationChange);
    setInterval(checkConversationChange, 1000);
  }

  function matchesAnswer(element) {
    return ANSWER_SELECTORS.some((selector) => element.matches?.(selector));
  }

  function registerAnswer(answerEl) {
    if (!answerEl || state.answers.has(answerEl)) {
      return;
    }

    state.answers.set(answerEl, true);
  }

  function getConversationId() {
    const path = window.location.pathname || '';
    const match = path.match(/\/(?:c|share)\/([\w-]+)/i);
    if (match) {
      return match[1];
    }
    const segments = path.split('/').filter(Boolean);
    return segments[segments.length - 1] || null;
  }

  function createOverlay() {
    const container = document.createElement('div');
    container.className = 'toc-overlay';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toc-toggle';
    toggle.textContent = 'TOC';

    const panel = document.createElement('div');
    panel.className = 'toc-panel';

    const header = document.createElement('header');
    header.textContent = 'Bookmarks';

    const list = document.createElement('ul');
    list.className = 'toc-list';

    const empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.textContent = 'No bookmarks yet';

    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(empty);
    container.appendChild(toggle);
    container.appendChild(panel);
    document.body.appendChild(container);

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      panel.classList.toggle('visible');
      if (panel.classList.contains('visible')) {
        refreshOverlay();
      }
    });

    document.addEventListener('click', (event) => {
      if (!container.contains(event.target)) {
        panel.classList.remove('visible');
      }
    });

    return { container, toggleEl: toggle, panelEl: panel, listEl: list, emptyEl: empty };
  }

  async function refreshOverlay() {
    const overlay = state.overlay;
    if (!overlay) {
      return;
    }
    overlay.listEl.innerHTML = '';
    const conversationId = state.conversationId;
    if (!conversationId) {
      overlay.emptyEl.textContent = 'Open a conversation to view bookmarks';
      overlay.emptyEl.style.display = 'block';
      return;
    }
    const bookmarks = await getBookmarksForConversation(conversationId);
    overlay.emptyEl.textContent = 'No bookmarks yet';
    if (!bookmarks.length) {
      overlay.emptyEl.style.display = 'block';
      return;
    }

    overlay.emptyEl.style.display = 'none';
    bookmarks
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((bookmark) => {
        const li = document.createElement('li');
        li.className = 'toc-bookmark-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toc-bookmark';
        button.title = `${bookmark.tagName} (${bookmark.dataStart}-${bookmark.dataEnd})`;
        button.addEventListener('click', () => scrollToBookmark(bookmark));

        const label = document.createElement('span');
        label.className = 'toc-bookmark-label';
        label.textContent = bookmark.name;

        const close = document.createElement('span');
        close.className = 'toc-delete';
        close.textContent = '×';
        close.title = 'Delete bookmark';
        close.setAttribute('role', 'button');
        close.tabIndex = 0;
        const onDelete = async () => {
          const ok = confirm(`Delete bookmark "${bookmark.name}"?`);
          if (!ok) {
            return;
          }
          await deleteBookmark(bookmark.id);
          refreshOverlay();
        };
        close.addEventListener('click', (event) => {
          event.stopPropagation();
          event.preventDefault();
          onDelete();
        });
        close.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }
        });

        button.appendChild(label);
        button.appendChild(close);
        li.appendChild(button);
        overlay.listEl.appendChild(li);
      });
  }

  function scrollToBookmark(bookmark) {
    const selector = `[data-start=\"${bookmark.dataStart}\"][data-end=\"${bookmark.dataEnd}\"]`;
    const target = document.querySelector(selector);
    if (!target) {
      console.warn('[ChatGPT TOC] No matching node found', bookmark);
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('toc-highlight');
    setTimeout(() => target.classList.remove('toc-highlight'), 1800);
  }

  function resolveBookmarkTarget() {
    if (state.contextTarget?.isConnected) {
      return state.contextTarget;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return null;
    }
    return findSelectionElement(selection);
  }

  async function handleBookmarkCreate(selectionTextOverride) {
    const target = resolveBookmarkTarget();
    if (!target) {
      alert('Select text inside the content you want to bookmark, then try again.');
      return;
    }
    const answerEl = findAnswerElement(target);
    if (!answerEl) {
      alert('Could not find the answer section for this bookmark.');
      return;
    }
    const conversationId = getConversationId();
    if (!conversationId) {
      alert('Could not determine the conversation for this bookmark.');
      return;
    }
    const dataStart = target.getAttribute('data-start');
    const dataEnd = target.getAttribute('data-end');
    if (!dataStart || !dataEnd) {
      alert('This node is missing data-start / data-end attributes; cannot bookmark.');
      return;
    }
    const selectionText = (selectionTextOverride || state.selectionText || target.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 60);
    const defaultName = selectionText || 'Bookmark';
    const input = prompt('Bookmark name', defaultName);
    if (input === null) {
      return;
    }
    const name = input.trim();
    if (!name) {
      alert('Bookmark name cannot be empty.');
      return;
    }
    const bookmark = {
      id: generateBookmarkId(),
      answerId: conversationId,
      conversationId,
      name,
      summary: selectionText || defaultName,
      tagName: target.tagName.toLowerCase(),
      dataStart,
      dataEnd,
      createdAt: Date.now()
    };
    await addBookmark(bookmark);
    await refreshOverlay();
  }

  function findAnswerElement(element) {
    if (!element) {
      return null;
    }
    for (const selector of ANSWER_SELECTORS) {
      const match = element.closest(selector);
      if (match) {
        return match;
      }
    }
    return null;
  }

  function findBookmarkableElement(start) {
    if (!start) {
      return null;
    }
    if (start instanceof Element) {
      return start.closest('[data-start][data-end]');
    }
    return null;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const tx = request.transaction;
        if (!tx) {
          return;
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('answerId', 'answerId', { unique: false });
          return;
        }

        const existingStore = tx.objectStore(STORE_NAME);
        if (existingStore.keyPath === 'id') {
          if (!existingStore.indexNames.contains('answerId')) {
            existingStore.createIndex('answerId', 'answerId', { unique: false });
          }
          if (event.oldVersion < 4) {
            existingStore.openCursor().onsuccess = (cursorEvent) => {
              const cursor = cursorEvent.target.result;
              if (!cursor) {
                return;
              }
              const value = cursor.value;
              if (value?.conversationId && value.answerId !== value.conversationId) {
                value.answerId = value.conversationId;
                cursor.update(value);
              }
              cursor.continue();
            };
          }
          return;
        }

        const legacyEntries = [];
        existingStore.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            legacyEntries.push(cursor.value);
            cursor.continue();
            return;
          }

          db.deleteObjectStore(STORE_NAME);
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('answerId', 'answerId', { unique: false });
          legacyEntries.forEach((entry) => {
            if (!entry.id) {
              entry.id = generateBookmarkId();
            }
            store.put(entry);
          });
        };
      };
    });
  }

  async function addBookmark(bookmark) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_NAME).put(bookmark);
    });
  }

  async function getBookmarks(answerId) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('answerId');
      const request = index.getAll(IDBKeyRange.only(answerId));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function getBookmarksForConversation(conversationId) {
    return getBookmarks(conversationId);
  }

  async function deleteBookmark(id) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_NAME).delete(id);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
