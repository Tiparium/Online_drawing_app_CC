# Quick Integration Points Reference

## Code Locations Requiring Changes for DynamoDB Persistence

### Client-Side (`public/app.js`)

#### 1. Canvas Initialization
**Current Line**: ~4-8
```javascript
const canvas = new fabric.Canvas('canvas', {
    width: 800,
    height: 600,
    backgroundColor: '#ffffff'
});
```

**Add After**:
```javascript
let currentCanvasId = 'global'; // Default canvas
let canvasMetadata = null;

async function loadCanvas(canvasId) {
    currentCanvasId = canvasId;
    // Request canvas state via WebSocket
    sendWebSocketMessage('canvasJoin', { canvasId });
}
```

#### 2. Path Creation Handler
**Current Line**: ~620-630 (in WebSocket section)
```javascript
canvas.on('path:created', (e) => {
    if (e.path && localUser) {
        const pathData = e.path.path;
        sendWebSocketMessage('drawingUpdate', {
            path: pathData,
            action: 'add'
        });
    }
});
```

**Replace With**:
```javascript
canvas.on('path:created', (e) => {
    if (e.path && localUser) {
        const objectId = generateUUID();
        const objectData = e.path.toObject(); // Full Fabric.js object
        
        // Add metadata
        e.path.set('objectId', objectId);
        e.path.set('canvasId', currentCanvasId);
        e.path.set('userId', localUser.userId);
        
        sendWebSocketMessage('drawingUpdate', {
            canvasId: currentCanvasId,
            objectId: objectId,
            objectData: objectData,
            action: 'add'
        });
    }
});
```

#### 3. WebSocket Message Handler - Add Canvas State
**Current Line**: ~556-598 (handleWebSocketMessage function)

**Add New Case**:
```javascript
case 'canvasState':
    // Clear current canvas
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    
    // Load objects from server
    data.objects.forEach(objData => {
        fabric.util.enlivenObjects([objData], (objects) => {
            canvas.add(objects[0]);
        });
    });
    
    canvas.renderAll();
    break;
```

#### 4. WebSocket Connection - Send Canvas Join
**Current Line**: ~524-554 (connectWebSocket function)

**Add After Connection**:
```javascript
ws.onopen = () => {
    console.log('WebSocket connected');
    isConnected = true;
    
    // Join default canvas
    sendWebSocketMessage('canvasJoin', {
        canvasId: currentCanvasId || 'global'
    });
};
```

### Server-Side (`server.js`)

#### 1. Add DynamoDB Client
**Add at top of file**:
```javascript
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION || 'us-east-1'
});
```

#### 2. Canvas State Loading
**Add new function**:
```javascript
async function loadCanvasObjects(canvasId) {
    const params = {
        TableName: 'CanvasObjects',
        KeyConditionExpression: 'canvasId = :canvasId',
        ExpressionAttributeValues: {
            ':canvasId': canvasId
        },
        IndexName: 'canvasId-createdAt-index'
    };
    
    const result = await dynamodb.query(params).promise();
    return result.Items.map(item => item.objectData);
}
```

#### 3. Save Canvas Object
**Add new function**:
```javascript
async function saveCanvasObject(data) {
    const params = {
        TableName: 'CanvasObjects',
        Item: {
            canvasId: data.canvasId,
            objectId: data.objectId,
            objectType: data.objectData.type,
            objectData: data.objectData,
            userId: data.userId || 'anonymous',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 1
        }
    };
    
    await dynamodb.put(params).promise();
}
```

#### 4. Connection Handler - Load State
**Modify** `wss.on('connection')` around line 39:
```javascript
wss.on('connection', async (ws, req) => {
    const userId = uuidv4();
    const url = new URL(req.url, 'http://localhost');
    const canvasId = url.searchParams.get('canvasId') || 'global';
    
    // ... existing userData setup ...
    
    // Load canvas state
    try {
        const objects = await loadCanvasObjects(canvasId);
        ws.send(JSON.stringify({
            type: 'canvasState',
            canvasId: canvasId,
            objects: objects
        }));
    } catch (error) {
        console.error('Error loading canvas state:', error);
    }
    
    // ... rest of connection handler ...
});
```

#### 5. Drawing Update Handler - Persist
**Modify** `case 'drawingUpdate'` around line 92:
```javascript
case 'drawingUpdate':
    // Save to DynamoDB
    try {
        await saveCanvasObject({
            canvasId: data.canvasId || 'global',
            objectId: data.objectId,
            objectData: data.objectData,
            userId: userId
        });
    } catch (error) {
        console.error('Error saving canvas object:', error);
        // Continue to broadcast even if save fails
    }
    
    // Forward drawing updates to all other users
    broadcast({
        type: 'drawingUpdate',
        userId,
        canvasId: data.canvasId || 'global',
        objectId: data.objectId,
        path: data.path,
        objectData: data.objectData,
        action: data.action
    }, userId);
    break;
```

#### 6. Add Canvas Join Handler
**Add new case** in `ws.on('message')` handler:
```javascript
case 'canvasJoin':
    const canvasId = data.canvasId || 'global';
    try {
        const objects = await loadCanvasObjects(canvasId);
        ws.send(JSON.stringify({
            type: 'canvasState',
            canvasId: canvasId,
            objects: objects
        }));
    } catch (error) {
        console.error('Error joining canvas:', error);
    }
    break;
```

---

## Helper Functions Needed

### Client-Side (`public/app.js`)

```javascript
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
```

### Server-Side (`server.js`)

```javascript
// Already using uuid, but ensure it's imported
const { v4: uuidv4 } = require('uuid');
```

---

## Testing Checklist

### Before Adding DynamoDB
- [ ] Test current functionality works
- [ ] Verify WebSocket connections
- [ ] Test multi-user drawing

### After Adding DynamoDB Integration
- [ ] Canvas state loads on connection
- [ ] New drawings persist to DynamoDB
- [ ] Multiple clients see persisted drawings
- [ ] Object IDs are unique
- [ ] Canvas switching works (if implemented)

### Before AWS Migration
- [ ] DynamoDB tables created
- [ ] IAM roles configured
- [ ] Lambda functions tested locally
- [ ] API Gateway endpoints configured
- [ ] Cognito integration tested

---

## Environment Variables Needed

### Local Development
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
CANVAS_OBJECTS_TABLE=CanvasObjects-dev
CANVASES_TABLE=Canvases-dev
```

### AWS Lambda
- Set via Lambda environment variables
- Or use IAM roles (recommended)

---

## Migration Order

1. **Phase 1**: Add canvas context (no DB yet)
   - Add `canvasId` to client state
   - Add `canvasId` to messages
   - Server accepts but ignores

2. **Phase 2**: Add DynamoDB writes
   - Create DynamoDB tables
   - Add save functions
   - Write on `drawingUpdate`
   - Keep broadcasting (dual-write)

3. **Phase 3**: Add canvas state loading
   - Load on connection
   - Load on canvas switch
   - Test persistence

4. **Phase 4**: Full AWS migration
   - Deploy Lambda functions
   - Configure API Gateway
   - Deploy frontend to S3/CloudFront
   - Integrate Cognito

