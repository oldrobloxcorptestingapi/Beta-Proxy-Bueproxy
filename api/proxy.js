export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    // Rotate between realistic user agents to avoid detection
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'
    ];
    
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    const isChrome = randomUA.includes('Chrome');
    const isMac = randomUA.includes('Macintosh');
    const isLinux = randomUA.includes('Linux');
    
    const response = await fetch(url, {
      method: req.method,
      headers: {
        'User-Agent': randomUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': isChrome ? '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"' : undefined,
        'sec-ch-ua-mobile': isChrome ? '?0' : undefined,
        'sec-ch-ua-platform': isChrome ? (isMac ? '"macOS"' : isLinux ? '"Linux"' : '"Windows"') : undefined,
        'Referer': targetUrl.origin
      },
      redirect: 'follow',
      follow: 10,
      timeout: 20000,
      compress: true
    });

    const contentType = response.headers.get('content-type') || 'text/html';

    // For binary content (images, videos, etc), just proxy it directly
    if (!contentType.includes('text') && !contentType.includes('json') && 
        !contentType.includes('javascript') && !contentType.includes('xml')) {
      const buffer = await response.buffer();
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.status(response.status).send(buffer);
    }

    let body = await response.text();

    // Get the proxy base URL
    const proxyBase = '/api/proxy?url=';

    // Aggressive content rewriting based on type
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      body = rewriteHtml(body, targetUrl, proxyBase);
    } else if (contentType.includes('javascript') || contentType.includes('json')) {
      body = rewriteJavaScript(body, targetUrl, proxyBase);
    } else if (contentType.includes('css')) {
      body = rewriteCSS(body, targetUrl, proxyBase);
    }

    // Remove ALL restrictive headers
    res.setHeader('Content-Type', contentType);
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    
    // Force allow everything
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.status(response.status).send(body);

  } catch (error) {
    console.error('Proxy error:', error);
    
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Proxy Error</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .error-box {
            background: #2d2d2d;
            padding: 40px;
            border-radius: 12px;
            max-width: 600px;
            text-align: center;
          }
          h1 { color: #ff6b6b; margin-bottom: 20px; }
          p { margin: 10px 0; line-height: 1.6; }
          .retry { 
            margin-top: 20px; 
            padding: 12px 24px;
            background: #4a9eff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
          }
          .details {
            background: #1a1a1a;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-family: monospace;
            font-size: 12px;
            text-align: left;
            overflow-x: auto;
          }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h1>⚠️ Connection Failed</h1>
          <p>Unable to fetch: <strong>${url}</strong></p>
          <p>${error.message}</p>
          <div class="details">
            <strong>Possible reasons:</strong><br>
            • Site has strict anti-bot protection<br>
            • SSL/Certificate issues<br>
            • Site is blocking server requests<br>
            • Timeout or network error<br>
            • Site requires authentication
          </div>
          <button class="retry" onclick="window.parent.location.reload()">Retry</button>
        </div>
      </body>
      </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(errorHtml);
  }
}

