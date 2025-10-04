export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Basic URL validation
  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch(url, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      redirect: 'follow',
      timeout: 15000
    });

    const contentType = response.headers.get('content-type') || 'text/html';
    let body = await response.text();

    // If it's HTML, rewrite it to work better in iframe
    if (contentType.includes('text/html')) {
      // Remove X-Frame-Options blocking headers by rewriting content
      body = rewriteHtml(body, targetUrl);
    }

    // Set headers to allow iframe embedding
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    
    res.status(response.status).send(body);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch the requested URL',
      message: error.message 
    });
  }
}

function rewriteHtml(html, targetUrl) {
  const baseUrl = targetUrl.origin;
  const fullUrl = targetUrl.href;

  // Add base tag and meta tags to help with loading
  let modified = html.replace(
    /<head>/i,
    `<head>
    <base href="${fullUrl}">
    <meta http-equiv="Content-Security-Policy" content="frame-ancestors *">
    `
  );

  // Remove frame-busting scripts (common anti-iframe code)
  modified = modified.replace(
    /<script[^>]*>[\s\S]*?(if\s*\(\s*top\s*!=\s*self|if\s*\(\s*window\s*!=\s*top|if\s*\(\s*top\.location\s*!=\s*self\.location|if\s*\(\s*parent\.frames\.length\s*>\s*0)[\s\S]*?<\/script>/gi,
    ''
  );

  // Remove common frame-busting patterns
  modified = modified.replace(/top\.location\s*=\s*self\.location/gi, '');
  modified = modified.replace(/top\.location\.href\s*=\s*self\.location\.href/gi, '');
  modified = modified.replace(/if\s*\(\s*top\s*!==?\s*self\s*\)/gi, 'if(false)');
  modified = modified.replace(/if\s*\(\s*window\s*!==?\s*top\s*\)/gi, 'if(false)');
  modified = modified.replace(/parent\.location\s*=\s*self\.location/gi, '');

  // Rewrite relative URLs to absolute
  modified = modified.replace(/src=["'](?!http|\/\/|data:)([^"']+)["']/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, fullUrl).href;
      return `src="${absoluteUrl}"`;
    } catch {
      return match;
    }
  });

  modified = modified.replace(/href=["'](?!http|\/\/|#|javascript:|mailto:)([^"']+)["']/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, fullUrl).href;
      return `href="${absoluteUrl}"`;
    } catch {
      return match;
    }
  });

  // Add script to override frame-busting at runtime
  const antiFrameBustScript = `
    <script>
      (function() {
        // Override frame-busting attempts
        try {
          Object.defineProperty(window, 'top', {
            get: function() { return window.self; }
          });
          Object.defineProperty(window, 'parent', {
            get: function() { return window.self; }
          });
        } catch(e) {}
        
        // Prevent page from breaking out of iframe
        window.addEventListener('beforeunload', function(e) {
          e.stopImmediatePropagation();
        }, true);
      })();
    </script>
  `;

  modified = modified.replace(/<\/head>/i, `${antiFrameBustScript}</head>`);

  return modified;
}
