// Mock Ollama for the T2 tier, bound to the hardcoded 11434 the app probes.
// src/ollama_manager.py checks http://127.0.0.1:11434/api/tags first and skips
// starting its own `ollama serve` on a 200 (ollama_manager.py ~148), so
// prebinding here keeps the real/ bundled Ollama out of the test. Answers
// /api/tags and a minimal streaming NDJSON /api/chat.
//
// Bind is hard by design (listen throws on EADDRINUSE): if a real Ollama is
// already answering on 11434 the test would silently hit the live LLM instead
// of this stub, so T2 setup must `pkill -f ollama` first (the bind then proves
// the port is ours). Used by the summary/transcription specs from PR2 on; the
// PR1 org-lock spec doesn't exercise Ollama and so doesn't start it.
const http = require('http');

const OLLAMA_PORT = 11434;

/**
 * Start the mock Ollama on 11434.
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
function startMockOllama() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/chat') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(
          JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: false }) + '\n',
        );
        res.end(
          JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n',
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock: not found' }));
    });
    // No EADDRINUSE swallow — a bind failure is a real signal (live Ollama up).
    server.on('error', reject);
    server.listen(OLLAMA_PORT, '127.0.0.1', () => {
      resolve({ close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

module.exports = { startMockOllama, OLLAMA_PORT };
