require('dotenv').config();

const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, shell, desktopCapturer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const os = require('os');

// ==================== CONFIGURATION ====================
const API_BASE_URL = 'http://13.125.5.67:8080';
const GOOGLE_CLIENT_ID = '862842547000-8vtpbvn6hea2m6ugid09t3qbvr99ph9q.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''; // TODO: 환경 변수로 관리하거나 비밀 키를 별도로 주입하세요
const ENABLE_DB_SYNC = true; // Enable DB sync


// Character name Korean mapping (English -> Korean)
const CHARACTER_NAME_KR = {
    // Level 1
    'marupitchi': '마루피치',
    'shizukutchi': '시즈쿠치',
    // Level 2
    'chiroritchi': '치로리치',
    'hoshipontchi': '호시폰치',
    'mokumokutchi': '모쿠모쿠치',
    'peacetchi': '피스치',
    // Level 3
    'kuchipatchi': '쿠치파치',
    'lovelitchi': '러블리치',
    'mametchi': '마메치',
    'memetchi': '메메치'
};

function getKoreanName(englishName) {
    if (!englishName) return '알';
    const lower = englishName.toLowerCase();
    return CHARACTER_NAME_KR[lower] || englishName;
}

function toRenderableImage(src) {
    if (!src) return src;
    if (typeof src === 'string' && src.startsWith('file:')) return src;
    try {
        return fs.existsSync(src) ? pathToFileURL(src).toString() : src;
    } catch (e) {
        return src;
    }
}

// Window references
let loginWindow = null;
let mainWindow = null;
let homeWindow = null;
let houseWindow = null;
let characterWindow = null;
let playWindow = null;
let characterState = { isReturningHome: false, isFocusMode: false, isExiting: false, isSleeping: false };
let tray = null;

// User state
let currentUser = null;
let isGameRunning = false;
let playerStats = null;
let petHistory = []; // Archive for dead pets
// 5 minutes cooldown (Disabled for testing)
// 5 minutes cooldown (Disabled for testing)
const PLAY_COOLDOWN = 0;
// Dynamic user data path based on logged-in user
function getUserDataPath() {
    if (!currentUser || !currentUser.id) return null;
    // Sanitize ID just in case
    const safeId = currentUser.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(app.getPath('userData'), `user-data-${safeId}.json`);
}
// Common device data (shared across users on this machine)
const deviceDataPath = path.join(app.getPath('userData'), 'device-data.json');
const authDataPath = path.join(app.getPath('userData'), 'auth-data.json');

const PLACES = [
    { id: 'house1', name: '집 1', icon: '🏠', model: 'house1.glb' },
    { id: 'house2', name: '집 2', icon: '🏠', model: 'house2.glb' },
    { id: 'house3', name: '집 3', icon: '🏠', model: 'house3.glb' },
    { id: 'house4', name: '집 4', icon: '🏠', model: 'house4.glb' },
    { id: 'house5', name: '집 5', icon: '🏠', model: 'house5.glb' },
    { id: 'house6', name: '집 6', icon: '🏠', model: 'house6.glb' },
    { id: 'park', name: '공원', icon: '🌿', model: 'park.glb' },
    { id: 'park2', name: '공원 2', icon: '🌿', model: 'park2.glb' },
    { id: 'bakery', name: '빵집', icon: '🥐', model: 'bakery.glb' },
    { id: 'pharmacy', name: '약국', icon: '💊', model: 'pharmacy.glb' },
    { id: 'school', name: '학교', icon: '🏫', model: 'school.glb' },
    { id: 'police', name: '경찰서', icon: '🚓', model: 'police_station.glb' },
    { id: 'gym', name: '헬스장', icon: '🏋️', model: 'gym.glb' },
    { id: 'toilet', name: '화장실', icon: '🚽', model: 'toilet.glb' },
    { id: 'cradle', name: '요람', icon: '🛏️', model: 'cradle.glb' },
];

const INITIAL_STATS = {
    happiness: 50,
    lastPlayTime: 0,
    level: 0,
    clickCount: 0,
    evolutionProgress: 0,
    characterImage: path.join(__dirname, 'assets/level0/level0.png'),
    evolutionHistory: [],
    lastEvolutionTime: Date.now(),
    hp: 100,
    lastFedTime: Date.now(),
    lastHungerDamageTime: Date.now(),
    lastAgingTime: Date.now(),
    birthday: Date.now(),
    discoveredPlaces: []
};

function getPlaceById(id) {
    return PLACES.find((p) => p.id === id) || PLACES[0];
}

function pickRandomPlace() {
    const idx = Math.floor(Math.random() * PLACES.length);
    return PLACES[idx];
}

function loadUserData() {
    playerStats = { ...INITIAL_STATS };
    petHistory = [];

    try {

        const dataPath = getUserDataPath();
        if (dataPath && fs.existsSync(dataPath)) {
            const fileData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            if (fileData) {
                if (fileData.activePet) {
                    // New nested format
                    playerStats = { ...INITIAL_STATS, ...fileData.activePet };
                    petHistory = fileData.petHistory || [];
                } else {
                    // Old flat format (migration)
                    playerStats = { ...INITIAL_STATS, ...fileData };
                }

                // Ensure birthday exists for migration
                if (!playerStats.birthday) {
                    playerStats.birthday = playerStats.lastEvolutionTime || Date.now();
                }
                if (!Array.isArray(playerStats.discoveredPlaces)) {
                    playerStats.discoveredPlaces = [];
                }

                console.log('Loaded user data. Active Pet:', playerStats.characterName, 'History count:', petHistory.length);
            }
        }
    } catch (e) {
        console.error('Failed to load user data:', e);
    }
}

function saveUserData() {
    try {
        const dataToSave = {
            activePet: playerStats,
            petHistory: petHistory
        };
        const dataPath = getUserDataPath();
        if (dataPath) {
            fs.writeFileSync(dataPath, JSON.stringify(dataToSave, null, 2), 'utf8');
            console.log(`Saved user data for ${currentUser.displayName} (including history)`);
        }
    } catch (e) {
        console.error('Failed to save user data:', e);
    }
}

// ==================== AUTH DATA PERSISTENCE ====================// Save auth data
function saveAuthData(user, tokens) {
    try {
        let existingTokens = {};
        const oldData = loadAuthData();
        if (oldData && oldData.tokens) {
            existingTokens = oldData.tokens;
        }

        const data = {
            user: user,
            tokens: {
                ...tokens,
                // Preserve refresh token if not provided in new tokens (Google sometimes omits it on re-auth)
                refreshToken: tokens.refreshToken || existingTokens.refreshToken
            }
        };
        fs.writeFileSync(authDataPath, JSON.stringify(data, null, 2));
        console.log('Auth data saved');
    } catch (e) {
        console.error('Failed to save auth data:', e);
    }
}

function loadAuthData() {
    try {
        if (fs.existsSync(authDataPath)) {
            const data = JSON.parse(fs.readFileSync(authDataPath, 'utf8'));
            if (data && data.user && data.tokens) {
                return data;
            }
        }
    } catch (e) {
        console.error('Failed to load auth data:', e);
    }
    return null;
}

