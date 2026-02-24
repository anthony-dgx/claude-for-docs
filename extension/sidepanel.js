// Side panel: chat UI with WebSocket client
const SERVER_URL = 'ws://localhost:3456';
const RECONNECT_DELAY = 3000;

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const docTitleEl = document.getElementById('doc-title');
const toolIndicatorEl = document.getElementById('tool-indicator');
const costEl = document.getElementById('cost');
const sessionToggleEl = document.getElementById('session-toggle');
const sessionsDropdownEl = document.getElementById('sessions-dropdown');

let ws = null;
let currentDocId = null;
let currentStreamEl = null;
let currentStreamText = '';
let totalCost = 0;
let isWaiting = false;

// In-memory session data: { [docId]: { title, messages: [{role, text}], cost } }
let sessions = {};

// ── Session persistence ──

async function loadSessions() {
  try {
    const result = await chrome.storage.local.get('sessions');
    sessions = result.sessions || {};
  } catch {
    sessions = {};
  }
}

async function saveSessions() {
  try {
    await chrome.storage.local.set({ sessions });
  } catch {
    // storage might be full — ignore
  }
}

function saveCurrentSession() {
  if (!currentDocId) return;
  // Collect messages from the DOM
  const msgs = [];
  messagesEl.querySelectorAll('.message').forEach((el) => {
    if (el.classList.contains('message-user')) {
      msgs.push({ role: 'user', text: el.textContent });
    } else if (el.classList.contains('message-assistant')) {
      msgs.push({ role: 'assistant', text: el.innerHTML });
    } else if (el.classList.contains('message-error')) {
      msgs.push({ role: 'error', text: el.textContent });
    }
  });
  sessions[currentDocId] = {
    title: docTitleEl.textContent || currentDocId,
    messages: msgs,
    cost: totalCost,
  };
  saveSessions();
}

function loadSession(docId) {
  // Clear the chat area
  messagesEl.innerHTML = '';
  totalCost = 0;
  costEl.textContent = '';
  currentStreamEl = null;
  currentStreamText = '';

  const session = sessions[docId];
  if (!session) return;

  // Restore messages
  session.messages.forEach(({ role, text }) => {
    const el = document.createElement('div');
    el.className = `message message-${role}`;
    if (role === 'assistant') {
      el.innerHTML = text; // already rendered HTML
    } else {
      el.textContent = text;
    }
    messagesEl.appendChild(el);
  });

  totalCost = session.cost || 0;
  if (totalCost > 0) {
    costEl.textContent = `$${totalCost.toFixed(4)}`;
  }

  scrollToBottom();
}

// ── Switch doc ──

function switchToDoc(docId, title) {
  if (docId === currentDocId) return;

  // Save current before switching
  saveCurrentSession();

  // Set new doc
  currentDocId = docId;
  docTitleEl.textContent = title || (docId ? docId.substring(0, 20) + '...' : 'No document');

  // Load its session
  loadSession(docId);

  // Tell the server
  if (ws && ws.readyState === WebSocket.OPEN && docId) {
    ws.send(JSON.stringify({ type: 'init', docId }));
  }
}

// ── Tab change handler (from background.js) ──

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TAB_CHANGED') {
    if (message.docId) {
      switchToDoc(message.docId, message.docTitle);
    }
    // If the tab has no doc, we keep the current session visible
    // (user can manually switch via dropdown)
  }
});

// ── Session switcher dropdown ──

function toggleSessionsDropdown() {
  const isOpen = !sessionsDropdownEl.classList.contains('hidden');
  if (isOpen) {
    closeSessionsDropdown();
  } else {
    openSessionsDropdown();
  }
}

function openSessionsDropdown() {
  // Make sure current session is saved so it shows in the list
  saveCurrentSession();

  const docIds = Object.keys(sessions);
  if (docIds.length === 0) {
    sessionsDropdownEl.innerHTML = '<div class="sessions-empty">No sessions yet</div>';
  } else {
    sessionsDropdownEl.innerHTML = docIds.map((docId) => {
      const s = sessions[docId];
      const msgCount = s.messages.length;
      const isActive = docId === currentDocId;
      return `<div class="session-item${isActive ? ' active' : ''}" data-doc-id="${docId}">
        <span class="session-title">${escapeHtml(s.title || docId)}</span>
        <span class="session-badge">${msgCount}</span>
      </div>`;
    }).join('');

    sessionsDropdownEl.querySelectorAll('.session-item').forEach((el) => {
      el.addEventListener('click', () => {
        const docId = el.dataset.docId;
        const s = sessions[docId];
        switchToDoc(docId, s?.title);
        closeSessionsDropdown();
      });
    });
  }

  sessionsDropdownEl.classList.remove('hidden');
  sessionToggleEl.classList.add('open');
}

