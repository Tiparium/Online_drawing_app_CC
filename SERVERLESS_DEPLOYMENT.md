# Complete Serverless Deployment Guide

Deploy the Drawing App with **AWS Lambda + API Gateway + S3 + DynamoDB**

## 🏗️ Architecture

```
┌──────────────────────────────────────┐
│  Browser (Users)                     │
└──────────────────────────────────────┘
              ↕️
┌──────────────────────────────────────┐
│  CloudFront (CDN) - HTTPS            │
│  https://d1234.cloudfront.net        │
└──────────────────────────────────────┘
              ↕️
┌──────────────────────────────────────┐
│  S3 Bucket (Static Files)            │
│  - index.html                        │
│  - app.js                            │
│  - styles.css                        │
│  - config.js (generated)             │
└──────────────────────────────────────┘
              ↕️
┌──────────────────────────────────────┐
│  API Gateway                         │
│  - WebSocket API (real-time)         │
│  - REST API (CRUD)                   │
└──────────────────────────────────────┘
              ↕️
┌──────────────────────────────────────┐
│  AWS Lambda Functions                │
│  - onConnect.js                      │
│  - onMessage.js                      │
│  - onDisconnect.js                   │
│  - api-rooms.js                      │
│  - api-strokes.js                    │
│  - api-deploy-count.js               │
└──────────────────────────────────────┘
              ↕️
┌──────────────────────────────────────┐
│  DynamoDB Tables                     │
│  - Rooms                             │
│  - CanvasObjects                     │
│  - Connections                       │
│  - DeploymentStats                   │
└──────────────────────────────────────┘
```

---

## 📋 Prerequisites

### 1. AWS Account
Sign up at https://aws.amazon.com

### 2. Install Required Tools

**AWS CLI:**
```bash
pip install awscli
aws configure
```

**AWS SAM CLI:**
```bash
# macOS
brew install aws-sam-cli

# Linux/Windows
pip install aws-sam-cli
```

**Node.js:**
```bash
# Already have Node.js 14+ installed for local dev
node --version
```

---

## 🚀 3-Step Deployment

### **Step 1: Create DynamoDB Tables** (1 minute)

```bash
cd backend/infrastructure
ENVIRONMENT=production ./setup-dynamodb.sh
cd ../..
```

**What it creates:**
- `Rooms-production` - Room metadata
- `CanvasObjects-production` - Drawing strokes
- `Connections-production` - Active WebSocket connections
- `DeploymentStats-production` - Deployment counter

**Verify:**
```bash
aws dynamodb list-tables --region us-east-1
```

---

### **Step 2: Deploy Lambda Functions** (3-5 minutes)

```bash
ENVIRONMENT=production ./deploy-lambda.sh
```

**What it does:**
1. ✅ Validates DynamoDB tables exist
2. ✅ Installs Lambda dependencies
3. ✅ Builds SAM application
4. ✅ Creates API Gateway WebSocket API
5. ✅ Creates API Gateway REST API
6. ✅ Deploys 6 Lambda functions
7. ✅ Sets up IAM roles & permissions
8. ✅ Returns API endpoints

**Expected Output:**
```
✓ Deployment complete!

Backend URLs:
  WebSocket: wss://abc123xyz.execute-api.us-east-1.amazonaws.com/production
  REST API:  https://abc123xyz.execute-api.us-east-1.amazonaws.com/production

API Endpoints:
  GET  https://...amazonaws.com/production/api/rooms
  POST https://...amazonaws.com/production/api/rooms
  GET  https://...amazonaws.com/production/api/rooms/{roomId}/strokes
  POST https://...amazonaws.com/production/api/rooms/{roomId}/strokes
  GET  https://...amazonaws.com/production/api/deploy-count
```

**💾 SAVE THESE URLs! You need them for Step 3.**

---

### **Step 3: Deploy Frontend to S3** (1 minute)

```bash
# Use the URLs from Step 2
export API_BASE="https://YOUR-REST-API-URL.amazonaws.com/production"
export WS_BASE="wss://YOUR-WEBSOCKET-URL.amazonaws.com/production"
export ENVIRONMENT="production"

./deploy.sh
```

**What it does:**
1. ✅ Generates `public/config.js` with your API URLs
2. ✅ Creates S3 bucket
3. ✅ Enables static website hosting
4. ✅ Uploads frontend files
5. ✅ Sets public access policy
6. ✅ Updates deployment counter in DynamoDB

**Expected Output:**
```
✓ Frontend deployed successfully!
Frontend URL: http://drawing-app-frontend.s3-website-us-east-1.amazonaws.com
```

