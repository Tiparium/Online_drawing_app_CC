// REST API Handler for Rooms
// Handles: GET /api/rooms, POST /api/rooms, DELETE /api/rooms/{roomId}, POST /api/rooms/{roomId}/archive

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const ROOMS_TABLE = process.env.ROOMS_TABLE || 'Rooms-production';
const STROKES_TABLE = process.env.STROKES_TABLE || 'CanvasObjects-production';

// Helper to format response with CORS
function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
        },
        body: JSON.stringify(body)
    };
}

async function clearRoomStrokes(roomId) {
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
        for (let i = 0; i < items.length; i += 25) {
            const batch = items.slice(i, i + 25);
            const req = batch.map(item => ({
                DeleteRequest: {
                    Key: { roomId, timestamp: item.timestamp }
                }
            }));
            if (req.length) {
                await ddb.send(new BatchWriteCommand({
                    RequestItems: { [STROKES_TABLE]: req }
                }));
            }
        }
    } while (lastEvaluatedKey);
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const method = event.httpMethod || event.requestContext?.http?.method;
    
    try {
        // Handle OPTIONS for CORS preflight
        if (method === 'OPTIONS') {
            return response(200, { message: 'OK' });
        }
        
        // GET /api/rooms - List all rooms
        if (method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: ROOMS_TABLE
            }));
            
            const rooms = (result.Items || []).sort((a, b) => 
                (b.createdAt || 0) - (a.createdAt || 0)
            );
            
            console.log(`Returning ${rooms.length} rooms`);
            
            return response(200, { rooms });
        }
        
        // POST /api/rooms - Create new room
        if (method === 'POST' && event.resource === '/api/rooms') {
            const body = JSON.parse(event.body || '{}');
            const { name, privacy, ownerId } = body;
            
            if (!name) {
                return response(400, { error: 'name is required' });
            }
            
            const room = {
                roomId: uuidv4(),
                name: name,
                privacy: privacy || 'public',
                createdAt: Date.now(),
                ownerId: ownerId || null,
                archived: false
            };
            
            await ddb.send(new PutCommand({
                TableName: ROOMS_TABLE,
                Item: room
            }));
            
            console.log('Created room:', room.roomId);
            
            return response(200, room);
        }

        // POST /api/rooms/{roomId}/archive
        if (method === 'POST' && event.resource && event.resource.endsWith('/archive')) {
            const roomId = event.pathParameters?.roomId;
            const body = JSON.parse(event.body || '{}');
            const archived = !!body.archived;
            if (!roomId) return response(400, { error: 'roomId is required' });
            await ddb.send(new UpdateCommand({
                TableName: ROOMS_TABLE,
                Key: { roomId },
                UpdateExpression: 'SET archived = :a',
                ExpressionAttributeValues: { ':a': archived }
            }));
            const updated = await ddb.send(new ScanCommand({
                TableName: ROOMS_TABLE,
                FilterExpression: 'roomId = :r',
                ExpressionAttributeValues: { ':r': roomId }
            }));
            const room = (updated.Items || [])[0] || { roomId, archived };
            return response(200, room);
        }

        // DELETE /api/rooms/{roomId}
        if (method === 'DELETE') {
            const roomId = event.pathParameters?.roomId;
            if (!roomId) return response(400, { error: 'roomId is required' });
            await clearRoomStrokes(roomId);
            await ddb.send(new DeleteCommand({
                TableName: ROOMS_TABLE,
                Key: { roomId }
            }));
            return response(200, { ok: true });
        }
        
        return response(405, { error: 'Method not allowed' });
        
    } catch (error) {
        console.error('Error:', error);
        return response(500, { 
            error: 'Internal server error',
            message: error.message 
        });
    }
};
