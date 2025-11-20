# Whiteboard Application - AWS Architecture Design

## Current State vs Target Architecture

### Current Architecture (Local Development)

- **Server**: Express.js with WebSocket (ws)
- **State**: In-memory only (no persistence)
- **Canvas**: Single global canvas
- **Auth**: None
- **Deployment**: Single server

### Target Architecture (AWS Production)

- **Frontend**: S3 + CloudFront
- **WebSocket**: API Gateway WebSocket API + Lambda
- **REST API**: API Gateway REST API + Lambda
- **Database**: DynamoDB (canvas state)
- **Auth**: Cognito
- **Scheduling**: EventBridge
- **State**: Persistent across sessions

---

## Data Model Design

### DynamoDB Table Structure

#### Table: `CanvasObjects`

**Purpose**: Store all drawing objects (paths, shapes, text) for a canvas

| Attribute    | Type                   | Description                                                       |
| ------------ | ---------------------- | ----------------------------------------------------------------- |
| `canvasId`   | String (Partition Key) | Canvas identifier (e.g., "global", "company-123", "private-456")  |
| `objectId`   | String (Sort Key)      | Unique object identifier (UUID)                                   |
| `objectType` | String                 | Type: "path", "rect", "circle", "text", "image"                   |
| `objectData` | Map                    | Fabric.js object serialized data (path, color, strokeWidth, etc.) |
| `userId`     | String                 | User who created the object                                       |
| `createdAt`  | Number                 | Timestamp (for ordering)                                          |
| `updatedAt`  | Number                 | Last update timestamp                                             |
| `version`    | Number                 | Version number for optimistic locking                             |

**GSI (Global Secondary Index)**: `canvasId-createdAt-index`

- Partition Key: `canvasId`
- Sort Key: `createdAt`
- Purpose: Efficient retrieval of canvas objects in chronological order

#### Table: `Canvases`

**Purpose**: Canvas metadata and configuration

| Attribute         | Type                   | Description                                    |
| ----------------- | ---------------------- | ---------------------------------------------- |
| `canvasId`        | String (Partition Key) | Canvas identifier                              |
| `name`            | String                 | Display name                                   |
| `type`            | String                 | "global", "company", "private"                 |
| `companyId`       | String                 | Company owner (if company canvas)              |
| `isPublic`        | Boolean                | Public visibility (read-only in global canvas) |
| `reservedAreas`   | List                   | Array of reserved space definitions            |
| `width`           | Number                 | Canvas width                                   |
| `height`          | Number                 | Canvas height                                  |
| `backgroundColor` | String                 | Canvas background color                        |
| `createdAt`       | Number                 | Creation timestamp                             |
| `updatedAt`       | Number                 | Last update timestamp                          |

**GSI**: `companyId-type-index`

- Partition Key: `companyId`
- Sort Key: `type`
- Purpose: List all canvases for a company

#### Table: `ReservedAreas`

**Purpose**: Track purchased/reserved canvas spaces

| Attribute     | Type                   | Description                              |
| ------------- | ---------------------- | ---------------------------------------- |
| `areaId`      | String (Partition Key) | Unique area identifier                   |
| `canvasId`    | String                 | Canvas containing this area              |
| `companyId`   | String                 | Company that owns this area              |
| `bounds`      | Map                    | `{x, y, width, height}` defining area    |
| `isPrivate`   | Boolean                | Private (editable) vs public (read-only) |
| `purchasedAt` | Number                 | Purchase timestamp                       |
| `expiresAt`   | Number                 | Expiration timestamp (optional)          |

**GSI**: `canvasId-areaId-index`

- Partition Key: `canvasId`
- Sort Key: `areaId`
- Purpose: Get all areas for a canvas

#### Table: `CanvasSnapshots`

**Purpose**: Periodic snapshots for recovery and compaction

| Attribute      | Type                   | Description                         |
| -------------- | ---------------------- | ----------------------------------- |
| `snapshotId`   | String (Partition Key) | Unique snapshot identifier          |
| `canvasId`     | String (Sort Key)      | Canvas identifier                   |
| `snapshotData` | Map                    | Full canvas state (JSON)            |
| `objectCount`  | Number                 | Number of objects in snapshot       |
| `createdAt`    | Number                 | Snapshot timestamp                  |
| `trigger`      | String                 | "scheduled", "manual", "compaction" |

**GSI**: `canvasId-createdAt-index`

- Partition Key: `canvasId`
- Sort Key: `createdAt`
- Purpose: Get latest snapshot for a canvas

