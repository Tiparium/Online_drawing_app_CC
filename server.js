const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const ROOMS_TABLE = process.env.ROOMS_TABLE || `Rooms-${ENVIRONMENT}`;
const STROKES_TABLE = process.env.STROKES_TABLE || `CanvasObjects-${ENVIRONMENT}`;
const DEPLOY_TABLE = process.env.DEPLOY_TABLE || `DeploymentStats-${ENVIRONMENT}`;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function listRooms() {
   const data = await ddb.send(new ScanCommand({ TableName: ROOMS_TABLE }));
   const rooms = data.Items || [];
   rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
   return rooms;
}

async function createRoom(name, privacy = 'public') {
   const room = { roomId: uuidv4(), name, privacy, createdAt: Date.now() };
   await ddb.send(new PutCommand({ TableName: ROOMS_TABLE, Item: room }));
   return room;
}

async function listStrokes(roomId) {
   const data = await ddb.send(new QueryCommand({
      TableName: STROKES_TABLE,
      KeyConditionExpression: 'roomId = :r',
      ExpressionAttributeValues: { ':r': roomId },
      ScanIndexForward: true
   }));
   return data.Items || [];
}

async function persistStroke(roomId, stroke) {
   if (!roomId || !stroke) return;
   const item = {
      roomId,
      objectId: uuidv4(),
      ...stroke,
      timestamp: stroke.timestamp || Date.now()
   };
   await ddb.send(new PutCommand({ TableName: STROKES_TABLE, Item: item }));
}

async function getDeployCount() {
   try {
      const res = await ddb.send(new GetCommand({
         TableName: DEPLOY_TABLE,
         Key: { id: 'deploy' }
      }));
      const raw = res.Item && res.Item.deployCount;
      const val = typeof raw === 'object' && raw !== null && 'N' in raw ? Number(raw.N) : Number(raw);
      return Number.isFinite(val) ? val : 0;
   } catch (err) {
      console.error('Failed to fetch deploy count', err);
      return 0;
   }
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use((req, res, next) => {
   res.header('Access-Control-Allow-Origin', '*');
   res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
   if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      return res.sendStatus(200);
   }
   next();
});

// Health check endpoint (useful for AWS load balancers)
app.get('/health', (req, res) => {
   res.status(200).json({ status: 'ok' });
});

// Serve the main app
app.get('/', (req, res) => {
   res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// REST APIs backed by DynamoDB
app.get('/api/rooms', async (req, res) => {
   try {
      const rooms = await listRooms();
      res.json({ rooms });
   } catch (err) {
      console.error('Failed to list rooms', err);
      res.status(500).json({ error: 'Failed to list rooms' });
   }
});

app.post('/api/rooms', async (req, res) => {
   const { name, privacy } = req.body || {};
   if (!name) return res.status(400).json({ error: 'name required' });
   try {
      const room = await createRoom(name, privacy || 'public');
      res.json(room);
   } catch (err) {
      console.error('Failed to create room', err);
      res.status(500).json({ error: 'Failed to create room' });
   }
});

app.get('/api/rooms/:roomId/strokes', async (req, res) => {
   const { roomId } = req.params;
   try {
      const strokes = await listStrokes(roomId);
      res.json({ strokes });
   } catch (err) {
      console.error('Failed to list strokes', err);
      res.status(500).json({ error: 'Failed to list strokes' });
   }
});

app.post('/api/rooms/:roomId/strokes', async (req, res) => {
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
   try {
      await persistStroke(roomId, stroke);
      res.json({ ok: true });
   } catch (err) {
      console.error('Failed to persist stroke', err);
      res.status(500).json({ error: 'Failed to persist stroke' });
   }
});

app.get('/api/deploy-count', async (req, res) => {
   const count = await getDeployCount();
   res.json({ count });
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

// Send current state to new user (no room yet)
ws.send(JSON.stringify({
   type: 'userConnected',
   userId,
   userData
}));

   ws.on('message', (message) => {
      try {
         const data = JSON.parse(message);

         switch (data.type) {
            case 'joinRoom': {
               const { roomId } = data;
               if (users.has(userId)) {
                  users.get(userId).roomId = roomId;
                  // Send existing users in this room to the joining user
                  const roomUsers = Array.from(users.entries())
                     .filter(([id, u]) => id !== userId && u.roomId === roomId)
                     .map(([id, u]) => ({ userId: id, userData: u.userData, roomId }));

                  ws.send(JSON.stringify({ type: 'roomJoined', roomId }));
                  ws.send(JSON.stringify({ type: 'existingUsersInRoom', roomId, users: roomUsers }));

                  // Notify others in the room
                  broadcast({
                     type: 'userJoined',
                     userId,
                     userData,
                     roomId
                  }, userId, roomId);
               }
               break;
            }

            case 'cursorMove':
                if (users.has(userId)) {
                   users.get(userId).userData.cursor = data.cursor;
                  const roomId = users.get(userId).roomId;
                  broadcast({
                     type: 'cursorMove',
                     userId,
                     cursor: data.cursor,
                     roomId
                  }, userId, roomId);
                }
                break;

            case 'drawingUpdate':
               const roomId = data.roomId || users.get(userId)?.roomId || null;
               if (data.action === 'add' && roomId) {
                  persistStroke(roomId, {
                     path: data.path,
                     strokeColor: data.strokeColor,
                     strokeWidth: data.strokeWidth,
                     smoothing: data.smoothing,
                     userId,
                     timestamp: Date.now()
                  }).catch(err => console.error('Failed to persist stroke', err));
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
                  const roomId = users.get(userId).roomId;
                  broadcast({
                     type: 'userSettings',
                     userId,
                     userData: users.get(userId).userData,
                     roomId
                  }, userId, roomId);
               }
               break;
        }
     } catch (error) {
         console.error('Error processing message:', error);
      }
   });

   ws.on('close', () => {
      const roomId = users.get(userId)?.roomId || null;
      users.delete(userId);
      broadcast({
         type: 'userLeft',
         userId,
         roomId
      }, userId, roomId);
   });
});

server.listen(PORT, () => {
   console.log(`Server running on http://localhost:${PORT}`);
   console.log(`WebSocket server ready`);
});
