// pages/api/proxy.js (Vercel / Node)
import https from 'https';
import http from 'http';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });

  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36',
  ];
  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

  const agent =
    target.protocol === 'https:'
      ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
      : new http.Agent({ keepAlive: true });

  try {
    const response = await fetch(target.href, {
      method: req.method,
      headers: {
        'User-Agent': randomUA,
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': target.origin + '/',
        'Origin': target.origin,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      redirect: 'follow',
      follow: 20,
      timeout: 30000,
      compress: true,
      agent,
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.removeHeader?.('Content-Security-Policy');

    // If not text-based, just stream it directly
    if (!contentType.includes('text') && !contentType.includes('json')) {
      const buf = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buf));
    }

    let body = await response.text();

    // Inject base and CSP fixes for HTML
    if (contentType.includes('html')) {
      body = rewriteHtml(body, target);
    }

    // Rewrite CSS or JS to route assets through proxy
    if (contentType.includes('css')) {
      body = rewriteCSS(body, target);
    } else if (contentType.includes('javascript')) {
      body = rewriteJavaScript(body, target);
    }

    return res.status(response.status).send(body);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).send(`<h1>Proxy Error</h1><pre>${err.message}</pre>`);
  }
}

function rewriteHtml(html, target) {
  const base = `/api/proxy?url=`;
  const baseTag = `<base href="${target.href}"><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">`;

  let out = html.replace(/<head[^>]*>/i, `<head>${baseTag}`);

  const proxy = (u) => {
    try {
      if (!u || u.startsWith('data:') || u.startsWith('javascript:')) return u;
      if (u.startsWith('//')) u = target.protocol + u;
      if (!/^https?:/i.test(u)) u = new URL(u, target.href).href;
      return base + encodeURIComponent(u);
    } catch {
      return u;
    }
  };

  // Rewrite href/src/srcset
  out = out.replace(/(href|src|srcset)=["']([^"']+)["']/gi, (m, attr, val) => `${attr}="${proxy(val)}"`);
  out = out.replace(/url\(["']?(?!data:)([^"')]+)["']?\)/gi, (m, u) => `url("${proxy(u)}")`);

  return out;
}

function rewriteJavaScript(js, target) {
  const base = `/api/proxy?url=`;
  return `const __PROXY__="${base}";\n` + js.replace(/top\.location/g, '/*blocked*/null');
}

function rewriteCSS(css, target) {
  const base = `/api/proxy?url=`;
  return css.replace(/url\(["']?(?!data:)([^"')]+)["']?\)/gi, (m, u) => {
    try {
      if (u.startsWith('//')) u = target.protocol + u;
      if (!/^https?:/i.test(u)) u = new URL(u, target.href).href;
      return `url("${base + encodeURIComponent(u)}")`;
    } catch {
      return m;
    }
  });
}
