// Multi-user drawing application with WebSocket support

// Initialize Fabric.js canvas
const canvas = new fabric.Canvas('canvas', {
    width: 800,
    height: 600,
    backgroundColor: '#ffffff'
});

// ============================================================================
// USER MANAGEMENT SYSTEM
// ============================================================================

let currentUserId = null;
let localUser = null;
const remoteUsers = new Map(); // userId -> User instance
const userCursors = new Map(); // userId -> cursor element
const simulatedUsers = new Map(); // userId -> SimulatedUser instance

class User {
    constructor(userId, userData, isLocal = false) {
        this.userId = userId;
        this.color = userData.color || '#000000';
        this.brushSize = userData.brushSize || 5;
        this.smoothing = userData.smoothing || 0;
        this.mode = userData.mode || 'draw';
        this.cursor = userData.cursor || { x: 0, y: 0 };
        this.isLocal = isLocal;
        
        // Create brush instance for this user
        if (isLocal) {
            this.brush = new SmoothedBrush(canvas);
            this.brush.setSmoothingLevel(this.smoothing);
            this.brush.width = this.brushSize;
            this.brush.color = this.color;
        } else {
            this.brush = null; // Remote users don't need brush instances
        }
        
        // Create cursor element
        this.createCursor();
    }
    
    createCursor() {
        if (this.isLocal) return; // Don't show cursor for local user
        
        const cursor = document.createElement('div');
        cursor.className = 'user-cursor';
        cursor.style.color = this.color;
        cursor.setAttribute('data-user-id', this.userId);
        document.querySelector('main').appendChild(cursor);
        userCursors.set(this.userId, cursor);
        this.updateCursorPosition();
    }
    
    updateCursorPosition() {
        const cursor = userCursors.get(this.userId);
        if (cursor) {
            const canvasEl = canvas.getElement();
            const rect = canvasEl.getBoundingClientRect();
            cursor.style.left = (rect.left + this.cursor.x) + 'px';
            cursor.style.top = (rect.top + this.cursor.y) + 'px';
        }
    }
    
    updateSettings(color, brushSize, smoothing, mode) {
        this.color = color;
        this.brushSize = brushSize;
        this.smoothing = smoothing;
        this.mode = mode;
        
        if (this.isLocal && this.brush) {
            this.brush.color = color;
            this.brush.width = brushSize;
            this.brush.setSmoothingLevel(smoothing);
        }
        
        const cursor = userCursors.get(this.userId);
        if (cursor) {
            cursor.style.color = color;
        }
    }
    
    remove() {
        const cursor = userCursors.get(this.userId);
        if (cursor) {
            cursor.remove();
        }
        userCursors.delete(this.userId);
    }
}

// ============================================================================
// SMOOTHED BRUSH (Preserved from original)
// ============================================================================

class SmoothedBrush extends fabric.PencilBrush {
    constructor(canvas) {
        super(canvas);
        this.smoothingLevel = 0;
        this._isDrawing = false;
        this._tempPath = null;
        this._animationFrame = null;
        this._lastFrameTime = null;
        
        // Cursor tracking - store recent cursor positions for path following
        this.cursorPath = [];
        this.cursorPos = null;
        this.prevCursorPos = null;
        this.prevCursorTime = null;
        
        // Physics state for drawing position
        this.drawPos = null;
        this.drawVel = { x: 0, y: 0 };
        
        // Drawing points
        this.drawnPoints = [];
        
        // Animation loop
        this.animate = this.animate.bind(this);
    }

    setSmoothingLevel(level) {
        this.smoothingLevel = level;
    }