function rewriteHtml(html, targetUrl, proxyBase) {
  const baseUrl = targetUrl.origin;
  const fullUrl = targetUrl.href;
  let modified = html;

  // Function to proxy a URL
  const proxyUrl = (url) => {
    try {
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) {
        return url;
      }
      if (url.startsWith('//')) {
        url = targetUrl.protocol + url;
      }
      if (!url.startsWith('http')) {
        url = new URL(url, fullUrl).href;
      }
      return proxyBase + encodeURIComponent(url);
    } catch {
      return url;
    }
  };

  // Inject aggressive anti-framing and URL rewriting
  const aggressiveHead = `
    <base href="${fullUrl}">
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;">
    <script>
      // Proxy configuration
      window.__PROXY_BASE__ = '${proxyBase}';
      window.__ORIGINAL_URL__ = '${fullUrl}';
      
      // Ultra aggressive frame-busting prevention
      (function() {
        'use strict';
        
        try {
          Object.defineProperty(window, 'top', {
            configurable: false,
            get: function() { return window; }
          });
          Object.defineProperty(window, 'parent', {
            configurable: false,
            get: function() { return window; }
          });
          Object.defineProperty(window, 'frameElement', {
            configurable: false,
            get: function() { return null; }
          });
        } catch(e) {}

        // Override fetch to proxy requests
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
          if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            url = window.__PROXY_BASE__ + encodeURIComponent(url);
          }
          return originalFetch.call(this, url, options);
        };

        // Override XMLHttpRequest
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
          if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            url = window.__PROXY_BASE__ + encodeURIComponent(url);
          }
          return originalOpen.call(this, method, url, ...args);
        };

        // Block navigation attempts
        window.addEventListener('beforeunload', function(e) {
          e.stopImmediatePropagation();
        }, true);

        console.log('🛡️ Proxy frame protection active');
      })();
    </script>
    <script>
      // Intercept ALL navigation
      (function() {
        const proxyNavigate = (url) => {
          if (!url) return;
          if (url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) return;
          
          try {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              url = new URL(url, window.__ORIGINAL_URL__).href;
            }
            
            window.parent.postMessage({
              type: 'navigate',
              url: url
            }, '*');
          } catch(e) {
            console.error('Navigation error:', e);
          }
        };

        // Intercept History API
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(state, title, url) {
          if (url) proxyNavigate(url);
          return originalPushState.apply(this, arguments);
        };
        
        history.replaceState = function(state, title, url) {
          if (url) proxyNavigate(url);
          return originalReplaceState.apply(this, arguments);
        };

        // Intercept all clicks
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a');
          if (link && link.href) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            proxyNavigate(link.href);
            return false;
          }
        }, true);

        // Intercept form submissions
        document.addEventListener('submit', function(e) {
          const form = e.target;
          if (form && form.action) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            const formData = new FormData(form);
            const params = new URLSearchParams(formData).toString();
            let url = form.action;
            
            if (form.method.toUpperCase() === 'GET' && params) {
              url += (url.includes('?') ? '&' : '?') + params;
            }
            
            proxyNavigate(url);
            return false;
          }
        }, true);

        console.log('🔗 Navigation interception active');
      })();
    </script>
  `;

  modified = modified.replace(/<head[^>]*>/i, '<head>' + aggressiveHead);

  // Rewrite ALL URLs in HTML to go through proxy
  // Script sources
  modified = modified.replace(/(<script[^>]*\ssrc=["'])(?!http:\/\/|https:\/\/|\/\/|data:|blob:)([^"']+)(["'])/gi, 
    (match, before, url, after) => before + proxyUrl(url) + after);
  
  modified = modified.replace(/(<script[^>]*\ssrc=["'])((?:https?:)?\/\/[^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);

  // Link/CSS sources
  modified = modified.replace(/(<link[^>]*\shref=["'])(?!http:\/\/|https:\/\/|\/\/|#|data:)([^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);
  
  modified = modified.replace(/(<link[^>]*\shref=["'])((?:https?:)?\/\/[^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);

  // Image sources
  modified = modified.replace(/(<img[^>]*\ssrc=["'])(?!http:\/\/|https:\/\/|\/\/|data:|blob:)([^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);
  
  modified = modified.replace(/(<img[^>]*\ssrc=["'])((?:https?:)?\/\/[^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);

  // Iframe sources
  modified = modified.replace(/(<iframe[^>]*\ssrc=["'])(?!http:\/\/|https:\/\/|\/\/|about:|data:)([^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);
  
  modified = modified.replace(/(<iframe[^>]*\ssrc=["'])((?:https?:)?\/\/[^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);

  // All other src attributes
  modified = modified.replace(/(\ssrc=["'])(?!http:\/\/|https:\/\/|\/\/|data:|blob:|javascript:)([^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);
  
  modified = modified.replace(/(\ssrc=["'])((?:https?:)?\/\/[^"']+)(["'])/gi,
    (match, before, url, after) => before + proxyUrl(url) + after);

  // Background images in style attributes
  modified = modified.replace(/url\(["']?(?!http:\/\/|https:\/\/|\/\/|data:)([^"')]+)["']?\)/gi,
    (match, url) => `url("${proxyUrl(url)}")`);

  // Remove frame-busting
  modified = modified.replace(/<script[^>]*>[\s\S]*?(top\.location|parent\.location|window\.top|top\s*!==?\s*self)[\s\S]*?<\/script>/gi, '');

  // Remove CSP and X-Frame-Options meta tags
  modified = modified.replace(/<meta[^>]*http-equiv=["']?(Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, '');

  return modified;
}

function rewriteJavaScript(js, targetUrl, proxyBase) {
  let modified = js;
  
  // Add proxy base as a constant
  modified = `const __PROXY_BASE__ = '${proxyBase}';\n` + modified;
  
  // Block frame-busting
  modified = modified.replace(/top\.location\s*=\s*/g, '/* blocked */ void ');
  modified = modified.replace(/parent\.location\s*=\s*/g, '/* blocked */ void ');
  modified = modified.replace(/if\s*\(\s*top\s*!==?\s*self\s*\)/g, 'if(false)');
  
  return modified;
}

function rewriteCSS(css, targetUrl, proxyBase) {
  let modified = css;
  
  const proxyUrl = (url) => {
    try {
      if (url.startsWith('data:')) return url;
      if (url.startsWith('//')) url = targetUrl.protocol + url;
      if (!url.startsWith('http')) url = new URL(url, targetUrl.href).href;
      return proxyBase + encodeURIComponent(url);
    } catch {
      return url;
    }
  };
  
  // Rewrite all url() in CSS
  modified = modified.replace(/url\(["']?(?!data:)([^"')]+)["']?\)/gi,
    (match, url) => `url("${proxyUrl(url.trim())}")`);
  
  return modified;
}
