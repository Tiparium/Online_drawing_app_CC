// ===== Screen + Room UI =====

// Screens
const mainMenu = document.getElementById('mainMenu');

// You have two elements with id="drawingScreen" in index.html.
// The one that actually contains the canvas is the second one (the one with .container),
// so we explicitly grab that one.
let drawingScreen = null;
(function () {
    const containerEl = document.querySelector('#drawingScreen .container');
    if (containerEl && containerEl.closest('.screen')) {
        drawingScreen = containerEl.closest('.screen');
    } else {
        drawingScreen = document.getElementById('drawingScreen');
    }
})();

function showScreen(screenEl) {
    const screens = document.querySelectorAll('.screen');
    for (const s of screens) {
        s.classList.remove('active');
    }
    if (screenEl) {
        screenEl.classList.add('active');
    }
}

// Modal + buttons
const createBtn         = document.getElementById('createWhiteboardBtn');
const createModal       = document.getElementById('createModal');
const cancelCreateBtn   = document.getElementById('cancelCreateBtn');
const confirmCreateBtn  = document.getElementById('confirmCreateBtn');
const whiteboardList    = document.getElementById('whiteboardList');
const backToMenuBtn     = document.getElementById('backToMenuBtn');

// In-memory rooms (for now – later these will come from the backend)
let rooms = [];
let nextRoomId = 1;
let currentRoom = null;

function normalizeRoom(room) {
    if (!room) return null;
    const id = room.roomId || room.id;
    return {
        id,
        roomId: id,
        name: room.name || 'Untitled',
        privacy: room.privacy || 'public',
        createdAt: room.createdAt || Date.now()
    };
}
// Allow overriding API/WS base via global for hosted frontends (e.g., S3 + separate backend)
const BOOT_CONFIG = (typeof window !== 'undefined' && window.__CONFIG) ? window.__CONFIG : {};
const API_BASE_RAW = (typeof window !== 'undefined' && (window.__API_BASE ?? BOOT_CONFIG.API_BASE)) ? (window.__API_BASE ?? BOOT_CONFIG.API_BASE) : '';
const WS_BASE_RAW = (typeof window !== 'undefined' && (window.__WS_BASE ?? BOOT_CONFIG.WS_BASE)) ? (window.__WS_BASE ?? BOOT_CONFIG.WS_BASE) : null;
const apiBaseNormalized = API_BASE_RAW.endsWith('/') ? API_BASE_RAW.slice(0, -1) : API_BASE_RAW;
const wsBaseNormalized = WS_BASE_RAW && WS_BASE_RAW.endsWith('/') ? WS_BASE_RAW.slice(0, -1) : WS_BASE_RAW;

async function apiGetRooms() {
    const res = await fetch(`${apiBaseNormalized}/api/rooms`);
    if (!res.ok) throw new Error(`rooms fetch failed: ${res.status}`);
    const data = await res.json();
    return (data.rooms || []).map(normalizeRoom).filter(Boolean);
}

async function apiCreateRoom(payload) {
    const res = await fetch(`${apiBaseNormalized}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`room create failed: ${res.status}`);
    const created = await res.json();
    return normalizeRoom(created);
}

async function apiGetRoomStrokes(roomId) {
    const res = await fetch(`${apiBaseNormalized}/api/rooms/${roomId}/strokes`);
    if (!res.ok) throw new Error(`strokes fetch failed: ${res.status}`);
    const data = await res.json();
    return data.strokes || [];
}

async function apiPersistStroke(roomId, stroke) {
    try {
        await fetch(`${apiBaseNormalized}/api/rooms/${roomId}/strokes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stroke)
        });
    } catch (err) {
        console.error('Failed to persist stroke', err);
    }
}

// Persist strokes via REST only when WebSocket persistence is unavailable (avoids double writes)
async function persistStrokeFallback(roomId, stroke) {
    if (!roomId || !stroke) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        return; // WebSocket path already persists in backend
    }
    await apiPersistStroke(roomId, stroke);
}