**🎉 Your app is LIVE!** Open the URL in your browser!

---

### **Step 4 (Optional): Add CloudFront CDN** (15 minutes)

For HTTPS and global distribution:

```bash
./setup_cloudfront.sh
```

**Expected Output:**
```
CloudFront Domain: https://d1234abcd5678.cloudfront.net
```

**Note:** CloudFront takes 15-20 minutes to deploy globally. Use this URL for production!

---

## 🧪 Testing Your Deployment

### **1. Test Backend (REST API)**

```bash
# Get your API URL
REST_API="https://YOUR-ID.execute-api.us-east-1.amazonaws.com/production"

# Test health endpoint (via rooms)
curl $REST_API/api/rooms

# Create a room
curl -X POST $REST_API/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Room","privacy":"public"}'

# List rooms again
curl $REST_API/api/rooms
```

### **2. Test Frontend**

1. Open S3 URL in browser
2. Create a whiteboard
3. Start drawing
4. Open in another browser/incognito
5. Join same whiteboard
6. **Both users should see drawings in real-time!**

### **3. Test Persistence**

1. Draw something
2. Refresh page
3. **Drawing should still be there!** (loaded from DynamoDB)

---

## 📊 What Got Deployed

### **Lambda Functions:**
```
✓ drawing-app-onConnect-production      (WebSocket connect)
✓ drawing-app-onMessage-production      (WebSocket messages)
✓ drawing-app-onDisconnect-production   (WebSocket disconnect)
✓ drawing-app-api-rooms-production      (REST: Rooms)
✓ drawing-app-api-strokes-production    (REST: Strokes)
✓ drawing-app-api-deploy-count-production (REST: Deploy count)
```

### **API Gateway:**
```
✓ WebSocket API: wss://....execute-api.us-east-1.amazonaws.com/production
  - $connect    → onConnect
  - $default    → onMessage (handles all message types)
  - $disconnect → onDisconnect

✓ REST API: https://....execute-api.us-east-1.amazonaws.com/production
  - GET  /api/rooms
  - POST /api/rooms
  - GET  /api/rooms/{roomId}/strokes
  - POST /api/rooms/{roomId}/strokes
  - GET  /api/deploy-count
```

### **DynamoDB Tables:**
```
✓ Rooms-production            (Room metadata)
✓ CanvasObjects-production    (Drawing strokes)
✓ Connections-production      (Active WebSocket connections)
✓ DeploymentStats-production  (Deployment counter)
```

### **S3 + CloudFront:**
```
✓ S3 Bucket: drawing-app-frontend
✓ CloudFront: https://d1234abcd5678.cloudfront.net (optional)
```

---

## 🔄 Making Updates

### **Update Backend (Lambda functions)**

After changing any Lambda function code:

```bash
cd backend/lambda

# Option 1: Quick update single function
sam build && sam deploy --no-confirm-changeset

# Option 2: Full deployment
cd ../..
ENVIRONMENT=production ./deploy-lambda.sh
```

### **Update Frontend**

After changing frontend code:

```bash
export API_BASE="https://YOUR-API.amazonaws.com/production"
export WS_BASE="wss://YOUR-WS.amazonaws.com/production"
./deploy.sh
```

---

## 💰 Cost Estimate

### **Monthly Costs (Low Traffic):**
```
DynamoDB:
- First 25 GB storage: FREE
- First 25 WCU/25 RCU: FREE
- Estimated: $0-2/month

Lambda:
- First 1M requests: FREE
- First 400,000 GB-seconds: FREE
- Estimated: $0-3/month

API Gateway:
- First 1M WebSocket messages: $1.00
- First 1M REST requests: $3.50
- Estimated: $2-5/month

S3:
- Storage: $0.023/GB
- Requests: $0.004/10k
- Estimated: $1/month

CloudFront:
- Data transfer: $0.085/GB
- Requests: $0.01/10k
- Estimated: $2-5/month

TOTAL: ~$5-15/month (scales with usage)
```

**Free Tier:** First 12 months ~$0-5/month!

---

## 🔧 Useful Commands

### **View Lambda Logs**
```bash
# View logs for specific function
sam logs -n drawing-app-onConnect-production --tail

# View all logs
sam logs --tail
```

### **List All Deployed Resources**
```bash
aws cloudformation describe-stack-resources \
  --stack-name drawing-app-production \
  --region us-east-1
```

### **Get API URLs**
```bash
aws cloudformation describe-stacks \
  --stack-name drawing-app-production \
  --region us-east-1 \
  --query 'Stacks[0].Outputs'
```