function clearAuthData() {
    try {
        if (fs.existsSync(authDataPath)) {
            fs.unlinkSync(authDataPath);
            console.log('Auth data cleared');
        }
    } catch (e) {
        console.error('Failed to clear auth data:', e);
    }
}

async function tryAutoLogin() {
    const authData = loadAuthData();
    if (!authData) return false;

    try {
        // Use stored auth data directly (don't refresh on every startup)
        currentUser = authData.user;
        global.authTokens = authData.tokens;

        console.log('Auto-login successful (cached):', currentUser.displayName);
        return true;
    } catch (err) {
        console.error('Auto-login failed:', err.message);
        clearAuthData();
        return false;
    }
}

// ==================== CHARACTER API FUNCTIONS ====================
// Get authorization header
function getAuthHeader() {
    if (global.authTokens && global.authTokens.accessToken) {
        return { Authorization: `Bearer ${global.authTokens.accessToken}` };
    }
    return {};
}

// Create character in DB
async function createCharacterInDB(name, species, personality, isRetry = false) {
    try {
        const response = await axios.post(`${API_BASE_URL}/characters`, {
            name,
            species,
            personality: personality || ''
        }, { headers: getAuthHeader() });

        console.log('Character created in DB:', response.data.id);
        return response.data;
    } catch (err) {
        if (err.response && (err.response.status === 401 || err.response.status === 403) && !isRetry) {
            console.log('[DB] Token expired (create), restoring...');
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                return createCharacterInDB(name, species, personality, true);
            }
        }
        console.error('Failed to create character in DB:', err.response?.data || err.message);
        return null;
    }
}

// Get characters from DB
async function getCharactersFromDB(isRetry = false) {
    try {
        const response = await axios.get(`${API_BASE_URL}/characters`, {
            headers: getAuthHeader()
        });
        return response.data;
    } catch (err) {
        if (err.response && (err.response.status === 401 || err.response.status === 403) && !isRetry) {
            console.log('[DB] Token expired (get), restoring...');
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                return getCharactersFromDB(true);
            }
        }
        console.error('Failed to get characters from DB:', err.response?.data || err.message);
        return [];
    }
}

// Generic API request helper with token refresh
async function apiRequest(config, isRetry = false) {
    try {
        const response = await axios({
            ...config,
            headers: {
                ...(config.headers || {}),
                ...getAuthHeader()
            }
        });
        return response.data;
    } catch (err) {
        const status = err.response?.status;
        if ((status === 401 || status === 403) && !isRetry) {
            console.log('[API] Token expired, attempting refresh...');
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                return apiRequest(config, true);
            }
        }
        console.error('[API] Request failed:', err.response?.data || err.message);
        throw err;
    }
}

// Update character in DB
async function updateCharacterInDB(characterId, updates, isRetry = false) {
    try {
        const response = await axios.patch(`${API_BASE_URL}/characters/${characterId}`, updates, {
            headers: getAuthHeader()
        });
        // console.log('Character updated in DB');
        return response.data;
    } catch (err) {
        if (err.response && (err.response.status === 401 || err.response.status === 403) && !isRetry) {
            console.log('[DB] Token expired (update), restoring...');
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                return updateCharacterInDB(characterId, updates, true);
            }
        }
        console.error('Failed to update character in DB:', err.response?.data || err.message);
        return null;
    }
}

// ==================== FRIEND API ====================
async function searchCharacters(query) {
    if (!query || !query.trim()) return [];
    return apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/characters/search`,
        params: { query: query.trim(), limit: 20 }
    });
}

async function sendFriendRequest(characterId, targetCharacterId, message) {
    return apiRequest({
        method: 'POST',
        url: `${API_BASE_URL}/characters/${characterId}/friend-requests`,
        data: { targetCharacterId, message }
    });
}

async function getFriendRequests(characterId, direction = 'incoming', status = 'PENDING') {
    return apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/characters/${characterId}/friend-requests`,
        params: { direction, status }
    });
}

async function acceptFriendRequest(characterId, requestId) {
    return apiRequest({
        method: 'POST',
        url: `${API_BASE_URL}/characters/${characterId}/friend-requests/${requestId}/accept`
    });
}

async function rejectFriendRequest(characterId, requestId) {
    return apiRequest({
        method: 'POST',
        url: `${API_BASE_URL}/characters/${characterId}/friend-requests/${requestId}/reject`
    });
}