async function loadDeployCount() {
    if (!deployCounterEl) return;
    try {
        const res = await fetch(`${apiBaseNormalized}/api/deploy-count`);
        if (!res.ok) throw new Error('deploy count failed');
        const data = await res.json();
        const count = Number(data.count);
        deployCounterEl.textContent = `Deploy #${Number.isFinite(count) ? count : 0}`;
    } catch (err) {
        console.error('Failed to load deploy count', err);
        deployCounterEl.textContent = 'Deploy #?';
    }
}

// Open modal
if (createBtn && createModal) {
    createBtn.addEventListener('click', () => {
        createModal.style.display = 'flex';
        const nameInput = document.getElementById('whiteboardName');
        if (nameInput) {
            nameInput.value = '';
            nameInput.focus();
        }
    });
}

// Close modal
if (cancelCreateBtn && createModal) {
    cancelCreateBtn.addEventListener('click', () => {
        createModal.style.display = 'none';
    });
}

async function loadRooms() {
    try {
        rooms = await apiGetRooms();
        updateRoomList();
    } catch (err) {
        console.error('Failed to load rooms', err);
        alert('Failed to load rooms from backend.');
    }
}

// Create + join room
if (confirmCreateBtn && createModal) {
    confirmCreateBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('whiteboardName');
        const privacyInput = document.querySelector("input[name='privacy']:checked");

        const name = nameInput ? nameInput.value.trim() : '';
        const privacy = privacyInput ? privacyInput.value : 'public';

        if (!name) {
            alert('Please name your whiteboard.');
            if (nameInput) nameInput.focus();
            return;
        }

        apiCreateRoom({ name, privacy }).then(room => {
            rooms.push(room);
            updateRoomList();
            createModal.style.display = 'none';
            joinRoom(room.id || room.roomId);
        }).catch(err => {
            console.error('Room creation failed', err);
            alert('Failed to create room');
        });
    });
}

// Back button on drawing screen
if (backToMenuBtn) {
    backToMenuBtn.addEventListener('click', () => {
        if (currentRoom) {
            cleanupRoomState(currentRoom.id);
        }
        currentRoom = null;
        showScreen(mainMenu);
    });
}

function updateRoomList() {
    if (!whiteboardList) return;

    whiteboardList.innerHTML = '';

    if (rooms.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'no-whiteboards';
        empty.innerHTML = '<p>No whiteboards available yet. Create your first one!</p>';
        whiteboardList.appendChild(empty);
        return;
    }

    rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'whiteboard-card';

        const preview = document.createElement('div');
        preview.className = 'whiteboard-preview';
        const placeholder = document.createElement('span');
        placeholder.className = 'preview-placeholder';
        placeholder.textContent = '📝';
        preview.appendChild(placeholder);

        const info = document.createElement('div');
        info.className = 'whiteboard-info';
        const title = document.createElement('h3');
        title.textContent = room.name;
        const meta = document.createElement('p');
        meta.textContent = room.privacy === 'public' ? 'Public Room' : 'Private Room';
        info.appendChild(title);
        info.appendChild(meta);

        const joinBtn = document.createElement('button');
        joinBtn.className = 'join-btn';
        joinBtn.textContent = 'Join';
        joinBtn.addEventListener('click', () => joinRoom(room.id || room.roomId));

        card.appendChild(preview);
        card.appendChild(info);
        card.appendChild(joinBtn);

        whiteboardList.appendChild(card);
    });
}

function joinRoom(roomId) {
    const previousRoomId = currentRoom ? currentRoom.id : null;
    currentRoom = rooms.find(r => r.id === roomId || r.roomId === roomId) || null;

    if (previousRoomId && previousRoomId !== currentRoom.id) {
        cleanupRoomState(previousRoomId);
    }

    ensureLocalUser(currentRoom.id);
    applyRoomSettings(currentRoom.id);
    renderUsersForActiveRoom();
    loadRoomStrokes(currentRoom.id).then(() => {
        sendWebSocketMessage('joinRoom', { roomId: currentRoom.id });
        showScreen(drawingScreen);
    }).catch(() => {
        sendWebSocketMessage('joinRoom', { roomId: currentRoom.id });
        showScreen(drawingScreen);
    });
}

