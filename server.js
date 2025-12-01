const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, QueryCommand, GetCommand, BatchWriteCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

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

async function createRoom(name, privacy = 'public', ownerId = null) {
   const room = { roomId: uuidv4(), name, privacy, createdAt: Date.now(), ownerId: ownerId || null, archived: false };
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
   const timestampKey = Date.now() * 1000 + Math.floor(Math.random() * 1000); // prevents millisecond collisions
   const item = {
      roomId,
      timestamp: timestampKey,
      ...stroke,
      seq: Number.isFinite(stroke.seq) ? Number(stroke.seq) : 0,
      userSeqKey: `${stroke.userId || 'unknown'}#${String(Number.isFinite(stroke.seq) ? Number(stroke.seq) : 0).padStart(20, '0')}`,
      timestamp: stroke.timestamp || timestampKey
   };
   await ddb.send(new PutCommand({ TableName: STROKES_TABLE, Item: item }));
}

async function clearRoomStrokes(roomId) {
   if (!roomId) return;
   let lastEvaluatedKey;
   do {
      const data = await ddb.send(new QueryCommand({
         TableName: STROKES_TABLE,
         KeyConditionExpression: 'roomId = :r',
         ExpressionAttributeValues: { ':r': roomId },
         ExclusiveStartKey: lastEvaluatedKey
      }));
      const items = data.Items || [];
      lastEvaluatedKey = data.LastEvaluatedKey;
      if (items.length === 0) continue;

      // DynamoDB batch writes allow up to 25 items at a time
      for (let i = 0; i < items.length; i += 25) {
         const batch = items.slice(i, i + 25).filter(item => typeof item.timestamp === 'number');
         if (batch.length === 0) continue;
         const deleteRequests = batch.map(item => ({
            DeleteRequest: { Key: { roomId, timestamp: item.timestamp } }
         }));
         await ddb.send(new BatchWriteCommand({
            RequestItems: { [STROKES_TABLE]: deleteRequests }
         }));
      }
   } while (lastEvaluatedKey);
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
   const { name, privacy, ownerId } = req.body || {};
   if (!name) return res.status(400).json({ error: 'name required' });
   try {
      const room = await createRoom(name, privacy || 'public', ownerId || null);
      res.json(room);
      broadcast({ type: 'roomCreated', room });
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
   const { path: pathData, strokeColor, strokeWidth, smoothing, userId, seq, shapeType, objectData } = req.body || {};
   if (!pathData && !objectData) return res.status(400).json({ error: 'path or objectData required' });
   const stroke = {
      path: pathData,
      strokeColor: strokeColor || '#000000',
      strokeWidth: strokeWidth || 5,
      smoothing: smoothing || 0,
      userId: userId || 'unknown',
      seq: Number.isFinite(seq) ? Number(seq) : 0,
      shapeType,
      objectData,
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

app.delete('/api/rooms/:roomId/strokes', async (req, res) => {
   const { roomId } = req.params;
   try {
      await clearRoomStrokes(roomId);
      res.json({ ok: true });
   } catch (err) {
      console.error('Failed to clear strokes', err);
      res.status(500).json({ error: 'Failed to clear strokes' });
   }
});

app.post('/api/rooms/:roomId/archive', async (req, res) => {
   const { roomId } = req.params;
   const { archived } = req.body || {};
   try {
      await ddb.send(new UpdateCommand({
         TableName: ROOMS_TABLE,
         Key: { roomId },
         UpdateExpression: 'SET archived = :a',
         ExpressionAttributeValues: { ':a': !!archived }
      }));
      const updated = await ddb.send(new GetCommand({
         TableName: ROOMS_TABLE,
         Key: { roomId }
      }));
      const room = updated.Item || { roomId, archived: !!archived };
      broadcast({ type: 'roomArchived', roomId, room });
      res.json(room);
   } catch (err) {
      console.error('Failed to archive room', err);
      res.status(500).json({ error: 'Failed to archive room' });
   }
});

app.delete('/api/rooms/:roomId', async (req, res) => {
   const { roomId } = req.params;
   try {
      await clearRoomStrokes(roomId);
      await ddb.send(new DeleteCommand({
         TableName: ROOMS_TABLE,
         Key: { roomId }
      }));
      broadcast({ type: 'roomDeleted', roomId });
      res.json({ ok: true });
   } catch (err) {
      console.error('Failed to delete room', err);
      res.status(500).json({ error: 'Failed to delete room' });
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
              if (data.action !== 'remove' && roomId) {
                 persistStroke(roomId, {
                    path: data.path,
                    strokeColor: data.strokeColor,
                    strokeWidth: data.strokeWidth,
                    smoothing: data.smoothing,
                    userId,
                    seq: Number.isFinite(data.seq) ? Number(data.seq) : 0,
                    timestamp: Date.now(),
                    shapeType: data.shapeType,
                    objectData: data.objectData
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
                  shapeType: data.shapeType,
                  objectData: data.objectData,
                  seq: data.seq,
                  roomId
               }, userId, roomId);
               break;

            case 'roomCreated':
               broadcast({
                  type: 'roomCreated',
                  room: data.room
               }, null, null);
               break;

            case 'roomDeleted':
               broadcast({
                  type: 'roomDeleted',
                  roomId: data.roomId
               }, null, null);
               break;

            case 'roomArchived':
               broadcast({
                  type: 'roomArchived',
                  roomId: data.roomId,
                  room: data.room
               }, null, null);
               break;

            case 'userSettings':
               if (users.has(userId)) {
                  const userEntry = users.get(userId);
                  userEntry.userData.color = data.color;
                  userEntry.userData.brushSize = data.brushSize;
                  userEntry.userData.smoothing = data.smoothing;
                  userEntry.userData.mode = data.mode;
                  if (data.name) {
                     userEntry.userData.name = data.name;
                  }
                  const roomId = userEntry.roomId;
                  broadcast({
                     type: 'userSettings',
                     userId,
                     userData: userEntry.userData,
                     roomId
                  }, userId, roomId);
               }
               break;

            case 'clearCanvas': {
               const roomId = data.roomId || users.get(userId)?.roomId || null;
               if (!roomId) break;
               clearRoomStrokes(roomId).catch(err => console.error('Failed to clear strokes', err));
               broadcast({
                  type: 'canvasCleared',
                  roomId,
                  triggeredBy: userId
               }, userId, roomId);
               break;
            }
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
