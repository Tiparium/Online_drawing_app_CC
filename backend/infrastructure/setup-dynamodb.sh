#!/bin/bash
# Create DynamoDB Tables for Drawing App
set -e

ENVIRONMENT="${ENVIRONMENT:-dev}"
REGION="${AWS_REGION:-us-east-1}"

echo "Creating DynamoDB Tables..."
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Table 1: Rooms
echo "Creating Rooms table..."
aws dynamodb create-table \
    --table-name "Rooms-${ENVIRONMENT}" \
    --attribute-definitions \
        AttributeName=roomId,AttributeType=S \
    --key-schema \
        AttributeName=roomId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    --tags Key=Environment,Value="$ENVIRONMENT" Key=Project,Value=DrawingApp \
    2>/dev/null || echo "Table already exists"

echo "✓ Rooms table created"

# Table 2: CanvasObjects
echo "Creating CanvasObjects table..."
aws dynamodb create-table \
    --table-name "CanvasObjects-${ENVIRONMENT}" \
    --attribute-definitions \
        AttributeName=roomId,AttributeType=S \
        AttributeName=objectId,AttributeType=S \
    --key-schema \
        AttributeName=roomId,KeyType=HASH \
        AttributeName=objectId,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    --tags Key=Environment,Value="$ENVIRONMENT" Key=Project,Value=DrawingApp \
    2>/dev/null || echo "Table already exists"

echo "✓ CanvasObjects table created"

# Table 3: Connections
echo "Creating Connections table..."
aws dynamodb create-table \
    --table-name "Connections-${ENVIRONMENT}" \
    --attribute-definitions \
        AttributeName=connectionId,AttributeType=S \
    --key-schema \
        AttributeName=connectionId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    --tags Key=Environment,Value="$ENVIRONMENT" Key=Project,Value=DrawingApp \
    2>/dev/null || echo "Table already exists"

echo "✓ Connections table created"
echo ""

# Table 4: DeploymentStats
echo "Creating DeploymentStats table..."
aws dynamodb create-table \
    --table-name "DeploymentStats-${ENVIRONMENT}" \
    --attribute-definitions \
        AttributeName=id,AttributeType=S \
    --key-schema \
        AttributeName=id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    --tags Key=Environment,Value="$ENVIRONMENT" Key=Project,Value=DrawingApp \
    2>/dev/null || echo "Table already exists"

echo "✓ DeploymentStats table created"
echo ""

echo "Waiting for tables to be active..."
aws dynamodb wait table-exists --table-name "Rooms-${ENVIRONMENT}" --region "$REGION"
aws dynamodb wait table-exists --table-name "CanvasObjects-${ENVIRONMENT}" --region "$REGION"
aws dynamodb wait table-exists --table-name "Connections-${ENVIRONMENT}" --region "$REGION"
aws dynamodb wait table-exists --table-name "DeploymentStats-${ENVIRONMENT}" --region "$REGION"

echo ""
echo "✓ All DynamoDB tables created and active!"
echo ""
echo "Tables:"
echo "  - Rooms-${ENVIRONMENT}"
echo "  - CanvasObjects-${ENVIRONMENT}"
echo "  - Connections-${ENVIRONMENT}"
echo "  - DeploymentStats-${ENVIRONMENT}"
echo ""
