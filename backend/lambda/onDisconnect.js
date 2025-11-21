// WebSocket onDisconnect Handler
// Cleanup when user disconnects and notify others

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'Connections-production';

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    
    console.log('Disconnecting:', connectionId);
    
    try {
        // Get connection info before deleting (to know which room)
        const connection = await ddb.send(new GetCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId: connectionId }
        }));
        
        const roomId = connection.Item?.roomId;
        
        // Delete connection from database
        await ddb.send(new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId: connectionId }
        }));
        
        console.log('Connection deleted:', connectionId);
        
        // Notify other users in the same room
        if (roomId) {
            const apiGateway = new ApiGatewayManagementApiClient({
                endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
            });
            
            // Get remaining connections in room
            const roomConnections = await ddb.send(new ScanCommand({
                TableName: CONNECTIONS_TABLE,
                FilterExpression: 'roomId = :roomId',
                ExpressionAttributeValues: {
                    ':roomId': roomId
                }
            }));
            
            // Notify each remaining user
            const notifications = (roomConnections.Items || []).map(async (conn) => {
                try {
                    await apiGateway.send(new PostToConnectionCommand({
                        ConnectionId: conn.connectionId,
                        Data: JSON.stringify({
                            type: 'userLeft',
                            userId: connectionId,
                            roomId: roomId
                        })
                    }));
                } catch (error) {
                    console.error(`Failed to notify ${conn.connectionId}:`, error);
                    
                    // If connection is stale, remove it
                    if (error.statusCode === 410) {
                        await ddb.send(new DeleteCommand({
                            TableName: CONNECTIONS_TABLE,
                            Key: { connectionId: conn.connectionId }
                        }));
                    }
                }
            });
            
            await Promise.all(notifications);
        }
        
        return {
            statusCode: 200,
            body: 'Disconnected'
        };
        
    } catch (error) {
        console.error('Error in onDisconnect:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to disconnect', error: error.message })
        };
    }
};
