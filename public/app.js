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
        this.name = userData.name || (isLocal ? 'You' : 'User');
        this.color = userData.color || '#000000';
        this.brushSize = userData.brushSize || 5;
        this.smoothing = userData.smoothing || 0;
        this.mode = userData.mode || 'draw';
        this.cursor = userData.cursor || { x: 0, y: 0 };
        this.isLocal = isLocal;
        this.initials = this.generateInitials(this.name);
        
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
        // Add to users pane
        this.addToUsersPane();
    }
    
    generateInitials(name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
            return parts[0].substring(0, 3).toUpperCase();
        }
        let initials = '';
        for (let i = 0; i < Math.min(parts.length, 3); i++) {
            initials += parts[i][0].toUpperCase();
        }
        return initials.substring(0, 3);
    }
    
    createCursor() {
        if (this.isLocal) return; // Don't show cursor for local user
        
        // Create wrapper for cursor and tooltip
        const wrapper = document.createElement('div');
        wrapper.className = 'user-cursor-wrapper';
        wrapper.setAttribute('data-user-id', this.userId);
        
        const cursor = document.createElement('div');
        cursor.className = 'user-cursor';
        cursor.style.color = this.color;
        cursor.setAttribute('data-initials', this.initials);
        cursor.setAttribute('title', this.name); // Native tooltip as fallback
        
        const tooltip = document.createElement('div');
        tooltip.className = 'cursor-tooltip';
        tooltip.textContent = this.name;
        
        wrapper.appendChild(cursor);
        wrapper.appendChild(tooltip);
        
        document.querySelector('main').appendChild(wrapper);
        userCursors.set(this.userId, wrapper); // Store wrapper instead of cursor
        this.updateCursorPosition();
    }
    
    updateCursorPosition() {
        const wrapper = userCursors.get(this.userId);
        if (wrapper) {
            const canvasEl = canvas.getElement();
            const rect = canvasEl.getBoundingClientRect();
            wrapper.style.left = (rect.left + this.cursor.x) + 'px';
            wrapper.style.top = (rect.top + this.cursor.y) + 'px';
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
        
        const wrapper = userCursors.get(this.userId);
        if (wrapper) {
            const cursor = wrapper.querySelector('.user-cursor');
            if (cursor) {
                cursor.style.color = color;
            }
        }
        
        // Update users pane avatar color
        this.updateUsersPaneItem();
    }
    
    addToUsersPane() {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;
        
        const userItem = document.createElement('div');
        userItem.className = `user-item ${this.isLocal ? 'local' : ''}`;
        userItem.setAttribute('data-user-id', this.userId);
        
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        
        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.style.color = this.color;
        avatar.textContent = this.initials;
        
        const name = document.createElement('span');
        name.className = 'user-name';
        name.textContent = this.name;
        
        userInfo.appendChild(avatar);
        userInfo.appendChild(name);
        
        userItem.appendChild(userInfo);
        
        // Add delete button for simulated users only
        if (!this.isLocal && this.userId.startsWith('sim_')) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-user-btn';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.setAttribute('title', 'Delete simulated user');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.remove();
            });
            userItem.appendChild(deleteBtn);
        }
        
        usersList.appendChild(userItem);
    }
    
    updateUsersPaneItem() {
        const userItem = document.querySelector(`[data-user-id="${this.userId}"]`);
        if (userItem) {
            const avatar = userItem.querySelector('.user-avatar');
            if (avatar) {
                avatar.style.color = this.color;
            }
        }
    }
    
    remove() {
        const wrapper = userCursors.get(this.userId);
        if (wrapper) {
            wrapper.remove();
        }
        userCursors.delete(this.userId);
        
        // Remove from users pane
        const userItem = document.querySelector(`.user-item[data-user-id="${this.userId}"]`);
        if (userItem) {
            userItem.remove();
        }
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
            const localUserData = {
                name: 'You',
                ...data.userData
            };
            localUser = new User(data.userId, localUserData, true);
            setupLocalUser();
            break;
            
        case 'existingUsers':
            data.users.forEach(user => {
                if (user.userId !== currentUserId) {
                    const remoteUserData = {
                        name: user.userData.name || `User ${user.userId.substring(0, 8)}`,
                        ...user.userData
                    };
                    const remoteUser = new User(user.userId, remoteUserData, false);
                    remoteUsers.set(user.userId, remoteUser);
                }
            });
            break;
            
        case 'userJoined':
            if (data.userId !== currentUserId) {
                const remoteUserData = {
                    name: data.userData.name || `User ${data.userId.substring(0, 8)}`,
                    ...data.userData
                };
                const remoteUser = new User(data.userId, remoteUserData, false);
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

// Historical artist names for simulated users
const HISTORICAL_ARTISTS = [
    'Leonardo da Vinci', 'Vincent van Gogh', 'Pablo Picasso', 'Claude Monet',
    'Michelangelo', 'Salvador Dalí', 'Frida Kahlo', 'Henri Matisse',
    'Rembrandt', 'Georgia O\'Keeffe', 'Jackson Pollock', 'Andy Warhol',
    'Wassily Kandinsky', 'Edgar Degas', 'Pierre-Auguste Renoir', 'Gustav Klimt',
    'Paul Cézanne', 'Edvard Munch', 'Johannes Vermeer', 'Gustave Courbet',
    'Diego Velázquez', 'Francisco Goya', 'Édouard Manet', 'Paul Gauguin',
    'Marc Chagall', 'Joan Miró', 'René Magritte', 'Yves Klein',
    'Mark Rothko', 'Roy Lichtenstein', 'David Hockney', 'Jean-Michel Basquiat'
];

// ============================================================================
// SIMULATED USER CLASS
// ============================================================================

class SimulatedUser {
    constructor(userId) {
        this.userId = userId;
        this.name = this.getRandomArtistName();
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
        
        // Behavior patterns
        this.behaviorPattern = Math.random(); // 0-1, determines behavior type
        this.pathPoints = []; // For path following
        this.currentPathIndex = 0;
        this.drawingPattern = null; // 'circle', 'spiral', 'line', 'random'
        this.patternCenter = { x: this.x, y: this.y };
        this.patternRadius = 50 + Math.random() * 100;
        this.patternAngle = 0;
        
        // Create user
        const userData = {
            name: this.name,
            color: this.color,
            brushSize: this.brushSize,
            smoothing: this.smoothing,
            mode: 'draw',
            cursor: { x: this.x, y: this.y }
        };
        const user = new User(userId, userData, false);
        remoteUsers.set(userId, user);

        // Initialize tracking variables for stuck detection
        this.lastMoveTime = Date.now();
        this.lastPosition = { x: this.x, y: this.y };

        // Start simulation
        this.simulate();
    }
    
    getRandomArtistName() {
        const usedNames = Array.from(remoteUsers.values()).map(u => u.name);
        const availableNames = HISTORICAL_ARTISTS.filter(name => !usedNames.includes(name));
        if (availableNames.length === 0) {
            // If all names are used, add a number
            return HISTORICAL_ARTISTS[Math.floor(Math.random() * HISTORICAL_ARTISTS.length)] + 
                   ' ' + Math.floor(Math.random() * 100);
        }
        return availableNames[Math.floor(Math.random() * availableNames.length)];
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
        try {
            const user = remoteUsers.get(this.userId);
            if (!user) {
                console.warn(`SimulatedUser ${this.userId}: User not found, removing`);
                this.remove();
                return;
            }

            // Check for stuck condition - if position hasn't changed for too long
            const now = Date.now();
            if (!this.lastMoveTime) {
                this.lastMoveTime = now;
                this.lastPosition = { x: this.x, y: this.y };
            }

            // Reset if stuck for more than 10 seconds
            if (now - this.lastMoveTime > 10000) {
                console.log(`SimulatedUser ${this.userId}: Stuck detected, resetting position`);
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.targetX = this.x;
                this.targetY = this.y;
                this.pathPoints = [];
                this.currentPathIndex = 0;
                this.isDrawing = false;
                this.lastMoveTime = now;
                this.lastPosition = { x: this.x, y: this.y };
            }

            // Update settings occasionally
            this.updateSettings();

            // Choose behavior pattern based on behaviorPattern value
            if (this.behaviorPattern < 0.25) {
                // Pattern 1: Circular drawing
                this.simulateCircular();
            } else if (this.behaviorPattern < 0.5) {
                // Pattern 2: Spiral drawing
                this.simulateSpiral();
            } else if (this.behaviorPattern < 0.75) {
                // Pattern 3: Path following with drawing
                this.simulatePathFollowing();
            } else {
                // Pattern 4: Random wandering with varied drawing
                this.simulateRandomWander();
            }

            // Check if position actually changed
            const moved = Math.abs(this.x - this.lastPosition.x) > 0.1 || Math.abs(this.y - this.lastPosition.y) > 0.1;
            if (moved) {
                this.lastMoveTime = now;
                this.lastPosition = { x: this.x, y: this.y };
            }

            // Update cursor
            user.cursor = { x: this.x, y: this.y };
            user.updateCursorPosition();

            // Draw occasionally
            if (!this.isDrawing && Math.random() < debugParams.drawFreq) {
                this.startDrawing();
                // Choose drawing pattern
                const patterns = ['circle', 'spiral', 'line', 'random'];
                this.drawingPattern = patterns[Math.floor(Math.random() * patterns.length)];
                this.patternCenter = { x: this.x, y: this.y };
                this.patternRadius = 30 + Math.random() * 80;
                this.patternAngle = 0;
            }

            if (this.isDrawing) {
                this.continueDrawing();
            }

            requestAnimationFrame(() => this.simulate());
        } catch (error) {
            console.error(`SimulatedUser ${this.userId}: Error in simulate()`, error);
            // Try to recover by resetting
            try {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.targetX = this.x;
                this.targetY = this.y;
                this.pathPoints = [];
                this.currentPathIndex = 0;
                this.isDrawing = false;
                requestAnimationFrame(() => this.simulate());
            } catch (resetError) {
                console.error(`SimulatedUser ${this.userId}: Failed to reset after error`, resetError);
                this.remove();
            }
        }
    }
    
    simulateCircular() {
        // Move in a circular pattern
        this.patternAngle += 0.05 * debugParams.simSpeed;
        const radius = 80 + Math.sin(this.patternAngle * 2) * 30;
        this.x = this.patternCenter.x + Math.cos(this.patternAngle) * radius;
        this.y = this.patternCenter.y + Math.sin(this.patternAngle) * radius;

        // Clamp to canvas bounds
        this.x = Math.max(0, Math.min(canvas.width, this.x));
        this.y = Math.max(0, Math.min(canvas.height, this.y));

        // Occasionally change center
        if (Math.random() < 0.01) {
            this.patternCenter = {
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height
            };
        }
    }
    
    simulateSpiral() {
        // Move in a spiral pattern
        this.patternAngle += 0.03 * debugParams.simSpeed;
        this.patternRadius += 0.5;

        if (this.patternRadius > 200) {
            this.patternRadius = 20;
            this.patternCenter = {
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height
            };
        }

        this.x = this.patternCenter.x + Math.cos(this.patternAngle) * this.patternRadius;
        this.y = this.patternCenter.y + Math.sin(this.patternAngle) * this.patternRadius;

        // Clamp to canvas bounds
        this.x = Math.max(0, Math.min(canvas.width, this.x));
        this.y = Math.max(0, Math.min(canvas.height, this.y));
    }
    
    simulatePathFollowing() {
        // Follow a curved path
        if (this.pathPoints.length === 0 || this.currentPathIndex >= this.pathPoints.length) {
            // Generate new path
            this.pathPoints = [];
            const startX = Math.random() * canvas.width;
            const startY = Math.random() * canvas.height;
            const numPoints = 20 + Math.floor(Math.random() * 30);

            for (let i = 0; i < numPoints; i++) {
                const t = i / numPoints;
                const angle = Math.PI * 2 * t;
                const radius = 50 + Math.sin(t * Math.PI * 4) * 30;
                this.pathPoints.push({
                    x: startX + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
                    y: startY + Math.sin(angle) * radius + (Math.random() - 0.5) * 40
                });
            }
            // Ensure all path points are within canvas bounds
            this.pathPoints = this.pathPoints.map(point => ({
                x: Math.max(0, Math.min(canvas.width, point.x)),
                y: Math.max(0, Math.min(canvas.height, point.y))
            }));
            this.currentPathIndex = 0;
        }

        // Move toward current path point
        const target = this.pathPoints[this.currentPathIndex];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5) {
            this.currentPathIndex++;
        } else if (distance > 0.01) {
            const speed = debugParams.simSpeed * 2;
            const moveX = (dx / distance) * speed;
            const moveY = (dy / distance) * speed;

            // Apply movement and clamp to canvas bounds
            this.x += moveX;
            this.y += moveY;
            this.x = Math.max(0, Math.min(canvas.width, this.x));
            this.y = Math.max(0, Math.min(canvas.height, this.y));
        }
    }
    
    simulateRandomWander() {
        // Random wandering with occasional direction changes
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5 || Math.random() < 0.02) {
            // Pick new target, sometimes with bias toward center
            const bias = Math.random();
            if (bias < 0.3) {
                // Bias toward center
                this.targetX = canvas.width / 2 + (Math.random() - 0.5) * 200;
                this.targetY = canvas.height / 2 + (Math.random() - 0.5) * 200;
            } else {
                // Random target
                this.targetX = Math.random() * canvas.width;
                this.targetY = Math.random() * canvas.height;
            }
            // Ensure target is within bounds
            this.targetX = Math.max(0, Math.min(canvas.width, this.targetX));
            this.targetY = Math.max(0, Math.min(canvas.height, this.targetY));
        } else if (distance > 0.01) {
            // Move toward target with some variation (only if distance is safe)
            const speed = debugParams.simSpeed * 2;
            const variation = (Math.random() - 0.5) * 0.3;
            const moveX = (dx / distance) * speed * (1 + variation);
            const moveY = (dy / distance) * speed * (1 + variation);

            // Apply movement and clamp to canvas bounds
            this.x += moveX;
            this.y += moveY;
            this.x = Math.max(0, Math.min(canvas.width, this.x));
            this.y = Math.max(0, Math.min(canvas.height, this.y));
        }
    }
    
    startDrawing() {
        this.isDrawing = true;
        this.drawPoints = [{ x: this.x, y: this.y }];
    }
    
    continueDrawing() {
        if (!this.isDrawing) return;
        
        // Draw based on pattern
        if (this.drawingPattern === 'circle') {
            this.patternAngle += 0.1;
            const radius = this.patternRadius;
            const pointX = this.patternCenter.x + Math.cos(this.patternAngle) * radius;
            const pointY = this.patternCenter.y + Math.sin(this.patternAngle) * radius;
            this.drawPoints.push({ x: pointX, y: pointY });
            this.x = pointX;
            this.y = pointY;
            
            if (this.patternAngle >= Math.PI * 2) {
                this.finishDrawing();
            }
        } else if (this.drawingPattern === 'spiral') {
            this.patternAngle += 0.15;
            this.patternRadius += 1;
            const pointX = this.patternCenter.x + Math.cos(this.patternAngle) * this.patternRadius;
            const pointY = this.patternCenter.y + Math.sin(this.patternAngle) * this.patternRadius;
            this.drawPoints.push({ x: pointX, y: pointY });
            this.x = pointX;
            this.y = pointY;
            
            if (this.patternRadius > 150) {
                this.finishDrawing();
            }
        } else if (this.drawingPattern === 'line') {
            // Draw a line
            this.drawPoints.push({ x: this.x, y: this.y });
            if (this.drawPoints.length === 1) {
                // Start line
                this.lineTarget = {
                    x: this.x + (Math.random() - 0.5) * 200,
                    y: this.y + (Math.random() - 0.5) * 200
                };
            }
            
            const dx = this.lineTarget.x - this.x;
            const dy = this.lineTarget.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 5) {
                this.finishDrawing();
            } else {
                const speed = 3;
                this.x += (dx / distance) * speed;
                this.y += (dy / distance) * speed;
            }
        } else {
            // Random drawing
            this.drawPoints.push({ x: this.x, y: this.y });
            
            // Occasionally finish drawing
            if (this.drawPoints.length > 10 && Math.random() < 0.15) {
                this.finishDrawing();
            }
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
        
        // Apply smoothing if needed
        let pointsToDraw = this.drawPoints;
        if (user.smoothing > 0 && this.drawPoints.length > 2) {
            const smoothingFactor = user.smoothing / 100;
            const windowSize = Math.max(1, Math.floor(smoothingFactor * 10) + 1);
            let smoothed = [...this.drawPoints];
            const passes = Math.max(1, Math.floor(smoothingFactor * 3) + 1);
            
            for (let pass = 0; pass < passes; pass++) {
                const newSmoothed = [smoothed[0]];
                for (let i = 1; i < smoothed.length - 1; i++) {
                    const start = Math.max(0, i - windowSize);
                    const end = Math.min(smoothed.length - 1, i + windowSize);
                    let sumX = 0, sumY = 0, count = 0;
                    for (let j = start; j <= end; j++) {
                        const distance = Math.abs(j - i);
                        const weight = 1 / (1 + distance * smoothingFactor * 3);
                        sumX += smoothed[j].x * weight;
                        sumY += smoothed[j].y * weight;
                        count += weight;
                    }
                    newSmoothed.push({ x: sumX / count, y: sumY / count });
                }
                newSmoothed.push(smoothed[smoothed.length - 1]);
                smoothed = newSmoothed;
            }
            pointsToDraw = smoothed;
        }
        
        // Create path string
        let pathData = `M ${pointsToDraw[0].x} ${pointsToDraw[0].y}`;
        if (user.smoothing > 0 && pointsToDraw.length > 2) {
            for (let i = 1; i < pointsToDraw.length - 1; i++) {
                const midX = (pointsToDraw[i].x + pointsToDraw[i + 1].x) / 2;
                const midY = (pointsToDraw[i].y + pointsToDraw[i + 1].y) / 2;
                pathData += ` Q ${pointsToDraw[i].x} ${pointsToDraw[i].y} ${midX} ${midY}`;
            }
            pathData += ` L ${pointsToDraw[pointsToDraw.length - 1].x} ${pointsToDraw[pointsToDraw.length - 1].y}`;
        } else {
            for (let i = 1; i < pointsToDraw.length; i++) {
                pathData += ` L ${pointsToDraw[i].x} ${pointsToDraw[i].y}`;
            }
        }
        
        // Create and add path
        const path = new fabric.Path(pathData, {
            fill: '',
            stroke: user.color,
            strokeWidth: user.brushSize,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            selectable: false,
            evented: false
        });
        path.set('userId', this.userId);
        canvas.add(path);
        canvas.renderAll();
        
        // Send to other users
        sendWebSocketMessage('drawingUpdate', {
            path: pathData,
            action: 'add'
        });
        
        this.isDrawing = false;
        this.drawPoints = [];
    }
    
    remove() {
        const user = remoteUsers.get(this.userId);
        if (user) {
            user.remove();
            remoteUsers.delete(this.userId);
        }
        simulatedUsers.delete(this.userId);
        updateSimUserCount();
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
// USERS PANE MANAGEMENT
// ============================================================================

const usersPane = document.getElementById('usersPane');
const toggleUsersPane = document.getElementById('toggleUsersPane');

toggleUsersPane.addEventListener('click', () => {
    const isCollapsed = usersPane.classList.contains('collapsed');
    if (isCollapsed) {
        usersPane.classList.remove('collapsed');
        toggleUsersPane.textContent = '−';
    } else {
        usersPane.classList.add('collapsed');
        toggleUsersPane.textContent = '+';
    }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

setMode('draw');
connectWebSocket();

