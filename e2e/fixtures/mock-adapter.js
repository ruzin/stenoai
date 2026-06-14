// Mock org adapter for the T2 tier. Serves the endpoints the desktop's org
// handlers call against a signed-in adapter, with just enough state to drive the
// CRUD + share/unshare lifecycle deterministically — no real backend, no AWS/S3.
//
// Backwards compatible with the original sign-in-only mock (org-lock-lifecycle.t2,
// shared-notes-policy): POST /auth/login still returns a structurally valid HS256
// JWT in the { token, email, name, org_id } envelope (app/main.js ~8071) and
// GET /policy still returns the enterprise policy. It NEVER returns 401 (that
// would trip the app's real sign-out path mid-test). Listens on an ephemeral
// loopback port; the caller passes the returned url as the adapter URL.
//
// Statefulness (per server instance, so each test starts clean):
//   POST   /auth/login           -> { token, email, name, org_id }
//   GET    /policy               -> { auto_share_default, shared_notes_enabled }
//   POST   /meetings             -> create; returns { id, ...payload }
//   GET    /meetings             -> { meetings: [...] }
//   GET    /meetings/:id         -> the meeting (404 if gone)
//   DELETE /meetings/:id         -> { id } (404 if gone)
//   POST   /uploads/presign      -> { upload_url: <self>/s3/<key>, s3_key }
//   PUT    /s3/:key              -> 200 (accepts the uploaded bytes)
//   POST   /ai/chat              -> { answer } (echoes the question deterministically)
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

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Start the mock adapter on an ephemeral loopback port.
 * @param {object} [opts]
 * @param {object} [opts.policy] override the /policy response.
 * @returns {Promise<{ url: string, close: () => Promise<void>, meetingCount: () => number, s3Puts: () => number }>}
 */
function startMockAdapter(opts = {}) {
  const policy = opts.policy || { auto_share_default: true, shared_notes_enabled: true };
  const meetings = new Map(); // id -> meeting object
  let idSeq = 0;
  let keySeq = 0;
  let s3PutCount = 0;
  let baseUrl = '';

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parse = () => {
          try {
            return raw ? JSON.parse(raw) : {};
          } catch {
            return {};
          }
        };
        const { method, url } = req;

        // --- auth + policy (unchanged contract) ---
        if (method === 'POST' && url === '/auth/login') {
          return json(res, 200, {
            token: makeToken(),
            email: 'e2e@example.com',
            name: 'E2E Bot',
            org_id: 'org-e2e',
          });
        }
        if (method === 'GET' && url === '/policy') {
          return json(res, 200, policy);
        }

        // --- meetings CRUD ---
        if (method === 'POST' && url === '/meetings') {
          const payload = parse();
          const id = `m${++idSeq}`;
          const meeting = { id, ...payload };
          meetings.set(id, meeting);
          return json(res, 200, meeting);
        }
        if (method === 'GET' && url === '/meetings') {
          return json(res, 200, { meetings: [...meetings.values()] });
        }
        const meetingMatch = url.match(/^\/meetings\/([^/?]+)$/);
        if (meetingMatch) {
          const id = decodeURIComponent(meetingMatch[1]);
          if (method === 'GET') {
            return meetings.has(id)
              ? json(res, 200, meetings.get(id))
              : json(res, 404, { detail: 'mock: meeting not found' });
          }
          if (method === 'DELETE') {
            if (!meetings.has(id)) return json(res, 404, { detail: 'mock: meeting not found' });
            meetings.delete(id);
            return json(res, 200, { id });
          }
        }

        // --- share upload: presign + (self-hosted) S3 PUT ---
        if (method === 'POST' && url === '/uploads/presign') {
          const { filename = 'note.md' } = parse();
          const s3_key = `notes/${++keySeq}-${filename}`;
          return json(res, 200, {
            upload_url: `${baseUrl}/s3/${encodeURIComponent(s3_key)}`,
            s3_key,
          });
        }
        if (method === 'PUT' && url.startsWith('/s3/')) {
          s3PutCount++;
          res.writeHead(200);
          return res.end();
        }

        // --- org AI chat (deterministic echo) ---
        if (method === 'POST' && url === '/ai/chat') {
          const { question = '' } = parse();
          return json(res, 200, { answer: `mock-org-answer: ${question}` });
        }

        // Default: 404 (never 401 — see header comment).
        return json(res, 404, { detail: 'mock: not found' });
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        url: baseUrl,
        close: () => new Promise((r) => server.close(() => r())),
        meetingCount: () => meetings.size,
        s3Puts: () => s3PutCount,
      });
    });
  });
}

module.exports = { startMockAdapter };