    onMouseDown(pointer, options) {
        if (this._tempPath) {
            this.canvas.remove(this._tempPath);
            this._tempPath = null;
        }
        
        this.cursorPos = { x: pointer.x, y: pointer.y };
        this.prevCursorPos = { x: pointer.x, y: pointer.y };
        this.prevCursorTime = Date.now();
        this._lastFrameTime = this.prevCursorTime;
        
        this.drawPos = { x: pointer.x, y: pointer.y };
        this.drawVel = { x: 0, y: 0 };
        
        this.cursorPath = [{ x: pointer.x, y: pointer.y, time: this.prevCursorTime }];
        this.drawnPoints = [{ x: pointer.x, y: pointer.y }];
        this._isDrawing = true;
        
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
        }
        this._lastFrameTime = performance.now();
        this.animate();
    }

    onMouseMove(pointer, options) {
        if (!this._isDrawing) return;
        
        const now = Date.now();
        this.prevCursorPos = { ...this.cursorPos };
        this.cursorPos = { x: pointer.x, y: pointer.y };
        this.prevCursorTime = now;
        
        this.cursorPath.push({ x: pointer.x, y: pointer.y, time: now });
        if (this.cursorPath.length > 20) {
            this.cursorPath.shift();
        }
    }

    onMouseUp(options) {
        if (!this._isDrawing) return;
        
        this._isDrawing = false;
        
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
        
        if (this.smoothingLevel === 0) {
            if (this.drawnPoints.length > 1) {
                this.finalizePath(this.drawnPoints, false);
            }
        } else {
            if (this.drawnPoints.length > 1) {
                this.momentumCatchUp();
            } else if (this.drawnPoints.length > 0 && this.cursorPos) {
                this.drawnPoints.push({ ...this.cursorPos });
                this.finalizePath(this.drawnPoints, true);
            }
        }
        
        setTimeout(() => {
            this.drawnPoints = [];
            this.cursorPath = [];
            this.cursorPos = null;
            this.drawPos = null;
        }, 200);
    }

    animate() {
        if (!this._isDrawing) return;
        
        const currentTime = performance.now();
        const deltaTime = Math.max(0.001, (currentTime - this._lastFrameTime) / 1000);
        this._lastFrameTime = currentTime;
        
        if (this.smoothingLevel === 0) {
            if (this.cursorPos) {
                const lastPoint = this.drawnPoints[this.drawnPoints.length - 1];
                const distance = Math.sqrt(
                    Math.pow(this.cursorPos.x - lastPoint.x, 2) +
                    Math.pow(this.cursorPos.y - lastPoint.y, 2)
                );
                
                if (distance > 1) {
                    this.drawnPoints.push({ ...this.cursorPos });
                    this.updatePath();
                }
            }
        } else {
            this.updatePhysics(deltaTime);
            
            const lastPoint = this.drawnPoints[this.drawnPoints.length - 1];
            const distance = Math.sqrt(
                Math.pow(this.drawPos.x - lastPoint.x, 2) +
                Math.pow(this.drawPos.y - lastPoint.y, 2)
            );
            
            if (distance > 0.5) {
                this.drawnPoints.push({ ...this.drawPos });
                this.updatePath();
            }
        }
        
        this._animationFrame = requestAnimationFrame(this.animate);
    }

    updatePhysics(deltaTime) {
        if (!this.cursorPos || !this.drawPos) return;
        
        const smoothingFactor = this.smoothingLevel / 100;
        const now = Date.now();
        const timeSinceLastCursorMove = now - this.prevCursorTime;
        const isCursorStationary = timeSinceLastCursorMove > 50;
        
        let targetPos = this.cursorPos;
        if (!isCursorStationary && this.cursorPath.length > 1 && smoothingFactor > 0) {
            const lookBackIndex = Math.floor(this.cursorPath.length * smoothingFactor * 0.5);
            const targetIndex = Math.max(0, this.cursorPath.length - 1 - lookBackIndex);
            targetPos = {
                x: this.cursorPath[targetIndex].x,
                y: this.cursorPath[targetIndex].y
            };
        }
        
        const dx = targetPos.x - this.drawPos.x;
        const dy = targetPos.y - this.drawPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const currentSpeed = Math.sqrt(this.drawVel.x * this.drawVel.x + this.drawVel.y * this.drawVel.y);
        const brakingDistance = (currentSpeed * currentSpeed) / (2 * 200);
        
        const maxAcceleration = (1 - smoothingFactor) * 2000 + smoothingFactor * 200;
        const maxDeceleration = maxAcceleration * 1.5;
        
        let targetSpeed = 0;
        if (distance > 0.01) {
            if (distance < brakingDistance && currentSpeed > 0) {
                const brakeFactor = Math.min(1, distance / brakingDistance);
                targetSpeed = currentSpeed * brakeFactor * 0.5;
            } else {
                targetSpeed = Math.min(distance * 10, 500);
            }
        }
        
        if (isCursorStationary && distance < 5) {
            targetSpeed = 0;
        }
        
        let desiredVelX = 0;
        let desiredVelY = 0;
        if (distance > 0.01) {
            desiredVelX = (dx / distance) * targetSpeed;
            desiredVelY = (dy / distance) * targetSpeed;
        }
        
        const accelX = desiredVelX - this.drawVel.x;
        const accelY = desiredVelY - this.drawVel.y;
        const accelMagnitude = Math.sqrt(accelX * accelX + accelY * accelY);
        
        const isBraking = distance < brakingDistance || (isCursorStationary && distance < 10);
        const maxAccel = isBraking ? maxDeceleration : maxAcceleration;
        
        let limitedAccelX = accelX;
        let limitedAccelY = accelY;
        if (accelMagnitude > maxAccel * deltaTime) {
            const scale = (maxAccel * deltaTime) / accelMagnitude;
            limitedAccelX = accelX * scale;
            limitedAccelY = accelY * scale;
        }
        
        this.drawVel.x += limitedAccelX;
        this.drawVel.y += limitedAccelY;
        
        let damping = 0.95 + smoothingFactor * 0.04;
        if (isCursorStationary && distance < 10) {
            damping = 0.85;
        } else if (distance < 5) {
            damping = 0.90;
        }
        this.drawVel.x *= damping;
        this.drawVel.y *= damping;
        
        this.drawPos.x += this.drawVel.x * deltaTime;
        this.drawPos.y += this.drawVel.y * deltaTime;
        
        if (isCursorStationary && distance < 0.5 && currentSpeed < 5) {
            this.drawPos.x = targetPos.x;
            this.drawPos.y = targetPos.y;
            this.drawVel.x = 0;
            this.drawVel.y = 0;
        }
    }

    momentumCatchUp() {
        const smoothingFactor = this.smoothingLevel / 100;
        const catchUpSpeed = (1 - smoothingFactor) * 0.3 + smoothingFactor * 0.05;
        const maxIterations = Math.max(120, Math.floor(240 * smoothingFactor));
        
        let iteration = 0;
        const finalPoints = [...this.drawnPoints];
        let lastTime = performance.now();
        
        const catchUp = () => {
            if (!this.drawPos || !this.cursorPos || iteration >= maxIterations) {
                if (finalPoints.length > 1) {
                    this.finalizePath(finalPoints, this.smoothingLevel > 0);
                }
                return;
            }
            
            const currentTime = performance.now();
            const deltaTime = Math.max(0.001, (currentTime - lastTime) / 1000);
            lastTime = currentTime;
            
            this.updatePhysics(deltaTime);
            
            const dx = this.cursorPos.x - this.drawPos.x;
            const dy = this.cursorPos.y - this.drawPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 0.5 && Math.abs(this.drawVel.x) < 5 && Math.abs(this.drawVel.y) < 5) {
                if (distance >= 0.5) {
                    finalPoints.push({ ...this.cursorPos });
                }
                if (finalPoints.length > 1) {
                    this.finalizePath(finalPoints, this.smoothingLevel > 0);
                }
                return;
            }
            
            const lastPoint = finalPoints[finalPoints.length - 1];
            const pointDistance = Math.sqrt(
                Math.pow(this.drawPos.x - lastPoint.x, 2) +
                Math.pow(this.drawPos.y - lastPoint.y, 2)
            );
            
            if (pointDistance > 0.5) {
                finalPoints.push({ ...this.drawPos });
            }
            
            if (this._tempPath) {
                this.canvas.remove(this._tempPath);
            }
            if (finalPoints.length > 1) {
                const pointsToDraw = this.smoothingLevel > 0 && finalPoints.length > 2 
                    ? this.smoothPath(finalPoints) 
                    : finalPoints;
                const pathData = this.createPathFromPoints(pointsToDraw, this.smoothingLevel > 0);
                this._tempPath = new fabric.Path(pathData, {
                    fill: '',
                    stroke: this.color,
                    strokeWidth: this.width,
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    selectable: false,
                    evented: false
                });
                this.canvas.add(this._tempPath);
                this.canvas.renderAll();
            }
            
            iteration++;
            requestAnimationFrame(catchUp);
        };
        
        catchUp();
    }

    updatePath() {
        if (this.drawnPoints.length < 2) return;
        
        if (this._tempPath) {
            this.canvas.remove(this._tempPath);
            this._tempPath = null;
        }
        
        let pointsToDraw = this.drawnPoints;
        if (this.smoothingLevel > 0 && this.drawnPoints.length > 2) {
            pointsToDraw = this.smoothPath(this.drawnPoints);
        }
        
        const pathData = this.createPathFromPoints(pointsToDraw, this.smoothingLevel > 0);
        this._tempPath = new fabric.Path(pathData, {
            fill: '',
            stroke: this.color,
            strokeWidth: this.width,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            selectable: false,
            evented: false
        });
        
        this.canvas.add(this._tempPath);
        this.canvas.renderAll();
    }

    finalizePath(points, useCurves) {
        if (this._tempPath) {
            this.canvas.remove(this._tempPath);
            this._tempPath = null;
        }
        
        if (points.length < 2) return null;
        
        let pointsToDraw = points;
        if (useCurves && points.length > 2) {
            pointsToDraw = this.smoothPath(points);
        }
        
        const pathData = this.createPathFromPoints(pointsToDraw, useCurves);
        const finalPath = new fabric.Path(pathData, {
            fill: '',
            stroke: this.color,
            strokeWidth: this.width,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            selectable: false,
            evented: false
        });
        
        this.canvas.add(finalPath);
        this.canvas.renderAll();
        
        return finalPath;
    }

    smoothPath(points) {
        if (points.length < 3) return points;
        
        const smoothingFactor = this.smoothingLevel / 100;
        const windowSize = Math.max(1, Math.floor(smoothingFactor * 10) + 1);
        let smoothed = [...points];
        const passes = Math.max(1, Math.floor(smoothingFactor * 3) + 1);
        
        for (let pass = 0; pass < passes; pass++) {
            const newSmoothed = [smoothed[0]];
            
            for (let i = 1; i < smoothed.length - 1; i++) {
                const start = Math.max(0, i - windowSize);
                const end = Math.min(smoothed.length - 1, i + windowSize);
                
                let sumX = 0;
                let sumY = 0;
                let count = 0;
                
                for (let j = start; j <= end; j++) {
                    const distance = Math.abs(j - i);
                    const weight = 1 / (1 + distance * smoothingFactor * 3);
                    sumX += smoothed[j].x * weight;
                    sumY += smoothed[j].y * weight;
                    count += weight;
                }
                
                newSmoothed.push({
                    x: sumX / count,
                    y: sumY / count
                });
            }
            
            newSmoothed.push(smoothed[smoothed.length - 1]);
            smoothed = newSmoothed;
        }
        
        return smoothed;
    }

    createPathFromPoints(points, useCurves = true) {
        if (points.length < 2) return '';
        
        let path = `M ${points[0].x} ${points[0].y}`;
        
        if (useCurves && points.length > 2) {
            for (let i = 1; i < points.length - 1; i++) {
                const midX = (points[i].x + points[i + 1].x) / 2;
                const midY = (points[i].y + points[i + 1].y) / 2;
                path += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
            }
            path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
        } else {
            for (let i = 1; i < points.length; i++) {
                path += ` L ${points[i].x} ${points[i].y}`;
            }
        }
        
        return path;
    }
}

