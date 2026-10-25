'use strict';
/* Eye → Face backend. Zero npm dependencies: Node >= 20 built-ins only.
   - Serves the static frontend from ./public
   - POST /api/generate  → Gemini image generation (key stays in the environment)
   - GET  /api/health */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- tiny .env loader (real environment variables always win) ---------- */
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env file: fine in production */ }

const { GENRES } = require('./lib/genres');
const { generateMoodboard, AppError, cfg } = require('./lib/gemini');

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
const PORT = num(process.env.PORT, 3000);
const MAX_IMAGE_BYTES = num(process.env.MAX_IMAGE_MB, 4) * 1024 * 1024;
const MAX_BODY = Math.ceil(MAX_IMAGE_BYTES * 1.4) + 4096; // base64 overhead + JSON
const RATE_MAX = num(process.env.RATE_LIMIT_MAX, 5);
const RATE_WINDOW_MS = num(process.env.RATE_LIMIT_WINDOW_MIN, 10) * 60 * 1000;
const DAILY_LIMIT = num(process.env.DAILY_LIMIT, 300);
const MAX_CONCURRENT = num(process.env.MAX_CONCURRENT, 3);
const TRUST_PROXY = num(process.env.TRUST_PROXY, 0); // number of proxies in front of this server
const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const PUBLIC = path.join(__dirname, 'public');

/* ---------- helpers ---------- */
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com', "img-src 'self' data: blob:",
    // data: lets the page turn the returned base64 image into a Blob; ORIGINS allows a split-hosted API
    ["connect-src 'self' data:", ...ORIGINS].join(' '), "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
};
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, { ...SECURITY_HEADERS, ...(isObj ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(data);
}
const sendErr = (res, status, code, message, retryAfter, extra = {}) =>
  send(res, status, { error: { code, message, ...(retryAfter ? { retryAfter } : {}) } },
    { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}), ...extra });

function clientIp(req) {
  if (TRUST_PROXY > 0) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ip = xff[xff.length - TRUST_PROXY];
    if (ip) return ip;
  }
  return req.socket.remoteAddress || 'unknown';
}

/* CORS: only the origins you list, never "*" */
function corsHeaders(req) {
  const o = req.headers.origin;
  if (!o || !ORIGINS.includes(o)) return {};
  return { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' };
}

/* sliding-window limiter per IP (in memory: use a shared store if you run several instances) */
const hits = new Map();
function rateCheck(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return Math.max(1, Math.ceil((arr[0] + RATE_WINDOW_MS - now) / 1000)); }
  arr.push(now); hits.set(ip, arr); return 0;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k); }, 60000).unref();

let day = new Date().toISOString().slice(0, 10), dayCount = 0;
const underDailyCap = () => { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; dayCount = 0; } return dayCount < DAILY_LIMIT; };
let inflight = 0;

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = +req.headers['content-length'];
    if (declared > limit) { req.resume(); return reject(new AppError(413, 'too_large', 'The photo is too large. Please use a smaller one.')); }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); return reject(new AppError(413, 'too_large', 'The photo is too large. Please use a smaller one.')); }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new AppError(400, 'bad_request', 'Malformed request.')); } });
    req.on('error', () => reject(new AppError(400, 'bad_request', 'Malformed request.')));
  });
}

const MIME = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/webp': (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP',
};

/* ---------- API ---------- */
async function handleGenerate(req, res, cors) {
  const id = crypto.randomBytes(4).toString('hex'), t0 = Date.now();
  const E = (status, code, msg, ra) => sendErr(res, status, code, msg, ra, cors);
  try {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return E(415, 'bad_request', 'Send JSON.');
    const wait = rateCheck(clientIp(req));
    if (wait) return E(429, 'rate_limited', `You have reached the limit of ${RATE_MAX} artworks per ${Math.round(RATE_WINDOW_MS / 60000)} minutes. Please try again later.`, wait);
    const { genre, image, mime } = (await readJson(req, MAX_BODY)) || {};
    if (typeof genre !== 'string' || !Object.prototype.hasOwnProperty.call(GENRES, genre)) return E(400, 'bad_genre', 'Please choose a valid genre.');
    if (typeof mime !== 'string' || !Object.prototype.hasOwnProperty.call(MIME, mime)) return E(400, 'bad_image', 'Please upload a JPEG, PNG or WebP photo.');
    if (typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return E(400, 'bad_image', 'The photo could not be read. Please try another one.');
    const buf = Buffer.from(image, 'base64');
    if (buf.length < 2000) return E(400, 'bad_image', 'The photo is too small. Please use a clearer, larger photo.');
    if (buf.length > MAX_IMAGE_BYTES) return E(413, 'too_large', 'The photo is too large. Please use a smaller one.');
    if (!MIME[mime](buf)) return E(400, 'bad_image', 'That file does not look like a real image.');
    if (!cfg().key && !cfg().hfToken) return E(503, 'not_configured', 'The AI service is not configured yet.');
    if (!underDailyCap()) return E(503, 'daily_cap', 'The studio has reached its daily limit. Please come back tomorrow.', 3600);
    if (inflight >= MAX_CONCURRENT) return E(503, 'busy', 'Lots of people are creating art right now. Please try again in a moment.', 20);

    inflight++; dayCount++;
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // stop paying for work nobody is waiting for
    try {
      const out = await generateMoodboard({ genre, image, mime, signal: ac.signal });
      console.log(`[${id}] ok genre="${genre}" ${Date.now() - t0}ms`);
      send(res, 200, { image: out.image, mime: out.mime, quote: out.quote, genre }, { 'Cache-Control': 'no-store', ...cors });
    } finally { inflight--; }
  } catch (e) {
    if (e && e.code === 'cancelled') return;
    if (e instanceof AppError) { console.warn(`[${id}] ${e.code} ${Date.now() - t0}ms`); return E(e.status === 499 ? 400 : e.status, e.code, e.message, e.retryAfter); }
    console.error(`[${id}] unexpected`, e && e.message);
    E(500, 'server_error', 'Something went wrong on our side. Please try again.');
  }
}

/* ---------- static files ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  if (p.includes('\0')) return send(res, 400, 'Bad request');
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(PUBLIC, path.normalize(p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname.startsWith('/api/')) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') {
      return send(res, cors['Access-Control-Allow-Origin'] ? 204 : 403, '', { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
    }
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, ai: !!(cfg().key || cfg().hfToken) }, { 'Cache-Control': 'no-store', ...cors });
    if (pathname === '/api/generate') {
      if (req.method !== 'POST') return sendErr(res, 405, 'method_not_allowed', 'Use POST.', 0, { Allow: 'POST', ...cors });
      return handleGenerate(req, res, cors);
    }
    return sendErr(res, 404, 'not_found', 'Not found.', 0, cors);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  serveStatic(req, res);
});
server.requestTimeout = 180000;
server.headersTimeout = 20000;

if (require.main === module) {
  server.listen(PORT, () => console.log(`Eye → Face listening on :${PORT}  (Gemini key ${cfg().key ? 'configured' : 'MISSING - set GEMINI_API_KEY'})`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
module.exports = server;
