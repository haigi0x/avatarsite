// === State ===
let siteData = null;
let knowledgeBase = [];
let voiceEnabled = true;
let isListening = false;
let recognition = null;
let conversationHistory = [];

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
  // Load knowledge base and settings
  try {
    const [kbRes, settingsRes] = await Promise.all([
      fetch('/api/knowledge').catch(() => null),
      fetch('/api/settings').catch(() => null),
    ]);

    if (kbRes && kbRes.ok) {
      const kbData = await kbRes.json();
      knowledgeBase = kbData.items || [];
    }

    if (settingsRes && settingsRes.ok) {
      const settings = await settingsRes.json();
      if (settings.characterName) {
        document.getElementById('avatar-name').textContent = settings.characterName;
      }
    }
  } catch (e) {
    // Silently continue with defaults
  }

  // Eye tracking
  document.addEventListener('mousemove', (e) => {
    const eyes = document.querySelectorAll('.eye');
    eyes.forEach(eye => {
      const rect = eye.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const d = 2;
      eye.style.transform = `translate(${Math.cos(angle) * d}px, ${Math.sin(angle) * d}px)`;
    });
  });

  // Voice list
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      window.speechSynthesis.getVoices();
    });
  }
});

// === Chat ===
function handleChatKey(e) {
  if (e.key === 'Enter') sendMessage();
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  addUserMessage(text);
  input.value = '';
  showTyping();
  setTalking(true);

  // Hide welcome, show content area
  document.getElementById('welcome-screen').classList.add('hidden');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        siteData,
        history: conversationHistory.slice(-10),
      }),
    });
    const data = await res.json();

    hideTyping();
    addBotMessage(data.reply);
    speak(data.reply);

    // Track conversation
    conversationHistory.push(
      { role: 'user', content: text },
      { role: 'assistant', content: data.reply }
    );

    // Update right panel
    updateRightPanel(data);

  } catch (error) {
    hideTyping();
    addBotMessage('申し訳ありません、応答の生成に失敗しました。');
  }

  setTalking(false);
}

function sendSuggestion(btn) {
  document.getElementById('chat-input').value = btn.textContent;
  sendMessage();
}

// === Right Panel Updates ===
function updateRightPanel(data) {
  // AI Summary
  if (data.summary) {
    const summaryEl = document.getElementById('ai-summary');
    const contentEl = document.getElementById('summary-content');
    summaryEl.classList.remove('hidden');

    let html = '';
    if (data.summary.highlight) {
      html += `<div class="summary-highlight">${escapeHtml(data.summary.highlight)}</div>`;
    }
    if (data.summary.sections) {
      data.summary.sections.forEach(s => {
        html += `<div class="summary-section"><h4>${escapeHtml(s.title)}</h4><p>${escapeHtml(s.content)}</p></div>`;
      });
    }
    if (!html && data.summary.text) {
      html = `<p>${escapeHtml(data.summary.text)}</p>`;
    }
    contentEl.innerHTML = html;
  }

  // Related Pages
  if (data.relatedPages && data.relatedPages.length > 0) {
    const container = document.getElementById('related-pages');
    const linksEl = document.getElementById('related-links');
    container.classList.remove('hidden');

    linksEl.innerHTML = data.relatedPages.map(page => `
      <div class="related-link" onclick="openPagePreview('${escapeAttr(page.url)}', '${escapeAttr(page.title)}')">
        <div class="related-link-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div class="related-link-text">
          <div class="related-link-title">${escapeHtml(page.title)}</div>
          <div class="related-link-url">${escapeHtml(page.url || '')}</div>
        </div>
        <div class="related-link-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `).join('');
  }

  // Dynamic Content Cards
  if (data.contentCards && data.contentCards.length > 0) {
    const container = document.getElementById('dynamic-content');
    const cardsEl = document.getElementById('content-cards');
    container.classList.remove('hidden');

    cardsEl.innerHTML = data.contentCards.map(card => `
      <div class="content-card">
        <div class="content-card-header">
          <div class="content-card-icon">${card.icon || '📄'}</div>
          <div class="content-card-title">${escapeHtml(card.title)}</div>
        </div>
        <div class="content-card-body">${escapeHtml(card.content)}</div>
        ${card.link ? `<a class="content-card-link" onclick="openPagePreview('${escapeAttr(card.link)}', '${escapeAttr(card.title)}')">詳しく見る →</a>` : ''}
      </div>
    `).join('');
  }

  // Suggested Questions
  if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
    updateSuggestions(data.suggestedQuestions);
  }
}

function updateSuggestions(questions) {
  const list = document.getElementById('suggestions-list');
  list.innerHTML = questions.map(q =>
    `<button class="suggestion-btn" onclick="sendSuggestion(this)">${escapeHtml(q)}</button>`
  ).join('');
}

// === Site Preview ===
function openPagePreview(url, title) {
  const previewEl = document.getElementById('site-preview');
  const titleEl = document.getElementById('preview-title');
  const frameEl = document.getElementById('site-frame');

  previewEl.classList.remove('hidden');
  titleEl.textContent = title || 'ページプレビュー';
  frameEl.src = '/api/proxy?url=' + encodeURIComponent(url);
}

function closeSitePreview() {
  document.getElementById('site-preview').classList.add('hidden');
  document.getElementById('site-frame').src = '';
}

// === Message rendering ===
function addBotMessage(text) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message bot';
  div.innerHTML = `
    <div class="message-avatar">
      <div class="mini-avatar">
        <div class="mini-eyes">
          <div class="mini-eye"></div>
          <div class="mini-eye"></div>
        </div>
      </div>
    </div>
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function addUserMessage(text) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = `
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function showTyping() {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message bot';
  div.id = 'typing';
  div.innerHTML = `
    <div class="message-avatar">
      <div class="mini-avatar">
        <div class="mini-eyes">
          <div class="mini-eye"></div>
          <div class="mini-eye"></div>
        </div>
      </div>
    </div>
    <div class="message-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function hideTyping() {
  const el = document.getElementById('typing');
  if (el) el.remove();
}

function scrollToBottom() {
  const messages = document.getElementById('chat-messages');
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// === Voice ===
function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  document.getElementById('voice-icon-on').classList.toggle('hidden', !voiceEnabled);
  document.getElementById('voice-icon-off').classList.toggle('hidden', voiceEnabled);
}

function speak(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const clean = text.replace(/[🔍💬🔊🛒📋📑📞📌📄✨🏢💡📎🔗]/g, '');
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'ja-JP';
  utterance.rate = 1.1;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const jpVoice = voices.find(v => v.lang.startsWith('ja'));
  if (jpVoice) utterance.voice = jpVoice;

  utterance.onstart = () => setTalking(true);
  utterance.onend = () => setTalking(false);

  window.speechSynthesis.speak(utterance);
}

// === Mic ===
function toggleMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    addBotMessage('お使いのブラウザは音声認識に対応していません。');
    return;
  }

  if (isListening) {
    stopListening();
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'ja-JP';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    document.getElementById('chat-input').value = text;
    sendMessage();
    stopListening();
  };

  recognition.onerror = () => stopListening();
  recognition.onend = () => stopListening();

  recognition.start();
  isListening = true;
  document.getElementById('mic-btn').classList.add('active');
}

function stopListening() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  isListening = false;
  document.getElementById('mic-btn').classList.remove('active');
}

// === Avatar ===
function setTalking(isTalking) {
  const mouth = document.getElementById('avatar-mouth');
  if (mouth) {
    mouth.classList.toggle('talking', isTalking);
  }
}
