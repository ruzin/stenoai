// Mock org adapter for the T2 tier. Serves POST /auth/login with a
// structurally valid HS256 JWT (exp +1h) in the { token, email, name, org_id }
// envelope the real org-login handler expects (app/main.js ~8042). Everything
// else 404s, and it NEVER returns 401 — a 401 would trip the app's real
// sign-out path mid-test. Listens on an ephemeral port; the caller passes the
// returned url as the adapter URL in the sign-in form.
const http = require('http');

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function makeToken() {
  // exp +1h so org-status' isJwtExpired() check (30s skew) treats it as valid.
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: 'e2e-bot', exp: Math.floor(Date.now() / 1000) + 3600 }),
    'e2efakesig',
  ].join('.');
}

/**
 * Start the mock adapter on an ephemeral loopback port.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function startMockAdapter() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Drain the request body (we don't inspect credentials) so 'end' fires;
      // the mock authenticates structurally, not by content.
      req.resume();
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/auth/login') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              token: makeToken(),
              email: 'e2e@example.com',
              name: 'E2E Bot',
              org_id: 'org-e2e',
            }),
          );
        } else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ detail: 'mock: not found' }));
        }
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startMockAdapter };
