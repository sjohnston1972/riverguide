// River Guide — minimal reference/mock backend for local dev
//
// Serves the static frontend and implements POST /api/mcp/chat so the app
// can run end to end without any production credentials.
//
// Modes:
//   - Mock mode (default): no API key required. Returns a canned response
//     in the same shape the real Claude Messages API would, so the UI can
//     be exercised offline.
//   - Live mode (optional): set ANTHROPIC_API_KEY in the environment to
//     proxy requests to the real Claude API using the server-owned system
//     prompt from prompt.txt. There is no default/fallback key anywhere in
//     this file — if the env var isn't set, the server stays in mock mode.
//
// No external dependencies — Node's built-in http/https/fs modules only.

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

// --- Server-owned system prompt -------------------------------------------
// The client no longer sends systemPrompt; the backend is the source of
// truth for it, loaded once at startup from prompt.txt.
let systemPrompt = 'You are a helpful Scottish rivers and kayaking guide.';
try {
    systemPrompt = fs.readFileSync(path.join(ROOT_DIR, 'prompt.txt'), 'utf8');
} catch (err) {
    console.warn('[river-guide] Could not read prompt.txt, using fallback system prompt:', err.message);
}

// --- Static file serving ---------------------------------------------------

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function serveStatic(req, res, urlPath) {
    // Strip query string, decode, and default '/' to index.html.
    let cleanPath = decodeURIComponent(urlPath.split('?')[0]);
    if (cleanPath === '/') cleanPath = '/index.html';

    // Resolve against the repo root and refuse to escape it (path traversal guard).
    const resolved = path.resolve(ROOT_DIR, '.' + cleanPath);
    if (!resolved.startsWith(ROOT_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(resolved, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

// --- POST /api/mcp/chat -----------------------------------------------------

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 1e6) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(payload);
}

// Pull the most recent user-authored text out of the conversation, for the
// mock reply. `messages` items look like { role: 'user', content: string }
// or { role: 'assistant', content: [ { type, text }, ... ] } (the client
// echoes the raw response content blocks back as assistant history).
function lastUserText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.role === 'user') {
            if (typeof m.content === 'string') return m.content;
            if (Array.isArray(m.content)) {
                return m.content.filter(b => b && b.type === 'text').map(b => b.text).join('\n\n');
            }
        }
    }
    return '';
}

function buildMockReply(userText) {
    // A simple built-in trigger to exercise the error path on demand
    // without needing a separate route (see README "Testing the error path").
    if (/__force_error__/i.test(userText)) {
        return null; // signals caller to send an error response
    }

    const text = userText
        ? `Mock reply for local dev. You asked: "${userText}".\n\n` +
          `This is a canned response from the reference backend (no ANTHROPIC_API_KEY set, so no live tools were called). ` +
          `In live mode this backend would call the Claude Messages API with the search_rivers, get_river_stations, ` +
          `get_station_levels, get_weather_forecast, and get_river_guide MCP tools described in prompt.txt.`
        : 'Mock reply for local dev.';

    return {
        content: [
            { type: 'text', text }
        ]
    };
}

// Optional live mode: proxy to the real Claude Messages API.
function callAnthropic(messages) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: 1024,
            system: systemPrompt,
            messages: messages
        });

        const req = https.request(
            {
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            apiRes => {
                let raw = '';
                apiRes.on('data', chunk => (raw += chunk));
                apiRes.on('end', () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(raw);
                    } catch (err) {
                        return reject(new Error('Upstream returned invalid JSON'));
                    }
                    if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed.error?.message || `Upstream error: ${apiRes.statusCode}`));
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function handleChat(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        return sendJson(res, 400, { error: err.message });
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return sendJson(res, 400, { error: 'Request body must include a non-empty "messages" array.' });
    }

    if (ANTHROPIC_API_KEY) {
        try {
            const result = await callAnthropic(messages);
            return sendJson(res, 200, { content: result.content });
        } catch (err) {
            console.error('[river-guide] Live Anthropic call failed:', err.message);
            return sendJson(res, 502, { error: `Upstream Claude API error: ${err.message}` });
        }
    }

    // Mock mode.
    const userText = lastUserText(messages);
    const reply = buildMockReply(userText);
    if (reply === null) {
        return sendJson(res, 500, { error: 'Forced mock error (message contained __force_error__).' });
    }
    return sendJson(res, 200, reply);
}

// --- HTTP server -------------------------------------------------------------

const server = http.createServer((req, res) => {
    const urlPath = req.url || '/';

    if (req.method === 'POST' && urlPath.split('?')[0] === '/api/mcp/chat') {
        handleChat(req, res).catch(err => {
            console.error('[river-guide] Unhandled error:', err);
            sendJson(res, 500, { error: 'Internal server error' });
        });
        return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(req, res, urlPath);
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
});

server.listen(PORT, () => {
    console.log(`[river-guide] Serving ${ROOT_DIR} on http://localhost:${PORT}`);
    console.log(`[river-guide] Mode: ${ANTHROPIC_API_KEY ? 'live (Anthropic API)' : 'mock (no API key set)'}`);
});