// ============================================================================
// WEBSOCKET CONNECTION
// ============================================================================

let ws = null;
let isConnected = false;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        isConnected = true;
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        isConnected = false;
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'userConnected':
            currentUserId = data.userId;
            localUser = new User(data.userId, data.userData, true);
            setupLocalUser();
            break;
            
        case 'existingUsers':
            data.users.forEach(user => {
                if (user.userId !== currentUserId) {
                    const remoteUser = new User(user.userId, user.userData, false);
                    remoteUsers.set(user.userId, remoteUser);
                }
            });
            break;
            
        case 'userJoined':
            if (data.userId !== currentUserId) {
                const remoteUser = new User(data.userId, data.userData, false);
                remoteUsers.set(data.userId, remoteUser);
            }
            break;
            
        case 'userLeft':
            const user = remoteUsers.get(data.userId);
            if (user) {
                user.remove();
                remoteUsers.delete(data.userId);
            }
            break;
            
        case 'cursorMove':
            const remoteUser = remoteUsers.get(data.userId);
            if (remoteUser) {
                remoteUser.cursor = data.cursor;
                remoteUser.updateCursorPosition();
            }
            break;
            
        case 'drawingUpdate':
            handleRemoteDrawing(data.userId, data.path, data.action);
            break;
    }
}

