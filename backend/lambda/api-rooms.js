// REST API Handler for Rooms
// Handles: GET /api/rooms, POST /api/rooms

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const ROOMS_TABLE = process.env.ROOMS_TABLE || 'Rooms-production';

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
        if (method === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const { name, privacy } = body;
            
            if (!name) {
                return response(400, { error: 'name is required' });
            }
            
            const room = {
                roomId: uuidv4(),
                name: name,
                privacy: privacy || 'public',
                createdAt: Date.now()
            };
            
            await ddb.send(new PutCommand({
                TableName: ROOMS_TABLE,
                Item: room
            }));
            
            console.log('Created room:', room.roomId);
            
            return response(200, room);
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

