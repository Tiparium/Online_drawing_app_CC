#!/bin/bash
# CloudWatch Monitoring Setup
# Sets up dashboards and alarms for the drawing app

set -e

BUCKET_NAME="${BUCKET_NAME:-drawing-app-frontend}"
REGION="${AWS_REGION:-us-east-1}"
DASHBOARD_NAME="DrawingApp-Monitoring"

echo "========================================
Setting Up CloudWatch Monitoring
========================================"
echo ""

# Step 1: Create CloudWatch Dashboard
echo "Step 1: Creating CloudWatch Dashboard..."

cat > /tmp/dashboard-body.json <<'EOF'
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/S3", "NumberOfObjects", { "stat": "Average" } ],
          [ ".", "BucketSizeBytes", { "stat": "Average" } ]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "S3 Storage Metrics",
        "yAxis": {
          "left": {
            "showUnits": true
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/S3", "AllRequests", { "stat": "Sum" } ],
          [ ".", "GetRequests", { "stat": "Sum" } ],
          [ ".", "PutRequests", { "stat": "Sum" } ]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "S3 Request Metrics"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/S3", "4xxErrors", { "stat": "Sum", "color": "#ff7f0e" } ],
          [ ".", "5xxErrors", { "stat": "Sum", "color": "#d62728" } ]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "S3 Error Metrics"
      }
    },
    {
      "type": "text",
      "properties": {
        "markdown": "# Drawing App Monitoring\n\n## Current Services\n- S3 Frontend (drawing-app-frontend)\n\n## Future Services (When Added)\n- API Gateway WebSocket\n- Lambda Functions\n- DynamoDB Tables\n- Cognito User Pool"
      }
    }
  ]
}
EOF

aws cloudwatch put-dashboard \
    --dashboard-name "$DASHBOARD_NAME" \
    --dashboard-body file:///tmp/dashboard-body.json

rm /tmp/dashboard-body.json

echo "✓ Dashboard created: $DASHBOARD_NAME"
echo ""

# Step 2: Create Billing Alarm
echo "Step 2: Creating billing alarm..."

# Create SNS topic for alerts
SNS_TOPIC_ARN=$(aws sns create-topic \
    --name DrawingAppBillingAlerts \
    --region us-east-1 \
    --query 'TopicArn' \
    --output text 2>/dev/null || \
    aws sns list-topics --query "Topics[?contains(TopicArn, 'DrawingAppBillingAlerts')].TopicArn" --output text)

echo "✓ SNS Topic: $SNS_TOPIC_ARN"

# Email alerts skipped - can be added later if needed
echo "(Email alerts skipped - alarms still active)"
echo ""

# Create billing alarm (Note: Billing metrics only in us-east-1)
aws cloudwatch put-metric-alarm \
    --alarm-name DrawingAppBillingAlarm \
    --alarm-description "Alert when AWS charges exceed $5" \
    --metric-name EstimatedCharges \
    --namespace AWS/Billing \
    --statistic Maximum \
    --period 21600 \
    --evaluation-periods 1 \
    --threshold 5.0 \
    --comparison-operator GreaterThanThreshold \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --dimensions Name=Currency,Value=USD \
    --region us-east-1

echo "✓ Billing alarm created (threshold: $5)"
echo ""

# Step 3: Create S3 metrics alarm
echo "Step 3: Creating S3 error alarm..."

aws cloudwatch put-metric-alarm \
    --alarm-name DrawingAppS3Errors \
    --alarm-description "Alert on S3 errors" \
    --metric-name 4xxErrors \
    --namespace AWS/S3 \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 100 \
    --comparison-operator GreaterThanThreshold \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --dimensions Name=BucketName,Value="$BUCKET_NAME" \
    --region "$REGION"

echo "✓ S3 error alarm created"
echo ""

echo "========================================
Monitoring Setup Complete!
========================================"
echo ""
echo "CloudWatch Dashboard: https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=$DASHBOARD_NAME"
echo ""
echo "What's Monitoring:"
echo "  ✓ S3 storage and request metrics"
echo "  ✓ S3 error rates"
echo "  ✓ AWS billing (alerts at $5)"
echo ""
echo "To Add Later (when services are deployed):"
echo "  - API Gateway metrics"
echo "  - Lambda function metrics"
echo "  - DynamoDB metrics"
echo "  - Cognito metrics"
echo ""