async function getFriends(characterId) {
    return apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/characters/${characterId}/friends`
    });
}

async function sendFriendMessage(characterId, friendCharacterId, messageText, emoteId) {
    return apiRequest({
        method: 'POST',
        url: `${API_BASE_URL}/characters/${characterId}/friends/${friendCharacterId}/messages`,
        data: { messageText, emoteId }
    });
}

// Call LLM API (with optional screenshot)
// Call LLM API (with optional screenshot)
// Refresh Backend Access Token
async function refreshAccessToken() {
    console.log('[Auth] Refreshing access token via Backend...');
    try {
        if (!global.authTokens || !global.authTokens.refreshToken) {
            throw new Error('No refresh token available');
        }

        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refreshToken: global.authTokens.refreshToken,
            deviceId: getDeviceId()
        });

        const newAuthResponse = response.data;
        global.authTokens.accessToken = newAuthResponse.accessToken;

        // If backend issues a new refresh token (rotation), update it
        if (newAuthResponse.refreshToken) {
            global.authTokens.refreshToken = newAuthResponse.refreshToken;
        }
        global.authTokens.expiresIn = newAuthResponse.expiresIn;

        // Save new tokens
        saveAuthData(currentUser, global.authTokens);
        console.log('[Auth] Token refreshed successfully');
        return true;
    } catch (err) {
        console.error('[Auth] Failed to refresh token:', err.message);
        if (err.response) {
            console.error('[Auth] Error details:', JSON.stringify(err.response.data));
        }

        // If refresh fails (e.g. invalid grant), clear auth data so user logs in again next time
        if (err.response && (err.response.status === 400 || err.response.status === 401)) {
            console.error('[Auth] Refresh token invalid. Clearing auth data to force re-login.');
            clearAuthData();
            global.authTokens = null; // Stop further API calls in this session

            // Force logout UI
            if (currentUser) {
                console.log('[Auth] Forcing logout due to invalid token...');
                ipcMain.emit('logout');
            }
        }
        return false;
    }
}

// Call LLM API (with optional screenshot)
async function callLlmApi(characterId, userMessage, context, screenshotBuffer, isRetry = false) {
    try {
        console.log(`[LLM] Calling API for CharID: ${characterId} (Has Screenshot: ${!!screenshotBuffer})`);

        let url = `${API_BASE_URL}/llm/generate`;
        let options = {
            method: 'POST',
            headers: getAuthHeader()
        };

        if (screenshotBuffer) {
            // Multipart Request for Screenshot
            const formData = new FormData();
            formData.append('characterId', characterId);
            if (userMessage) formData.append('userMessage', userMessage);

            const blob = new Blob([screenshotBuffer], { type: 'image/png' });
            formData.append('screenshot', blob, 'screenshot.png');

            options.body = formData;
        } else {
            // JSON Request (Text Only)
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify({
                characterId,
                userMessage: userMessage || '',
                context: context || {}
            });
        }

        const response = await fetch(url, options);

        if (response.status === 401 || response.status === 403) {
            if (!isRetry) {
                console.log('[LLM] Token expired, attempting refresh...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    return callLlmApi(characterId, userMessage, context, screenshotBuffer, true);
                }
            }
        }

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[LLM] API Error ${response.status}:`, errText);
            throw new Error(`API Error ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (err) {
        console.error('[LLM] Request failed:', err.message);
        return null;
    }
}

// Sync local character to DB
async function syncCharacterToDB() {
    if (!ENABLE_DB_SYNC) return;
    if (!playerStats || !global.authTokens) return;

    // Only sync if character is born (Level > 0)
    if (playerStats.level === 0 || !playerStats.characterName) {
        // console.log('[DB Sync] Character not born yet (Egg). Skipping...');
        return;
    }

    // Check if we already have a characterId stored
    if (!playerStats.dbCharacterId) {
        // Try to get existing characters first
        const existingChars = await getCharactersFromDB();
        if (existingChars.length > 0) {
            // Use the first alive character
            const aliveChar = existingChars.find(c => c.isAlive) || existingChars[0];
            playerStats.dbCharacterId = aliveChar.id;
            playerStats.lastSyncedStageIndex = aliveChar.stageIndex ?? aliveChar.stage_index ?? 0;
            console.log('Linked to existing DB character:', aliveChar.id);
        } else {
            // Create new character
            // Use Korean name for name, but hardcode species to '고양이' (Cat) to avoid backend 500 error
            // It seems backend only accepts specific species enum or existing values.
            const koreanName = getKoreanName(playerStats.characterName);
            const newChar = await createCharacterInDB(
                koreanName || '새 친구',
                '고양이', // species (Fixed to valid value)
                '다마고치 스타일 캐릭터'
            );
            if (newChar) {
                playerStats.dbCharacterId = newChar.id;
            }
        }
        saveUserData();
    }

    // Update character stats in DB
    if (playerStats.dbCharacterId) {
        const safeStageIndex = Math.max(
            playerStats.level || 0,
            playerStats.lastSyncedStageIndex || 0
        );

        const updated = await updateCharacterInDB(playerStats.dbCharacterId, {
            happiness: playerStats.happiness,
            health: playerStats.hp,
            stageIndex: safeStageIndex,
            lastFedAt: playerStats.lastFedTime ? new Date(playerStats.lastFedTime).toISOString() : null,
            lastPlayedAt: playerStats.lastPlayTime ? new Date(playerStats.lastPlayTime).toISOString() : null
        });

        if (updated && typeof updated.stageIndex === 'number') {
            playerStats.lastSyncedStageIndex = updated.stageIndex;
        } else {
            playerStats.lastSyncedStageIndex = safeStageIndex;
        }
    }
}

async function getOrSyncCharacterId() {
    if (!playerStats) return null;
    if (!playerStats.dbCharacterId) {
        await syncCharacterToDB();
    }
    return playerStats.dbCharacterId || null;
}


// ==================== LOGIN WINDOW ====================
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 300,
        height: 400, // Reverted to original size
        resizable: false,
        frame: false,
        transparent: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    loginWindow.loadFile('login.html');
    loginWindow.on('closed', () => loginWindow = null);
}

// ==================== MAIN SCREEN WINDOW ====================
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 350,
        height: 550,
        resizable: false,
        frame: false,
        fullscreenable: false, // Prevent Mac fullscreen
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    mainWindow.loadFile('main-screen.html');

    // Send initial state when loaded
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('update-ui-state', { isGameRunning });
        const renderable = toRenderableImage(playerStats?.characterImage);
        if (renderable) {
            mainWindow.webContents.send('update-image', renderable);
        }
    });

    mainWindow.on('closed', () => mainWindow = null);
}

// ==================== NAVIGATION ====================
ipcMain.on('open-memorial', () => {
    if (mainWindow) {
        mainWindow.loadFile('memorial.html');
    }
});

ipcMain.on('go-to-main', () => {
    if (mainWindow) {
        mainWindow.loadFile('main-screen.html');
    }
});

ipcMain.handle('get-ui-state', () => {
    return { isGameRunning };
});

ipcMain.handle('get-pet-history', () => {
    // Keep original characterName for image path, add displayName for Korean
    return petHistory.map(pet => ({
        ...pet,
        displayName: getKoreanName(pet.characterName)
    }));
});

ipcMain.handle('reset-game', () => {
    // 1. Archive current dead pet into history
    if (playerStats) {
        // Add death timestamp or mark it
        const deadPet = { ...playerStats, deathTime: Date.now() };
        petHistory.push(deadPet);
    }

    // 2. Reset to initial state for a NEW pet
    playerStats = {
        ...INITIAL_STATS,
        lastEvolutionTime: Date.now(),
        lastFedTime: Date.now(),
        lastHungerDamageTime: Date.now()
    };

    saveUserData();
    return { success: true };
});

function handleDeath() {
    if (characterWindow) {
        characterWindow.close();
        characterWindow = null;
    }
    console.log('--- CHARACTER HAS DIED ---');
}

// ==================== HOME ICON WINDOW ====================
function createHomeWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    homeWindow = new BrowserWindow({
        width: 140,
        height: 140,
        x: 20,
        y: height - 160,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        visibleOnAllWorkspaces: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // Keep home behind the character window
    homeWindow.setAlwaysOnTop(true, 'floating');

    if (process.platform === 'darwin') {
        homeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        homeWindow.setAlwaysOnTop(true, 'floating');
    }

    homeWindow.loadFile('home.html');
    homeWindow.on('closed', () => homeWindow = null);
}

// ==================== HOUSE VIEWER WINDOW ====================
async function capturePrimaryScreenDataUrl() {
    try {
        const primary = screen.getPrimaryDisplay();
        const { bounds, workArea, scaleFactor } = primary;
        const { width, height } = bounds;
        const captureWidth = Math.max(1, Math.round(width * (scaleFactor || 1)));
        const captureHeight = Math.max(1, Math.round(height * (scaleFactor || 1)));
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: captureWidth, height: captureHeight }
        });
        if (!sources || sources.length === 0) return '';
        const primarySource = sources.find((s) => {
            const displayId = s.display_id ? Number(s.display_id) : null;
            return displayId === primary.id;
        }) || sources[0];
        if (!primarySource.thumbnail || primarySource.thumbnail.isEmpty()) return '';
        const thumb = primarySource.thumbnail;
        const thumbSize = thumb.getSize();
        const scaleX = thumbSize.width / bounds.width;
        const scaleY = thumbSize.height / bounds.height;
        const cropRect = {
            x: Math.max(0, Math.round((workArea.x - bounds.x) * scaleX)),
            y: Math.max(0, Math.round((workArea.y - bounds.y) * scaleY)),
            width: Math.max(1, Math.round(workArea.width * scaleX)),
            height: Math.max(1, Math.round(workArea.height * scaleY)),
        };
        const cropped = thumb.crop(cropRect);
        return cropped.toDataURL();
    } catch (err) {
        console.warn('Screen capture failed:', err);
        return '';
    }
}

async function createHouseWindow(placeId = 'home', isNewPlace = false) {
    if (houseWindow) {
        houseWindow.show();
        return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const { workArea } = primaryDisplay;

    let startBounds = { width: 140, height: 140, x: 20, y: height - 160 };
    if (homeWindow) {
        try {
            startBounds = homeWindow.getBounds();
        } catch (e) { }
    }

    const targetWidth = Math.round(workArea.width);
    const targetHeight = Math.round(workArea.height);
    const targetX = Math.round(workArea.x);
    const targetY = Math.round(workArea.y);
    const screenCaptureUrl = await capturePrimaryScreenDataUrl();
    const place = getPlaceById(placeId);

    houseWindow = new BrowserWindow({
        width: startBounds.width,
        height: startBounds.height,
        x: startBounds.x,
        y: startBounds.y,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    if (process.platform === 'darwin') {
        houseWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        houseWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    const imgUrl = playerStats && playerStats.characterImage
        ? pathToFileURL(playerStats.characterImage).toString()
        : '';
    houseWindow.loadFile('house-viewer.html', {
        query: {
            mode: 'overlay',
            img: imgUrl,
            screen: screenCaptureUrl,
            placeId: place.id,
            placeName: place.name,
            model: place.model,
            isNew: isNewPlace ? '1' : '0'
        }
    });
    houseWindow.on('closed', () => houseWindow = null);

    houseWindow.webContents.on('did-finish-load', () => {
        if (!houseWindow) return;
        houseWindow.setBounds(
            { x: targetX, y: targetY, width: targetWidth, height: targetHeight },
            true
        );
        houseWindow.show();
    });
}

// ==================== CHARACTER WINDOW ====================
function createCharacterWindow() {
    // Determine spawn position
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    let startX = Math.round(width / 2 - 125);
    let startY = Math.round(height / 2 - 125);

    // If home exists, spawn there
    if (homeWindow) {
        try {
            const homeBounds = homeWindow.getBounds();
            startX = Math.round((homeBounds.x + homeBounds.width / 2) - 125);
            startY = Math.round((homeBounds.y + homeBounds.height / 2) - 125); // Adjusted Y
        } catch (e) { }
    }

    characterWindow = new BrowserWindow({
        width: 250,
        height: 250,
        x: startX,
        y: startY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // Ensure character stays above the home icon
    characterWindow.setAlwaysOnTop(true, 'screen-saver');
    characterWindow.moveTop();

    characterWindow.loadFile('character.html');
    characterWindow.webContents.on('did-finish-load', () => {
        const renderable = toRenderableImage(playerStats.characterImage);
        if (renderable) {
            characterWindow.webContents.send('update-image', renderable);
        }
    });

    // Make window click-through for transparent areas
    characterWindow.setIgnoreMouseEvents(true, { forward: true });

    // Movement Logic
    let x = startX;
    let y = startY;
    let vx = (Math.random() - 0.5) * 1.5;
    let vy = (Math.random() - 0.5) * 1.5;
    let isMoving = true;
    characterState.isReturningHome = false;
    characterState.isExiting = false;

    // Toggle movement state every 5 seconds
    const movementToggle = setInterval(() => {
        if (!characterState.isReturningHome && !characterState.isFocusMode) {
            if (Math.random() > 0.7) {
                isMoving = false;
                // console.log('Character is resting...');
            } else {
                isMoving = true;
                vx = (Math.random() - 0.5) * 1.5;
                vy = (Math.random() - 0.5) * 1.5;
                // console.log('Character is moving...');
            }
        }
    }, 5000);

    const movementLoop = setInterval(() => {
        if (!characterWindow) {
            clearInterval(movementLoop);
            clearInterval(movementToggle);
            return;
        }

        let currentBounds = characterWindow.getBounds();
        // If user drags character, update internal x,y
        // Note: Drag might fight with this loop if not handled carefully, 
        // but since we update bounds every frame, it overrides drag unless paused.
        // For now, let's trust internal vars x,y except when focus mode changes or spawn.

        // RETURN HOME LOGIC
        if (characterState.isReturningHome && homeWindow) {
            const homeBounds = homeWindow.getBounds();
            const homeCX = homeBounds.x + homeBounds.width / 2;
            const homeCY = homeBounds.y + homeBounds.height / 2;

            const targetX = homeCX - 125;
            const targetY = homeCY - 180;

            const dx = targetX - x;
            const dy = targetY - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 10) {
                // Arrived
                if (!characterState.isExiting) {
                    characterState.isExiting = true;
                    try {
                        characterWindow.webContents.send('play-popdown');
                    } catch (e) {
                        characterWindow.close();
                    }
                    setTimeout(() => {
                        try {
                            if (characterWindow) characterWindow.close();
                        } catch (e) { }
                    }, 500);
                }
                return;
            }

            const speed = Math.max(5, dist / 10);
            vx = (dx / dist) * speed;
            vy = (dy / dist) * speed;

            x += vx;
            y += vy;

            characterWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: 250, height: 250 });
            return;
        }

        if (isMoving) {
            // Level 0 (Egg) should not move
            if (playerStats.level === 0) {
                // Just stay in place (or maybe wobble slightly?)
                // For now, static as requested.
            }
            else if ((characterState.isFocusMode || characterState.isSleeping) && homeWindow) {
                // ... (Focus Mode Logic)
                try {
                    const homeBounds = homeWindow.getBounds();
                    const homeCX = homeBounds.x + homeBounds.width / 2;
                    const targetX = homeCX - 125;
                    const targetY = homeBounds.y - 220;

                    const hoverOffset = Math.sin(Date.now() / 800) * 15;
                    const dx = targetX - x;
                    const dy = (targetY + hoverOffset) - y;

                    x += dx * 0.05;
                    y += dy * 0.05;
                    vx = dx * 0.05; vy = dy * 0.05;
                } catch (e) { }
            } else {
                // NORMAL MODE (Level 1+)
                x += vx;
                y += vy;

                let minX = 0, maxX = width - 250;
                let minY = 0, maxY = height - 250;

                if (x < minX || x > maxX) { vx *= -1; x = Math.max(minX, Math.min(x, maxX)); }
                if (y < minY || y > maxY) { vy *= -1; y = Math.max(minY, Math.min(y, maxY)); }

                if (Math.random() < 0.01) {
                    vx = (Math.random() - 0.5) * 1.5;
                    vy = (Math.random() - 0.5) * 1.5;
                }
            }

            characterWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: 250, height: 250 });

            // Notify play window
            if (playWindow) {
                playWindow.webContents.send('character-moved', { x, y, width: 250, height: 250 });
            }
        }
    }, 16); // 60fps

    characterWindow.on('closed', () => {
        characterWindow = null;
        clearInterval(movementLoop);
        clearInterval(movementToggle);

        // If play window is open, close it too? No, keep it.
    });
}

// ==================== TRAY ====================
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'a.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '메인 화면 열기', click: () => {
                if (mainWindow) mainWindow.show();
                else createMainWindow();
            }
        },
        {
            label: '캐릭터 보이기/숨기기', click: () => {
                if (homeWindow) homeWindow.webContents.send('toggle-character');
            }
        },
        { label: '종료', click: () => app.quit() }
    ]);

    tray.setToolTip('Cynical Floater');
    tray.setContextMenu(contextMenu);
}

// ==================== IPC HANDLERS ====================

ipcMain.on('close-app', () => app.quit());

ipcMain.handle('get-user-info', () => {
    return currentUser;
});

// ==================== AUTH HELPER FUNCTIONS ====================

function base64URLEncode(str) {
    return str.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest();
}

function getDeviceId() {
    let devId = null;
    try {
        if (fs.existsSync(deviceDataPath)) {
            const data = JSON.parse(fs.readFileSync(deviceDataPath, 'utf8'));
            devId = data.deviceId;
        }
    } catch (e) { }

    if (!devId) {
        devId = crypto.randomUUID();
        // Save deviceId immediately so it's persisted
        try {
            let data = {};
            if (fs.existsSync(deviceDataPath)) {
                data = JSON.parse(fs.readFileSync(deviceDataPath, 'utf8'));
            }
            data.deviceId = devId;
            fs.writeFileSync(deviceDataPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to save deviceId:', e);
        }
    }
    return devId;
}

async function performGoogleLogin() {
    const port = 42813;
    const redirectUri = `http://127.0.0.1:${port}`;

    const verifier = base64URLEncode(crypto.randomBytes(32));
    const challenge = base64URLEncode(sha256(verifier));

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=openid%20profile%20email&` +
        `code_challenge=${challenge}&` +
        `code_challenge_method=S256`;

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const queryObject = parsedUrl.query;

            if (queryObject.code) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<html><body><script>window.close()</script></body></html>');
                server.close();

                try {
                    // 1. Exchange code for tokens (Google requires form-urlencoded)
                    const tokenParams = new URLSearchParams();
                    tokenParams.append('code', queryObject.code);
                    tokenParams.append('client_id', GOOGLE_CLIENT_ID);
                    tokenParams.append('client_secret', GOOGLE_CLIENT_SECRET);
                    tokenParams.append('code_verifier', verifier);
                    tokenParams.append('redirect_uri', redirectUri);
                    tokenParams.append('grant_type', 'authorization_code');

                    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', tokenParams, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });

                    const idToken = tokenRes.data.id_token;

                    // 2. Authenticate with backend
                    const backendRes = await axios.post(`${API_BASE_URL}/auth/google`, {
                        idToken,
                        deviceId: getDeviceId(),
                        deviceName: os.hostname() || 'Desktop App'
                    });

                    resolve(backendRes.data);
                } catch (err) {
                    console.error('Token exchange/backend auth error:', err.response?.data || err.message);
                    reject(new Error('Backend authentication failed: ' + (err.response?.data?.message || err.message)));
                }
            } else if (queryObject.error) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>로그인 실패</h1><p>' + queryObject.error + '</p>');
                server.close();
                reject(new Error(queryObject.error));
            }
        }).listen(port);

        shell.openExternal(authUrl);

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close();
            reject(new Error('Login timeout'));
        }, 300000);
    });
}

ipcMain.on('google-login', async () => {
    try {
        console.log('Starting Google Login...');
        const authResponse = await performGoogleLogin();

        currentUser = authResponse.user;

        // Store tokens for future API calls
        const tokens = {
            accessToken: authResponse.accessToken,
            refreshToken: authResponse.refreshToken,
            expiresIn: authResponse.expiresIn
        };
        global.authTokens = tokens;

        // Save auth data for persistent login
        saveAuthData(currentUser, tokens);

        console.log('Login successful:', currentUser.displayName);

        loadUserData();
        if (loginWindow) loginWindow.close();
        createMainWindow();
        createTray();

        // Sync character to DB after login
        setTimeout(() => syncCharacterToDB(), 2000);
    } catch (err) {
        console.error('Google Login Error:', err);
        if (loginWindow) {
            loginWindow.webContents.send('login-error', err.message);
        }
    }
});

ipcMain.on('logout', () => {
    currentUser = null;
    isGameRunning = false;
    playerStats = null; // Clear stats
    petHistory = [];    // Clear history
    global.authTokens = null;
    clearAuthData(); // Clear saved auth data
    if (mainWindow) mainWindow.close();
    if (characterWindow) characterWindow.close();
    if (homeWindow) homeWindow.close();
    if (houseWindow) houseWindow.close();
    if (tray) tray.destroy();
    if (playWindow) playWindow.close();
    createLoginWindow();
});

ipcMain.on('start-game', () => {
    isGameRunning = true;
    if (mainWindow) mainWindow.hide();
    if (!homeWindow) createHomeWindow();
    else homeWindow.show();
});

ipcMain.on('show-main-window', () => {
    if (currentUser) {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.webContents.send('update-ui-state', { isGameRunning });
        } else {
            createMainWindow();
            mainWindow.webContents.on('did-finish-load', () => {
                mainWindow.webContents.send('update-ui-state', { isGameRunning });
            });
        }
    }
});

ipcMain.handle('start-peek', () => {
    const place = pickRandomPlace();
    const discovered = new Set(playerStats.discoveredPlaces || []);
    const isNew = !discovered.has(place.id);
    discovered.add(place.id);
    playerStats.discoveredPlaces = Array.from(discovered);
    saveUserData();
    const discoveredPlaces = playerStats.discoveredPlaces.map((id) => getPlaceById(id));
    return { place, isNew, discoveredPlaces };
});

ipcMain.handle('get-places', () => {
    const discovered = new Set(playerStats.discoveredPlaces || []);
    return PLACES.map((place) => ({
        ...place,
        unlocked: discovered.has(place.id)
    }));
});

ipcMain.on('open-house-viewer', (event, payload = {}) => {
    if (houseWindow) {
        houseWindow.close();
        return;
    }
    if (characterWindow && !characterState.isReturningHome) {
        characterState.isReturningHome = true;
    }
    const placeId = payload.placeId || 'home';
    const isNewPlace = !!payload.isNew;
    createHouseWindow(placeId, isNewPlace);
});

ipcMain.on('close-house-viewer', () => {
    if (houseWindow) houseWindow.close();
});

ipcMain.handle('capture-primary-screen', async () => {
    return capturePrimaryScreenDataUrl();
});

ipcMain.on('toggle-focus-mode', (event, isFocusOn) => {
    characterState.isFocusMode = isFocusOn;
});

ipcMain.on('toggle-character', () => {
    if (characterWindow) {
        if (!characterState.isReturningHome) {
            characterState.isReturningHome = true;
        }
    } else {
        createCharacterWindow();
    }
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (characterWindow) {
        characterWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

ipcMain.on('destructive-action', (event, type) => {
    // Safety guard: Only allow if happiness is low (< 40)
    if (playerStats.happiness >= 40) {
        console.log(`Destructive action '${type}' blocked (Happiness: ${playerStats.happiness})`);
        return;
    }

    console.log(`Executing Destructive Action: ${type}`);
    let script = '';

    switch (type) {
        case 'alt-f4':
            // Alt + F4
            script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{F4}')`;
            break;
        case 'alt-tab':
            // Alt + Tab
            script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{TAB}')`;
            break;
        case 'win-key':
            // Ctrl + Esc acts as Windows Key
            script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^{ESC}')`;
            break;
        case 'dim-screen':
            // Try to set brightness to 30% (Works on laptops mostly)
            script = `(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,30)`;
            break;
        case 'shutdown':
            // Shutdown in 60 seconds
            exec('shutdown /s /t 60 /c "주인님이 저를 돌보지 않아서 컴퓨터를 끕니다. (취소하려면 shutdown /a)"');
            return;
        case 'minimize-window':
            // Minimize active window (Alt + Space + N)
            script = `$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('% n');`;
            break;
    }

    if (script) {
        exec(`powershell -Command "${script}"`, (error, stdout, stderr) => {
            if (error) console.error(`Action ${type} failed:`, error);
        });
    }
});

