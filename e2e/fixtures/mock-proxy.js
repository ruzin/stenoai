// Minimal forward HTTP proxy for the T2 tier. Records every absolute-form
// request URL it's asked to proxy, then forwards it to the real target and
// pipes the response back. Used by proxy-routing.t2 to prove the desktop's
// org/S3 HTTP calls go through the system/session proxy (i.e. Electron
// net.fetch, not Node's undici which ignores the proxy entirely).
//
// The mock adapter is plain HTTP on loopback, so Chromium would normally
// BYPASS the proxy for it — the spec defeats that with proxyBypassRules
// '<-loopback>', which forces even loopback requests through here.
const http = require('http');

/**
 * Start the proxy on an ephemeral loopback port.
 * @returns {Promise<{ url: string, port: number, requests: () => string[], close: () => Promise<void> }>}
 */
function startMockProxy() {
  const seen = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // In forward-proxy mode req.url is absolute-form: http://host:port/path
      seen.push(req.url);
      let target;
      try {
        target = new URL(req.url);
      } catch {
        res.writeHead(400);
        return res.end();
      }
      const proxyReq = http.request(
        {
          host: target.hostname,
          port: target.port || 80,
          path: target.pathname + target.search,
          method: req.method,
          headers: req.headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(proxyReq);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        requests: () => seen.slice(),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startMockProxy };