function sendWebSocketMessage(type, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

// ============================================================================
// REMOTE DRAWING HANDLING
// ============================================================================

function handleRemoteDrawing(userId, pathData, action) {
    const user = remoteUsers.get(userId);
    if (!user) return;
    
    if (action === 'add' && pathData) {
        const path = new fabric.Path(pathData, {
            fill: '',
            stroke: user.color,
            strokeWidth: user.brushSize,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            selectable: false,
            evented: false
        });
        path.set('userId', userId);
        canvas.add(path);
        canvas.renderAll();
    }
}

// ============================================================================
// LOCAL USER SETUP
// ============================================================================

let currentMode = 'draw';

function setupLocalUser() {
    if (!localUser) return;
    
    canvas.freeDrawingBrush = localUser.brush;
    canvas.freeDrawingBrush.width = localUser.brushSize;
    canvas.freeDrawingBrush.color = localUser.color;
    
    // Send initial settings
    sendWebSocketMessage('userSettings', {
        color: localUser.color,
        brushSize: localUser.brushSize,
        smoothing: localUser.smoothing,
        mode: localUser.mode
    });
}

// Track local drawing to send to other users
let currentPath = null;

canvas.on('path:created', (e) => {
    if (e.path && localUser) {
        const pathData = e.path.path;
        sendWebSocketMessage('drawingUpdate', {
            path: pathData,
            action: 'add'
        });
    }
});

// ============================================================================
// UI SETUP
// ============================================================================

const drawBtn = document.getElementById('drawBtn');
const selectBtn = document.getElementById('selectBtn');
const rectBtn = document.getElementById('rectBtn');
const circleBtn = document.getElementById('circleBtn');
const textBtn = document.getElementById('textBtn');
const clearBtn = document.getElementById('clearBtn');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const smoothingSlider = document.getElementById('smoothingSlider');
const smoothingValue = document.getElementById('smoothingValue');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const fileInput = document.getElementById('fileInput');

// Tool selection
function setMode(mode) {
    currentMode = mode;
    if (localUser) {
        localUser.mode = mode;
        sendWebSocketMessage('userSettings', {
            color: localUser.color,
            brushSize: localUser.brushSize,
            smoothing: localUser.smoothing,
            mode: mode
        });
    }
    
    canvas.isDrawingMode = (mode === 'draw');
    canvas.selection = (mode === 'select');
    
    [drawBtn, selectBtn, rectBtn, circleBtn, textBtn].forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (mode === 'draw') drawBtn.classList.add('active');
    if (mode === 'select') selectBtn.classList.add('active');
    if (mode === 'rect') rectBtn.classList.add('active');
    if (mode === 'circle') circleBtn.classList.add('active');
    if (mode === 'text') textBtn.classList.add('active');
}

drawBtn.addEventListener('click', () => setMode('draw'));
selectBtn.addEventListener('click', () => setMode('select'));
rectBtn.addEventListener('click', () => setMode('rect'));
circleBtn.addEventListener('click', () => setMode('circle'));
textBtn.addEventListener('click', () => setMode('text'));

// Brush settings
brushSize.addEventListener('input', (e) => {
    const size = parseInt(e.target.value);
    brushSizeValue.textContent = size;
    if (localUser) {
        localUser.brushSize = size;
        localUser.brush.width = size;
        sendWebSocketMessage('userSettings', {
            color: localUser.color,
            brushSize: size,
            smoothing: localUser.smoothing,
            mode: localUser.mode
        });
    }
});

colorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    if (localUser) {
        localUser.color = color;
        localUser.brush.color = color;
        sendWebSocketMessage('userSettings', {
            color: color,
            brushSize: localUser.brushSize,
            smoothing: localUser.smoothing,
            mode: localUser.mode
        });
    }
});