---

## API Design

### WebSocket API (API Gateway + Lambda)

**Purpose**: Real-time drawing updates, cursor tracking

#### Connection Flow

```
Client → API Gateway WebSocket → Lambda (connect)
  → DynamoDB: Get canvas state
  → Return: Canvas objects + active users
  → Store connection in connection table
```

#### Message Types

**1. `canvasJoin`**

```json
{
  "type": "canvasJoin",
  "canvasId": "company-123",
  "userId": "cognito-user-id"
}
```

- Validates user has access to canvas
- Loads canvas state from DynamoDB
- Returns existing objects
- Notifies other users

**2. `drawingUpdate`** (Current implementation)

```json
{
  "type": "drawingUpdate",
  "canvasId": "company-123",
  "objectId": "uuid-here",
  "objectData": {
    "path": "M 10 10 L 20 20...",
    "stroke": "#ff0000",
    "strokeWidth": 5
  },
  "action": "add" | "update" | "delete",
  "timestamp": 1234567890
}
```

- **Lambda Action**:
  - Write to DynamoDB (CanvasObjects table)
  - Broadcast to all connected clients
  - Update canvas `updatedAt` timestamp

**3. `cursorMove`** (Current implementation)

- No persistence needed
- Broadcast only

**4. `userSettings`** (Current implementation)

- No persistence needed
- Broadcast only

#### Lambda Functions

**`onConnect`**

- Authenticate via Cognito
- Check canvas access permissions
- Load canvas state from DynamoDB
- Return initial state to client
- Store connection in DynamoDB connection table

**`onMessage`**

- Route by message type
- Validate permissions (reserved areas)
- Process drawing updates
- Write to DynamoDB
- Broadcast to connected clients

**`onDisconnect`**

- Clean up connection record
- Notify other users

### REST API (API Gateway + Lambda)

**Purpose**: Non-real-time operations

#### Endpoints

**Canvas Management**

- `POST /api/canvases` - Create canvas
- `GET /api/canvases/{canvasId}` - Get canvas metadata
- `GET /api/canvases?companyId={id}` - List company canvases
- `PUT /api/canvases/{canvasId}` - Update canvas settings
- `DELETE /api/canvases/{canvasId}` - Delete canvas

**Space Reservation**

- `POST /api/reservations` - Purchase/reserve space
- `GET /api/reservations?canvasId={id}` - List reservations
- `PUT /api/reservations/{areaId}` - Update reservation
- `DELETE /api/reservations/{areaId}` - Cancel reservation

**Export/Import**

- `GET /api/canvases/{canvasId}/export` - Export canvas as image
- `POST /api/canvases/{canvasId}/import` - Import canvas state

**Snapshot Management**

- `POST /api/canvases/{canvasId}/snapshots` - Create snapshot
- `GET /api/canvases/{canvasId}/snapshots` - List snapshots
- `GET /api/canvases/{canvasId}/snapshots/{snapshotId}` - Get snapshot

---

## Code Structure Modifications

### Current Client Code (`public/app.js`)

**Modifications Needed:**

1. **Canvas Context**

```javascript
// Current: Single global canvas
const canvas = new fabric.Canvas('canvas', {...});

// Target: Canvas ID management
let currentCanvasId = null;
let canvasMetadata = null;

function loadCanvas(canvasId) {
    currentCanvasId = canvasId;
    // Load canvas metadata
    // Load canvas objects from WebSocket or REST API
    // Initialize canvas with objects
}
```

2. **WebSocket Message Enhancement**

```javascript
// Add canvasId to all messages
sendWebSocketMessage('drawingUpdate', {
    canvasId: currentCanvasId,
    objectId: objectId,
    objectData: pathData,
    action: 'add'
});

// Handle canvas state loading
case 'canvasState':
    // Load initial canvas objects
    data.objects.forEach(obj => {
        const fabricObj = fabric.util.enlivenObjects([obj]);
        canvas.add(fabricObj);
    });
    break;
```

3. **Object ID Management**

```javascript
// Current: Objects created without IDs
canvas.on("path:created", (e) => {
  sendWebSocketMessage("drawingUpdate", {
    path: e.path.path,
    action: "add",
  });
});

// Target: Assign IDs before creation
canvas.on("path:created", (e) => {
  const objectId = generateUUID();
  e.path.set("objectId", objectId);
  e.path.set("canvasId", currentCanvasId);
  e.path.set("userId", localUser.userId);

  sendWebSocketMessage("drawingUpdate", {
    canvasId: currentCanvasId,
    objectId: objectId,
    objectData: e.path.toObject(), // Full Fabric.js object
    action: "add",
  });
});
```

