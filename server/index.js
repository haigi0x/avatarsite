const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Data paths
const DATA_DIR = path.join(__dirname, 'data');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper: read/write JSON
function readJSON(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return defaultValue;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// Knowledge Base API
// ============================================================
app.get('/api/knowledge', (req, res) => {
  const items = readJSON(KNOWLEDGE_FILE, []);
  res.json({ items });
});

app.post('/api/knowledge', (req, res) => {
  const items = readJSON(KNOWLEDGE_FILE, []);
  const item = req.body;
  if (!item.title || !item.content) {
    return res.status(400).json({ error: 'タイトルと内容は必須です' });
  }
  items.push(item);
  writeJSON(KNOWLEDGE_FILE, items);
  res.json({ success: true });
});

app.delete('/api/knowledge/:id', (req, res) => {
  let items = readJSON(KNOWLEDGE_FILE, []);
  items = items.filter(i => i.id !== req.params.id);
  writeJSON(KNOWLEDGE_FILE, items);
  res.json({ success: true });
});

// ============================================================
// Settings API
// ============================================================
app.get('/api/settings', (req, res) => {
  const settings = readJSON(SETTINGS_FILE, {
    characterName: 'AIアシスタント',
    welcomeMessage: 'こんにちは！何についてお聞きになりたいですか？',
    defaultSuggestions: [
      'どんなサービスを提供していますか？',
      '会社の特徴を教えてください',
      'お問い合わせ方法は？',
    ],
    activeMode: 'default',
    modePrompt: '',
  });
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  writeJSON(SETTINGS_FILE, req.body);
  res.json({ success: true });
});

// ============================================================
// Conversations API
// ============================================================
app.get('/api/conversations', (req, res) => {
  const logs = readJSON(CONVERSATIONS_FILE, []);
  res.json(logs);
});

// ============================================================
// Site Analysis API
// ============================================================
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URLが必要です' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    const navigation = [];
    $('nav a, header a, .nav a, .menu a, .navigation a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (text && href && text.length < 50) {
        try {
          navigation.push({ text, href: new URL(href, url).toString() });
        } catch (e) {}
      }
    });
    const uniqueNav = [...new Map(navigation.map(n => [n.text, n])).values()].slice(0, 20);

    const sections = [];
    $('h1, h2, h3').each((i, el) => {
      const heading = $(el).text().trim();
      const level = el.tagName;
      let content = '';
      let sibling = $(el).next();
      let count = 0;
      while (sibling.length && count < 5) {
        const tag = sibling.prop('tagName');
        if (tag && tag.match(/^H[1-3]$/)) break;
        const text = sibling.text().trim();
        if (text) content += text + ' ';
        sibling = sibling.next();
        count++;
      }
      if (heading) {
        sections.push({ heading, level, content: content.trim().slice(0, 300) });
      }
    });

    const products = [];
    $('[class*="product"], [class*="item"], [class*="card"]').each((i, el) => {
      const name = $(el).find('h2, h3, h4, [class*="name"], [class*="title"]').first().text().trim();
      const price = $(el).find('[class*="price"], [class*="cost"]').first().text().trim();
      const image = $(el).find('img').first().attr('src');
      const link = $(el).find('a').first().attr('href');
      if (name && name.length < 100) {
        products.push({
          name,
          price: price || null,
          image: image ? new URL(image, url).toString() : null,
          link: link ? new URL(link, url).toString() : null,
        });
      }
    });

    const ctas = [];
    $('a[href*="contact"], a[href*="inquiry"], a[href*="cart"], [class*="cta"]').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (text && text.length < 50) {
        try {
          ctas.push({ text, href: href ? new URL(href, url).toString() : null });
        } catch (e) {}
      }
    });

    const footerInfo = $('footer').text().trim().slice(0, 500);

    const siteData = {
      url,
      title,
      description,
      ogImage,
      navigation: uniqueNav,
      sections: sections.slice(0, 30),
      products: products.slice(0, 50),
      ctas: ctas.slice(0, 10),
      footerInfo,
      analyzedAt: new Date().toISOString(),
    };

    res.json(siteData);
  } catch (error) {
    console.error('Scraping error:', error.message);
    res.status(500).json({ error: `サイトの取得に失敗しました: ${error.message}` });
  }
});

// ============================================================
// Proxy API
// ============================================================
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URLが必要です' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
      timeout: 15000,
      responseType: 'text',
    });

    let html = response.data;
    const baseUrl = new URL(url);
    const baseTag = `<base href="${baseUrl.origin}/" target="_blank">`;
    html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).send(`<html><body><h2>サイトを読み込めませんでした</h2><p>${error.message}</p></body></html>`);
  }
});

