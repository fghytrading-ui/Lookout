import axios from 'axios';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*'
};

import { registerCache } from './persistentCache.js';
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min — news doesn't change every minute
registerCache('news', cache);

function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { cache.delete(k); return null; }
  return e.data;
}
function cacheSet(k, d) { cache.set(k, { data: d, ts: Date.now() }); }

// Parse RSS items from Google News
function parseRSS(xml, limit = 4) {
  const items = [];
  // Match each <item>...</item> block
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of itemMatches.slice(0, limit)) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch  = block.match(/<link>([\s\S]*?)<\/link>/);
    const dateMatch  = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    if (titleMatch) {
      let title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      let publisher = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
      // Google News titles often end with " - Publisher" — split off
      if (!publisher && title.includes(' - ')) {
        const parts = title.split(' - ');
        publisher = parts[parts.length - 1];
        title = parts.slice(0, -1).join(' - ');
      }
      items.push({
        title,
        publisher: publisher || 'News',
        link: linkMatch ? linkMatch[1].trim() : '',
        time: dateMatch ? new Date(dateMatch[1]).toISOString() : null
      });
    }
  }
  return items;
}

// Google News RSS — permissive, free, no key
export async function fetchNews(ticker, limit = 4) {
  const cached = cacheGet(`news:${ticker}`);
  if (cached) return cached;

  try {
    const query = encodeURIComponent(`${ticker} stock`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
    const news = parseRSS(data, limit);
    cacheSet(`news:${ticker}`, news);
    return news;
  } catch {
    cacheSet(`news:${ticker}`, []);
    return [];
  }
}

// Lightweight sentiment proxy: derive from news headline keywords
// (StockTwits is Cloudflare-blocked; this is a free fallback)
const BULLISH_WORDS = ['surge', 'rally', 'soar', 'beat', 'upgrade', 'raise', 'jump', 'gain', 'rise', 'higher', 'breakout', 'record high', 'outperform', 'buy', 'strong', 'growth', 'profit', 'win'];
const BEARISH_WORDS = ['fall', 'plunge', 'crash', 'miss', 'downgrade', 'cut', 'drop', 'tumble', 'decline', 'lower', 'breakdown', 'low', 'underperform', 'sell', 'weak', 'loss', 'concern', 'warning', 'lawsuit', 'investigation', 'fraud'];

export function deriveSentimentFromNews(news) {
  if (!news?.length) return null;
  let bull = 0, bear = 0;
  for (const n of news) {
    const text = (n.title || '').toLowerCase();
    for (const w of BULLISH_WORDS) if (text.includes(w)) bull++;
    for (const w of BEARISH_WORDS) if (text.includes(w)) bear++;
  }
  const total = bull + bear;
  if (total === 0) return { score: 50, bull: 0, bear: 0, total: news.length, label: 'Neutral' };
  const score = Math.round((bull / total) * 100);
  return {
    score, bull, bear, total: news.length,
    label: score >= 70 ? 'Strongly Bullish'
         : score >= 55 ? 'Bullish'
         : score <= 30 ? 'Strongly Bearish'
         : score <= 45 ? 'Bearish'
         : 'Mixed'
  };
}

export async function enrichTicker(ticker) {
  const news = await fetchNews(ticker, 4);
  const sentiment = deriveSentimentFromNews(news);
  return { news, sentiment };
}
