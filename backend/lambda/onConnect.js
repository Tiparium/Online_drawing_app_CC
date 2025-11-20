// WebSocket onConnect Handler
// Triggered when user connects to WebSocket

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'Connections-dev';
const CANVAS_OBJECTS_TABLE = process.env.CANVAS_OBJECTS_TABLE || 'CanvasObjects-dev';

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const roomId = event.queryStringParameters?.roomId || 'default';
    
    console.log('Connection:', connectionId, 'Room:', roomId);
    
    try {
        // Store connection info
        await dynamodb.put({
            TableName: CONNECTIONS_TABLE,
            Item: {
                connectionId: connectionId,
                roomId: roomId,
                connectedAt: Date.now(),
                ttl: Math.floor(Date.now() / 1000) + 7200  // 2 hour TTL
            }
        }).promise();
        
        // Load existing canvas objects for this room
        const canvasData = await dynamodb.query({
            TableName: CANVAS_OBJECTS_TABLE,
            KeyConditionExpression: 'roomId = :roomId',
            ExpressionAttributeValues: {
                ':roomId': roomId
            }
        }).promise();
        
        // Send canvas state to newly connected user
        const apiGateway = new AWS.ApiGatewayManagementApi({
            endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
        });
        
        await apiGateway.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
                type: 'canvasState',
                roomId: roomId,
                objects: canvasData.Items.map(item => item.objectData)
            })
        }).promise();
        
        return {
            statusCode: 200,
            body: 'Connected'
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: 'Failed to connect'
        };
    }
};