async function loadRoomStrokes(roomId) {
    try {
    const strokes = await apiGetRoomStrokes(roomId);
    resetCanvasState(roomId);
    strokes.forEach(stroke => {
        if (!stroke.path) return;
        const path = new fabric.Path(stroke.path, {
            fill: '',
            stroke: stroke.strokeColor || '#000000',
                strokeWidth: stroke.strokeWidth || 5,
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                selectable: false,
                evented: false
            });
            path.set('userId', stroke.userId || 'unknown');
            path.set('roomId', roomId);
            path.set('smoothing', stroke.smoothing || 0);
            canvas.add(path);
        });
        canvas.renderAll();
    } catch (err) {
        console.error('Failed to load strokes for room', roomId, err);
    }
}

function cleanupRoomState(roomId) {
    const cursors = getUserCursors(roomId);
    cursors.forEach(wrapper => wrapper.remove());
    cursors.clear();

    const simUsers = getSimulatedUsers(roomId);
    simUsers.forEach(sim => sim.remove());
    simUsers.clear();

    const remoteMap = getRemoteUsers(roomId);
    remoteMap.forEach(user => user.remove());
    remoteMap.clear();

    const usersList = document.getElementById('usersList');
    if (usersList) {
        usersList.innerHTML = '';
    }

    updateSimUserCount();
}

function renderUsersForActiveRoom() {
    const usersList = document.getElementById('usersList');
    if (usersList) {
        usersList.innerHTML = '';
    }

    const activeRoomId = getActiveRoomId();

    if (localUser) {
        localUser.roomId = activeRoomId;
        localUser.addToUsersPane();
    }

    const remoteMap = getRemoteUsers(activeRoomId);
    remoteMap.forEach(user => {
        user.roomId = activeRoomId;
        if (!user.isLocal) {
            user.createCursor();
        }
        user.addToUsersPane();
    });

    updateSimUserCount();
}

function applyRoomSettings(roomId) {
    const settings = getRoomSettings(roomId);
    if (colorPicker) colorPicker.value = settings.color;
    if (brushSize) {
        brushSize.value = settings.brushSize;
        brushSizeValue.textContent = settings.brushSize;
    }
    if (smoothingSlider) {
        smoothingSlider.value = settings.smoothing;
        smoothingValue.textContent = settings.smoothing;
    }

    if (localUser && localUser.brush) {
        localUser.roomId = roomId;
        localUser.updateSettings(settings.color, settings.brushSize, settings.smoothing, localUser.mode);
        canvas.freeDrawingBrush = localUser.brush;
        canvas.freeDrawingBrush.width = settings.brushSize;
        canvas.freeDrawingBrush.color = settings.color;
        canvas.freeDrawingBrush.setSmoothingLevel(settings.smoothing);
    }
    if (localUser && currentRoom && currentRoom.id === roomId) {
        sendWebSocketMessage('userSettings', {
            color: settings.color,
            brushSize: settings.brushSize,
            smoothing: settings.smoothing,
            mode: localUser.mode
        });
    }
}

function updateActiveRoomSettings(partialSettings) {
    const settings = getRoomSettings();
    Object.assign(settings, partialSettings);
}


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
const remoteUsersByRoom = new Map(); // roomId -> Map<userId, User>
const userCursorsByRoom = new Map(); // roomId -> Map<userId, cursorEl>
const simulatedUsersByRoom = new Map(); // roomId -> Map<userId, SimulatedUser>

function getActiveRoomId() {
    return currentRoom ? currentRoom.id : 'lobby';
}

function getRemoteUsers(roomId = getActiveRoomId()) {
    if (!remoteUsersByRoom.has(roomId)) {
        remoteUsersByRoom.set(roomId, new Map());
    }
    return remoteUsersByRoom.get(roomId);
}

function getUserCursors(roomId = getActiveRoomId()) {
    if (!userCursorsByRoom.has(roomId)) {
        userCursorsByRoom.set(roomId, new Map());
    }
    return userCursorsByRoom.get(roomId);
}

function getSimulatedUsers(roomId = getActiveRoomId()) {
    if (!simulatedUsersByRoom.has(roomId)) {
        simulatedUsersByRoom.set(roomId, new Map());
    }
    return simulatedUsersByRoom.get(roomId);
}

const roomSettings = new Map(); // roomId -> {color, brushSize, smoothing}

