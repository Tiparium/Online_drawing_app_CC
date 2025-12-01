// WebSocket onMessage Handler
// Handles all incoming WebSocket messages and broadcasts to room

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, DeleteCommand, UpdateCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'Connections-production';
const CANVAS_OBJECTS_TABLE = process.env.CANVAS_OBJECTS_TABLE || 'CanvasObjects-production';
const MAX_BATCH = 25;
const TS_MULTIPLIER = 1000;

function makeTimestampKey() {
    return Date.now() * TS_MULTIPLIER + Math.floor(Math.random() * TS_MULTIPLIER);
}

function makeUserSeqKey(userId, seq) {
    const padded = String(seq ?? 0).padStart(20, '0');
    return `${userId || 'unknown'}#${padded}`;
}

// Broadcast message to all connections in a room except sender
async function broadcastToRoom(roomId, message, excludeConnectionId, apiGateway) {
    // Get all connections in this room
    const connections = await ddb.send(new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        FilterExpression: 'roomId = :roomId',
        ExpressionAttributeValues: {
            ':roomId': roomId
        }
    }));
    
    const postCalls = (connections.Items || []).map(async (connection) => {
        if (connection.connectionId === excludeConnectionId) {
            return; // Don't send back to sender
        }
        
        try {
            await apiGateway.send(new PostToConnectionCommand({
                ConnectionId: connection.connectionId,
                Data: typeof message === 'string' ? message : JSON.stringify(message)
            }));
        } catch (error) {
            console.error(`Failed to send to ${connection.connectionId}:`, error);
            
            // If connection is stale (410 Gone), remove it
            if (error.statusCode === 410) {
                console.log(`Removing stale connection: ${connection.connectionId}`);
                await ddb.send(new DeleteCommand({
                    TableName: CONNECTIONS_TABLE,
                    Key: { connectionId: connection.connectionId }
                }));
            }
        }
    });
    
    await Promise.all(postCalls);
}

// Broadcast to all connections (no room filter)
async function broadcastAll(message, excludeConnectionId, apiGateway) {
    const connections = await ddb.send(new ScanCommand({
        TableName: CONNECTIONS_TABLE
    }));
    
    const postCalls = (connections.Items || []).map(async (connection) => {
        if (connection.connectionId === excludeConnectionId) return;
        try {
            await apiGateway.send(new PostToConnectionCommand({
                ConnectionId: connection.connectionId,
                Data: typeof message === 'string' ? message : JSON.stringify(message)
            }));
        } catch (error) {
            console.error(`Failed to send to ${connection.connectionId}:`, error);
            if (error.statusCode === 410) {
                await ddb.send(new DeleteCommand({
                    TableName: CONNECTIONS_TABLE,
                    Key: { connectionId: connection.connectionId }
                }));
            }
        }
    });
    
    await Promise.all(postCalls);
}