smoothingSlider.addEventListener('input', (e) => {
    const smoothing = parseInt(e.target.value);
    smoothingValue.textContent = smoothing;
    if (localUser) {
        localUser.smoothing = smoothing;
        localUser.brush.setSmoothingLevel(smoothing);
        sendWebSocketMessage('userSettings', {
            color: localUser.color,
            brushSize: localUser.brushSize,
            smoothing: smoothing,
            mode: localUser.mode
        });
    }
});

// Cursor tracking
canvas.on('mouse:move', (e) => {
    if (localUser && isConnected) {
        const pointer = canvas.getPointer(e.e);
        localUser.cursor = { x: pointer.x, y: pointer.y };
        sendWebSocketMessage('cursorMove', {
            cursor: localUser.cursor
        });
    }
});

// Rectangle tool
rectBtn.addEventListener('click', () => {
    setMode('rect');
    canvas.on('mouse:down', startRect);
});

function startRect(o) {
    if (currentMode !== 'rect') return;
    
    const pointer = canvas.getPointer(o.e);
    const rect = new fabric.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: localUser ? localUser.color : '#000000',
        strokeWidth: localUser ? localUser.brushSize : 5
    });
    
    canvas.add(rect);
    canvas.setActiveObject(rect);
    
    canvas.on('mouse:move', (o) => {
        const pointer = canvas.getPointer(o.e);
        rect.set({
            width: Math.abs(pointer.x - rect.left),
            height: Math.abs(pointer.y - rect.top)
        });
        canvas.renderAll();
    });
    
    canvas.once('mouse:up', () => {
        canvas.off('mouse:move');
        canvas.off('mouse:down', startRect);
        if (rect.path) {
            sendWebSocketMessage('drawingUpdate', {
                path: rect.path,
                action: 'add'
            });
        }
    });
}

