// WebSocket onMessage Handler
// Handles drawing updates and broadcasts to room

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'Connections-dev';
const CANVAS_OBJECTS_TABLE = process.env.CANVAS_OBJECTS_TABLE || 'CanvasObjects-dev';

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body);
    
    console.log('Message from:', connectionId, 'Type:', body.type);
    
    try {
        // Get sender's room
        const connection = await dynamodb.get({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId: connectionId }
        }).promise();
        
        const roomId = connection.Item?.roomId || 'default';
        
        // Handle different message types
        if (body.type === 'drawingUpdate') {
            // Save drawing to DynamoDB
            await dynamodb.put({
                TableName: CANVAS_OBJECTS_TABLE,
                Item: {
                    roomId: roomId,
                    objectId: body.objectId || `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    objectData: body.objectData || body,
                    createdAt: Date.now()
                }
            }).promise();
        }
        
        // Broadcast to all connections in same room
        const roomConnections = await dynamodb.scan({
            TableName: CONNECTIONS_TABLE,
            FilterExpression: 'roomId = :roomId',
            ExpressionAttributeValues: {
                ':roomId': roomId
            }
        }).promise();
        
        const apiGateway = new AWS.ApiGatewayManagementApi({
            endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
        });
        
        const broadcasts = roomConnections.Items.map(async (item) => {
            if (item.connectionId !== connectionId) {  // Don't send back to sender
                try {
                    await apiGateway.postToConnection({
                        ConnectionId: item.connectionId,
                        Data: JSON.stringify(body)
                    }).promise();
                } catch (error) {
                    // Connection is stale, delete it
                    if (error.statusCode === 410) {
                        await dynamodb.delete({
                            TableName: CONNECTIONS_TABLE,
                            Key: { connectionId: item.connectionId }
                        }).promise();
                    }
                }
            }
        });
        
        await Promise.all(broadcasts);
        
        return {
            statusCode: 200,
            body: 'Message sent'
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: 'Failed to send message'
        };
    }
};