async function clearRoomStrokes(roomId) {
    let lastEvaluatedKey;
    let deleted = 0;

    do {
        const query = await ddb.send(new QueryCommand({
            TableName: CANVAS_OBJECTS_TABLE,
            KeyConditionExpression: 'roomId = :roomId',
            ExpressionAttributeValues: {
                ':roomId': roomId
            },
            ExclusiveStartKey: lastEvaluatedKey
        }));

        const items = query.Items || [];
        lastEvaluatedKey = query.LastEvaluatedKey;

        for (let i = 0; i < items.length; i += MAX_BATCH) {
            const batch = items.slice(i, i + MAX_BATCH);
            const requests = batch.map(item => ({
                DeleteRequest: {
                    Key: {
                        roomId,
                        objectId: item.objectId
                    }
                }
            }));
            if (requests.length > 0) {
                await ddb.send(new BatchWriteCommand({
                    RequestItems: {
                        [CANVAS_OBJECTS_TABLE]: requests
                    }
                }));
                deleted += requests.length;
            }
        }
    } while (lastEvaluatedKey);

    console.log(`Cleared ${deleted} strokes for room ${roomId}`);
    return deleted;
}

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || '{}');
    
    console.log('Message from:', connectionId, 'Type:', body.type);
    
    const apiGateway = new ApiGatewayManagementApiClient({
        endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
    });
    
    try {
        // Get sender's connection info to find their room
                const connection = await ddb.send(new GetCommand({
                    TableName: CONNECTIONS_TABLE,
                    Key: { connectionId: connectionId }
                }));
        
        if (!connection.Item) {
            console.warn('Connection not found:', connectionId);
            return { statusCode: 404, body: 'Connection not found' };
        }
        
        const roomId = body.roomId || connection.Item.roomId || 'default';
        const incomingName = body.name;
        
        // Handle different message types
        switch (body.type) {
            case 'joinRoom': {
                // Update connection's room
                await ddb.send(new UpdateCommand({
                    TableName: CONNECTIONS_TABLE,
                    Key: { connectionId: connectionId },
                    UpdateExpression: 'SET roomId = :roomId, userData = :ud',
                    ExpressionAttributeValues: {
                        ':roomId': body.roomId,
                        ':ud': {
                            name: incomingName || connection.Item.userData?.name || '',
                            color: connection.Item.userData?.color || '#000000',
                            brushSize: connection.Item.userData?.brushSize || 5,
                            smoothing: connection.Item.userData?.smoothing || 0,
                            mode: connection.Item.userData?.mode || 'draw'
                        }
                    }
                }));
                
                // Load canvas objects for this room
                const canvasData = await ddb.send(new QueryCommand({
                    TableName: CANVAS_OBJECTS_TABLE,
                    KeyConditionExpression: 'roomId = :roomId',
                    ExpressionAttributeValues: {
                        ':roomId': body.roomId
                    },
                    Limit: 1000
                }));
                
                // Get existing users in this room
                const roomConnections = await ddb.send(new ScanCommand({
                    TableName: CONNECTIONS_TABLE,
                    FilterExpression: 'roomId = :roomId',
                    ExpressionAttributeValues: {
                        ':roomId': body.roomId
                    }
                }));
                
                const existingUsers = (roomConnections.Items || [])
                    .filter(conn => conn.connectionId !== connectionId)
                    .map(conn => ({
                        userId: conn.connectionId,
                        userData: {
                            id: conn.connectionId,
                            cursor: { x: 0, y: 0 },
                            color: conn.userData?.color || '#000000',
                            brushSize: conn.userData?.brushSize || 5,
                            smoothing: conn.userData?.smoothing || 0,
                            mode: conn.userData?.mode || 'draw',
                            name: conn.userData?.name || ''
                        },
                        roomId: body.roomId
                    }));
                
                // Send user connected message (now that connection is established)
                await apiGateway.send(new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: 'userConnected',
                        userId: connectionId,
                        userData: {
                            id: connectionId,
                            cursor: { x: 0, y: 0 },
                            color: connection.Item?.userData?.color || '#000000',
                            brushSize: connection.Item?.userData?.brushSize || 5,
                            smoothing: connection.Item?.userData?.smoothing || 0,
                            mode: connection.Item?.userData?.mode || 'draw',
                            name: connection.Item?.userData?.name || incomingName || ''
                        }
                    })
                }));
                
                // Send canvas state
                await apiGateway.send(new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: 'canvasState',
                        roomId: body.roomId,
                        objects: (canvasData.Items || []).map(item => ({
                            path: item.path,
                            strokeColor: item.strokeColor,
                            strokeWidth: item.strokeWidth,
                            smoothing: item.smoothing || 0,
                            userId: item.userId || 'unknown'
                        }))
                    })
                }));
                
                // Send room joined confirmation
                await apiGateway.send(new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: 'roomJoined',
                        roomId: body.roomId
                    })
                }));
                
                // Send existing users
                await apiGateway.send(new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: 'existingUsersInRoom',
                        roomId: body.roomId,
                        users: existingUsers
                    })
                }));
                
                // Notify others that user joined
                await broadcastToRoom(body.roomId, {
                    type: 'userJoined',
                    userId: connectionId,
                    userData: {
                        id: connectionId,
                        cursor: { x: 0, y: 0 },
                        color: connection.Item?.userData?.color || '#000000',
                        brushSize: connection.Item?.userData?.brushSize || 5,
                        smoothing: connection.Item?.userData?.smoothing || 0,
                        mode: connection.Item?.userData?.mode || 'draw',
                        name: connection.Item?.userData?.name || incomingName || ''
                    },
                    roomId: body.roomId
                }, connectionId, apiGateway);
                
                break;
            }
            
            case 'cursorMove': {
                // Just broadcast cursor position, no persistence needed
                await broadcastToRoom(roomId, {
                    type: 'cursorMove',
                    userId: connectionId,
                    cursor: body.cursor,
                    roomId: roomId
                }, connectionId, apiGateway);
                break;
            }

            case 'roomCreated': {
                await broadcastAll({
                    type: 'roomCreated',
                    room: body.room
                }, connectionId, apiGateway);
                break;
            }

            case 'roomDeleted': {
                await broadcastAll({
                    type: 'roomDeleted',
                    roomId: body.roomId
                }, connectionId, apiGateway);
                break;
            }

            case 'roomArchived': {
                await broadcastAll({
                    type: 'roomArchived',
                    roomId: body.roomId,
                    room: body.room
                }, connectionId, apiGateway);
                break;
            }
            
            case 'drawingUpdate': {
                // Save to DynamoDB if adding or updating
                if (body.action !== 'remove' && roomId) {
                    const timestampKey = makeTimestampKey();
                    const seq = Number.isFinite(body.seq) ? Number(body.seq) : 0;
                    
                    await ddb.send(new PutCommand({
                        TableName: CANVAS_OBJECTS_TABLE,
                        Item: {
                            roomId: roomId,
                            timestamp: timestampKey,
                            objectId: body.objectId || `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            path: body.path,
                            strokeColor: body.strokeColor || '#000000',
                            strokeWidth: body.strokeWidth || 5,
                            smoothing: body.smoothing || 0,
                            userId: connectionId,
                            shapeType: body.shapeType,
                            objectData: body.objectData,
                            seq: seq,
                            userSeqKey: makeUserSeqKey(connectionId, seq),
                            timestamp: timestampKey
                        }
                    }));
                    
                    console.log('Saved drawing to DynamoDB with timestamp:', timestampKey, 'seq:', seq);
                }
                
                // Broadcast to all users in room
                await broadcastToRoom(roomId, {
                    type: 'drawingUpdate',
                    userId: connectionId,
                    path: body.path,
                    action: body.action,
                    strokeColor: body.strokeColor,
                    strokeWidth: body.strokeWidth,
                    smoothing: body.smoothing,
                    shapeType: body.shapeType,
                    objectData: body.objectData,
                    roomId: roomId,
                    seq: body.seq
                }, connectionId, apiGateway);
                
                break;
            }
            
            case 'userSettings': {
                // Broadcast user settings changes (color, brush size, etc.)
                await broadcastToRoom(roomId, {
                    type: 'userSettings',
                    userId: connectionId,
                    userData: {
                        color: body.color,
                        brushSize: body.brushSize,
                        smoothing: body.smoothing,
                        mode: body.mode,
                        name: body.name
                    },
                    roomId: roomId
                }, connectionId, apiGateway);
                break;
            }

            case 'clearCanvas': {
                await clearRoomStrokes(roomId);
                await broadcastToRoom(roomId, {
                    type: 'canvasCleared',
                    roomId: roomId,
                    triggeredBy: connectionId
                }, connectionId, apiGateway);
                break;
            }
            
            default:
                console.warn('Unknown message type:', body.type);
        }
        
        return {
            statusCode: 200,
            body: 'Message processed'
        };
        
    } catch (error) {
        console.error('Error processing message:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to process message', error: error.message })
        };
    }
};