// ============================================================
// Chat API - Enhanced with knowledge base, summary, suggestions
// ============================================================
app.post('/api/chat', (req, res) => {
  const { message, siteData, history } = req.body;
  const knowledge = readJSON(KNOWLEDGE_FILE, []);
  const settings = readJSON(SETTINGS_FILE, {});
  const msg = (message || '').toLowerCase();

  // Find relevant knowledge items
  const relevantKB = findRelevantKnowledge(msg, knowledge);

  // Generate reply
  let reply = '';
  let summary = null;
  let relatedPages = [];
  let contentCards = [];
  let suggestedQuestions = [];

  if (relevantKB.length > 0) {
    // Knowledge-based response
    const topItem = relevantKB[0];
    reply = topItem.content;

    if (relevantKB.length > 1) {
      reply += '\n\n関連する情報もございます。右側のパネルで詳細をご確認ください。';
    }

    // Build summary
    summary = {
      highlight: topItem.content.slice(0, 150),
      sections: relevantKB.slice(0, 3).map(k => ({
        title: k.title,
        content: k.content.slice(0, 200),
      })),
    };

    // Build related pages
    relatedPages = relevantKB
      .filter(k => k.url)
      .map(k => ({ title: k.title, url: k.url }));

    // Build content cards
    contentCards = relevantKB.map(k => ({
      icon: getCategoryIcon(k.category),
      title: k.title,
      content: k.content.slice(0, 150),
      link: k.url || null,
    }));

    // Generate follow-up questions
    suggestedQuestions = generateSuggestions(msg, knowledge, relevantKB);

  } else if (siteData) {
    // Site-data based response (fallback)
    const result = generateSiteResponse(msg, siteData);
    reply = result.reply;
    summary = result.summary;
    relatedPages = result.relatedPages;
    contentCards = result.contentCards;
    suggestedQuestions = result.suggestedQuestions;

  } else {
    // No data available - general response
    reply = generateGeneralResponse(msg, knowledge);
    suggestedQuestions = getDefaultSuggestions(knowledge, settings);
  }

  // Log conversation
  logConversation(message, reply, settings.activeMode || 'Default');

  res.json({
    reply,
    summary,
    relatedPages,
    contentCards,
    suggestedQuestions,
  });
});

// === Knowledge search ===
function findRelevantKnowledge(query, knowledge) {
  if (!knowledge || knowledge.length === 0) return [];

  const queryWords = query.split(/[\s,。、！？]+/).filter(w => w.length > 1);

  const scored = knowledge.map(item => {
    let score = 0;
    const text = (item.title + ' ' + item.content + ' ' + (item.category || '')).toLowerCase();

    queryWords.forEach(word => {
      if (text.includes(word)) score += 2;
      if (item.title.toLowerCase().includes(word)) score += 3;
    });

    // Category matching
    if (query.includes('会社') && item.category === 'company') score += 3;
    if (query.includes('サービス') && item.category === 'service') score += 3;
    if (query.includes('製品') && item.category === 'service') score += 3;
    if ((query.includes('質問') || query.includes('faq')) && item.category === 'faq') score += 3;
    if (query.includes('問い合わせ') && item.category === 'contact') score += 3;
    if (query.includes('連絡') && item.category === 'contact') score += 3;

    return { ...item, score };
  });

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
}

function generateSuggestions(query, allKB, matchedKB) {
  const suggestions = [];
  const matchedCategories = new Set(matchedKB.map(k => k.category));

  // Suggest from other categories
  const categoryQuestions = {
    company: '会社についてもっと教えてください',
    service: '提供しているサービスの詳細は？',
    faq: 'よくある質問を教えてください',
    contact: 'お問い合わせ方法を教えてください',
  };

  for (const [cat, question] of Object.entries(categoryQuestions)) {
    if (!matchedCategories.has(cat) && allKB.some(k => k.category === cat)) {
      suggestions.push(question);
    }
  }

  // Suggest drilling down on matched items
  matchedKB.slice(1, 3).forEach(k => {
    suggestions.push(`${k.title}について詳しく教えて`);
  });

  return suggestions.slice(0, 3);
}

function getDefaultSuggestions(knowledge, settings) {
  if (settings.defaultSuggestions && settings.defaultSuggestions.length > 0) {
    return settings.defaultSuggestions;
  }

  const suggestions = [];
  const categories = [...new Set(knowledge.map(k => k.category))];

  if (categories.includes('company')) suggestions.push('会社概要を教えてください');
  if (categories.includes('service')) suggestions.push('どんなサービスがありますか？');
  if (categories.includes('faq')) suggestions.push('よくある質問を見たいです');
  if (categories.includes('contact')) suggestions.push('お問い合わせ先を知りたいです');

  if (suggestions.length === 0) {
    suggestions.push('どんなサービスを提供していますか？', '会社の特徴を教えてください', 'お問い合わせ方法は？');
  }

  return suggestions.slice(0, 3);
}