function getRoomSettings(roomId = getActiveRoomId()) {
    if (!roomSettings.has(roomId)) {
        roomSettings.set(roomId, {
            color: (defaultRoomSettings && defaultRoomSettings.color) || '#000000',
            brushSize: (defaultRoomSettings && defaultRoomSettings.brushSize) || 5,
            smoothing: (defaultRoomSettings && defaultRoomSettings.smoothing) || 0
        });
    }
    return roomSettings.get(roomId);
}

class User {
    constructor(userId, userData, isLocal = false, roomId = getActiveRoomId()) {
        this.userId = userId;
        this.roomId = roomId;
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
        if (this.isLocal || this.roomId !== getActiveRoomId()) return; // Only render for active room
        const cursors = getUserCursors(this.roomId);
        const existing = cursors.get(this.userId);
        if (existing) {
            existing.remove();
            cursors.delete(this.userId);
        }
        
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
        cursors.set(this.userId, wrapper); // Store wrapper instead of cursor
        this.updateCursorPosition();
    }
    
    updateCursorPosition() {
        const wrapper = getUserCursors(this.roomId).get(this.userId);
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
        
        const wrapper = getUserCursors(this.roomId).get(this.userId);
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
        if (this.roomId !== getActiveRoomId()) return;

        const existingItem = usersList.querySelector(`.user-item[data-user-id="${this.userId}"]`);
        if (existingItem) {
            existingItem.remove();
        }
        
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
        const wrapper = getUserCursors(this.roomId).get(this.userId);
        if (wrapper) {
            wrapper.remove();
        }
        getUserCursors(this.roomId).delete(this.userId);
        
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
            
            // Removed temp path rendering to avoid read-only issues with AWS S3
            // Smoothing is cached locally until stroke completion
            
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
            evented: false,
            // Mark as local-only to prevent S3 sync issues
            localOnly: true
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
        const roomId = getActiveRoomId();
        finalPath.set('roomId', roomId);
        finalPath.set('smoothing', this.smoothingLevel);
        finalPath.set('userId', localUser ? localUser.userId : 'local');
        
        // Cache stroke locally for this room so smoothing adjustments exist before persistence
        const cache = getStrokeCache(roomId);
        cache.pending.push({
            pathData,
            color: this.color,
            strokeWidth: this.width,
            smoothing: this.smoothingLevel,
            userId: localUser ? localUser.userId : 'local',
            timestamp: Date.now()
        });
        
        this.canvas.add(finalPath);
        this.canvas.renderAll();

        // Only send once stroke is finalized (after momentum finishes)
        if (localUser && currentRoom) {
            sendWebSocketMessage('drawingUpdate', {
                path: pathData,
                action: 'add',
                roomId,
                smoothing: this.smoothingLevel,
                strokeColor: this.color,
                strokeWidth: this.width
            });
            persistStrokeFallback(roomId, {
                path: pathData,
                strokeColor: this.color,
                strokeWidth: this.width,
                smoothing: this.smoothingLevel,
                userId: localUser.userId
            });
        }
        
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
    // Prefer configured WS base (can be wss://… or ws://…); otherwise same-origin
    const wsUrl = wsBaseNormalized || `${protocol}//${window.location.host}`;
    
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
    const targetRoomId = data.roomId || getActiveRoomId();
    const activeRoomId = getActiveRoomId();
    const isRoomScoped = ['existingUsers', 'existingUsersInRoom', 'userJoined', 'userLeft', 'cursorMove', 'drawingUpdate', 'userSettings', 'canvasCleared'].includes(data.type);
    if (isRoomScoped && data.roomId && data.roomId !== activeRoomId) {
        return;
    }

    switch (data.type) {
        case 'userConnected':
            currentUserId = data.userId;
            const localUserData = {
                name: 'You',
                ...data.userData
            };
            localUser = new User(data.userId, localUserData, true, activeRoomId);
            setupLocalUser();
            break;
            
        case 'existingUsers':
            data.users.forEach(user => {
                if (user.userId !== currentUserId) {
                    const remoteUserData = {
                        name: user.userData.name || `User ${user.userId.substring(0, 8)}`,
                        ...user.userData
                    };
                    const remoteUser = new User(user.userId, remoteUserData, false, targetRoomId);
                    getRemoteUsers(targetRoomId).set(user.userId, remoteUser);
                }
            });
            break;
        
        case 'existingUsersInRoom':
            if (data.roomId !== activeRoomId) break;
            data.users.forEach(user => {
                if (user.userId !== currentUserId) {
                    if (getRemoteUsers(data.roomId).has(user.userId)) return;
                    const remoteUserData = {
                        name: user.userData.name || `User ${user.userId.substring(0, 8)}`,
                        ...user.userData
                    };
                    const remoteUser = new User(user.userId, remoteUserData, false, data.roomId);
                    getRemoteUsers(data.roomId).set(user.userId, remoteUser);
                }
            });
            renderUsersForActiveRoom();
            break;
            
        case 'userJoined':
            if (data.userId !== currentUserId && data.roomId === activeRoomId) {
                if (getRemoteUsers(targetRoomId).has(data.userId)) break;
                const remoteUserData = {
                    name: data.userData.name || `User ${data.userId.substring(0, 8)}`,
                    ...data.userData
                };
                const remoteUser = new User(data.userId, remoteUserData, false, targetRoomId);
                getRemoteUsers(targetRoomId).set(data.userId, remoteUser);
            }
            renderUsersForActiveRoom();
            break;
            
        case 'userLeft':
            if (data.roomId && data.roomId !== activeRoomId) break;
            const user = getRemoteUsers(targetRoomId).get(data.userId);
            if (user) {
                user.remove();
                getRemoteUsers(targetRoomId).delete(data.userId);
                renderUsersForActiveRoom();
            }
            break;
            
        case 'cursorMove':
            const remoteUser = getRemoteUsers(targetRoomId).get(data.userId);
            if (remoteUser) {
                remoteUser.cursor = data.cursor;
                remoteUser.updateCursorPosition();
            }
            break;
            
        case 'drawingUpdate':
            handleRemoteDrawing(data.userId, data.path, data.action, targetRoomId, data.strokeColor, data.strokeWidth, data.smoothing);
            break;

        case 'canvasCleared':
            applyRemoteCanvasRedraw(targetRoomId);
            break;
    }
}

function sendWebSocketMessage(type, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const payload = {
            type,
            roomId: currentRoom ? currentRoom.id : null,
            ...data
        };
        ws.send(JSON.stringify(payload));
    }
}