// ==================== EVOLUTION SYSTEM ====================

ipcMain.handle('get-current-image', () => {
    return toRenderableImage(playerStats.characterImage);
});

let clickResetTimer = null;

ipcMain.on('egg-clicked', () => {
    if (playerStats.level !== 0) return;

    // Reset the reset timer
    if (clickResetTimer) clearTimeout(clickResetTimer);

    playerStats.clickCount = (playerStats.clickCount || 0) + 1;
    console.log(`Egg clicked: ${playerStats.clickCount}`);

    if (playerStats.clickCount === 15) {
        // Crack the egg
        playerStats.characterImage = path.join(__dirname, 'assets/level0/level0_cracked.png');
        const renderable = toRenderableImage(playerStats.characterImage);
        if (characterWindow) characterWindow.webContents.send('update-image', renderable);
        if (mainWindow) mainWindow.webContents.send('update-image', renderable);
    } else if (playerStats.clickCount >= 30) {
        // Evolve to Level 1
        evolveCharacter(1);
        return; // Don't set reset timer if evolved
    }

    saveUserData();

    // Set timer to reset clicks if user stops
    clickResetTimer = setTimeout(() => {
        if (playerStats.level === 0 && playerStats.clickCount > 0) {
            console.log('Click streak broken. Resetting egg.');
            playerStats.clickCount = 0;
            playerStats.characterImage = path.join(__dirname, 'assets/level0/level0.png');
            const renderable = toRenderableImage(playerStats.characterImage);
            if (characterWindow) characterWindow.webContents.send('update-image', renderable);
            if (mainWindow) mainWindow.webContents.send('update-image', renderable);
            saveUserData();
        }
    }, 3000); // 3 seconds timeout
});

