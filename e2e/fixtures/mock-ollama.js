// Mock Ollama for the T2 tier, bound to the hardcoded 11434 the app probes.
// src/ollama_manager.py checks http://127.0.0.1:11434/api/tags first and skips
// starting its own `ollama serve` on a 200 (ollama_manager.py ~148), so
// prebinding here keeps the real/ bundled Ollama out of the test. Answers
// /api/tags, /api/pull, and a streaming NDJSON /api/chat.
//
// Bind is hard by design (listen throws on EADDRINUSE): if a real Ollama is
// already answering on 11434 the test would silently hit the live LLM instead
// of this stub, so T2 setup must `pkill -f ollama` first (the bind then proves
// the port is ours). Used by the summary/transcription specs from PR2 on; the
// PR1 org-lock spec doesn't exercise Ollama and so doesn't start it.
//
// Contract testing (Phase 4): pass { chatReply } to return a fixed assistant
// message instead of the default 'ok', and read lastChatPrompt() to assert what
// prompt the summarizer built (e.g. that it embedded the transcript). Default
// behaviour is unchanged, so the existing @pipeline specs are unaffected.
const http = require('http');

const OLLAMA_PORT = 11434;

/**
 * Start the mock Ollama on 11434.
 * @param {object} [opts]
 * @param {string} [opts.chatReply='ok'] assistant content returned by /api/chat.
 * @returns {Promise<{ close: () => Promise<void>, lastChatPrompt: () => string|null, chatCalls: () => number }>}
 */
function startMockOllama(opts = {}) {
  const chatReply = opts.chatReply ?? 'ok';
  let lastChatPrompt = null;
  let chatCalls = 0;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // /api/tags — the summarizer's _ensure_model_available() reads each
      // entry's `model` field (ollama-python maps it there, not `name`); if the
      // configured model isn't found it tries to PULL it, so we must list it
      // under `model` or the pull path 404s and crashes summarisation.
      if (req.method === 'GET' && req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [
              // gemma4:e2b-it-qat is the config default (Config.DEFAULT_MODEL);
              // list it so the summarizer finds the configured model installed
              // instead of taking the pull path. llama3.2:3b kept for tests that
              // pin the older model explicitly.
              {
                name: 'gemma4:e2b-it-qat',
                model: 'gemma4:e2b-it-qat',
                modified_at: '2024-01-01T00:00:00Z',
                size: 4301000000,
                digest: 'mock',
              },
              {
                name: 'llama3.2:3b',
                model: 'llama3.2:3b',
                modified_at: '2024-01-01T00:00:00Z',
                size: 2019393189,
                digest: 'mock',
              },
            ],
          }),
        );
        return;
      }
      // /api/pull — defensive: if the model is ever considered missing, answer
      // a success stream rather than 404 so summarisation doesn't crash.
      if (req.method === 'POST' && req.url === '/api/pull') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end(JSON.stringify({ status: 'success' }) + '\n');
        return;
      }
      if (req.method === 'POST' && req.url === '/api/chat') {
        // Capture the prompt so a contract test can assert what was sent (the
        // summarizer sends messages:[{role:'user', content:<prompt+transcript>}]).
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          chatCalls++;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const msgs = Array.isArray(body.messages) ? body.messages : [];
            lastChatPrompt = msgs.length ? String(msgs[msgs.length - 1].content || '') : '';
          } catch {
            lastChatPrompt = '';
          }
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(
            JSON.stringify({ message: { role: 'assistant', content: chatReply }, done: false }) +
              '\n',
          );
          res.end(
            JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n',
          );
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock: not found' }));
    });
    // No EADDRINUSE swallow — a bind failure is a real signal (live Ollama up).
    server.on('error', reject);
    server.listen(OLLAMA_PORT, '127.0.0.1', () => {
      resolve({
        close: () => new Promise((r) => server.close(() => r())),
        lastChatPrompt: () => lastChatPrompt,
        chatCalls: () => chatCalls,
      });
    });
  });
}

module.exports = { startMockOllama, OLLAMA_PORT };
