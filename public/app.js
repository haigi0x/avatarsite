// === State ===
let siteData = null;
let voiceEnabled = true;
let isListening = false;
let recognition = null;

// === URL読み込み ===
document.getElementById('load-btn').addEventListener('click', loadSite);
document.getElementById('url-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loadSite();
});

async function loadSite() {
  let url = document.getElementById('url-input').value.trim();
  if (!url) return;

  // プロトコル補完
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    document.getElementById('url-input').value = url;
  }

  const loading = document.getElementById('loading-indicator');
  loading.classList.remove('hidden');

  try {
    // 1. サイト分析
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'サイトの取得に失敗しました');
    }

    siteData = await res.json();

    // 2. サービス内ブラウザで表示
    const frame = document.getElementById('site-frame');
    const welcome = document.getElementById('welcome-screen');
    frame.src = '/api/proxy?url=' + encodeURIComponent(url);
    frame.classList.remove('hidden');
    welcome.classList.add('hidden');

    // 3. クイックアクション表示
    document.getElementById('quick-actions').classList.remove('hidden');

    // 4. アバターが自動で案内開始
    showNotification();
    const greeting = buildGreeting(siteData);
    addBotMessage(greeting);
    speak(greeting);

    // 5. チャットを自動オープン
    openChat();

  } catch (error) {
    addBotMessage(`エラー: ${error.message}`);
    openChat();
  } finally {
    loading.classList.add('hidden');
  }
}

function buildGreeting(data) {
  let msg = `「${data.title}」を読み込みました！\n\n`;

  if (data.description) {
    msg += `${data.description}\n\n`;
  }

  if (data.products.length > 0) {
    msg += `🛒 ${data.products.length}件の商品が見つかりました。\n`;
  }

  if (data.navigation.length > 0) {
    msg += `📑 ${data.navigation.length}件のメニューがあります。\n`;
  }

  if (data.sections.length > 0) {
    msg += `📄 ${data.sections.length}件のセクションを検出しました。\n`;
  }

  msg += '\n何について知りたいですか？下のボタンか、自由に質問してください。';

  return msg;
}

// === チャット ===
function toggleChat() {
  const chatWindow = document.getElementById('chat-window');
  const isHidden = chatWindow.classList.contains('hidden');
  if (isHidden) {
    openChat();
  } else {
    chatWindow.classList.add('hidden');
  }
}

function openChat() {
  document.getElementById('chat-window').classList.remove('hidden');
  document.getElementById('notification-dot').classList.add('hidden');
  scrollToBottom();
}

function showNotification() {
  document.getElementById('notification-dot').classList.remove('hidden');
}

function addBotMessage(text) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message bot';
  div.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function addUserMessage(text) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function showTyping() {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message bot';
  div.id = 'typing';
  div.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
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

  // アバターの口を動かす
  setTalking(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, siteData }),
    });
    const data = await res.json();

    hideTyping();
    addBotMessage(data.reply);
    speak(data.reply);

    // ハイライト処理
    if (data.highlights && data.highlights.length > 0) {
      handleHighlights(data.highlights);
    }
  } catch (error) {
    hideTyping();
    addBotMessage('すみません、応答の生成に失敗しました。');
  }

  setTalking(false);
}

function sendQuick(text) {
  document.getElementById('chat-input').value = text;
  sendMessage();
}

// === ハイライト（サイト内ブラウザへの操作） ===
function handleHighlights(highlights) {
  highlights.forEach(h => {
    if (h.type === 'navigation' && h.data.length > 0) {
      // ナビゲーションのリンクをメッセージとして表示
      let navMsg = '📌 関連リンク:\n';
      h.data.forEach(item => {
        navMsg += `・${item.text}\n`;
      });
      addBotMessage(navMsg);
    }
  });
}

// === 音声合成 ===
function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  const btn = document.getElementById('voice-toggle');
  btn.textContent = voiceEnabled ? '🔊' : '🔇';
}

function speak(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;

  // 前の発話を停止
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text.replace(/[🔍💬🔊🛒📋📑📞📌📄]/g, ''));
  utterance.lang = 'ja-JP';
  utterance.rate = 1.1;
  utterance.pitch = 1.0;

  // 日本語音声を選択
  const voices = window.speechSynthesis.getVoices();
  const jpVoice = voices.find(v => v.lang.startsWith('ja'));
  if (jpVoice) utterance.voice = jpVoice;

  utterance.onstart = () => setTalking(true);
  utterance.onend = () => setTalking(false);

  window.speechSynthesis.speak(utterance);
}

// === 音声認識 ===
function toggleMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    addBotMessage('お使いのブラウザは音声認識に対応していません。');
    return;
  }

  if (isListening) {
    stopListening();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
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

// === アバター表情 ===
function setTalking(isTalking) {
  const mouths = document.querySelectorAll('.avatar-mouth');
  mouths.forEach(m => {
    if (isTalking) {
      m.classList.add('talking');
    } else {
      m.classList.remove('talking');
    }
  });
}

// 目がマウスを追う
document.addEventListener('mousemove', (e) => {
  const eyes = document.querySelectorAll('.eye');
  eyes.forEach(eye => {
    const rect = eye.getBoundingClientRect();
    const eyeCenterX = rect.left + rect.width / 2;
    const eyeCenterY = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - eyeCenterY, e.clientX - eyeCenterX);
    const distance = 2;
    eye.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
  });
});

// 音声リスト読み込み（一部ブラウザで必要）
window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
  window.speechSynthesis.getVoices();
});