### Server Code Modifications

**Current: `server.js` (Express + WebSocket)**

**Target: Lambda Functions**

#### `websocket-connect.js`

```javascript
exports.handler = async (event) => {
  const { requestContext, queryStringParameters } = event;
  const connectionId = requestContext.connectionId;
  const canvasId = queryStringParameters?.canvasId || "global";
  const userId = requestContext.authorizer?.userId; // From Cognito

  // Validate canvas access
  const hasAccess = await validateCanvasAccess(userId, canvasId);
  if (!hasAccess) {
    return { statusCode: 403 };
  }

  // Store connection
  await dynamodb.put({
    TableName: "Connections",
    Item: {
      connectionId,
      canvasId,
      userId,
      connectedAt: Date.now(),
    },
  });

  // Load canvas state
  const objects = await loadCanvasObjects(canvasId);

  // Send initial state
  await sendToConnection(connectionId, {
    type: "canvasState",
    canvasId,
    objects,
  });

  return { statusCode: 200 };
};
```

#### `websocket-message.js`

```javascript
exports.handler = async (event) => {
  const { requestContext, body } = event;
  const connectionId = requestContext.connectionId;
  const data = JSON.parse(body);

  switch (data.type) {
    case "drawingUpdate":
      // Write to DynamoDB
      await dynamodb.put({
        TableName: "CanvasObjects",
        Item: {
          canvasId: data.canvasId,
          objectId: data.objectId,
          objectType: data.objectData.type,
          objectData: data.objectData,
          userId: requestContext.authorizer.userId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
      });

      // Update canvas timestamp
      await dynamodb.update({
        TableName: "Canvases",
        Key: { canvasId: data.canvasId },
        UpdateExpression: "SET updatedAt = :now",
        ExpressionAttributeValues: { ":now": Date.now() },
      });

      // Broadcast to all connections on this canvas
      await broadcastToCanvas(
        data.canvasId,
        {
          type: "drawingUpdate",
          ...data,
        },
        connectionId
      );
      break;
  }

  return { statusCode: 200 };
};
```

---

## Authentication & Authorization Integration

### Cognito Integration Points

**1. WebSocket Connection**

- API Gateway authorizer validates Cognito JWT
- Extract `userId` and `companyId` from token claims
- Pass to Lambda via `requestContext.authorizer`

**2. Canvas Access Control**

```javascript
async function validateCanvasAccess(userId, canvasId, action = "read") {
  const canvas = await getCanvas(canvasId);

  // Global canvas: always readable
  if (canvas.type === "global" && action === "read") {
    return true;
  }

  // Company canvas: check company membership
  if (canvas.type === "company") {
    const user = await getCognitoUser(userId);
    if (user.companyId === canvas.companyId) {
      return action === "read" || action === "write";
    }
    // Public read-only check
    if (canvas.isPublic && action === "read") {
      return true;
    }
  }

  // Private canvas: owner only
  if (canvas.type === "private") {
    return canvas.ownerId === userId;
  }

  return false;
}
```

**3. Reserved Area Validation**

```javascript
async function validateReservedAreaAccess(userId, canvasId, x, y) {
  const areas = await getReservedAreas(canvasId);
  const user = await getCognitoUser(userId);

  for (const area of areas) {
    if (isPointInArea(x, y, area.bounds)) {
      // Check if user's company owns this area
      if (area.companyId === user.companyId) {
        return area.isPrivate ? "write" : "read";
      }
      // Area owned by different company
      if (!area.isPrivate) {
        return "read"; // Public read-only
      }
      return "denied";
    }
  }

  // Not in reserved area: global canvas rules apply
  return "write";
}
```

---

## Migration Path from Current Architecture

### Phase 1: Add Canvas Context (No Breaking Changes)

- Add `canvasId` to client-side state
- Add `canvasId` to WebSocket messages (default to 'global')
- Server accepts but ignores `canvasId` (backward compatible)

### Phase 2: Add DynamoDB Persistence

- Modify server to write `drawingUpdate` to DynamoDB
- Add canvas state loading on connection
- Keep in-memory broadcasting (dual-write)

### Phase 3: Multi-Canvas Support

- Add canvas selection UI
- Implement canvas switching
- Add canvas metadata management

### Phase 4: AWS Migration