// ============================================================================
// REMOTE DRAWING HANDLING
// ============================================================================

function handleRemoteDrawing(userId, pathData, action, roomId = getActiveRoomId(), strokeColor = null, strokeWidth = null, smoothing = 0) {
    if (roomId !== getActiveRoomId()) return;
    const user = getRemoteUsers(roomId).get(userId);
    if (!user) return;
    
    if (action === 'add' && pathData) {
        const path = new fabric.Path(pathData, {
            fill: '',
            stroke: strokeColor || user.color,
            strokeWidth: strokeWidth || user.brushSize,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            selectable: false,
            evented: false
        });
        path.set('userId', userId);
        path.set('roomId', roomId);
        path.set('smoothing', smoothing || user.smoothing || 0);
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

    updateActiveRoomSettings({
        color: localUser.color,
        brushSize: localUser.brushSize,
        smoothing: localUser.smoothing
    });
    applyRoomSettings(getActiveRoomId());

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
const deployCounterEl = document.getElementById('deployCounter');
const strokeCachesByRoom = new Map(); // roomId -> { pending: [] }
let defaultRoomSettings = null;

function initDefaultRoomSettings() {
    if (defaultRoomSettings) return;
    defaultRoomSettings = {
        color: colorPicker ? colorPicker.value : '#000000',
        brushSize: brushSize ? parseInt(brushSize.value, 10) || 5 : 5,
        smoothing: smoothingSlider ? parseInt(smoothingSlider.value, 10) || 0 : 0
    };
}

initDefaultRoomSettings();

function getStrokeCache(roomId = getActiveRoomId()) {
    if (!strokeCachesByRoom.has(roomId)) {
        strokeCachesByRoom.set(roomId, { pending: [] });
    }
    return strokeCachesByRoom.get(roomId);
}

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
    updateActiveRoomSettings({ brushSize: size });
    if (localUser && localUser.brush) {
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
    updateActiveRoomSettings({ color });
    if (localUser && localUser.brush) {
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
    updateActiveRoomSettings({ smoothing });
    if (localUser && localUser.brush) {
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
    if (localUser && isConnected && currentRoom) {
        const pointer = canvas.getPointer(e.e);
        localUser.cursor = { x: pointer.x, y: pointer.y };
        sendWebSocketMessage('cursorMove', {
            cursor: localUser.cursor
        });
    }
});

function resetCanvasState(roomId = getActiveRoomId()) {
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.renderAll();
    const cache = getStrokeCache(roomId);
    if (cache) {
        cache.pending = [];
    }
}

async function persistCanvasClear(roomId = getActiveRoomId()) {
    if (!roomId) return;
    try {
        await fetch(`${apiBaseNormalized}/api/rooms/${roomId}/strokes`, { method: 'DELETE' });
    } catch (err) {
        console.error('Failed to persist canvas clear', err);
    }
}

async function pushCanvasRedrawToRoom(roomId = getActiveRoomId()) {
    if (!roomId) return;
    await persistCanvasClear(roomId);
    // Notify peers via WebSocket; if disconnected, local clear still persisted
    sendWebSocketMessage('clearCanvas', { roomId });
}

function applyRemoteCanvasRedraw(roomId = getActiveRoomId()) {
    if (roomId !== getActiveRoomId()) return;
    resetCanvasState(roomId);
}

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
                const roomId = currentRoom ? currentRoom.id : null;
            const payload = {
                path: rect.path,
                action: 'add',
                roomId,
                strokeColor: rect.stroke,
                strokeWidth: rect.strokeWidth,
                smoothing: localUser ? localUser.smoothing : 0
            };
            sendWebSocketMessage('drawingUpdate', payload);
            if (roomId) {
                persistStrokeFallback(roomId, {
                    path: rect.path,
                    strokeColor: rect.stroke,
                    strokeWidth: rect.strokeWidth,
                    smoothing: localUser ? localUser.smoothing : 0,
                    userId: localUser ? localUser.userId : 'local'
                });
            }
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
                const roomId = currentRoom ? currentRoom.id : null;
            const payload = {
                path: circle.path,
                action: 'add',
                roomId,
                strokeColor: circle.stroke,
                strokeWidth: circle.strokeWidth,
                smoothing: localUser ? localUser.smoothing : 0
            };
            sendWebSocketMessage('drawingUpdate', payload);
            if (roomId) {
                persistStrokeFallback(roomId, {
                    path: circle.path,
                    strokeColor: circle.stroke,
                    strokeWidth: circle.strokeWidth,
                    smoothing: localUser ? localUser.smoothing : 0,
                    userId: localUser ? localUser.userId : 'local'
                });
            }
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
    const roomId = getActiveRoomId();
    const confirmed = confirm('Are you sure you want to clear the canvas for everyone in this whiteboard?');
    if (!confirmed) return;

    resetCanvasState(roomId);
    pushCanvasRedrawToRoom(roomId);
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

if (debugBtn && debugPanel) {
    debugBtn.addEventListener('click', () => {
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
    });
}

if (simSpeedSlider && simSpeedValue) {
    simSpeedSlider.addEventListener('input', (e) => {
        debugParams.simSpeed = parseInt(e.target.value);
        simSpeedValue.textContent = debugParams.simSpeed;
        updateSimUsers();
    });
}

if (drawFreqSlider && drawFreqValue) {
    drawFreqSlider.addEventListener('input', (e) => {
        debugParams.drawFreq = parseFloat(e.target.value);
        drawFreqValue.textContent = debugParams.drawFreq;
        updateSimUsers();
    });
}

if (settingsFreqSlider && settingsFreqValue) {
    settingsFreqSlider.addEventListener('input', (e) => {
        debugParams.settingsFreq = parseFloat(e.target.value);
        settingsFreqValue.textContent = debugParams.settingsFreq;
        updateSimUsers();
    });
}

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
    constructor(userId, roomId = getActiveRoomId()) {
        this.userId = userId;
        this.roomId = roomId;
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
        const user = new User(userId, userData, false, this.roomId);
        getRemoteUsers(this.roomId).set(userId, user);

        // Initialize tracking variables for stuck detection
        this.lastMoveTime = Date.now();
        this.lastPosition = { x: this.x, y: this.y };

        // Start simulation
        this.simulate();
    }
    
    getRandomArtistName() {
        const usedNames = Array.from(getRemoteUsers(this.roomId).values()).map(u => u.name);
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
            
            const user = getRemoteUsers(this.roomId).get(this.userId);
            if (user) {
                user.updateSettings(this.color, this.brushSize, this.smoothing, 'draw');
            }
        }
    }
    
    simulate() {
        try {
            const user = getRemoteUsers(this.roomId).get(this.userId);
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
        const user = getRemoteUsers(this.roomId).get(this.userId);
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
        path.set('roomId', this.roomId);
        canvas.add(path);
        canvas.renderAll();
        
        // Send to other users
        const payload = {
            path: pathData,
            action: 'add',
            roomId: this.roomId,
            smoothing: user.smoothing || 0,
            strokeColor: user.color,
            strokeWidth: user.brushSize
        };
        sendWebSocketMessage('drawingUpdate', payload);
        persistStrokeFallback(this.roomId, {
            path: pathData,
            strokeColor: user.color,
            strokeWidth: user.brushSize,
            smoothing: user.smoothing || 0,
            userId: this.userId
        });
        
        this.isDrawing = false;
        this.drawPoints = [];
    }
    
    remove() {
        const user = getRemoteUsers(this.roomId).get(this.userId);
        if (user) {
            user.remove();
            getRemoteUsers(this.roomId).delete(this.userId);
        }
        getSimulatedUsers(this.roomId).delete(this.userId);
        updateSimUserCount();
    }
}

function updateSimUsers() {
    const activeRoomId = getActiveRoomId();
    getSimulatedUsers(activeRoomId).forEach(sim => {
        // Parameters are used in simulate() method
    });
}

if (addSimUserBtn) {
    addSimUserBtn.addEventListener('click', () => {
        const userId = 'sim_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const activeRoomId = getActiveRoomId();
        const simUser = new SimulatedUser(userId, activeRoomId);
        getSimulatedUsers(activeRoomId).set(userId, simUser);
        updateSimUserCount();
    });
}

if (removeSimUserBtn) {
    removeSimUserBtn.addEventListener('click', () => {
        const activeRoomId = getActiveRoomId();
        const simUsers = getSimulatedUsers(activeRoomId);
        if (simUsers.size > 0) {
            const firstUserId = simUsers.keys().next().value;
            const simUser = simUsers.get(firstUserId);
            if (simUser) {
                simUser.remove();
                simUsers.delete(firstUserId);
                updateSimUserCount();
            }
        }
    });
}

function updateSimUserCount() {
    if (!simUserCount) return;
    const activeRoomId = getActiveRoomId();
    const simUsers = getSimulatedUsers(activeRoomId);
    simUserCount.textContent = `Simulated Users: ${simUsers.size}`;
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

async function initApp() {
    setMode('draw');
    connectWebSocket();
    await Promise.all([loadRooms(), loadDeployCount()]);
}

// Expose a start hook so Cognito login can gate initialization
window.startDrawingApp = async function () {
    if (window.__drawingAppStarted) return;
    window.__drawingAppStarted = true;
    await initApp();
};

if (window.__authReady && typeof window.startDrawingApp === 'function') {
    window.startDrawingApp();
}

// Fallback local user for single-player/offline scenarios
function ensureLocalUser(roomId = getActiveRoomId()) {
    if (localUser) {
        localUser.roomId = roomId;
        return localUser;
    }
    const settings = getRoomSettings(roomId);
    const userData = {
        name: 'You',
        color: settings.color,
        brushSize: settings.brushSize,
        smoothing: settings.smoothing,
        mode: currentMode,
        cursor: { x: 0, y: 0 }
    };
    localUser = new User(`local_${Date.now()}`, userData, true, roomId);
    setupLocalUser();
    return localUser;
}
