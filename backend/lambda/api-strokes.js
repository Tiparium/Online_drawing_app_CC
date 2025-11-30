// REST API Handler for Strokes
// Handles: GET /api/rooms/{roomId}/strokes, POST /api/rooms/{roomId}/strokes

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STROKES_TABLE = process.env.STROKES_TABLE || 'CanvasObjects-production';
const TS_MULTIPLIER = 1000;

function makeTimestampKey() {
    return Date.now() * TS_MULTIPLIER + Math.floor(Math.random() * TS_MULTIPLIER);
}

function makeUserSeqKey(userId, seq) {
    const padded = String(seq ?? 0).padStart(20, '0');
    return `${userId || 'unknown'}#${padded}`;
}

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

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const method = event.httpMethod || event.requestContext?.http?.method;
    const roomId = event.pathParameters?.roomId;
    
    try {
        // Handle OPTIONS for CORS preflight
        if (method === 'OPTIONS') {
            return response(200, { message: 'OK' });
        }
        
        if (!roomId) {
            return response(400, { error: 'roomId is required' });
        }
        
        // GET /api/rooms/{roomId}/strokes - Get all strokes for room
        if (method === 'GET') {
            const queryParams = event.queryStringParameters || {};
            const filterUserId = queryParams.userId;
            const sinceSeq = Number(queryParams.sinceSeq);

            // Per-user delta path (uses GSI on roomId + userSeqKey)
            if (filterUserId && Number.isFinite(sinceSeq)) {
                const startKey = makeUserSeqKey(filterUserId, sinceSeq + 1);
                const gsiResult = await ddb.send(new QueryCommand({
                    TableName: STROKES_TABLE,
                    IndexName: 'StrokesByUserSeq',
                    KeyConditionExpression: 'roomId = :roomId AND userSeqKey >= :start',
                    ExpressionAttributeValues: {
                        ':roomId': roomId,
                        ':start': startKey
                    },
                    Limit: 500
                }));

                const strokes = (gsiResult.Items || []).map(item => ({
                    path: item.path,
                    strokeColor: item.strokeColor || '#000000',
                    strokeWidth: item.strokeWidth || 5,
                    smoothing: item.smoothing || 0,
                    userId: item.userId || 'unknown',
                    timestamp: item.timestamp,
                    seq: item.seq || 0
                }));

                return response(200, { strokes });
            }

            const result = await ddb.send(new QueryCommand({
                TableName: STROKES_TABLE,
                KeyConditionExpression: 'roomId = :roomId',
                ExpressionAttributeValues: {
                    ':roomId': roomId
                },
                ScanIndexForward: true,  // Sort by sort key ascending
                Limit: 1000  // Limit to prevent timeout
            }));
            
            const strokes = (result.Items || []).map(item => ({
                path: item.path,
                strokeColor: item.strokeColor || '#000000',
                strokeWidth: item.strokeWidth || 5,
                smoothing: item.smoothing || 0,
                userId: item.userId || 'unknown',
                timestamp: item.timestamp
            }));
            
            console.log(`Returning ${strokes.length} strokes for room ${roomId}`);
            
            return response(200, { strokes });
        }
        
        // POST /api/rooms/{roomId}/strokes - Save new stroke
        if (method === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const { path, strokeColor, strokeWidth, smoothing, userId, seq } = body;
            
            if (!path) {
                return response(400, { error: 'path is required' });
            }
            
            const tsKey = makeTimestampKey();
            const item = {
                roomId: roomId,
                timestamp: tsKey,
                objectId: uuidv4(), // non-key identifier retained for debugging
                path: path,
                strokeColor: strokeColor || '#000000',
                strokeWidth: strokeWidth || 5,
                smoothing: smoothing || 0,
                userId: userId || 'unknown',
                seq: Number.isFinite(seq) ? Number(seq) : 0,
                userSeqKey: makeUserSeqKey(userId, Number.isFinite(seq) ? Number(seq) : 0)
            };
            
            await ddb.send(new PutCommand({
                TableName: STROKES_TABLE,
                Item: item
            }));
            
            console.log('Saved stroke:', item.objectId);
            
            return response(200, { ok: true });
        }

        // DELETE /api/rooms/{roomId}/strokes - Clear all strokes for room
        if (method === 'DELETE') {
            let lastEvaluatedKey;
            let deleted = 0;

            do {
                const query = await ddb.send(new QueryCommand({
                    TableName: STROKES_TABLE,
                    KeyConditionExpression: 'roomId = :roomId',
                    ExpressionAttributeValues: {
                        ':roomId': roomId
                    },
                    ExclusiveStartKey: lastEvaluatedKey
                }));

                const items = query.Items || [];
                lastEvaluatedKey = query.LastEvaluatedKey;

                for (let i = 0; i < items.length; i += 25) {
                    const batch = items.slice(i, i + 25);
                    const requests = batch.map(item => ({
                        DeleteRequest: {
                            Key: {
                                roomId,
                                timestamp: item.timestamp
                            }
                        }
                    }));
                    if (requests.length > 0) {
                        await ddb.send(new BatchWriteCommand({
                            RequestItems: {
                                [STROKES_TABLE]: requests
                            }
                        }));
                        deleted += requests.length;
                    }
                }
            } while (lastEvaluatedKey);

            console.log(`Deleted ${deleted} strokes for room ${roomId}`);
            return response(200, { ok: true, deleted });
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
