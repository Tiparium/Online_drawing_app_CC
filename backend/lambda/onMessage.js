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
        
        // Handle different message types
        switch (body.type) {
            case 'joinRoom': {
                // Update connection's room
                await ddb.send(new UpdateCommand({
                    TableName: CONNECTIONS_TABLE,
                    Key: { connectionId: connectionId },
                    UpdateExpression: 'SET roomId = :roomId',
                    ExpressionAttributeValues: {
                        ':roomId': body.roomId
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
                            color: '#000000',
                            brushSize: 5,
                            smoothing: 0,
                            mode: 'draw'
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
                            color: '#000000',
                            brushSize: 5,
                            smoothing: 0,
                            mode: 'draw'
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
                        color: '#000000',
                        brushSize: 5,
                        smoothing: 0,
                        mode: 'draw'
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
            
            case 'drawingUpdate': {
                // Save to DynamoDB if adding new stroke
                if (body.action === 'add' && roomId) {
                    const objectId = body.objectId || `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    
                    await ddb.send(new PutCommand({
                        TableName: CANVAS_OBJECTS_TABLE,
                        Item: {
                            roomId: roomId,
                            objectId: objectId,
                            path: body.path,
                            strokeColor: body.strokeColor || '#000000',
                            strokeWidth: body.strokeWidth || 5,
                            smoothing: body.smoothing || 0,
                            userId: connectionId,
                            timestamp: Date.now()
                        }
                    }));
                    
                    console.log('Saved drawing to DynamoDB:', objectId);
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
                    roomId: roomId
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
                        mode: body.mode
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
