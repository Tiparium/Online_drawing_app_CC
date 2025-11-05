const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (useful for AWS load balancers)
app.get('/health', (req, res) => {
   res.status(200).json({ status: 'ok' });
});

// Serve the main app
app.get('/', (req, res) => {
   res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection management
const users = new Map(); // userId -> { ws, userData }

// Broadcast to all clients except sender
function broadcast(data, excludeUserId = null) {
   const message = JSON.stringify(data);
   users.forEach((user, userId) => {
      if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
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

   users.set(userId, { ws, userData });

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
      userData
   }, userId);

   ws.on('message', (message) => {
      try {
         const data = JSON.parse(message);

         switch (data.type) {
            case 'cursorMove':
               if (users.has(userId)) {
                  users.get(userId).userData.cursor = data.cursor;
                  broadcast({
                     type: 'cursorMove',
                     userId,
                     cursor: data.cursor
                  }, userId);
               }
               break;

            case 'drawingUpdate':

               // Forward drawing updates to all other users
               broadcast({
                  type: 'drawingUpdate',
                  userId,
                  path: data.path,
                  action: data.action // 'add', 'remove', 'update'
               }, userId);
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
         userId
      });
   });
});

server.listen(PORT, () => {
   console.log(`Server running on http://localhost:${PORT}`);
   console.log(`WebSocket server ready`);
});

