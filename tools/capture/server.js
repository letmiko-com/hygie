// Capture harness for Health Auto Export payloads.
//
// Records every incoming request verbatim (headers + gzipped body) so the
// real HAE protocol can be studied before the ingestion schema is designed:
// batch sizes, identifiers, retry behaviour, ordering, header set.
//
// This is NOT the ingestion endpoint. It interprets nothing, stores raw.
// Auth: shared token in the X-Capture-Token header (CAPTURE_TOKEN env var).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data/captures';
const TOKEN = process.env.CAPTURE_TOKEN;
const MAX_BODY = 512 * 1024 * 1024; // 512 MiB hard stop, we want to observe big batches

if (!TOKEN) {
  console.error('CAPTURE_TOKEN is not set, refusing to start');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

let seq = 0;

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function listCaptures() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.meta.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, captures: fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.meta.json')).length }));
    return;
  }

  // Everything else requires the token, checked before reading any body.
  const token = req.headers['x-capture-token'] || url.searchParams.get('token');
  if (!token || !constantTimeEqual(token, TOKEN)) {
    console.log(`rejected 401: ${req.method} ${url.pathname} token=${token ? 'present-but-wrong' : 'missing'} ua=${(req.headers['user-agent'] || '?').slice(0, 40)}`);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    req.destroy();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/captures') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(listCaptures(), null, 2));
    return;
  }

  // Download one captured body (still gzipped) by id, for offline analysis.
  const dl = url.pathname.match(/^\/captures\/([A-Za-z0-9-]+)\/body$/);
  if (req.method === 'GET' && dl) {
    const p = path.join(DATA_DIR, `${dl[1]}.body.gz`);
    if (!fs.existsSync(p)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/gzip' });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (req.method === 'POST') {
    const started = Date.now();
    const id = `${new Date(started).toISOString().replace(/[:.]/g, '-')}-${String(++seq).padStart(4, '0')}`;
    const bodyPath = path.join(DATA_DIR, `${id}.body.gz`);
    const metaPath = path.join(DATA_DIR, `${id}.meta.json`);
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(bodyPath);
    let bytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        aborted = true;
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        req.destroy();
      }
    });
    req.pipe(gzip).pipe(out);

    out.on('finish', () => {
      const meta = {
        id,
        receivedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        // Full header set is the point of the capture. The only secret in
        // there is our own capture token, so mask it.
        headers: { ...req.headers, 'x-capture-token': '***' },
        bodyBytes: bytes,
        aborted,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      console.log(`captured ${id}: ${bytes} bytes on ${url.pathname}${aborted ? ' (aborted)' : ''}`);
      if (!aborted) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id, bytes }));
      }
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.requestTimeout = 15 * 60 * 1000; // match Railway's 15 min proxy limit
server.listen(PORT, () => console.log(`capture harness listening on :${PORT}, data in ${DATA_DIR}`));
