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

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // Wait for client to send session ID before sending initial state
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('WS message received:', data.type, data.sessionId);
      if (data.type === 'session:register' && data.sessionId) {
        clientSessions.set(ws, data.sessionId);
        console.log('Session registered:', data.sessionId);
        // Send only this session's queue state
        const jobs = queue.getAll(data.sessionId);
        console.log('Sending queue init with jobs:', jobs.length);
        ws.send(JSON.stringify({ type: 'queue:init', jobs }));
      }
    } catch (err) {
      console.error('WS message error:', err.message);
    }
  });

  // Clean up on disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clientSessions.delete(ws);
  });
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