### **Monitor DynamoDB**
```bash
# Count rooms
aws dynamodb scan \
  --table-name Rooms-production \
  --select "COUNT"

# Count strokes in a room
aws dynamodb query \
  --table-name CanvasObjects-production \
  --key-condition-expression "roomId = :rid" \
  --expression-attribute-values '{":rid":{"S":"YOUR-ROOM-ID"}}' \
  --select "COUNT"
```

### **Check Active WebSocket Connections**
```bash
aws dynamodb scan \
  --table-name Connections-production \
  --region us-east-1
```

---

## 🐛 Troubleshooting

### **Issue: "SAM CLI not found"**
```bash
pip install aws-sam-cli
# or
brew install aws-sam-cli
```

### **Issue: "DynamoDB table not found"**
```bash
cd backend/infrastructure
ENVIRONMENT=production ./setup-dynamodb.sh
```

### **Issue: "Lambda deployment failed"**
Check CloudWatch logs:
```bash
sam logs -n drawing-app-onConnect-production --tail
```

### **Issue: "Frontend can't connect to backend"**
1. Verify `public/config.js` has correct URLs
2. Check browser console for CORS errors
3. Verify API Gateway URLs are correct:
   ```bash
   curl https://YOUR-API.amazonaws.com/production/api/rooms
   ```

### **Issue: "WebSocket not working"**
1. Check Lambda logs:
   ```bash
   sam logs -n drawing-app-onMessage-production --tail
   ```
2. Verify WebSocket URL format: `wss://` not `ws://`
3. Check Connections table for active connections:
   ```bash
   aws dynamodb scan --table-name Connections-production
   ```

### **Issue: "Drawings not saving"**
1. Check onMessage Lambda logs
2. Verify DynamoDB write permissions in IAM
3. Check CanvasObjects table for new items

---

## 🔒 Security Considerations

### **CORS Configuration**
Lambda functions have CORS enabled for `*` (all origins). For production, update:

```javascript
// In api-rooms.js, api-strokes.js, etc.
'Access-Control-Allow-Origin': 'https://your-cloudfront-domain.cloudfront.net'
```

### **API Rate Limiting**
Add throttling in `template.yaml`:
```yaml
ApiRoomsFunction:
  Properties:
    ReservedConcurrentExecutions: 10  # Limit concurrent executions
```

### **DynamoDB Encryption**
Already enabled by default (encryption at rest).

### **CloudWatch Alarms**
Set up alarms for:
- Lambda errors
- API Gateway 5xx errors
- DynamoDB throttling

---

## 📈 Scaling

### **Lambda Auto-Scaling**
- ✅ Automatically handles up to 1000 concurrent executions
- ✅ Can request increase to 10,000+

### **DynamoDB Auto-Scaling**
Using PAY_PER_REQUEST mode:
- ✅ Automatically scales to handle traffic
- ✅ No capacity planning needed

### **API Gateway**
- ✅ Handles 10,000 requests/second by default
- ✅ Can request increase

**Your app can handle thousands of concurrent users without changes!**

---

## 🧹 Cleanup (Delete Everything)

To avoid AWS charges:

```bash
# 1. Delete CloudFormation stack (Lambdas, API Gateway)
aws cloudformation delete-stack \
  --stack-name drawing-app-production \
  --region us-east-1

# 2. Empty and delete S3 bucket
aws s3 rm s3://drawing-app-frontend --recursive
aws s3 rb s3://drawing-app-frontend

# 3. Delete CloudFront distribution (if created)
# Get distribution ID first
aws cloudfront list-distributions
# Disable, then delete
aws cloudfront update-distribution --id YOUR-ID --if-match ETAG --distribution-config '{"Enabled":false}'
aws cloudfront delete-distribution --id YOUR-ID --if-match ETAG

# 4. Delete DynamoDB tables
aws dynamodb delete-table --table-name Rooms-production
aws dynamodb delete-table --table-name CanvasObjects-production
aws dynamodb delete-table --table-name Connections-production
aws dynamodb delete-table --table-name DeploymentStats-production
```

---

## 📚 Additional Resources

- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [API Gateway WebSocket](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/)

---

## 🎉 Success Checklist

- [ ] DynamoDB tables created
- [ ] Lambda functions deployed
- [ ] API Gateway URLs working
- [ ] Frontend deployed to S3
- [ ] Can create rooms
- [ ] Can draw in real-time
- [ ] Multiple users can collaborate
- [ ] Drawings persist after refresh
- [ ] (Optional) CloudFront CDN setup

**Congratulations! You have a production-ready serverless drawing app!** 🚀

