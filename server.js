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

// Broadcast to all connected WebSocket clients
const broadcast = (data) => {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
};

wss.on('connection', (ws) => {
  // Send current queue state on connect
  ws.send(JSON.stringify({ type: 'queue:init', jobs: queue.getAll() }));
});

queue.on('job:added',   (job)  => broadcast({ type: 'job:added',   job }));
queue.on('job:updated', (job)  => broadcast({ type: 'job:updated', job }));
queue.on('job:removed', (data) => broadcast({ type: 'job:removed', ...data }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TubeDL running on http://0.0.0.0:${PORT}`);
});