function getCategoryIcon(category) {
  const icons = {
    company: '🏢',
    service: '💡',
    faq: '❓',
    contact: '📞',
    other: '📄',
  };
  return icons[category] || '📄';
}

// === Site-data based response ===
function generateSiteResponse(msg, siteData) {
  let reply = '';
  let summary = null;
  let relatedPages = [];
  let contentCards = [];
  let suggestedQuestions = [];

  if (msg.includes('概要') || msg.includes('教えて') || msg.includes('紹介') || msg.includes('何のサイト')) {
    reply = `こちらは「${siteData.title}」というサイトです。`;
    if (siteData.description) reply += `\n${siteData.description}`;

    summary = {
      highlight: siteData.description || siteData.title,
      sections: siteData.sections.slice(0, 3).map(s => ({
        title: s.heading,
        content: s.content || '(詳細はページをご覧ください)',
      })),
    };

    relatedPages = siteData.navigation.slice(0, 5).map(n => ({
      title: n.text,
      url: n.href,
    }));

    suggestedQuestions = ['商品やサービスの詳細は？', 'お問い合わせ方法は？', 'メニュー一覧を教えて'];

  } else if (msg.includes('商品') || msg.includes('製品') || msg.includes('アイテム')) {
    if (siteData.products.length > 0) {
      reply = '見つかった商品をご紹介します：\n';
      siteData.products.slice(0, 5).forEach(p => {
        reply += `\n・${p.name}`;
        if (p.price) reply += ` (${p.price})`;
      });

      contentCards = siteData.products.slice(0, 6).map(p => ({
        icon: '🛒',
        title: p.name,
        content: p.price || '',
        link: p.link,
      }));

      suggestedQuestions = ['他の商品も見たい', 'おすすめの商品は？', '問い合わせ方法は？'];
    } else {
      reply = 'このサイトでは商品情報が見つかりませんでした。';
      suggestedQuestions = ['サイトの概要を教えて', 'メニュー一覧は？'];
    }

  } else if (msg.includes('メニュー') || msg.includes('ページ') || msg.includes('ナビ')) {
    if (siteData.navigation.length > 0) {
      reply = 'サイトのメニュー一覧です：\n';
      siteData.navigation.forEach(n => {
        reply += `\n・${n.text}`;
      });

      relatedPages = siteData.navigation.map(n => ({
        title: n.text,
        url: n.href,
      }));

      suggestedQuestions = ['サイトの概要は？', '商品情報を教えて', 'お問い合わせ先は？'];
    }

  } else if (msg.includes('問い合わせ') || msg.includes('連絡') || msg.includes('コンタクト')) {
    if (siteData.ctas.length > 0) {
      reply = 'お問い合わせ関連のリンクがあります：\n';
      siteData.ctas.slice(0, 3).forEach(c => {
        reply += `\n・${c.text}`;
      });

      relatedPages = siteData.ctas.filter(c => c.href).map(c => ({
        title: c.text,
        url: c.href,
      }));
    } else {
      reply = 'お問い合わせページの情報が見つかりませんでした。';
    }
    suggestedQuestions = ['サイトの概要を教えて', '商品について知りたい'];

  } else {
    reply = `ご質問ありがとうございます。「${siteData.title}」について、以下のことをお聞きいただけます：\n\n・サイトの概要\n・商品情報\n・メニュー一覧\n・お問い合わせ先`;
    suggestedQuestions = ['概要を教えて', '商品情報を見たい', 'お問い合わせ先は？'];
  }

  return { reply, summary, relatedPages, contentCards, suggestedQuestions };
}

// === General response (no site data, no knowledge match) ===
function generateGeneralResponse(msg, knowledge) {
  if (knowledge.length === 0) {
    return 'こんにちは！まだ知識ベースに情報が登録されていません。管理画面から企業情報を追加すると、より詳しくお答えできるようになります。';
  }

  // Try fuzzy matching on knowledge
  const allContent = knowledge.map(k => `【${k.title}】${k.content}`).join('\n');

  return `ご質問ありがとうございます。申し訳ありませんが、お探しの情報が見つかりませんでした。\n\n以下のようなトピックについてはお答えできます：\n${knowledge.slice(0, 5).map(k => `・${k.title}`).join('\n')}`;
}

// === Conversation logging ===
function logConversation(userMessage, botReply, mode) {
  const logs = readJSON(CONVERSATIONS_FILE, []);
  logs.push({
    id: Date.now().toString(),
    date: new Date().toISOString(),
    mode: mode || 'Default',
    lastMessage: userMessage,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: botReply },
    ],
  });

  // Keep last 1000 conversations
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }

  writeJSON(CONVERSATIONS_FILE, logs);
}

// ============================================================
// Serve admin
// ============================================================
app.get('/admin', (req, res) => {
  res.redirect('/admin/');
});

app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`HITO Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
