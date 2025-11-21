# Fabric.js Drawing App

A modern, feature-rich drawing application built with Fabric.js, designed to run locally and easily deploy to AWS.

## Features

- 🎨 **Drawing Tools**: Freehand drawing with customizable brush size and color
- 📐 **Shapes**: Add rectangles and circles
- ✏️ **Text**: Add and edit text on the canvas
- 🖼️ **Image Loading**: Load images onto the canvas
- 💾 **Save**: Export your drawings as PNG images
- 🎯 **Select & Move**: Select and manipulate objects on the canvas
- 👥 **Multi-User Support**: Real-time collaboration with multiple users
- 🎯 **Live Cursors**: See other users' cursors in real-time
- ⚡ **Physics-Based Smoothing**: Momentum-based brush smoothing for natural drawing feel
- 🐛 **Debug Tools**: Simulated users for testing multi-user scenarios

## Local Development

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

### Pointing the frontend at your backend

The static site expects a runtime config file at `public/config.js` that sets `window.__API_BASE` (the base URL of your API/server). When you run `./deploy.sh`, set `API_BASE=https://your-backend.example.com` and the script will generate `public/config.js` before uploading to S3/CloudFront. For local testing, you can copy `public/config.example.js` to `public/config.js` and update it to point at your running backend.

- If your WebSocket endpoint differs from the API host, set `WS_BASE=wss://your-backend.example.com` when running `./deploy.sh` (or in `public/config.js`). Leaving it blank falls back to the same origin as the site.

## AWS Serverless Deployment

**⚡ NEW: Full Serverless Deployment with Lambda + API Gateway!**

Deploy in 3 commands (~5 minutes):
```bash
# 1. Create database
cd backend/infrastructure && ENVIRONMENT=production ./setup-dynamodb.sh && cd ../..

# 2. Deploy backend (Lambda + API Gateway)
ENVIRONMENT=production ./deploy-lambda.sh

# 3. Deploy frontend (S3 + CloudFront)
export API_BASE="<URL-FROM-STEP-2>"
export WS_BASE="<URL-FROM-STEP-2>"
./deploy.sh
```

See [QUICK_START.md](QUICK_START.md) or [SERVERLESS_DEPLOYMENT.md](SERVERLESS_DEPLOYMENT.md) for complete guide.

---

## Alternative AWS Deployment Options

This application was designed for serverless but can also deploy to:

### Option 1: AWS Elastic Beanstalk (Easiest)

1. Install the EB CLI:
```bash
pip install awsebcli
```

2. Initialize Elastic Beanstalk:
```bash
eb init
```

3. Create and deploy:
```bash
eb create
eb open
```

### Option 2: AWS ECS with Docker

1. Build the Docker image:
```bash
docker build -t fabricjs-drawing-app .
```

2. Tag and push to Amazon ECR:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker tag fabricjs-drawing-app:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/fabricjs-drawing-app:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/fabricjs-drawing-app:latest
```

3. Create an ECS task definition and service using the pushed image.

### Option 3: AWS App Runner

1. Push your code to GitHub
2. Connect your repository to AWS App Runner
3. Configure the build and start commands:
   - Build: `npm install`
   - Start: `npm start`
4. Deploy!

### Option 4: AWS EC2

1. Launch an EC2 instance
2. Install Node.js and npm
3. Clone your repository
4. Run `npm install` and `npm start`
5. Configure security groups to allow port 3000

## Project Structure

```
.
├── public/
│   ├── index.html      # Main HTML file
│   ├── styles.css      # Application styles
│   └── app.js          # Fabric.js application logic (multi-user)
├── server.js           # Express + WebSocket server
├── package.json        # Dependencies and scripts
├── Dockerfile          # Docker configuration for containerization
├── ARCHITECTURE.md     # Detailed architecture design for AWS deployment
├── INTEGRATION_POINTS.md # Quick reference for DynamoDB integration
└── README.md           # This file
```

## Architecture & Design

This application is designed to evolve into a full-featured whiteboard platform with:
- **Multi-Canvas Support**: Global, company, and private canvases
- **Persistence**: DynamoDB storage for canvas state
- **Authentication**: AWS Cognito integration
- **Space Reservation**: Paid canvas space allocation
- **Real-time Collaboration**: WebSocket-based updates

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for detailed design documentation and [`INTEGRATION_POINTS.md`](INTEGRATION_POINTS.md) for code integration references.

## Environment Variables

- `PORT`: Server port (default: 3000)

## Health Check

The application includes a health check endpoint at `/health` that returns a 200 status, useful for AWS load balancers and health checks.

## Technologies Used

### Current Stack
- **Fabric.js**: Canvas manipulation library
- **Express.js**: Web server framework
- **WebSocket (ws)**: Real-time communication
- **Node.js**: Runtime environment

### Planned AWS Stack
- **S3 + CloudFront**: Frontend hosting and CDN
- **API Gateway**: WebSocket and REST APIs
- **AWS Lambda**: Serverless backend functions
- **DynamoDB**: Canvas state persistence
- **Cognito**: User authentication/authorization
- **EventBridge**: Scheduled tasks (snapshots, compaction)

## License

MIT
