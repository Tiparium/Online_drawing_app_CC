// WebSocket onConnect Handler
// Triggered when user connects to WebSocket API

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'Connections-production';
const CANVAS_OBJECTS_TABLE = process.env.CANVAS_OBJECTS_TABLE || 'CanvasObjects-production';

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const roomId = event.queryStringParameters?.roomId || 'default';
    
    console.log('Connection:', connectionId, 'Room:', roomId);
    
    try {
        // Store connection info
        await ddb.send(new PutCommand({
            TableName: CONNECTIONS_TABLE,
            Item: {
                connectionId: connectionId,
                roomId: roomId,
                connectedAt: Date.now(),
                ttl: Math.floor(Date.now() / 1000) + 7200  // 2 hour TTL
            }
        }));
        
        console.log('Connection stored:', connectionId);
        
        // Load existing canvas objects for this room
        const canvasData = await ddb.send(new QueryCommand({
            TableName: CANVAS_OBJECTS_TABLE,
            KeyConditionExpression: 'roomId = :roomId',
            ExpressionAttributeValues: {
                ':roomId': roomId
            },
            Limit: 1000  // Load up to 1000 strokes
        }));
        
        console.log(`Loaded ${canvasData.Items?.length || 0} objects for room ${roomId}`);
        console.log('Connection accepted. Client will request initial state via message.');
        
        return {
            statusCode: 200,
            body: 'Connected'
        };
    } catch (error) {
        console.error('Error in onConnect:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to connect', error: error.message })
        };
    }
};
