const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// サイト情報をスクレイピングして構造化するAPI
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

    // メタ情報取得
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    // ナビゲーション取得
    const navigation = [];
    $('nav a, header a, .nav a, .menu a, .navigation a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (text && href && text.length < 50) {
        navigation.push({ text, href: new URL(href, url).toString() });
      }
    });
    // 重複除去
    const uniqueNav = [...new Map(navigation.map(n => [n.text, n])).values()].slice(0, 20);

    // メインコンテンツ抽出
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

    // 商品情報（ECサイト対応）
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

    // お問い合わせ・CTA
    const ctas = [];
    $('a[href*="contact"], a[href*="inquiry"], a[href*="cart"], button, [class*="cta"], [class*="btn"]').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (text && text.length < 50) {
        ctas.push({ text, href: href ? new URL(href, url).toString() : null });
      }
    });

    // フッター情報
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

// プロキシ: 外部サイトをサービス内ブラウザとして表示
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

    // CSSやJSの相対パスを絶対パスに変換
    let html = response.data;
    const baseUrl = new URL(url);
    const baseTag = `<base href="${baseUrl.origin}/" target="_blank">`;
    html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);

    // X-Frame-Options を回避するためHTMLを直接返す
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).send(`<html><body><h2>サイトを読み込めませんでした</h2><p>${error.message}</p></body></html>`);
  }
});

// チャットAPI（アバターの応答生成 - テンプレートベース）
app.post('/api/chat', (req, res) => {
  const { message, siteData } = req.body;
  if (!siteData) {
    return res.json({ reply: 'まずURLを入力して、サイトを読み込んでください。' });
  }

  const msg = message.toLowerCase();
  let reply = '';

  // サイト情報に基づいた応答生成
  if (msg.includes('何のサイト') || msg.includes('概要') || msg.includes('教えて') || msg.includes('紹介') || !message) {
    reply = `こちらは「${siteData.title}」というサイトです。`;
    if (siteData.description) {
      reply += `\n${siteData.description}`;
    }
    if (siteData.navigation.length > 0) {
      reply += `\n\n主なページとして、${siteData.navigation.slice(0, 5).map(n => n.text).join('、')} などがあります。`;
    }
  } else if (msg.includes('商品') || msg.includes('製品') || msg.includes('アイテム') || msg.includes('何が売')) {
    if (siteData.products.length > 0) {
      reply = '見つかった商品をご紹介します：\n';
      siteData.products.slice(0, 5).forEach(p => {
        reply += `\n・${p.name}`;
        if (p.price) reply += ` (${p.price})`;
      });
      if (siteData.products.length > 5) {
        reply += `\n\n他にも${siteData.products.length - 5}件の商品があります。`;
      }
    } else {
      reply = 'このサイトでは商品情報が見つかりませんでした。HPサイトかもしれません。';
    }
  } else if (msg.includes('メニュー') || msg.includes('ページ') || msg.includes('ナビ')) {
    if (siteData.navigation.length > 0) {
      reply = 'サイトのメニュー一覧です：\n';
      siteData.navigation.forEach(n => {
        reply += `\n・${n.text}`;
      });
    } else {
      reply = 'ナビゲーション情報が見つかりませんでした。';
    }
  } else if (msg.includes('問い合わせ') || msg.includes('連絡') || msg.includes('コンタクト')) {
    if (siteData.ctas.length > 0) {
      reply = 'お問い合わせ関連のリンクがあります：\n';
      siteData.ctas.slice(0, 3).forEach(c => {
        reply += `\n・${c.text}`;
      });
    } else {
      reply = 'お問い合わせページの情報が見つかりませんでした。フッター情報を確認してみましょう。';
      if (siteData.footerInfo) {
        reply += `\n\nフッター情報: ${siteData.footerInfo.slice(0, 200)}`;
      }
    }
  } else if (msg.includes('内容') || msg.includes('セクション') || msg.includes('詳細')) {
    if (siteData.sections.length > 0) {
      reply = 'サイトの主な内容です：\n';
      siteData.sections.slice(0, 5).forEach(s => {
        reply += `\n【${s.heading}】\n${s.content || '(詳細はページをご覧ください)'}`;
      });
    } else {
      reply = 'セクション情報が抽出できませんでした。';
    }
  } else {
    reply = `ご質問ありがとうございます。「${siteData.title}」について他にお知りになりたいことはありますか？\n\n以下のようなことをお聞きいただけます：\n・サイトの概要\n・商品情報\n・メニュー一覧\n・お問い合わせ先\n・セクション詳細`;
  }

  res.json({
    reply,
    highlights: findRelevantSections(msg, siteData),
  });
});

function findRelevantSections(query, siteData) {
  const highlights = [];
  if (query.includes('商品') || query.includes('製品')) {
    highlights.push({ type: 'products', data: siteData.products.slice(0, 3) });
  }
  if (query.includes('メニュー') || query.includes('ナビ')) {
    highlights.push({ type: 'navigation', data: siteData.navigation });
  }
  return highlights;
}

app.listen(PORT, () => {
  console.log(`Avatar Site Guide running on http://localhost:${PORT}`);
});