function evolveCharacter(targetLevel) {
    console.log(`[Evolution] Attempting to evolve to Level ${targetLevel}...`);

    const levelDir = path.join(__dirname, `assets/level${targetLevel}`);
    console.log(`[Evolution] Checking directory: ${levelDir}`);

    // 1. Get subdirectories
    fs.readdir(levelDir, { withFileTypes: true }, (err, dirents) => {
        if (err) {
            console.error('[Evolution] Failed to read level dir:', err);
            return;
        }

        const charFolders = dirents.filter(d => d.isDirectory()).map(d => d.name);
        console.log(`[Evolution] Found folders: ${charFolders.join(', ')}`);

        if (charFolders.length === 0) {
            console.error(`[Evolution] No character folders found in level ${targetLevel}`);
            return;
        }

        // 2. Pick random folder
        const randomCharName = charFolders[Math.floor(Math.random() * charFolders.length)];
        const charDir = path.join(levelDir, randomCharName);
        console.log(`[Evolution] Selected character: ${randomCharName}`);

        // 3. Find image (Prefer 'normal.webp')
        fs.readdir(charDir, (err, files) => {
            if (err || files.length === 0) {
                console.error('[Evolution] Empty character folder:', charDir);
                return;
            }

            // Look for normal.webp first
            let targetImage = files.find(f => f.toLowerCase() === 'normal.webp');

            // Fallback: any image
            if (!targetImage) {
                targetImage = files.find(f => f.match(/\.(png|svg|webp|jpg)$/i));
            }

            if (!targetImage) {
                console.error('[Evolution] No valid images found in:', charDir);
                return;
            }

            const fullPath = path.join(charDir, targetImage);
            console.log(`[Evolution] Selected image: ${fullPath}`);

            // UPDATE STATS
            playerStats.level = targetLevel;
            playerStats.evolutionProgress = 0;
            playerStats.lastEvolutionTime = Date.now();
            playerStats.characterImage = fullPath;
            playerStats.characterName = randomCharName; // Save name

            playerStats.evolutionHistory.push({ level: targetLevel, name: randomCharName, date: Date.now() });

            // Notify Renderer
            if (characterWindow) {
                characterWindow.webContents.send('update-image', toRenderableImage(fullPath));
                // characterWindow.webContents.send('show-speech', '진화했다! ✨');
                // Force redraw if needed
                characterWindow.setBounds(characterWindow.getBounds());
            }
            if (mainWindow) {
                mainWindow.webContents.send('update-image', toRenderableImage(fullPath));
            }

            saveUserData();
            console.log(`[Evolution] Success! Level ${targetLevel}`);
        });
    });
}