- Deploy frontend to S3/CloudFront
- Replace Express server with Lambda functions
- Add API Gateway endpoints
- Integrate Cognito authentication

### Phase 5: Advanced Features

- Reserved area validation
- Snapshot/compaction system
- Export/import functionality

---

## Design Considerations

### 1. Canvas State Loading Strategy

**Option A: Full Load on Connect**

- Load all objects from DynamoDB
- Simple but slow for large canvases
- Good for: Small canvases, infrequent connections

**Option B: Incremental Sync**

- Load recent objects + snapshots
- Use version numbers for conflict resolution
- Good for: Large canvases, frequent connections

**Recommended**: Hybrid approach

- Load snapshot if available (< 1 hour old)
- Load objects created after snapshot
- Use GSI on `createdAt` for efficient queries

### 2. Write Performance

**Challenge**: Each drawing stroke creates many objects

- Solution: Batch writes using DynamoDB BatchWriteItem
- Buffer writes locally, flush every 100ms or 10 items

**Optimization**: Use DynamoDB Streams

- Stream canvas object writes to trigger snapshots
- Reduce Lambda polling for EventBridge

### 3. Conflict Resolution

**Scenario**: Two users edit same object simultaneously

**Solution**: Optimistic Locking

- Include `version` number in object updates
- Check version on update
- Reject if version mismatch
- Client handles rejection (refresh object)

### 4. Reserved Area Enforcement

**Client-Side**: Visual feedback

- Highlight reserved areas
- Disable drawing in unauthorized areas
- Show ownership information

**Server-Side**: Strict validation

- Lambda validates coordinates on every `drawingUpdate`
- Reject operations outside authorized areas
- Return error to client

### 5. Snapshot & Compaction Strategy

**EventBridge Schedule**: Every 6 hours

- Create snapshot of all canvases
- Store in `CanvasSnapshots` table
- Compaction: Delete objects older than 30 days, keep snapshots

**Manual Snapshots**: On-demand

- User-triggered via REST API
- Before major canvas changes
- Before deletion

---

## Key Integration Points in Current Code

### 1. `public/app.js` - Canvas Object Creation

**Location**: `canvas.on('path:created')` handler
**Change**: Add object metadata before sending

```javascript
// Add objectId, canvasId, userId
e.path.set("objectId", generateUUID());
e.path.set("canvasId", currentCanvasId);
e.path.set("userId", localUser.userId);
```

### 2. `public/app.js` - Canvas Loading

**Location**: `handleWebSocketMessage('canvasState')`
**Change**: Load objects from server response

```javascript
case 'canvasState':
    data.objects.forEach(obj => {
        fabric.util.enlivenObjects([obj], (objects) => {
            canvas.add(objects[0]);
        });
    });
    break;
```

### 3. `server.js` - Drawing Update Handler

**Location**: `case 'drawingUpdate'`
**Change**: Write to DynamoDB before broadcasting

```javascript
case 'drawingUpdate':
    // Write to DynamoDB
    await saveCanvasObject(data);
    // Then broadcast
    broadcast({...}, userId);
    break;
```

### 4. WebSocket Connection

**Location**: `wss.on('connection')`
**Change**: Load canvas state on connect

```javascript
wss.on("connection", async (ws) => {
  // ... existing code ...

  // Load canvas state
  const canvasId = query.canvasId || "global";
  const objects = await loadCanvasObjects(canvasId);

  ws.send(
    JSON.stringify({
      type: "canvasState",
      canvasId,
      objects,
    })
  );
});
```

---

## Testing Strategy

### Unit Tests

- DynamoDB write operations
- Canvas access validation
- Reserved area validation
- Object serialization/deserialization

### Integration Tests

- WebSocket connection flow
- Canvas state loading
- Multi-user drawing conflicts
- Reserved area enforcement

### Load Tests

- Concurrent users on same canvas
- Large canvas state loading
- DynamoDB write throughput
- WebSocket message broadcasting

---

## Security Considerations

1. **Input Validation**: All coordinates, object data validated
2. **Rate Limiting**: Prevent spam drawing updates
3. **Cognito Integration**: All operations require valid JWT
4. **Reserved Area Bounds**: Server-side validation only
5. **DynamoDB Access**: IAM roles with least privilege
6. **CORS**: Configured for CloudFront domain only

---

This architecture maintains the current real-time collaboration experience while adding persistence, multi-canvas support, and enterprise features. The migration path allows incremental adoption without breaking existing functionality.
