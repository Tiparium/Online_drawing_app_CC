# 🚀 Quick Start - 3 Commands to Deploy

Get your drawing app live in **5 minutes**!

## Prerequisites

```bash
# 1. Install AWS CLI
pip install awscli

# 2. Install SAM CLI
pip install aws-sam-cli

# 3. Configure AWS
aws configure
```

## Deployment

```bash
# Step 1: Create database (1 min)
cd backend/infrastructure && ENVIRONMENT=production ./setup-dynamodb.sh && cd ../..

# Step 2: Deploy backend (3-5 min)
ENVIRONMENT=production ./deploy-lambda.sh

# Step 3: Deploy frontend (1 min)
# Copy the URLs from Step 2 output, then:
export API_BASE="https://YOUR-REST-API.amazonaws.com/production"
export WS_BASE="wss://YOUR-WEBSOCKET.amazonaws.com/production"
./deploy.sh
```

**Done!** Open the S3 URL from Step 3 in your browser! 🎉

---

## What You Get

- ✅ Collaborative whiteboard
- ✅ Real-time drawing
- ✅ Persistent storage
- ✅ Auto-scaling
- ✅ ~$5-15/month cost
- ✅ Production ready

---

## Need Help?

See [SERVERLESS_DEPLOYMENT.md](SERVERLESS_DEPLOYMENT.md) for detailed guide.

