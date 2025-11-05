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

## AWS Deployment

This application is designed for easy deployment to AWS. Here are several deployment options:

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

