// WebSocket onDisconnect Handler
// Cleanup when user disconnects

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'Connections-dev';

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    
    console.log('Disconnecting:', connectionId);
    
    try {
        // Remove connection from database
        await dynamodb.delete({
            TableName: CONNECTIONS_TABLE,
            Key: {
                connectionId: connectionId
            }
        }).promise();
        
        return {
            statusCode: 200,
            body: 'Disconnected'
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: 'Failed to disconnect'
        };
    }
};

