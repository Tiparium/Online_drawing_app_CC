// REST API Handler for Strokes
// Handles: GET /api/rooms/{roomId}/strokes, POST /api/rooms/{roomId}/strokes

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STROKES_TABLE = process.env.STROKES_TABLE || 'CanvasObjects-production';

// Helper to format response with CORS
function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
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
            const { path, strokeColor, strokeWidth, smoothing, userId } = body;
            
            if (!path) {
                return response(400, { error: 'path is required' });
            }
            
            const item = {
                roomId: roomId,
                objectId: uuidv4(),
                path: path,
                strokeColor: strokeColor || '#000000',
                strokeWidth: strokeWidth || 5,
                smoothing: smoothing || 0,
                userId: userId || 'unknown',
                timestamp: Date.now()
            };
            
            await ddb.send(new PutCommand({
                TableName: STROKES_TABLE,
                Item: item
            }));
            
            console.log('Saved stroke:', item.objectId);
            
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