// Check evolution progress periodically (Level 1+)
// Update character image based on happiness and level
function updateDynamicImage() {
    if (playerStats.level === 0 || !playerStats.characterName) return;

    const baseDir = path.join(__dirname, 'assets', `level${playerStats.level}`, playerStats.characterName);

    // Sleep Override
    if (characterState.isSleeping) {
        const sleepPath = path.join(baseDir, 'sleeping.webp');
        if (fs.existsSync(sleepPath)) {
            if (playerStats.characterImage !== sleepPath) {
                playerStats.characterImage = sleepPath;
                const renderable = toRenderableImage(sleepPath);
                if (characterWindow) characterWindow.webContents.send('update-image', renderable);
                if (mainWindow) mainWindow.webContents.send('update-image', renderable);
            }
            return;
        }
    }
    const h = playerStats.happiness;
    let candidates = [];

    // LEVEL 1: 3 steps (0-33, 33-66, 66-100)
    if (playerStats.level === 1) {
        if (h < 33) candidates = ['sad.webp'];
        else if (h < 66) candidates = ['normal.webp'];
        else candidates = ['happy.webp'];
    }
    // LEVEL 2: 4 steps (0-25, 25-50, 50-75, 75-100)
    else if (playerStats.level === 2) {
        if (h < 25) candidates = ['sad.webp'];
        else if (h < 50) candidates = ['boring.webp'];
        else if (h < 75) candidates = ['normal.webp'];
        else candidates = ['happy.webp'];
    }
    // LEVEL 3: 5 steps (0-20, 20-40, 40-60, 60-80, 80-100)
    else if (playerStats.level === 3) {
        if (h < 20) candidates = ['angry.webp', 'sad.webp'];
        else if (h < 40) candidates = ['back.webp', 'refusing.webp'];
        else if (h < 60) candidates = ['boring.webp', 'normal.webp'];
        else if (h < 80) candidates = ['happy.webp'];
        else candidates = ['kissing.webp', 'blushing.webp'];
    }

    // fallback
    if (candidates.length === 0) candidates = ['normal.webp'];

    // Pick one
    const filename = candidates[Math.floor(Math.random() * candidates.length)];
    const fullPath = path.join(baseDir, filename);

    // Apply only if changed (to prevent flickering random choices) or force update occasionally?
    // For random choices in Lv3, we might want them to switch occasionally.
    // Let's check existence first.
    if (fs.existsSync(fullPath)) {
        // If it's a random choice interval, we might update even if path is same?
        // But to be stable, let's only update if the current image is NOT one of the candidates 
        // OR if enough time passed to re-roll random.
        // For simplicity: Update every time this is called (1 min interval).
        playerStats.characterImage = fullPath;

        const renderable = toRenderableImage(fullPath);
        if (characterWindow) characterWindow.webContents.send('update-image', renderable);
        if (mainWindow) mainWindow.webContents.send('update-image', renderable);
    } else {
        // Fallback to normal if specific emotion missing
        const normalPath = path.join(baseDir, 'normal.webp');
        if (fs.existsSync(normalPath)) {
            playerStats.characterImage = normalPath;
        }
    }
}

