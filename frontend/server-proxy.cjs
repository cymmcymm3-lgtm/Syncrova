const express = require('express');
const httpProxy = require('http-proxy');
const path = require('path');

const app = express();
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true
});

app.use((req, res, next) => {
  console.log(`[PROXY] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, 'dist')));
app.use('/uploads', express.static(path.join(__dirname, '../backend/uploads')));

app.use('/api', (req, res) => {
  req.url = req.originalUrl;
  console.log(`[PROXY] Forwarding API: ${req.method} ${req.url}`);
  proxy.web(req, res, { target: BACKEND_URL }, (err) => {
    console.error('[PROXY ERROR]', err.message);
    if (!res.headersSent) res.status(500).json({ msg: 'Backend unreachable' });
  });
});

app.use('/socket.io', (req, res) => {
  req.url = req.originalUrl;
  console.log(`[PROXY] Forwarding Socket.IO: ${req.method} ${req.url}`);
  proxy.web(req, res, { target: BACKEND_URL }, (err) => {
    console.error('[SOCKET PROXY ERROR]', err.message);
    if (!res.headersSent) res.status(500).json({ msg: 'Socket backend unreachable' });
  });
});

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 5002;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server (with WebSocket support) running on http://localhost:${PORT}`);
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/socket.io')) {
    socket.destroy();
    return;
  }

  console.log('[PROXY] Upgrade request for', req.url);
  proxy.ws(req, socket, head, { target: BACKEND_URL });
});
