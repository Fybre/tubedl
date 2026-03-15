const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const searchRouter = require('./routes/search');
const downloadsRouter = require('./routes/downloads');
const queue = require('./services/queue');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/search', searchRouter);
app.use('/api', downloadsRouter);

// Map to track session IDs for each WebSocket connection
const clientSessions = new Map();

// Broadcast to clients with matching session ID (or all if no session specified)
const broadcast = (data, targetSessionId = null) => {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const clientSession = clientSessions.get(client);
      // If no target session, broadcast to all (for backwards compatibility)
      // If target session, only broadcast to matching clients
      if (!targetSessionId || clientSession === targetSessionId) {
        client.send(msg);
      }
    }
  });
};

wss.on('connection', (ws, req) => {
  // Session ID passed as ?sid= query param — reliable across all environments
  const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const sid = urlParams.get('sid') || null;

  if (sid) clientSessions.set(ws, sid);

  // Send this session's queue state immediately
  ws.send(JSON.stringify({ type: 'queue:init', jobs: queue.getAll(sid) }));

  ws.on('error', (err) => console.error('WS error:', err.message));
  ws.on('close', () => clientSessions.delete(ws));
});

// Broadcast job events only to the session that owns the job
queue.on('job:added', (job) => {
  broadcast({ type: 'job:added', job }, job.sessionId);
});

queue.on('job:updated', (job) => {
  broadcast({ type: 'job:updated', job }, job.sessionId);
});

queue.on('job:removed', (data) => {
  broadcast({ type: 'job:removed', ...data }, data.sessionId);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TubeDL running on http://0.0.0.0:${PORT}`);
});
