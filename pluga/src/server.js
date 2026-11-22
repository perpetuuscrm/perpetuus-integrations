'use strict';

/** HTTP entry point. Logs method, path (relay tokens masked), status and time; never headers or bodies. */
const http = require('http');
const { loadConfig } = require('./config');
const { createApp } = require('./app');

const MAX_BODY_BYTES = 1024 * 1024;

function createServer(config = loadConfig(), deps = {}) {
  const app = createApp(config, deps);
  return http.createServer((req, res) => {
    const started = Date.now();
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"message":"Payload too large"}');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      const url = new URL(req.url, 'http://local');
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body;
      if (rawBody && !url.pathname.startsWith('/relay/')) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"message":"Body must be JSON"}');
          return;
        }
      }
      const query = {};
      for (const [key, value] of url.searchParams) query[key] = value;
      const result = await app.handle({ method: req.method, path: url.pathname, query, headers: req.headers, body, rawBody });
      const headers = { ...(result.headers || {}) };
      let payload = '';
      if (result.body !== undefined && result.status !== 204) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        payload = JSON.stringify(result.body);
      }
      res.writeHead(result.status, headers).end(payload);
      const path = url.pathname.startsWith('/relay/') ? '/relay/***' : url.pathname;
      if (!process.env.QUIET) console.log(`${req.method} ${path} ${result.status} ${Date.now() - started}ms`);
    });
  });
}

if (require.main === module) {
  const config = loadConfig();
  createServer(config).listen(config.port, () => console.log(`perpetuus-pluga-adapter listening on :${config.port}`));
}

module.exports = { createServer };
