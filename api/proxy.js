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
    
    // Use the most realistic browser headers possible
    const response = await fetch(url, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Referer': targetUrl.origin
      },
      redirect: 'follow',
      follow: 10,
      timeout: 20000,
      compress: true
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    let body = await response.text();

    // Aggressive HTML rewriting for maximum compatibility
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      body = aggressiveRewriteHtml(body, targetUrl);
    } else if (contentType.includes('javascript') || contentType.includes('json')) {
      // Rewrite JavaScript files too
      body = rewriteJavaScript(body, targetUrl);
    } else if (contentType.includes('css')) {
      body = rewriteCSS(body, targetUrl);
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
    
    // Even on error, try to return something useful
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

function aggressiveRewriteHtml(html, targetUrl) {
  const baseUrl = targetUrl.origin;
  const fullUrl = targetUrl.href;
  let modified = html;

  // Step 1: Inject base and aggressive anti-framing protection
  const aggressiveHead = `
    <base href="${fullUrl}">
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;">
    <script>
      // ULTRA AGGRESSIVE frame-busting prevention
      (function() {
        'use strict';
        
        // Freeze window properties
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
          
          // Override document properties
          Object.defineProperty(document, 'referrer', {
            get: function() { return '${fullUrl}'; }
          });
          
          // Intercept location changes
          var originalLocation = window.location;
          delete window.location;
          window.location = new Proxy(originalLocation, {
            set: function(target, property, value) {
              if (property === 'href' && value !== originalLocation.href) {
                console.log('Blocked location change to:', value);
                return true;
              }
              return Reflect.set(target, property, value);
            }
          });
          
        } catch(e) { console.log('Frame protection error:', e); }

        // Block common frame-busting patterns
        window.addEventListener('beforeunload', function(e) {
          e.stopImmediatePropagation();
          return undefined;
        }, true);

        // Override alert/confirm/prompt that might be used for frame busting
        var methods = ['alert', 'confirm', 'prompt'];
        methods.forEach(function(method) {
          var original = window[method];
          window[method] = function() {
            console.log('Blocked ' + method + ':', arguments);
            return method === 'confirm' ? true : '';
          };
        });

        // Prevent page from detecting iframe
        if (window.self !== window.top) {
          try {
            Object.defineProperty(window.self, 'frameElement', {
              get: function() { return null; }
            });
          } catch(e) {}
        }

        // Intercept and block navigation attempts
        var origOpen = window.open;
        window.open = function(url, target) {
          if (target === '_top' || target === '_parent') {
            target = '_self';
          }
          return origOpen.call(this, url, target);
        };

        // Block meta refresh redirects
        var metaRefresh = document.querySelectorAll('meta[http-equiv="refresh"]');
        metaRefresh.forEach(function(meta) { meta.remove(); });

        console.log('🛡️ Frame protection active');
      })();
    </script>
  `;

  modified = modified.replace(/<head[^>]*>/i, '<head>' + aggressiveHead);

  // Step 2: Remove ALL frame-busting scripts
  const frameBustPatterns = [
    /<script[^>]*>[\s\S]*?(top\.location|parent\.location|window\.top|top\s*!==?\s*self|top\s*!=\s*self|frameElement|frames\.length)[\s\S]*?<\/script>/gi,
    /if\s*\(\s*top\s*[!=]==?\s*self\s*\)[^;{]*[;{]/gi,
    /if\s*\(\s*window\s*[!=]==?\s*top\s*\)[^;{]*[;{]/gi,
    /if\s*\(\s*parent\s*[!=]==?\s*self\s*\)[^;{]*[;{]/gi,
    /top\.location\s*=\s*[^;]+;/gi,
    /parent\.location\s*=\s*[^;]+;/gi,
    /window\.top\.location\s*=\s*[^;]+;/gi,
  ];

  frameBustPatterns.forEach(pattern => {
    modified = modified.replace(pattern, '/* removed frame-busting code */');
  });

  // Step 3: Rewrite ALL URLs to absolute
  modified = modified.replace(/src\s*=\s*["'](?!http|\/\/|data:|blob:|javascript:)([^"']+)["']/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, fullUrl).href;
      return `src="${absoluteUrl}"`;
    } catch {
      return match;
    }
  });

  modified = modified.replace(/href\s*=\s*["'](?!http|\/\/|#|javascript:|mailto:|tel:)([^"']+)["']/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, fullUrl).href;
      return `href="${absoluteUrl}"`;
    } catch {
      return match;
    }
  });

  // Rewrite url() in style attributes
  modified = modified.replace(/url\(["']?(?!http|\/\/|data:)([^"')]+)["']?\)/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, fullUrl).href;
      return `url("${absoluteUrl}")`;
    } catch {
      return match;
    }
  });

  // Step 4: Remove CSP meta tags
  modified = modified.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
  
  // Step 5: Remove X-Frame-Options meta
  modified = modified.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');

  return modified;
}

function rewriteJavaScript(js, targetUrl) {
  let modified = js;
  
  // Replace hardcoded domains with current domain
  const domain = targetUrl.hostname;
  modified = modified.replace(/location\.hostname\s*[!=]==?\s*["'][^"']+["']/g, `location.hostname === "${domain}"`);
  
  // Block frame-busting in JS files
  modified = modified.replace(/top\.location\s*=\s*/g, '/* blocked */ void ');
  modified = modified.replace(/parent\.location\s*=\s*/g, '/* blocked */ void ');
  
  return modified;
}

function rewriteCSS(css, targetUrl) {
  let modified = css;
  
  // Rewrite relative URLs in CSS
  modified = modified.replace(/url\(["']?(?!http|\/\/|data:)([^"')]+)["']?\)/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, targetUrl.href).href;
      return `url("${absoluteUrl}")`;
    } catch {
      return match;
    }
  });
  
  return modified;
}