function closeSessionsDropdown() {
  sessionsDropdownEl.classList.add('hidden');
  sessionToggleEl.classList.remove('open');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

sessionToggleEl.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSessionsDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!sessionsDropdownEl.contains(e.target) && !sessionToggleEl.contains(e.target)) {
    closeSessionsDropdown();
  }
});

// ── WebSocket ──

function connect() {
  setStatus('connecting');
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    setStatus('connected');
    if (currentDocId) {
      ws.send(JSON.stringify({ type: 'init', docId: currentDocId }));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    setStatus('disconnected');
    ws = null;
    setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ready':
      break;

    case 'stream':
      if (!currentStreamEl) {
        currentStreamEl = addMessage('assistant', '');
        currentStreamText = '';
      }
      currentStreamText += msg.text;
      currentStreamEl.innerHTML = renderMarkdown(currentStreamText);
      scrollToBottom();
      break;

    case 'tool_use':
      showToolIndicator(formatToolName(msg.toolName));
      break;

    case 'tool_result':
      hideToolIndicator();
      break;

    case 'done':
      hideToolIndicator();
      currentStreamEl = null;
      currentStreamText = '';
      totalCost += msg.cost || 0;
      costEl.textContent = `$${totalCost.toFixed(4)}`;
      setWaiting(false);
      saveCurrentSession();
      break;

    case 'error':
      hideToolIndicator();
      addMessage('error', msg.message);
      currentStreamEl = null;
      currentStreamText = '';
      setWaiting(false);
      saveCurrentSession();
      break;
  }
}

