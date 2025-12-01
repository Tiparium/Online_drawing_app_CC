#!/bin/bash
# AWS Lambda Serverless Deployment Script
# Deploys drawing app backend using AWS SAM

set -e

ENVIRONMENT="${ENVIRONMENT:-production}"
VERBOSE=false
RESET_TABLES=false
REGION="${AWS_REGION:-us-east-1}"

for arg in "$@"; do
    case "$arg" in
        -v|--verbose) VERBOSE=true ;;
        -reset|--reset) RESET_TABLES=true ;;
        -h|--help)
            echo "Usage: $0 [-v] [--reset]"
            echo "  -v, --verbose   Print additional details (table checks, CLI output)"
            echo "  --reset         Drop and recreate Rooms/CanvasObjects tables for this env (destructive)"
            exit 0
            ;;
    esac
done

STACK_NAME="drawing-app-${ENVIRONMENT}"
REGION="${AWS_REGION:-us-east-1}"

echo "=========================================="
echo "Deploying Serverless Backend"
echo "=========================================="
echo "Stack: $STACK_NAME"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Install with: pip install awscli"
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo "❌ AWS SAM CLI not found."
    echo "Install with: pip install aws-sam-cli"
    echo "Or: brew install aws-sam-cli (macOS)"
    exit 1
fi

# Check if DynamoDB tables exist
if $VERBOSE; then
    echo "Checking DynamoDB tables..."
fi
TABLES=("Rooms-${ENVIRONMENT}" "CanvasObjects-${ENVIRONMENT}" "Connections-${ENVIRONMENT}" "DeploymentStats-${ENVIRONMENT}")

if $RESET_TABLES; then
    echo "Resetting Rooms/CanvasObjects tables for ${ENVIRONMENT}..."
    for t in "Rooms-${ENVIRONMENT}" "CanvasObjects-${ENVIRONMENT}"; do
        aws dynamodb delete-table --table-name "$t" --region "$REGION" >/dev/null 2>&1 || true
        aws dynamodb wait table-not-exists --table-name "$t" --region "$REGION" >/dev/null 2>&1 || true
    done
fi

for table in "${TABLES[@]}"; do
    if aws dynamodb describe-table --table-name "$table" --region "$REGION" &>/dev/null; then
        $VERBOSE && echo "✓ Table exists: $table"
    else
        echo "❌ Table not found: $table"
        echo "Run: cd backend/infrastructure && ENVIRONMENT=$ENVIRONMENT ./setup-dynamodb.sh"
        exit 1
    fi
done

if $VERBOSE; then
    echo ""
fi

# Navigate to Lambda directory
cd backend/lambda

# Install dependencies
echo "Installing Lambda dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Build SAM application
echo "Building SAM application..."
sam build --template-file template.yaml
echo "✓ Build complete"
echo ""

# Deploy SAM application
echo "Deploying to AWS..."
echo "This will take 2-5 minutes..."
echo ""

sam deploy \
    --template-file .aws-sam/build/template.yaml \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --parameter-overrides Environment="$ENVIRONMENT" \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --resolve-s3

echo ""
echo "=========================================="
echo "✓ Deployment complete!"
echo "=========================================="
echo ""

# Get stack outputs
echo "Retrieving API endpoints..."
WEBSOCKET_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='WebSocketApiUrl'].OutputValue" \
    --output text)

REST_API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue" \
    --output text)

if [ -n "$WEBSOCKET_URL" ] && [ -n "$REST_API_URL" ]; then
    echo "Backend URLs:"
    echo "  WebSocket: $WEBSOCKET_URL"
    echo "  REST API:  $REST_API_URL"
    echo ""
    echo "API Endpoints:"
    echo "  GET  ${REST_API_URL}/api/rooms"
    echo "  POST ${REST_API_URL}/api/rooms"
    echo "  GET  ${REST_API_URL}/api/rooms/{roomId}/strokes"
    echo "  POST ${REST_API_URL}/api/rooms/{roomId}/strokes"
    echo "  GET  ${REST_API_URL}/api/deploy-count"
    echo ""
    echo "=========================================="
    echo "Next Steps:"
    echo "=========================================="
    echo ""
    echo "1. Test the backend:"
    echo "   curl ${REST_API_URL}/api/rooms"
    echo ""
    echo "2. Deploy frontend to S3:"
    echo "   cd ../.."
    echo "   export API_BASE=\"${REST_API_URL}\""
    echo "   export WS_BASE=\"${WEBSOCKET_URL}\""
    echo "   ./deploy.sh"
    echo ""
    echo "3. (Optional) Setup CloudFront for HTTPS:"
    echo "   ./setup_cloudfront.sh"
    echo ""
    echo "Save these URLs for your frontend deployment!"
    echo ""
else
    echo "Could not retrieve API endpoints. Check stack outputs with:"
    echo "  aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION"
fi

cd ../..
