// === State ===
let currentPage = 'dashboard';
let knowledgeItems = [];
let settings = {};
let conversationLogs = [];

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  renderDashboard();
  renderKnowledgeList();

  // Load settings into form
  if (settings.characterName) {
    document.getElementById('setting-name').value = settings.characterName;
  }
  if (settings.welcomeMessage) {
    document.getElementById('setting-welcome').value = settings.welcomeMessage;
  }
  if (settings.defaultSuggestions) {
    document.getElementById('setting-suggestions').value = settings.defaultSuggestions.join('\n');
  }
  if (settings.modePrompt) {
    document.getElementById('mode-prompt').value = settings.modePrompt;
  }
});

async function loadAllData() {
  try {
    const [kbRes, settingsRes, logsRes] = await Promise.all([
      fetch('/api/knowledge').catch(() => null),
      fetch('/api/settings').catch(() => null),
      fetch('/api/conversations').catch(() => null),
    ]);

    if (kbRes && kbRes.ok) {
      const data = await kbRes.json();
      knowledgeItems = data.items || [];
    }
    if (settingsRes && settingsRes.ok) {
      settings = await settingsRes.json();
    }
    if (logsRes && logsRes.ok) {
      conversationLogs = await logsRes.json();
    }
  } catch (e) {
    console.error('Failed to load data:', e);
  }
}

// === Navigation ===
function navigateTo(page) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });

  currentPage = page;
}

// === Dashboard ===
function renderDashboard() {
  const today = new Date().toISOString().split('T')[0];
  const todayLogs = conversationLogs.filter(l => l.date && l.date.startsWith(today));

  document.getElementById('stat-conversations').textContent = conversationLogs.length;
  document.getElementById('stat-users').textContent = new Set(conversationLogs.map(l => l.userId || 'anonymous')).size;
  document.getElementById('stat-conv-change').textContent = todayLogs.length > 0 ? `+${todayLogs.length}` : '--';
  document.getElementById('stat-mode').textContent = settings.activeMode || 'Default';

  // Conversation history table
  const tbody = document.getElementById('conversation-history');
  if (conversationLogs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">会話履歴はまだありません</td></tr>';
    return;
  }

  tbody.innerHTML = conversationLogs.slice(-10).reverse().map(log => `
    <tr>
      <td>${formatDate(log.date)}</td>
      <td><span class="mode-badge">${escapeHtml(log.mode || 'Default')}</span></td>
      <td>${escapeHtml((log.lastMessage || '').slice(0, 60))}</td>
      <td><button class="detail-btn">詳細</button></td>
    </tr>
  `).join('');
}

// === Chat Test ===
async function sendTestMessage() {
  const input = document.getElementById('test-chat-input');
  const text = input.value.trim();
  if (!text) return;

  const messagesEl = document.getElementById('test-chat-messages');

  // Remove empty state
  const empty = messagesEl.querySelector('.test-empty-state');
  if (empty) empty.remove();

  // Add user message
  const userDiv = document.createElement('div');
  userDiv.className = 'test-message user';
  userDiv.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  messagesEl.appendChild(userDiv);

  input.value = '';
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: [] }),
    });
    const data = await res.json();

    const botDiv = document.createElement('div');
    botDiv.className = 'test-message bot';
    botDiv.innerHTML = `<div class="bubble">${escapeHtml(data.reply)}</div>`;
    messagesEl.appendChild(botDiv);
  } catch (e) {
    const errDiv = document.createElement('div');
    errDiv.className = 'test-message bot';
    errDiv.innerHTML = `<div class="bubble">エラーが発生しました</div>`;
    messagesEl.appendChild(errDiv);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// === Knowledge Base ===
function showAddKnowledge() {
  document.getElementById('knowledge-form').classList.remove('hidden');
}

function hideAddKnowledge() {
  document.getElementById('knowledge-form').classList.add('hidden');
  document.getElementById('kb-title').value = '';
  document.getElementById('kb-content').value = '';
  document.getElementById('kb-url').value = '';
}

async function saveKnowledge() {
  const category = document.getElementById('kb-category').value;
  const title = document.getElementById('kb-title').value.trim();
  const content = document.getElementById('kb-content').value.trim();
  const url = document.getElementById('kb-url').value.trim();

  if (!title || !content) {
    showToast('タイトルと内容は必須です');
    return;
  }

  const item = {
    id: Date.now().toString(),
    category,
    title,
    content,
    url: url || null,
    createdAt: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });

    if (res.ok) {
      knowledgeItems.push(item);
      renderKnowledgeList();
      hideAddKnowledge();
      showToast('知識アイテムを追加しました');
    }
  } catch (e) {
    showToast('保存に失敗しました');
  }
}

async function deleteKnowledge(id) {
  try {
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    knowledgeItems = knowledgeItems.filter(i => i.id !== id);
    renderKnowledgeList();
    showToast('削除しました');
  } catch (e) {
    showToast('削除に失敗しました');
  }
}

function renderKnowledgeList() {
  const container = document.getElementById('knowledge-list');
  const emptyEl = document.getElementById('knowledge-empty');

  if (knowledgeItems.length === 0) {
    container.innerHTML = '<div class="empty-card" id="knowledge-empty"><p>知識ベースにアイテムがまだ登録されていません</p></div>';
    return;
  }

  const categoryLabels = {
    company: '会社情報',
    service: 'サービス・製品',
    faq: 'よくある質問',
    contact: 'お問い合わせ',
    other: 'その他',
  };

  container.innerHTML = knowledgeItems.map(item => `
    <div class="knowledge-item">
      <div class="knowledge-item-header">
        <span class="knowledge-item-title">${escapeHtml(item.title)}</span>
        <span class="knowledge-item-category">${categoryLabels[item.category] || item.category}</span>
      </div>
      <div class="knowledge-item-content">${escapeHtml(item.content.slice(0, 200))}${item.content.length > 200 ? '...' : ''}</div>
      ${item.url ? `<div class="knowledge-item-url">${escapeHtml(item.url)}</div>` : ''}
      <div class="knowledge-item-actions">
        <button class="btn-danger" onclick="deleteKnowledge('${item.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          削除
        </button>
      </div>
    </div>
  `).join('');
}

// === Mode Management ===
async function saveMode() {
  const prompt = document.getElementById('mode-prompt').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, modePrompt: prompt }),
    });

    if (res.ok) {
      settings.modePrompt = prompt;
      // Increment version
      const versionEl = document.getElementById('prompt-version');
      const current = parseInt(versionEl.textContent.replace('v', '')) || 1;
      versionEl.textContent = `v${current + 1}`;
      showToast('プロンプトを保存しました');
    }
  } catch (e) {
    showToast('保存に失敗しました');
  }
}

// === Settings ===
async function saveSettings() {
  const name = document.getElementById('setting-name').value.trim();
  const welcome = document.getElementById('setting-welcome').value.trim();
  const suggestions = document.getElementById('setting-suggestions').value.trim().split('\n').filter(s => s.trim());
  const mode = document.getElementById('setting-mode').value;

  const newSettings = {
    ...settings,
    characterName: name || 'AIアシスタント',
    welcomeMessage: welcome,
    defaultSuggestions: suggestions,
    activeMode: mode,
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    });

    if (res.ok) {
      settings = newSettings;
      showToast('設定を保存しました');
    }
  } catch (e) {
    showToast('保存に失敗しました');
  }
}

// === Utils ===
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2500);
}