// Check evolution progress and decrease happiness periodically
// ==================== STATUS & HP MANAGEMENT (Every 1 Minute) ====================
setInterval(() => {
    if (!playerStats) return;

    // 0. Watchdog: Ensure Home icon exists
    if (isGameRunning && !homeWindow) {
        console.log('[Watchdog] Home icon missing. Recreating...');
        createHomeWindow();
    }

    const now = Date.now();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    // 1. Happiness Decay (Passive)
    if (playerStats.happiness > 0) {
        playerStats.happiness = Math.max(0, playerStats.happiness - 1);
        console.log(`[Status] Happiness decayed to: ${playerStats.happiness}`);
    }

    // 2. HP Management
    if (playerStats.hp === undefined) playerStats.hp = 100;

    // A. Hunger Damage (Check every 12 hours)
    if (!playerStats.lastHungerDamageTime) playerStats.lastHungerDamageTime = playerStats.lastFedTime || now;
    const timeSinceFed = now - (playerStats.lastFedTime || now);
    const isStarving = timeSinceFed >= TWELVE_HOURS;

    if (now - playerStats.lastHungerDamageTime >= TWELVE_HOURS) {
        playerStats.hp = Math.max(0, playerStats.hp - 15);
        playerStats.lastHungerDamageTime = now;
        console.log(`[Status] HP penalty (-15) due to hunger! Current HP: ${playerStats.hp}`);
    }

    // B. Aging Damage (Lifespan Check every 24 hours)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (!playerStats.lastAgingTime) playerStats.lastAgingTime = playerStats.birthday || now;

    if (now - playerStats.lastAgingTime >= TWENTY_FOUR_HOURS) {
        let agingDamage = 0;
        if (playerStats.level === 1) agingDamage = 10; // 10 days lifespan
        else if (playerStats.level >= 2) agingDamage = 7.5; // 15 days lifespan

        if (agingDamage > 0) {
            playerStats.hp = Math.max(0, playerStats.hp - agingDamage);
            playerStats.lastAgingTime = now;
            console.log(`[Status] Aging penalty (-${agingDamage}) due to lifespan! Current HP: ${playerStats.hp}`);
        }
    }

    // C. Gradual HP Changes (Based on Happiness)
    if (playerStats.happiness < 50) {
        // HP slowly decays if character is sad (Approx 10 per hour)
        if (playerStats.hp > 0 && Math.random() < 0.17) {
            playerStats.hp = Math.max(0, playerStats.hp - 1);
            console.log(`[Status] HP decaying due to sadness: ${playerStats.hp}`);
        }
    } else if (!isStarving) {
        // HP recovers if happy and well-fed (Approx 5 per day => 5/1440 chance per minute)
        if (playerStats.hp < 100 && Math.random() < 0.00347) {
            playerStats.hp = Math.min(100, playerStats.hp + 1);
            console.log(`[Status] HP recovering: ${playerStats.hp}`);
        }
    }

    // C. Death Check
    if (playerStats.hp <= 0) {
        handleDeath();
    }

    // 3. Visuals and Timers
    updateDynamicImage();

    // Check Sleep Time (23:00 ~ 06:00)
    // Check Sleep Time (00:00 ~ 06:00)
    const currentHour = new Date().getHours();
    // Midnight (00:00) to 06:00
    const shouldSleep = (currentHour < 6);
    if (characterState.isSleeping !== shouldSleep) {
        characterState.isSleeping = shouldSleep;
        console.log(`[Status] Sleep State Changed: ${shouldSleep}`);
        updateDynamicImage(); // Update image immediately

        // Say something when falling asleep
        if (shouldSleep && characterWindow) {
            characterWindow.webContents.send('show-speech', '아 졸려...');
        }
    }

    // 2. Evolution Progress (Level 1+)
    if (playerStats.level > 0 && playerStats.level < 3 && playerStats.hp > 0) {
        // Targets: 1->2 (5 days = 7200 mins), 2->3 (10 days = 14400 mins)
        // Base rate per minute to reach 100%
        let baseRate = (playerStats.level === 1) ? (100 / 7200) : (100 / 14400);

        // Bonus: If happy (> 60), grow 2x faster
        const multiplier = (playerStats.happiness > 60) ? 2 : 1;
        const growth = baseRate * multiplier;

        playerStats.evolutionProgress = Math.min(100, (playerStats.evolutionProgress || 0) + growth);

        console.log(`[Evolution] Level ${playerStats.level} Progress: ${playerStats.evolutionProgress.toFixed(4)}% (+${growth.toFixed(5)})`);

        if (playerStats.evolutionProgress >= 100) {
            evolveCharacter(playerStats.level + 1);
        }
    }

    saveUserData();
}, 60000); // Check every 1 minute

