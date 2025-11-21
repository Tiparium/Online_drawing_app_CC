// REST API Handler for Deploy Count
// Handles: GET /api/deploy-count

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const DEPLOY_TABLE = process.env.DEPLOY_TABLE || 'DeploymentStats-production';

// Helper to format response with CORS
function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,OPTIONS'
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
        
        // GET /api/deploy-count
        if (method === 'GET') {
            const result = await ddb.send(new GetCommand({
                TableName: DEPLOY_TABLE,
                Key: { id: 'deploy' }
            }));
            
            const deployCount = result.Item?.deployCount || 0;
            const count = typeof deployCount === 'object' && deployCount.N 
                ? Number(deployCount.N) 
                : Number(deployCount);
            
            console.log('Deploy count:', count);
            
            return response(200, { count: Number.isFinite(count) ? count : 0 });
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

