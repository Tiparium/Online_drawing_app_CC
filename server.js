const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'pseudo-s3.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { rooms: [], strokesByRoom: {} };
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

let store = loadStore();
if (!store.strokesByRoom) store.strokesByRoom = {};

function persistStroke(roomId, stroke) {
  if (!roomId || !stroke) return;
  if (!store.strokesByRoom[roomId]) store.strokesByRoom[roomId] = [];
  store.strokesByRoom[roomId].push(stroke);
  saveStore(store);
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Health check endpoint (useful for AWS load balancers)
app.get('/health', (req, res) => {
   res.status(200).json({ status: 'ok' });
});

// Serve the main app
app.get('/', (req, res) => {
   res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Pseudo S3 APIs
app.get('/api/rooms', (req, res) => {
   res.json({ rooms: store.rooms });
});

app.post('/api/rooms', (req, res) => {
   const { name, privacy } = req.body || {};
   if (!name) return res.status(400).json({ error: 'name required' });
   const room = { id: uuidv4(), name, privacy: privacy || 'public', createdAt: Date.now() };
   store.rooms.push(room);
   saveStore(store);
   res.json(room);
});

app.get('/api/rooms/:roomId/strokes', (req, res) => {
   const { roomId } = req.params;
   const strokes = store.strokesByRoom[roomId] || [];
   res.json({ strokes });
});

app.post('/api/rooms/:roomId/strokes', (req, res) => {
   const { roomId } = req.params;
   const { path: pathData, strokeColor, strokeWidth, smoothing, userId } = req.body || {};
   if (!pathData) return res.status(400).json({ error: 'path required' });
   const stroke = {
      path: pathData,
      strokeColor: strokeColor || '#000000',
      strokeWidth: strokeWidth || 5,
      smoothing: smoothing || 0,
      userId: userId || 'unknown',
      timestamp: Date.now()
   };
   persistStroke(roomId, stroke);
   res.json({ ok: true });
});

// WebSocket connection management
const users = new Map(); // userId -> { ws, userData, roomId }

// Broadcast to all clients except sender
function broadcast(data, excludeUserId = null, roomId = null) {
   const message = JSON.stringify(data);
   users.forEach((user, userId) => {
      const sameRoom = !roomId || user.roomId === roomId || !user.roomId;
      if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN && sameRoom) {
         user.ws.send(message);
      }
   });
}

wss.on('connection', (ws) => {
   const userId = uuidv4();
   const userData = {
      id: userId,
      cursor: { x: 0, y: 0 },
      color: '#000000',
      brushSize: 5,
      smoothing: 0,
      mode: 'draw'
   };

   users.set(userId, { ws, userData, roomId: null });

   // Send current state to new user
   ws.send(JSON.stringify({
      type: 'userConnected',
      userId,
      userData
   }));

   // Send all existing users to new user
   const existingUsers = Array.from(users.entries()).map(([id, user]) => ({
      userId: id,
      userData: user.userData
   }));
   ws.send(JSON.stringify({
      type: 'existingUsers',
      users: existingUsers.filter(u => u.userId !== userId)
   }));

   // Broadcast new user to all others
   broadcast({
      type: 'userJoined',
      userId,
      userData,
      roomId: null
   }, userId);

   ws.on('message', (message) => {
      try {
         const data = JSON.parse(message);

         switch (data.type) {
            case 'joinRoom': {
               const { roomId } = data;
               if (users.has(userId)) {
                  users.get(userId).roomId = roomId;
                  ws.send(JSON.stringify({ type: 'roomJoined', roomId }));
               }
               break;
            }

            case 'cursorMove':
               if (users.has(userId)) {
                  users.get(userId).userData.cursor = data.cursor;
                  broadcast({
                     type: 'cursorMove',
                     userId,
                     cursor: data.cursor,
                     roomId: users.get(userId).roomId
                  }, userId, users.get(userId).roomId);
               }
               break;

            case 'drawingUpdate':

               const roomId = data.roomId || users.get(userId)?.roomId || null;
               // Store stroke in pseudo S3
               if (data.action === 'add' && roomId) {
                  persistStroke(roomId, {
                     path: data.path,
                     strokeColor: data.strokeColor,
                     strokeWidth: data.strokeWidth,
                     smoothing: data.smoothing,
                     userId,
                     timestamp: Date.now()
                  });
               }

               // Forward drawing updates to all other users in room
               broadcast({
                  type: 'drawingUpdate',
                  userId,
                  path: data.path,
                  action: data.action, // 'add', 'remove', 'update'
                  strokeColor: data.strokeColor,
                  strokeWidth: data.strokeWidth,
                  smoothing: data.smoothing,
                  roomId
               }, userId, roomId);
               break;

            case 'userSettings':
               if (users.has(userId)) {
                  users.get(userId).userData.color = data.color;
                  users.get(userId).userData.brushSize = data.brushSize;
                  users.get(userId).userData.smoothing = data.smoothing;
                  users.get(userId).userData.mode = data.mode;
               }
               break;
        }
     } catch (error) {
         console.error('Error processing message:', error);
      }
   });

   ws.on('close', () => {
      users.delete(userId);
      broadcast({
         type: 'userLeft',
         userId,
         roomId: null
      });
   });
});

server.listen(PORT, () => {
   console.log(`Server running on http://localhost:${PORT}`);
   console.log(`WebSocket server ready`);
});