// ── UI ──

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message message-${role}`;
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(text);
  } else {
    el.textContent = text;
  }
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(status) {
  statusEl.className = `status status-${status}`;
  statusEl.title = status.charAt(0).toUpperCase() + status.slice(1);
}

function setWaiting(waiting) {
  isWaiting = waiting;
  sendBtn.disabled = waiting;
  inputEl.disabled = waiting;
  if (!waiting) inputEl.focus();
}

function showToolIndicator(label) {
  toolIndicatorEl.textContent = label;
  toolIndicatorEl.classList.remove('hidden');
}

function hideToolIndicator() {
  toolIndicatorEl.classList.add('hidden');
}

function formatToolName(name) {
  const labels = {
    'mcp__gdocs__get_doc_content': 'Reading document...',
    'mcp__gdocs__get_doc_structure': 'Analyzing structure...',
    'mcp__gdocs__get_doc_metadata': 'Getting metadata...',
    'mcp__gdocs__list_comments': 'Reading comments...',
    'mcp__gdocs__add_comment': 'Adding comment...',
    'mcp__gdocs__reply_to_comment': 'Posting reply...',
    'mcp__gdocs__resolve_comment': 'Resolving comment...',
    'mcp__gdocs__insert_text': 'Inserting text...',
    'mcp__gdocs__replace_text': 'Replacing text...',
    'mcp__gdocs__append_text': 'Appending text...',
    'mcp__gmail__search_emails': 'Searching emails...',
    'mcp__gmail__read_email': 'Reading email...',
    'mcp__gmail__read_thread': 'Reading thread...',
    'mcp__gmail__send_email': 'Sending email...',
    'mcp__gmail__reply_to_email': 'Replying to email...',
    'mcp__gmail__create_draft': 'Creating draft...',
    Read: 'Reading file...',
    Glob: 'Searching files...',
    Grep: 'Searching content...',
    WebSearch: 'Searching the web...',
    WebFetch: 'Fetching page...',
  };
  return labels[name] || `Running ${name}...`;
}

// ── Markdown (lightweight) ──

function renderMarkdown(text) {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong>$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>')
    // Lists
    .replace(/^- (.+)$/gm, '  \u2022 $1')
    // Line breaks
    .replace(/\n/g, '<br>');
}

// ── Skills ──

// Built-in quick actions (always available)
const BUILTIN_SKILLS = [
  { cmd: '/summarize', desc: 'Summarize the document content and open comments' },
  { cmd: '/comments', desc: 'List and analyze all open comments' },
  { cmd: '/reply-comments', desc: 'Draft replies to all open comments' },
  { cmd: '/polish', desc: 'Rewrite for clarity and conciseness' },
];

// Skills loaded from server (populated on init)
let serverSkills = [];

// All skills combined
let SKILLS = [];

async function loadSkillsFromServer() {
  try {
    const resp = await fetch('http://localhost:3456/skills');
    if (resp.ok) {
      serverSkills = await resp.json();
      // Merge: built-in first, then server skills (commands then skills)
      const serverItems = serverSkills.map(s => ({
        cmd: s.name.startsWith('/') ? s.name : `/${s.name}`,
        desc: s.description,
      }));
      // Deduplicate: server skills override built-ins with the same name
      const serverCmds = new Set(serverItems.map(s => s.cmd));
      const uniqueBuiltins = BUILTIN_SKILLS.filter(s => !serverCmds.has(s.cmd));
      SKILLS = [...uniqueBuiltins, ...serverItems];
      console.log(`Loaded ${serverSkills.length} skills from server`);
    }
  } catch {
    // Server not available, use built-ins only
    SKILLS = [...BUILTIN_SKILLS];
  }
}

const skillsMenuEl = document.getElementById('skills-menu');
let activeSkillIndex = -1;

function showSkillsMenu(filter = '') {
  const filtered = SKILLS.filter(s =>
    s.cmd.includes(filter.toLowerCase()) || s.desc.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    hideSkillsMenu();
    return;
  }

  activeSkillIndex = 0;
  skillsMenuEl.innerHTML = filtered.map((s, i) =>
    `<div class="skill-item${i === 0 ? ' active' : ''}" data-index="${i}">
      <span class="skill-name">${s.cmd}</span>
      <span class="skill-desc">${s.desc}</span>
    </div>`
  ).join('');

  skillsMenuEl.classList.remove('hidden');

  // Click handlers
  skillsMenuEl.querySelectorAll('.skill-item').forEach((el, i) => {
    el.addEventListener('click', () => selectSkill(filtered[i]));
    el.addEventListener('mouseenter', () => {
      activeSkillIndex = i;
      highlightSkill();
    });
  });
}

function hideSkillsMenu() {
  skillsMenuEl.classList.add('hidden');
  activeSkillIndex = -1;
}

function highlightSkill() {
  skillsMenuEl.querySelectorAll('.skill-item').forEach((el, i) => {
    el.classList.toggle('active', i === activeSkillIndex);
  });
}

function selectSkill(skill) {
  // Insert the command name — the server will load the full skill context
  inputEl.value = `${skill.cmd} `;
  hideSkillsMenu();
  autoResize();
  inputEl.focus();
}

// ── Doc ID helpers ──

function extractDocId(text) {
  const match = text.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function setDocId(docId, title) {
  currentDocId = docId;
  docTitleEl.textContent = title || docId.substring(0, 20) + '...';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'init', docId }));
  }
}

// ── Send message ──

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isWaiting || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Auto-detect doc ID from pasted URLs
  if (!currentDocId) {
    const docId = extractDocId(text);
    if (docId) {
      setDocId(docId);
    }
  }

  addMessage('user', text);
  inputEl.value = '';
  autoResize();
  setWaiting(true);
  saveCurrentSession();

  ws.send(JSON.stringify({
    type: 'chat',
    docId: currentDocId,
    message: text,
  }));
}

// ── Input handling ──

inputEl.addEventListener('keydown', (e) => {
  // Skills menu navigation
  if (!skillsMenuEl.classList.contains('hidden')) {
    const items = skillsMenuEl.querySelectorAll('.skill-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSkillIndex = Math.min(activeSkillIndex + 1, items.length - 1);
      highlightSkill();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSkillIndex = Math.max(activeSkillIndex - 1, 0);
      highlightSkill();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const filter = inputEl.value.slice(1).toLowerCase();
      const filtered = SKILLS.filter(s =>
        s.cmd.includes(filter) || s.desc.toLowerCase().includes(filter)
      );
      if (filtered[activeSkillIndex]) {
        selectSkill(filtered[activeSkillIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSkillsMenu();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  autoResize();
  const text = inputEl.value;
  if (text.startsWith('/') && !text.includes(' ')) {
    showSkillsMenu(text.slice(1));
  } else {
    hideSkillsMenu();
  }
});

sendBtn.addEventListener('click', sendMessage);

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

// ── Init ──

async function init() {
  // Load persisted sessions
  await loadSessions();

  // Load real skills from server
  SKILLS = [...BUILTIN_SKILLS]; // start with built-ins
  loadSkillsFromServer(); // async, will update SKILLS when ready

  // Try 1: ask background for cached doc info
  chrome.runtime.sendMessage({ type: 'GET_CURRENT_DOC' }, (doc) => {
    if (doc && doc.docId) {
      setDocId(doc.docId, doc.docTitle);
      loadSession(doc.docId);
    }
  });

  // Try 2: read the active tab URL directly
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const docId = extractDocId(tab.url);
      if (docId && !currentDocId) {
        const title = tab.title?.replace(/ - Google Docs$/, '') || '';
        setDocId(docId, title);
        loadSession(docId);
      }
    }
  } catch {
    // tabs API may not be available in all contexts
  }

  if (!currentDocId) {
    docTitleEl.textContent = 'Paste a Google Doc URL to start';
  }

  connect();
}

init();