// LLM speech bubble timer (every 10 seconds)
setInterval(async () => {
    // Debug Log
    // console.log(`[Timer] Tick. GameRunning: ${isGameRunning}, DB_ID: ${playerStats?.dbCharacterId ? 'YES' : 'NO'}`);

    // Call LLM every 10 seconds
    if (playerStats && isGameRunning) {

        // If not linked to DB yet, try syncing first
        if (!playerStats.dbCharacterId) {
            console.log('[Timer] No DB Character ID found. Attempting sync...');
            await syncCharacterToDB();
        }

        if (playerStats.dbCharacterId) {
            try {
                const context = {
                    happiness: playerStats.happiness,
                    hp: playerStats.hp,
                    level: playerStats.level,
                    characterName: getKoreanName(playerStats.characterName),
                    isHungry: (Date.now() - playerStats.lastFedTime) > 4 * 60 * 60 * 1000,
                    isLonely: (Date.now() - playerStats.lastPlayTime) > 2 * 60 * 60 * 1000
                };

                // Capture Screenshot
                let screenshotBuffer = null;
                try {
                    const primaryDisplay = screen.getPrimaryDisplay();
                    const { width, height } = primaryDisplay.size;

                    const sources = await desktopCapturer.getSources({
                        types: ['screen'],
                        thumbnailSize: { width, height }
                    });

                    if (sources.length > 0) {
                        // Use the first screen (primary)
                        // screenshotBuffer = sources[0].thumbnail.toPNG();
                        // console.log('Screenshot captured for LLM context');
                    }
                } catch (e) {
                    console.error('Failed to capture screenshot:', e);
                }

                const llmResponse = await callLlmApi(playerStats.dbCharacterId, '', context, screenshotBuffer);

                if (llmResponse && llmResponse.message && characterWindow) {
                    console.log(`[LLM Speech] ${llmResponse.message}`);
                    characterWindow.webContents.send('show-speech', llmResponse.message);
                }
            } catch (err) {
                console.error('LLM speech error:', err);
            }

            // Sync to DB
            syncCharacterToDB();
        }
    }
}, 10000);

// ==================== PLAY MODE & MINIGAMES ====================

ipcMain.handle('get-db-character-id', async () => {
    return getOrSyncCharacterId();
});

ipcMain.handle('friend-search', async (event, { query }) => {
    try {
        const results = await searchCharacters(query);
        return { success: true, results };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-send-request', async (event, { targetCharacterId, message }) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) {
            return { success: false, message: '캐릭터 동기화가 아직 안 됐어.' };
        }
        const data = await sendFriendRequest(characterId, targetCharacterId, message);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-get-requests', async (event, { direction = 'incoming', status = 'PENDING' } = {}) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const data = await getFriendRequests(characterId, direction, status);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-accept', async (event, { requestId }) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const data = await acceptFriendRequest(characterId, requestId);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-reject', async (event, { requestId }) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const data = await rejectFriendRequest(characterId, requestId);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-get-friends', async () => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const data = await getFriends(characterId);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-get-my-character', async () => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const characters = await getCharactersFromDB();
        const me = characters.find((c) => c.id === characterId) || null;
        if (!me) return { success: false, message: '내 캐릭터를 찾지 못했어.' };
        return { success: true, data: me };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-send-message', async (event, { friendCharacterId, messageText, emoteId }) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const data = await sendFriendMessage(characterId, friendCharacterId, messageText, emoteId);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('get-player-status', () => {
    const now = Date.now();
    const timeSinceLastPlay = now - playerStats.lastPlayTime;
    const remainingCooldown = Math.max(0, PLAY_COOLDOWN - timeSinceLastPlay);

    // Fallback logic for name
    let displayName = playerStats.characterName;
    if (!displayName) {
        if (playerStats.level === 0) displayName = '알';
        else {
            // Extract from path: .../levelN/NAME/normal.webp
            try {
                const parts = playerStats.characterImage.split(path.sep);
                // The folder name is the parent of the image file
                displayName = parts[parts.length - 2];
            } catch (e) {
                displayName = 'Unknown';
            }
        }
    }

    // Convert to Korean name for display
    const koreanName = getKoreanName(displayName);

    const discoveredPlaces = (playerStats.discoveredPlaces || []).map((id) => getPlaceById(id));
    const characterImagePath = playerStats.characterImage;
    const characterImage = characterImagePath && fs.existsSync(characterImagePath)
        ? pathToFileURL(characterImagePath).toString()
        : characterImagePath;

    return {
        happiness: playerStats.happiness,
        remainingCooldown,
        characterImage,
        level: playerStats.level,
        characterName: koreanName,
        evolutionProgress: playerStats.evolutionProgress || 0,
        hp: (playerStats.hp !== undefined) ? playerStats.hp : 100,
        discoveredPlaces
    };
});

ipcMain.handle('start-play-mode', (event, mode) => {
    const now = Date.now();
    if (now - playerStats.lastPlayTime < PLAY_COOLDOWN) {
        return { success: false, message: '아직 놀아줄 수 없습니다. (쿨타임 중)' };
    }

    if (mainWindow) mainWindow.hide();
    // homeWindow remains visible
    if (!characterWindow) createCharacterWindow();

    createPlayWindow(mode);
    return { success: true };
});

ipcMain.handle('finish-play-mode', (event, mode) => {
    // Determine stats increase based on mode
    const increase = (mode === 'food') ? 3 : 10;

    playerStats.happiness = Math.min(100, playerStats.happiness + increase);
    playerStats.lastPlayTime = Date.now();

    if (mode === 'food') {
        playerStats.lastFedTime = Date.now();
        playerStats.lastHungerDamageTime = Date.now();
        // Optional: Recover some HP when fed?
        // playerStats.hp = Math.min(100, (playerStats.hp || 0) + 5);
        console.log('[Status] Fed characters. Hunger timer reset.');
    }

    // Update image immediately
    updateDynamicImage();

    saveUserData(); // Save on change
    return { happiness: playerStats.happiness };
});

ipcMain.on('close-play-window', () => {
    if (playWindow) {
        playWindow.close();
        playWindow = null;
    }
    if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send('update-ui-state', { isGameRunning });
    }
});

ipcMain.on('ball-position', (event, { x, y }) => {
    if (characterWindow) {
        characterWindow.ballTarget = { x, y }; // Use this in movement logic if advanced physics needed
        // For now, simpler: Just move character towards ball instantly or specific logic
        // But since movement is controlled by loop, we can hijack it:
        // Let's add 'ballChasing' state or just override x,y for a bit
        // Actually, just updating target logic in loop is best, but loop is strict.

        // Just let it be for now, visual feedback is mostly in play overlay
    }
});

ipcMain.on('food-eaten', () => {
    if (characterWindow) {
        // characterWindow.webContents.send('show-speech', '존맛탱! 🍖');
    }
});

function createPlayWindow(mode) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    playWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        transparent: true,
        frame: false,
        fullscreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    playWindow.loadFile('play-overlay.html');
    playWindow.webContents.on('did-finish-load', () => {
        let startPos = null;
        if (characterWindow) {
            const bounds = characterWindow.getBounds();
            startPos = { x: bounds.x, y: bounds.y };
            characterWindow.hide();
        }
        playWindow.webContents.send('init-game', {
            mode,
            startPos,
            characterImage: playerStats.characterImage
        });
    });
    playWindow.on('closed', () => {
        playWindow = null;
        if (characterWindow) characterWindow.show();
    });
}

// ==================== APP LIFECYCLE ====================
app.whenReady().then(async () => {
    // Try auto-login first
    const autoLoginSuccess = await tryAutoLogin();

    if (autoLoginSuccess) {
        // User is already logged in, go straight to main screen
        loadUserData();
        createMainWindow();
        createTray();
    } else {
        // Show login window
        createLoginWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