// Circle tool
circleBtn.addEventListener('click', () => {
    setMode('circle');
    canvas.on('mouse:down', startCircle);
});

function startCircle(o) {
    if (currentMode !== 'circle') return;
    
    const pointer = canvas.getPointer(o.e);
    const circle = new fabric.Circle({
        left: pointer.x,
        top: pointer.y,
        radius: 0,
        fill: 'transparent',
        stroke: localUser ? localUser.color : '#000000',
        strokeWidth: localUser ? localUser.brushSize : 5
    });
    
    canvas.add(circle);
    canvas.setActiveObject(circle);
    
    canvas.on('mouse:move', (o) => {
        const pointer = canvas.getPointer(o.e);
        const radius = Math.sqrt(
            Math.pow(pointer.x - circle.left, 2) + 
            Math.pow(pointer.y - circle.top, 2)
        );
        circle.set({ radius });
        canvas.renderAll();
    });
    
    canvas.once('mouse:up', () => {
        canvas.off('mouse:move');
        canvas.off('mouse:down', startCircle);
        if (circle.path) {
            sendWebSocketMessage('drawingUpdate', {
                path: circle.path,
                action: 'add'
            });
        }
    });
}

// Text tool
textBtn.addEventListener('click', () => {
    setMode('text');
    const text = new fabric.IText('Click to edit', {
        left: 400,
        top: 300,
        fontFamily: 'Arial',
        fontSize: 20,
        fill: localUser ? localUser.color : '#000000'
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
});

// Clear canvas
clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the canvas?')) {
        canvas.clear();
        canvas.backgroundColor = '#ffffff';
        canvas.renderAll();
    }
});

// Save canvas
saveBtn.addEventListener('click', () => {
    const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1.0
    });
    
    const link = document.createElement('a');
    link.download = 'drawing.png';
    link.href = dataURL;
    link.click();
});

// Load image
loadBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            fabric.Image.fromURL(event.target.result, (img) => {
                canvas.add(img);
                canvas.renderAll();
            });
        };
        reader.readAsDataURL(file);
    }
});

// ============================================================================
// DEBUG FEATURES
// ============================================================================

const debugBtn = document.getElementById('debugBtn');
const debugPanel = document.getElementById('debugPanel');
const addSimUserBtn = document.getElementById('addSimUserBtn');
const removeSimUserBtn = document.getElementById('removeSimUserBtn');
const simSpeedSlider = document.getElementById('simSpeedSlider');
const simSpeedValue = document.getElementById('simSpeedValue');
const drawFreqSlider = document.getElementById('drawFreqSlider');
const drawFreqValue = document.getElementById('drawFreqValue');
const settingsFreqSlider = document.getElementById('settingsFreqSlider');
const settingsFreqValue = document.getElementById('settingsFreqValue');
const simUserCount = document.getElementById('simUserCount');

let debugParams = {
    simSpeed: 5,
    drawFreq: 0.3,
    settingsFreq: 0.05
};

debugBtn.addEventListener('click', () => {
    debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
});

simSpeedSlider.addEventListener('input', (e) => {
    debugParams.simSpeed = parseInt(e.target.value);
    simSpeedValue.textContent = debugParams.simSpeed;
    updateSimUsers();
});

drawFreqSlider.addEventListener('input', (e) => {
    debugParams.drawFreq = parseFloat(e.target.value);
    drawFreqValue.textContent = debugParams.drawFreq;
    updateSimUsers();
});

settingsFreqSlider.addEventListener('input', (e) => {
    debugParams.settingsFreq = parseFloat(e.target.value);
    settingsFreqValue.textContent = debugParams.settingsFreq;
    updateSimUsers();
});

class SimulatedUser {
    constructor(userId) {
        this.userId = userId;
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.targetX = this.x;
        this.targetY = this.y;
        this.color = this.randomColor();
        this.brushSize = Math.floor(Math.random() * 20) + 5;
        this.smoothing = Math.floor(Math.random() * 100);
        this.isDrawing = false;
        this.lastSettingsChange = Date.now();
        this.lastDrawTime = Date.now();
        
        // Create user
        const userData = {
            color: this.color,
            brushSize: this.brushSize,
            smoothing: this.smoothing,
            mode: 'draw',
            cursor: { x: this.x, y: this.y }
        };
        const user = new User(userId, userData, false);
        remoteUsers.set(userId, user);
        
        // Start simulation
        this.simulate();
    }
    
    randomColor() {
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    updateSettings() {
        if (Math.random() < debugParams.settingsFreq) {
            this.color = this.randomColor();
            this.brushSize = Math.floor(Math.random() * 20) + 5;
            this.smoothing = Math.floor(Math.random() * 100);
            
            const user = remoteUsers.get(this.userId);
            if (user) {
                user.updateSettings(this.color, this.brushSize, this.smoothing, 'draw');
            }
        }
    }
    
    simulate() {
        const user = remoteUsers.get(this.userId);
        if (!user) return;
        
        // Update settings occasionally
        this.updateSettings();
        
        // Move toward target
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 5) {
            // Pick new target
            this.targetX = Math.random() * canvas.width;
            this.targetY = Math.random() * canvas.height;
        } else {
            // Move toward target
            const speed = debugParams.simSpeed * 2;
            this.x += (dx / distance) * speed;
            this.y += (dy / distance) * speed;
        }
        
        // Update cursor
        user.cursor = { x: this.x, y: this.y };
        user.updateCursorPosition();
        
        // Draw occasionally
        if (!this.isDrawing && Math.random() < debugParams.drawFreq) {
            this.startDrawing();
        }
        
        if (this.isDrawing) {
            this.continueDrawing();
        }
        
        requestAnimationFrame(() => this.simulate());
    }
    
    startDrawing() {
        this.isDrawing = true;
        this.drawPoints = [{ x: this.x, y: this.y }];
    }
    
    continueDrawing() {
        if (!this.isDrawing) return;
        
        this.drawPoints.push({ x: this.x, y: this.y });
        
        // Occasionally finish drawing
        if (this.drawPoints.length > 10 && Math.random() < 0.1) {
            this.finishDrawing();
        }
    }
    
    finishDrawing() {
        if (this.drawPoints.length < 2) {
            this.isDrawing = false;
            return;
        }
        
        // Create path using same logic as SmoothedBrush
        const user = remoteUsers.get(this.userId);
        if (!user) return;
        
        const brush = new SmoothedBrush(canvas);
        brush.color = user.color;
        brush.width = user.brushSize;
        brush.setSmoothingLevel(user.smoothing);
        
        const path = brush.finalizePath(this.drawPoints, user.smoothing > 0);
        if (path) {
            path.set('userId', this.userId);
            sendWebSocketMessage('drawingUpdate', {
                path: path.path,
                action: 'add'
            });
        }
        
        this.isDrawing = false;
        this.drawPoints = [];
    }
    
    remove() {
        const user = remoteUsers.get(this.userId);
        if (user) {
            user.remove();
            remoteUsers.delete(this.userId);
        }
    }
}

function updateSimUsers() {
    simulatedUsers.forEach(sim => {
        // Parameters are used in simulate() method
    });
}

addSimUserBtn.addEventListener('click', () => {
    const userId = 'sim_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const simUser = new SimulatedUser(userId);
    simulatedUsers.set(userId, simUser);
    updateSimUserCount();
});

removeSimUserBtn.addEventListener('click', () => {
    if (simulatedUsers.size > 0) {
        const firstUserId = simulatedUsers.keys().next().value;
        const simUser = simulatedUsers.get(firstUserId);
        if (simUser) {
            simUser.remove();
            simulatedUsers.delete(firstUserId);
            updateSimUserCount();
        }
    }
});

function updateSimUserCount() {
    simUserCount.textContent = `Simulated Users: ${simulatedUsers.size}`;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

setMode('draw');
connectWebSocket();

