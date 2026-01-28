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
let chatWindow = null;
let playWindow = null;
let petGameWindow = null;
let characterState = { isReturningHome: false, isFocusMode: false, isExiting: false, isSleeping: false, isWindowDragging: false };
let tray = null;

// User state
let currentUser = null;
let isGameRunning = false;
let playerStats = null;
const DEFAULT_CAFE_CHANCE = 0.1;
const DEFAULT_BREEDING_CHANCE = 0.01;
let petHistory = []; // Archive for dead pets
let bootstrapCache = null;
let friendsCache = [];
let friendsCacheAt = 0;
// 5 minutes cooldown (Disabled for testing)
// 5 minutes cooldown (Disabled for testing)
const PLAY_COOLDOWN = 0;
const FEED_COOLDOWN = 4 * 60 * 60 * 1000;
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
    { id: 'cafe', name: '카페', icon: '☕', model: 'cafe.glb' },
    { id: 'pharmacy', name: '약국', icon: '💊', model: 'pharmacy.glb' },
    { id: 'bank', name: '은행', icon: '🏦', model: 'bank.glb' },
    { id: 'school', name: '학교', icon: '🏫', model: 'school.glb' },
    { id: 'police', name: '경찰서', icon: '🚓', model: 'police_station.glb' },
    { id: 'toilet', name: '화장실', icon: '🚽', model: 'toilet.glb' },
    { id: 'cradle', name: '요람', icon: '🛏️', model: 'cradle.glb' },
];
const HOUSE_IDS = PLACES.filter((p) => p.id.startsWith('house')).map((p) => p.id);
const NON_HOUSE_PLACE_IDS = PLACES.filter((p) => !p.id.startsWith('house') && p.id !== 'cradle').map((p) => p.id);

/* CHARACTER MAPPING */
const CHARACTER_NAMES_MAP = {
    'marupitchi': '마루피치',
    'young-mametchi': '영마메치',
    'kuchipatchi': '쿠치파치',
    'memetchi': '메메치',
    'lovelitchi': '러블리치',
    'kuromametchi': '쿠로마메치',
    'ichigotchi': '이치고치',
    'gozarutchi': '고자루치',
    'kikitchi': '키키치',
    'mametchi': '마메치',
    'chiroritchi': '치로리치',
    'peacetchi': '피스치'
};

const FEMALE_CHARACTERS = new Set([
    'marupitchi',
    'chiroritchi',
    'peacetchi',
    'lovelitchi',
    'memetchi'
]);

function getCharacterGender(englishName) {
    return getGenderForCharacterName(englishName) || 'male';
}

const BREEDING_STAGES = {
    KISSING: 'KISSING',
    EGG_HOME: 'EGG_HOME',
    EGG_ACQUIRED: 'EGG_ACQUIRED',
    CRADLE: 'CRADLE'
};

function isBreedingActive() {
    return !!playerStats?.breedingStage;
}

const FEMALE_CHARACTER_NAMES = new Set([
    'marupitchi',
    'chiroritchi',
    'peacetchi',
    'lovelitchi',
    'memetchi'
]);

function normalizeGenderKey(name) {
    if (!name) return null;
    const eng = getEnglishNameFromKorean(name);
    const key = (eng || name).toString().trim().toLowerCase();
    return key || null;
}

function getGenderForCharacterName(name) {
    const key = normalizeGenderKey(name);
    if (!key) return null;
    return FEMALE_CHARACTER_NAMES.has(key) ? 'female' : 'male';
}

function getEnglishNameFromKorean(koreanName) {
    for (const [key, value] of Object.entries(CHARACTER_NAMES_MAP)) {
        if (value === koreanName) return key;
    }
    return null;
}

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
    hunger: 0,
    discoveredPlaces: [],
    birthEventSent: false,
    deathEventSent: false,
    loverFriendCharacterId: null,
    childBornWithFriendId: null,
    lastSyncedStageIndex: 0,
    assignedHouseId: null,
    awayModeActive: false,
    breedingStage: null,
    breedingPartner: null,
    breedingParentCharacterId: null,
    breedingEggOrigin: false,
    hasEgg: false,
    sleepModeActive: false,
    wokeUpEarlyDate: null,
    gender: null,
    intimacyScore: 0,
    feedCount: 0,
    forcedAwayPlaceId: null,
    forcedAwayReason: null,
    forcedAwayMeta: null,
    pendingPoliceAfterBank: false,
    pendingPaydayDebug: false,
    cafePending: false,
    cafeChance: DEFAULT_CAFE_CHANCE,
    breedingChance: DEFAULT_BREEDING_CHANCE,
    debugTimeOffsetHours: 0,
    schoolLastDate: null,
    park2UsedFriendIds: [],
    friendIntimacyOverrides: {},
    achievements: {},
    firstDeathAchievement: false,
    visibleAccumMillis: 0,
    visibleLastTickAt: 0,
    placePlacements: {},
    sickModeActive: false,
    sickAnnounced: false,
    sickRecovered: false,
    pendingLineageParents: null,
    lineageCreated: false,
    forceNewCharacter: false,
    localUpdatedAt: 0,
    serverVersion: 0,
    serverUpdatedAt: 0
};

function getPlaceById(id) {
    return PLACES.find((p) => p.id === id) || PLACES[0];
}

function pickRandomPlace() {
    const idx = Math.floor(Math.random() * PLACES.length);
    return PLACES[idx];
}

function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function recomputeSleepMode(now = null) {
    if (!playerStats) return false;
    const current = now || getGameNow();
    const sleepHours = current.getHours() < 6;
    const todayKey = toDateKey(current);

    if (!sleepHours) {
        playerStats.sleepModeActive = false;
        playerStats.wokeUpEarlyDate = null;
        return false;
    }

    const wokeToday = playerStats.wokeUpEarlyDate === todayKey;
    playerStats.sleepModeActive = !wokeToday;
    return playerStats.sleepModeActive;
}

let homePlaceSyncInFlight = false;

async function syncAssignedHouseIdToServer() {
    if (!ENABLE_DB_SYNC) return;
    if (!playerStats?.dbCharacterId) return;
    if (homePlaceSyncInFlight) return;

    homePlaceSyncInFlight = true;
    try {
        await updateCharacterInDB(playerStats.dbCharacterId, {
            homePlaceId: playerStats.assignedHouseId || null
        });
    } finally {
        homePlaceSyncInFlight = false;
    }
}

function ensureAssignedHouseId() {
    if (!playerStats) return null;
    if (playerStats.level < 1) {
        playerStats.assignedHouseId = null;
        return null;
    }
    if (!playerStats.assignedHouseId || !HOUSE_IDS.includes(playerStats.assignedHouseId)) {
        const idx = Math.floor(Math.random() * HOUSE_IDS.length);
        playerStats.assignedHouseId = HOUSE_IDS[idx];
        saveUserData();
        // Fire-and-forget: persist assigned house once we have a character ID.
        syncAssignedHouseIdToServer();
    }
    return playerStats.assignedHouseId;
}

function pickAwayPlace() {
    // For now, away mode always goes to park.
    return getPlaceById('park');
}

function addDiscoveredPlace(placeId) {
    if (!playerStats) return;
    const discovered = new Set(playerStats.discoveredPlaces || []);
    discovered.add(placeId);
    playerStats.discoveredPlaces = Array.from(discovered);
}

function normalizePlacePlacement(placeId) {
    if (!playerStats) return null;
    playerStats.placePlacements = playerStats.placePlacements || {};
    const existing = playerStats.placePlacements[placeId];
    if (!existing) return null;
    if (existing.placements) return existing;
    if (typeof existing.x === 'number') {
        const normalized = {
            customName: null,
            activeId: 'default',
            placements: {
                default: {
                    label: '기본',
                    x: existing.x,
                    y: existing.y,
                    z: existing.z,
                    modelY: existing.modelY ?? 0
                }
            }
        };
        playerStats.placePlacements[placeId] = normalized;
        return normalized;
    }
    return existing;
}

function getActivePlacement(placeId) {
    const data = normalizePlacePlacement(placeId) || playerStats?.placePlacements?.[placeId];
    if (!data || !data.placements) return null;
    const activeId = data.activeId && data.placements[data.activeId] ? data.activeId : Object.keys(data.placements)[0];
    if (!activeId) return null;
    data.activeId = activeId;
    return { id: activeId, ...data.placements[activeId] };
}

function getPlacementByLabel(placeId, label) {
    if (!label) return null;
    const data = normalizePlacePlacement(placeId) || playerStats?.placePlacements?.[placeId];
    if (!data || !data.placements) return null;
    const target = label.trim().toLowerCase();
    const entry = Object.entries(data.placements).find(([, placement]) => {
        const name = (placement?.label || '').trim().toLowerCase();
        return name === target;
    });
    if (!entry) return null;
    return { id: entry[0], ...entry[1] };
}

function resolvePlacementForView(placeId) {
    if (!placeId) return null;
    const isHouse = placeId.startsWith('house');
    if (isHouse) {
        const hour = getGameNow().getHours();
        const label = hour < 6 ? '침대' : '의자';
        const labeled = getPlacementByLabel(placeId, label);
        if (labeled) return labeled;
    }
    return getActivePlacement(placeId);
}

async function upsertAchievementInDB(achievementId, label) {
    if (!ENABLE_DB_SYNC || !global.authTokens) return;
    try {
        await apiRequest({
            method: 'PUT',
            url: `${API_BASE_URL}/users/me/achievements/${achievementId}`,
            data: {
                progress: 1,
                unlockedAt: new Date().toISOString(),
                metadata: label ? { label } : null
            }
        });
    } catch (err) {
        // Best-effort; missing defs or network failures shouldn't break gameplay.
    }
}

function markAchievement(key, label, description = null) {
    if (!playerStats) return;
    playerStats.achievements = playerStats.achievements || {};
    if (playerStats.achievements[key]) return;
    playerStats.achievements[key] = {
        label,
        description: description || null,
        achievedAt: Date.now()
    };
    recordCharacterEvent('MILESTONE', `업적 달성: ${label}`, { achievementKey: key });
    upsertAchievementInDB(key, label);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('achievement-toast', {
            label: label || key
        });
    }
}

function clearForcedAway() {
    if (!playerStats) return;
    playerStats.forcedAwayPlaceId = null;
    playerStats.forcedAwayReason = null;
    playerStats.forcedAwayMeta = null;
    playerStats.awayModeActive = false;
}

function setForcedAway(placeId, reason, meta = null) {
    if (!playerStats || !placeId) return;
    playerStats.forcedAwayPlaceId = placeId;
    playerStats.forcedAwayReason = reason;
    playerStats.forcedAwayMeta = meta;
    playerStats.awayModeActive = true;
    saveUserData();

    if (characterWindow && !characterState.isReturningHome) {
        return { alreadyVisible: true };
    }
    if (homeWindow) {
        homeWindow.webContents.send('home-speech', '...');
    }
}

function isWeekdaySchoolHours(now = null) {
    const current = now || getGameNow();
    const day = current.getDay();
    const hour = current.getHours();
    const weekday = day >= 1 && day <= 5;
    return weekday && hour >= 9 && hour < 17;
}

function getGameNow() {
    const offsetHours = Number(playerStats?.debugTimeOffsetHours || 0);
    const offsetMs = offsetHours * 60 * 60 * 1000;
    return new Date(Date.now() + offsetMs);
}

function isCharacterVisibleOut() {
    return !!(characterWindow && !characterState.isReturningHome);
}

function ensureSickForcedAway() {
    if (!playerStats?.sickModeActive) return;
    if (playerStats.forcedAwayPlaceId !== 'pharmacy') {
        playerStats.forcedAwayPlaceId = 'pharmacy';
        playerStats.forcedAwayReason = 'PHARMACY';
        playerStats.awayModeActive = true;
        saveUserData({ touchLocalUpdatedAt: false });
    }
}

function triggerSickMode() {
    if (!playerStats || playerStats.sickModeActive) return;
    playerStats.sickModeActive = true;
    playerStats.sickAnnounced = true;
    playerStats.sickRecovered = false;
    ensureSickForcedAway();
    saveUserData({ touchLocalUpdatedAt: false });
    if (characterWindow && !characterWindow.isDestroyed()) {
        characterWindow.webContents.send('set-emotion', 'sad');
        characterWindow.webContents.send('show-speech', '나 조금 아픈거같아..콜록콜록');
    }
}

function getEligiblePark2FriendId() {
    const used = new Set(playerStats?.park2UsedFriendIds || []);
    const eligible = friendsCache.find((f) => (f.intimacy || 0) >= 70 && !used.has(f.friendCharacterId));
    return eligible?.friendCharacterId || null;
}

function maybeTriggerSchoolVisit() {
    if (!playerStats || playerStats.level !== 2) return false;
    if (!isWeekdaySchoolHours()) return false;
    const today = toDateKey(getGameNow());
    if (playerStats.schoolLastDate === today) return false;
    setForcedAway('school', 'SCHOOL');
    return true;
}

function maybeTriggerToiletVisit() {
    if (!playerStats || (playerStats.feedCount || 0) < 3) return false;
    setForcedAway('toilet', 'TOILET');
    return true;
}

function maybeTriggerCafeVisit() {
    if (!playerStats || !playerStats.cafePending) return false;
    setForcedAway('cafe', 'CAFE');
    return true;
}

function maybeTriggerPark2Visit() {
    if (!playerStats || playerStats.level < 2) return false;
    const friendId = getEligiblePark2FriendId();
    if (!friendId) return false;
    setForcedAway('park2', 'PARK2', { friendCharacterId: friendId });
    return true;
}

function maybeTriggerPoliceAfterBank() {
    if (!playerStats?.pendingPoliceAfterBank) return false;
    playerStats.pendingPoliceAfterBank = false;
    setForcedAway('police', 'PAYDAY_POLICE');
    return true;
}

function triggerPaydaySequence() {
    if (!playerStats) return;
    const canPayday = (playerStats.level || 0) >= 3 && (playerStats.intimacyScore || 0) >= 90;
    if (!canPayday) return;
    setForcedAway('bank', 'PAYDAY_BANK');
}

function resolveForcedAwayOnPeek(placeId) {
    if (!playerStats?.forcedAwayReason) return;
    const reason = playerStats.forcedAwayReason;
    const meta = playerStats.forcedAwayMeta || {};
    const today = toDateKey(getGameNow());

    if (reason === 'PAYDAY_BANK' && placeId === 'bank') {
        markAchievement('payday', '페이데이');
        playerStats.pendingPoliceAfterBank = true;
    } else if (reason === 'PAYDAY_POLICE' && placeId === 'police') {
        markAchievement('theft', '절도');
    } else if (reason === 'CAFE' && placeId === 'cafe') {
        markAchievement('iced-americano', '얼죽아');
        playerStats.cafePending = false;
    } else if (reason === 'SCHOOL' && placeId === 'school') {
        markAchievement('truancy', '땡떙이');
        playerStats.schoolLastDate = today;
    } else if (reason === 'TOILET' && placeId === 'toilet') {
        markAchievement('no-peek', '엿보지 마세요!');
        playerStats.feedCount = 0;
    } else if (reason === 'PARK2' && placeId === 'park2') {
        markAchievement('old-friend', '죽마고우');
        const used = new Set(playerStats.park2UsedFriendIds || []);
        if (meta.friendCharacterId) {
            used.add(meta.friendCharacterId);
            playerStats.park2UsedFriendIds = Array.from(used);
        }
    } else if (reason === 'PHARMACY' && placeId === 'pharmacy') {
        addDiscoveredPlace('pharmacy');
        saveUserData({ touchLocalUpdatedAt: false });
        return;
    }

    addDiscoveredPlace(placeId);
    clearForcedAway();
    saveUserData({ touchLocalUpdatedAt: false });
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
                if (!Array.isArray(playerStats.park2UsedFriendIds)) {
                    playerStats.park2UsedFriendIds = [];
                }
                playerStats.achievements = playerStats.achievements || {};
                playerStats.feedCount = playerStats.feedCount || 0;
                playerStats.cafeChance = typeof playerStats.cafeChance === 'number' ? playerStats.cafeChance : DEFAULT_CAFE_CHANCE;
                playerStats.breedingChance = typeof playerStats.breedingChance === 'number' ? playerStats.breedingChance : DEFAULT_BREEDING_CHANCE;
                if (!playerStats.friendIntimacyOverrides || typeof playerStats.friendIntimacyOverrides !== 'object') {
                    playerStats.friendIntimacyOverrides = {};
                }
                playerStats.pendingPaydayDebug = !!playerStats.pendingPaydayDebug;
                playerStats.hunger = typeof playerStats.hunger === 'number' ? playerStats.hunger : 0;
                playerStats.firstDeathAchievement = !!playerStats.firstDeathAchievement;
                playerStats.forceNewCharacter = !!playerStats.forceNewCharacter;
                playerStats.debugTimeOffsetHours = Number.isFinite(playerStats.debugTimeOffsetHours) ? playerStats.debugTimeOffsetHours : 0;
                playerStats.visibleAccumMillis = playerStats.visibleAccumMillis || 0;
                playerStats.visibleLastTickAt = playerStats.visibleLastTickAt || 0;
                playerStats.placePlacements = playerStats.placePlacements || {};
                const devicePlacements = getDevicePlacePlacements();
                if (devicePlacements && Object.keys(devicePlacements).length) {
                    playerStats.placePlacements = devicePlacements;
                }
                Object.keys(playerStats.placePlacements).forEach((placeId) => {
                    normalizePlacePlacement(placeId);
                });
                if (!playerStats.modelYOffsetResetApplied) {
                    Object.values(playerStats.placePlacements).forEach((placeData) => {
                        if (!placeData?.placements) return;
                        Object.values(placeData.placements).forEach((placement) => {
                            if (placement && typeof placement.modelY === 'number') {
                                placement.modelY = 0;
                            }
                        });
                    });
                    playerStats.modelYOffsetResetApplied = true;
                    saveUserData({ touchLocalUpdatedAt: false });
                }
                playerStats.sickModeActive = !!playerStats.sickModeActive;
                playerStats.sickAnnounced = !!playerStats.sickAnnounced;
                playerStats.sickRecovered = !!playerStats.sickRecovered;
                if (!playerStats.breedingStage && playerStats.isBreeding) {
                    playerStats.breedingStage = BREEDING_STAGES.KISSING;
                }
                if (!Object.values(BREEDING_STAGES).includes(playerStats.breedingStage)) {
                    playerStats.breedingStage = null;
                }
                if (!playerStats.breedingParentCharacterId && playerStats.breedingStage) {
                    playerStats.breedingParentCharacterId = playerStats.dbCharacterId || null;
                }
                if (playerStats.breedingStage && !playerStats.breedingPartner && !playerStats.hasEgg) {
                    // Recover from older test data that left breeding state without a partner.
                    playerStats.breedingStage = null;
                }
                playerStats.breedingEggOrigin = !!playerStats.breedingEggOrigin;
                delete playerStats.isBreeding;

                console.log('Loaded user data. Active Pet:', playerStats.characterName, 'History count:', petHistory.length);
            }
        }
    } catch (e) {
        console.error('Failed to load user data:', e);
    }
}

function saveUserData(options = {}) {
    try {
        if (playerStats && options.touchLocalUpdatedAt !== false) {
            playerStats.localUpdatedAt = Date.now();
        }
        const dataToSave = {
            activePet: playerStats,
            petHistory: petHistory
        };
        const dataPath = getUserDataPath();
        if (dataPath) {
            fs.writeFileSync(dataPath, JSON.stringify(dataToSave, null, 2), 'utf8');
            // console.log(`Saved user data for ${currentUser.displayName} (including history)`);
        }
    } catch (e) {
        console.error('Failed to save user data:', e);
    }
}

function resetPlayerStatsForNewPet({ preservePlacements = true, preserveMeta = false } = {}) {
    const devicePlacements = getDevicePlacePlacements();
    const preservedPlacements = preservePlacements ? (playerStats?.placePlacements || {}) : {};
    const preservedAchievements = preserveMeta ? (playerStats?.achievements || {}) : {};
    const preservedPlaces = preserveMeta ? (playerStats?.discoveredPlaces || []) : [];
    const preservedPark2 = [];
    playerStats = {
        ...INITIAL_STATS,
        lastEvolutionTime: Date.now(),
        lastFedTime: Date.now(),
        lastHungerDamageTime: Date.now()
    };
    playerStats.placePlacements = Object.keys(devicePlacements || {}).length ? devicePlacements : preservedPlacements;
    playerStats.achievements = preservedAchievements;
    playerStats.discoveredPlaces = preservedPlaces;
    playerStats.park2UsedFriendIds = preservedPark2;
    playerStats.debugTimeOffsetHours = 0;
    playerStats.cafeChance = DEFAULT_CAFE_CHANCE;
    playerStats.breedingChance = DEFAULT_BREEDING_CHANCE;
    playerStats.friendIntimacyOverrides = {};
    playerStats.pendingPaydayDebug = false;
    playerStats.forceNewCharacter = true;
    playerStats.dbCharacterId = null;
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

async function getBootstrapFromDB() {
    const data = await apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/sync/bootstrap`
    });
    bootstrapCache = data;
    return data;
}

async function getBootstrapSafe() {
    try {
        return await getBootstrapFromDB();
    } catch (e) {
        return bootstrapCache;
    }
}

async function syncStageFloorFromServerOnLogin() {
    if (!playerStats) return;

    const localLevel = playerStats.level || 0;
    let floor = localLevel;

    try {
        const bootstrap = await getBootstrapFromDB();
        const characterId = playerStats.dbCharacterId;
        const me = bootstrap?.characters?.find((c) => c.id === characterId) || null;

        if (me) {
            const serverStage = me.stageIndex || 0;
            floor = Math.max(localLevel, serverStage);

            if (me.homePlaceId && HOUSE_IDS.includes(me.homePlaceId)) {
                playerStats.assignedHouseId = me.homePlaceId;
            }
        }
    } catch (e) {
        // Fall back to local data if bootstrap fails on login.
    }

    playerStats.lastSyncedStageIndex = floor;
    saveUserData();
}

async function createEventInDB(characterId, eventType, eventText, metadata) {
    if (!characterId) return null;
    try {
        return await apiRequest({
            method: 'POST',
            url: `${API_BASE_URL}/characters/${characterId}/events`,
            data: {
                eventType,
                eventText,
                metadata: metadata || null
            }
        });
    } catch (err) {
        console.error('[Event] Failed to create event:', err.response?.data || err.message);
        return null;
    }
}

async function recordCharacterEvent(eventType, eventText, metadata) {
    const characterId = await getOrSyncCharacterId();
    if (!characterId) return null;
    return createEventInDB(characterId, eventType, eventText, metadata);
}

async function createLineageInDB(childCharacterId, parentACharacterId, parentBCharacterId) {
    if (!childCharacterId || !parentACharacterId || !parentBCharacterId) return null;
    try {
        return await apiRequest({
            method: 'POST',
            url: `${API_BASE_URL}/characters/${childCharacterId}/lineage`,
            data: { parentACharacterId, parentBCharacterId }
        });
    } catch (err) {
        console.error('[Lineage] Failed to create lineage:', err.response?.data || err.message);
        return null;
    }
}

async function tryCreatePendingLineage() {
    if (!ENABLE_DB_SYNC) return;
    if (!playerStats?.pendingLineageParents || playerStats.lineageCreated) return;
    const childCharacterId = playerStats.dbCharacterId;
    if (!childCharacterId) return;

    const { parentACharacterId, parentBCharacterId } = playerStats.pendingLineageParents;
    if (!parentACharacterId || !parentBCharacterId) {
        playerStats.pendingLineageParents = null;
        return;
    }
    // Guard against invalid lineage payloads after merges or partial resets.
    if (
        childCharacterId === parentACharacterId ||
        childCharacterId === parentBCharacterId ||
        parentACharacterId === parentBCharacterId
    ) {
        playerStats.pendingLineageParents = null;
        return;
    }
    const created = await createLineageInDB(childCharacterId, parentACharacterId, parentBCharacterId);
    if (created) {
        playerStats.lineageCreated = true;
        playerStats.pendingLineageParents = null;
        saveUserData();
    }
}

async function getCharacterDetailFromDB(characterId) {
    if (!characterId) return null;
    try {
        return await apiRequest({
            method: 'GET',
            url: `${API_BASE_URL}/characters/${characterId}`
        });
    } catch (err) {
        console.error('[Character] Failed to fetch detail:', err.response?.data || err.message);
        return null;
    }
}

async function getCharacterEventsFromDB(characterId, limit = 30) {
    if (!characterId) return [];
    try {
        const data = await apiRequest({
            method: 'GET',
            url: `${API_BASE_URL}/characters/${characterId}/events`,
            params: { limit }
        });
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[Event] Failed to fetch events:', err.response?.data || err.message);
        return [];
    }
}

function getServerUpdatedAtMillis(updatedAt) {
    if (!updatedAt) return 0;
    const t = new Date(updatedAt).getTime();
    return Number.isFinite(t) ? t : 0;
}

function applyServerCharacterToLocal(me) {
    if (!me || !playerStats) return;

    if (typeof me.stageIndex === 'number') playerStats.level = me.stageIndex;
    if (typeof me.happiness === 'number') playerStats.happiness = me.happiness;
    if (typeof me.health === 'number') playerStats.hp = me.health;
    if (typeof me.intimacyScore === 'number') playerStats.intimacyScore = me.intimacyScore;
    if (me.lastFedAt) playerStats.lastFedTime = new Date(me.lastFedAt).getTime();
    if (me.lastPlayedAt) playerStats.lastPlayTime = new Date(me.lastPlayedAt).getTime();
    if (me.homePlaceId && HOUSE_IDS.includes(me.homePlaceId)) {
        playerStats.assignedHouseId = me.homePlaceId;
    }

    playerStats.serverVersion = me.version || playerStats.serverVersion || 0;
    playerStats.serverUpdatedAt = getServerUpdatedAtMillis(me.updatedAt);
    playerStats.localUpdatedAt = playerStats.serverUpdatedAt;
}

async function syncFullStateFromDB() {
    try {
        if (!global.authTokens) return;
        if (playerStats?.forceNewCharacter) {
            return;
        }

        // Fetch latest data from DB
        const bootstrap = await getBootstrapSafe();
        const characters = bootstrap?.characters || [];

        // Find my character
        let me = null;
        if (playerStats?.dbCharacterId) {
            me = characters.find((c) => c.id === playerStats.dbCharacterId);
        }

        // If not found by ID (new device), find by logic
        if (!me) {
            me = characters.find((c) => c.isAlive) || characters[0];
            if (me) {
                playerStats.dbCharacterId = me.id;
            }
        }

        if (!me) {
            return;
        }


        const serverVersion = me.version || 0;
        const serverUpdatedAt = getServerUpdatedAtMillis(me.updatedAt);
        const localUpdatedAt = playerStats.localUpdatedAt || 0;
        const localServerVersion = playerStats.serverVersion || 0;

        const shouldPullFromServer = serverVersion > localServerVersion || serverUpdatedAt > localUpdatedAt;

        if (shouldPullFromServer) {
            applyServerCharacterToLocal(me);
        } else {
            // Keep local-first data, but carry forward server markers.
            playerStats.serverVersion = localServerVersion || serverVersion;
            playerStats.serverUpdatedAt = Math.max(playerStats.serverUpdatedAt || 0, serverUpdatedAt);
        }

        // Restore English Name & Image Path (For new device / missing local data)
        if (!playerStats.characterName && me.name) {
            const engName = getEnglishNameFromKorean(me.name);
            if (engName) {
                playerStats.characterName = engName;

                // Restore Image Path
                if (me.stageIndex === 0) {
                    playerStats.characterImage = path.join(__dirname, 'assets/level0/level0.png');
                } else {
                    const paths = [
                        path.join(__dirname, 'assets', `level${me.stageIndex}`, engName, 'normal.webp'),
                        path.join(__dirname, 'assets', `level${me.stageIndex}`, engName, 'normal.png')
                    ];
                    const validPath = paths.find(p => fs.existsSync(p));
                    if (validPath) {
                        playerStats.characterImage = validPath;
                    }
                }
            }
        }

        playerStats.lastSyncedStageIndex = Math.max(playerStats.level || 0, playerStats.lastSyncedStageIndex || 0);
        saveUserData({ touchLocalUpdatedAt: !shouldPullFromServer });

        // If local looks newer, push it up once after login.
        if (!shouldPullFromServer && localUpdatedAt > serverUpdatedAt) {
            await syncCharacterToDB();
        }

    } catch (e) {
        console.error('[Sync] Failed:', e);
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

function applyFriendDebugOverrides(friends = []) {
    if (!playerStats?.friendIntimacyOverrides) return friends;
    return friends.map((f) => {
        const override = playerStats.friendIntimacyOverrides[f.friendCharacterId];
        if (typeof override !== 'number') return f;
        return { ...f, intimacy: override };
    });
}

async function getFriends(characterId) {
    const data = await apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/characters/${characterId}/friends`
    });
    return applyFriendDebugOverrides(Array.isArray(data) ? data : []);
}

async function refreshFriendsCache(force = false) {
    if (!ENABLE_DB_SYNC || !playerStats || !global.authTokens) return;
    const now = Date.now();
    if (!force && now - friendsCacheAt < 5 * 60 * 1000) return;
    const characterId = await getOrSyncCharacterId();
    if (!characterId) return;
    try {
        friendsCache = await getFriends(characterId);
        friendsCacheAt = now;
    } catch (err) {
        // Cache refresh is best-effort.
    }
}

async function getFriendMessages(characterId, friendCharacterId, limit = 30) {
    return apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/characters/${characterId}/friends/${friendCharacterId}/messages`,
        params: { limit }
    });
}

async function sendFriendMessage(characterId, friendCharacterId, messageText, emoteId) {
    return apiRequest({
        method: 'POST',
        url: `${API_BASE_URL}/characters/${characterId}/friends/${friendCharacterId}/messages`,
        data: { messageText, emoteId }
    });
}

async function getLineageGraph(characterId, depth = 4) {
    return apiRequest({
        method: 'GET',
        url: `${API_BASE_URL}/characters/${characterId}/lineage`,
        params: { depth }
    });
}

// Call LLM API (with optional screenshot)
// Call LLM API (with optional screenshot)
async function updateFriendIntimacy(characterId, friendCharacterId, intimacy) {
    try {
        return await apiRequest({
            method: 'PATCH',
            url: `${API_BASE_URL}/characters/${characterId}/friends/${friendCharacterId}`,
            data: { intimacy }
        });
    } catch (err) {
        console.error('Failed to update friend intimacy:', err.response?.data || err.message);
        return null;
    }
}

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
                userMessage: userMessage || ''
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

            // Try to parse and display detailed error
            try {
                const errorJson = JSON.parse(errText);
                console.error('[LLM] Detailed Error:', JSON.stringify(errorJson, null, 2));
            } catch (e) {
                // Not JSON, already logged as text
            }

            throw new Error(`API Error ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (err) {
        console.error('[LLM] Request failed:', err.message);
        return null;
    }
}

function handleLlmActions(llmResponse) {
    if (!llmResponse || !Array.isArray(llmResponse.actions)) return;
    const hasPayday = llmResponse.actions.some((a) => (a?.type || '').toUpperCase() === 'PAYDAY');
    if (hasPayday) {
        triggerPaydaySequence();
    }
}

function resolveEmotionOverride(defaultEmotion = 'happy') {
    if (playerStats?.sickModeActive) return 'sad';
    const reason = playerStats?.forcedAwayReason;
    if (reason === 'SCHOOL') return 'boring';
    if (reason === 'PAYDAY_POLICE') return 'sad';
    return defaultEmotion;
}

ipcMain.handle('llm-chat', async (event, { message } = {}) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) {
            return { success: false, message: '캐릭터 동기화가 아직 안 됐어.' };
        }
        if (playerStats?.sickModeActive && !playerStats?.sickRecovered) {
            if (characterWindow && !characterWindow.isDestroyed()) {
                characterWindow.webContents.send('show-speech', '쿨럭쿨럭');
            }
            return { success: true, data: { message: '쿨럭쿨럭' } };
        }
        if (isBreedingActive()) {
            if (characterWindow && !characterWindow.isDestroyed()) {
                characterWindow.webContents.send('show-speech', '...');
            }
            return { success: true, data: { message: '...' } };
        }
        const text = (message || '').trim();
        if (!text) {
            return { success: false, message: '메시지를 입력해줘.' };
        }

        const res = await callLlmApi(characterId, text, '', null);
        if (res?.message) {
            handleLlmActions(res);
            if (characterWindow && !characterWindow.isDestroyed()) {
                characterWindow.webContents.send('show-speech', res.message);
                const emotion = resolveEmotionOverride(res.emotion || 'happy');
                characterWindow.webContents.send('set-emotion', emotion);
            }
            if (typeof res.intimacyScore === 'number') {
                playerStats.intimacyScore = res.intimacyScore;
                // Server is source of truth for intimacy.
                saveUserData({ touchLocalUpdatedAt: false });
            }
            playerStats.sickRecovered = false;
            return { success: true, data: res };
        }
        return { success: false, message: '응답을 받지 못했어.' };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

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
        if (playerStats.forceNewCharacter) {
            const koreanName = getKoreanName(playerStats.characterName);
            const newChar = await createCharacterInDB(
                koreanName || '새 친구',
                '고양이',
                '다마고치 스타일 캐릭터'
            );
            if (newChar) {
                playerStats.dbCharacterId = newChar.id;
                playerStats.serverVersion = newChar.version ?? 0;
                playerStats.serverUpdatedAt = getServerUpdatedAtMillis(newChar.updatedAt);
                playerStats.localUpdatedAt = playerStats.serverUpdatedAt;
                playerStats.forceNewCharacter = false;
            }
        } else {
            // Try to get existing characters first
            const existingChars = await getCharactersFromDB();
            if (existingChars.length > 0) {
                // Use the first alive character
                const aliveChar = existingChars.find(c => c.isAlive) || existingChars[0];
                playerStats.dbCharacterId = aliveChar.id;
                playerStats.lastSyncedStageIndex = aliveChar.stageIndex ?? aliveChar.stage_index ?? 0;
                playerStats.serverVersion = aliveChar.version ?? playerStats.serverVersion ?? 0;
                playerStats.serverUpdatedAt = getServerUpdatedAtMillis(aliveChar.updatedAt);
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
                    playerStats.serverVersion = newChar.version ?? 0;
                    playerStats.serverUpdatedAt = getServerUpdatedAtMillis(newChar.updatedAt);
                    playerStats.localUpdatedAt = playerStats.serverUpdatedAt;
                }
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
        const assignedHouseId = ensureAssignedHouseId();

        const updated = await updateCharacterInDB(playerStats.dbCharacterId, {
            name: getKoreanName(playerStats.characterName),
            happiness: playerStats.happiness,
            health: playerStats.hp,
            stageIndex: safeStageIndex,
            intimacyScore: playerStats.intimacyScore,
            homePlaceId: assignedHouseId || null,
            lastFedAt: playerStats.lastFedTime ? new Date(playerStats.lastFedTime).toISOString() : null,
            lastPlayedAt: playerStats.lastPlayTime ? new Date(playerStats.lastPlayTime).toISOString() : null
        });

        if (updated) {
            if (typeof updated.stageIndex === 'number') {
                playerStats.lastSyncedStageIndex = updated.stageIndex;
            } else {
                playerStats.lastSyncedStageIndex = safeStageIndex;
            }
            if (typeof updated.version === 'number') {
                playerStats.serverVersion = updated.version;
            }
            playerStats.serverUpdatedAt = getServerUpdatedAtMillis(updated.updatedAt);
            playerStats.localUpdatedAt = playerStats.serverUpdatedAt || Date.now();
        } else {
            playerStats.lastSyncedStageIndex = safeStageIndex;
        }

        // If we have a pending parent pair, persist it once the child exists in DB.
        tryCreatePendingLineage();
    }
}

async function getOrSyncCharacterId() {
    if (!playerStats) return null;
    if (!playerStats.dbCharacterId) {
        await syncCharacterToDB();
    }
    return playerStats.dbCharacterId || null;
}

function getCharacterDetailsMap(characters = []) {
    const map = new Map();
    characters.forEach((c) => map.set(c.id, c));
    return map;
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
        width: 315,
        height: 640,
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

ipcMain.on('open-lineage', () => {
    if (mainWindow) {
        mainWindow.loadFile('lineage.html');
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

ipcMain.handle('debug-adjust-stat', async (event, payload = {}) => {
    if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
    const key = payload.key;
    const delta = Number(payload.delta) || 0;
    const clamp = (value) => Math.max(0, Math.min(100, value));
    const beforeLocalUpdatedAt = playerStats.localUpdatedAt;

    switch (key) {
        case 'intimacyScore': {
            const current = Number(playerStats.intimacyScore) || 0;
            playerStats.intimacyScore = clamp(current + delta);
            break;
        }
        case 'happiness': {
            const current = Number(playerStats.happiness) || 0;
            playerStats.happiness = clamp(current + delta);
            break;
        }
        case 'hp': {
            const current = Number(playerStats.hp) || 0;
            playerStats.hp = clamp(current + delta);
            if (playerStats.hp > 0) {
                playerStats.deathEventSent = false;
            }
            break;
        }
        case 'evolutionProgress': {
            const current = Number(playerStats.evolutionProgress) || 0;
            playerStats.evolutionProgress = clamp(current + delta);
            maybeEvolveFromProgress();
            break;
        }
        case 'feedCount': {
            const current = Number(playerStats.feedCount) || 0;
            playerStats.feedCount = Math.max(0, current + delta);
            break;
        }
        case 'visibleMinutes': {
            const current = Number(playerStats.visibleAccumMillis) || 0;
            const next = Math.max(0, current + delta * 60 * 1000);
            playerStats.visibleAccumMillis = next;
            break;
        }
        case 'cafeChance': {
            const current = Number(playerStats.cafeChance) || 0;
            const next = Math.max(0, Math.min(1, current + delta));
            playerStats.cafeChance = next;
            break;
        }
        case 'breedingChance': {
            const current = Number(playerStats.breedingChance) || 0;
            const next = Math.max(0, Math.min(1, current + delta));
            playerStats.breedingChance = next;
            break;
        }
        case 'timeOffsetHours': {
            const current = Number(playerStats.debugTimeOffsetHours) || 0;
            const next = Math.max(-23, Math.min(23, current + delta));
            playerStats.debugTimeOffsetHours = next;
            if (houseWindow && !houseWindow.isDestroyed()) {
                houseWindow.webContents.send('debug-time-updated', {
                    offsetHours: playerStats.debugTimeOffsetHours
                });
            }
            break;
        }
        default:
            return { success: false, message: '알 수 없는 항목이야.' };
    }

    if (playerStats && typeof playerStats.localUpdatedAt === 'number') {
        playerStats.localUpdatedAt = Date.now();
    }

    try {
        if (key === 'intimacyScore') {
            const characterId = await getOrSyncCharacterId();
            if (characterId) {
                const updated = await updateCharacterInDB(characterId, {
                    intimacyScore: playerStats.intimacyScore
                });
                if (updated && typeof updated.version === 'number') {
                    playerStats.serverVersion = updated.version;
                }
                if (updated?.updatedAt) {
                    playerStats.serverUpdatedAt = getServerUpdatedAtMillis(updated.updatedAt);
                }
            }
        }
        await syncCharacterToDB();
    } catch (err) {
        if (typeof beforeLocalUpdatedAt === 'number') {
            playerStats.localUpdatedAt = beforeLocalUpdatedAt;
        }
        return { success: false, message: '서버 동기화 실패' };
    }

    return { success: true };
});

ipcMain.handle('debug-force-park2', async () => {
    try {
        if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
        await refreshFriendsCache(true);
        let friendId = getEligiblePark2FriendId();
        if (!friendId) {
            const fallback = (friendsCache || [])[0];
            friendId = fallback?.friendCharacterId || null;
        }
        if (!friendId) return { success: false, message: '친구가 없어.' };
        setForcedAway('park2', 'PARK2', { friendCharacterId: friendId });
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

ipcMain.handle('debug-force-place', async (event, { placeId } = {}) => {
    try {
        if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
        if (!placeId) return { success: false, message: '장소가 없어.' };
        if (placeId.startsWith('house')) {
            return { success: false, message: '집은 제외야.' };
        }
        if (placeId === 'park2') {
            await refreshFriendsCache(true);
            let friendId = getEligiblePark2FriendId();
            if (!friendId) {
                const fallback = (friendsCache || [])[0];
                friendId = fallback?.friendCharacterId || null;
            }
            if (!friendId) return { success: false, message: '친구가 없어.' };
            setForcedAway('park2', 'PARK2', { friendCharacterId: friendId });
            return { success: true };
        }
        const place = getPlaceById(placeId);
        if (!place) return { success: false, message: '알 수 없는 장소야.' };
        setForcedAway(placeId, 'DEBUG');
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

ipcMain.handle('debug-prepare-place', async (event, { placeId } = {}) => {
    try {
        if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
        if (!placeId) return { success: false, message: '장소가 없어.' };
        if (placeId.startsWith('house')) {
            return { success: false, message: '집은 제외야.' };
        }

        switch (placeId) {
            case 'bank': {
                playerStats.level = Math.max(playerStats.level || 0, 3);
                playerStats.intimacyScore = Math.max(playerStats.intimacyScore || 0, 90);
                playerStats.pendingPaydayDebug = true;
                break;
            }
            case 'police': {
                playerStats.pendingPoliceAfterBank = true;
                break;
            }
            case 'cafe': {
                playerStats.level = Math.max(playerStats.level || 0, 2);
                playerStats.cafePending = true;
                break;
            }
            case 'school': {
                playerStats.level = 2;
                const now = new Date();
                const targetHour = 10;
                const offset = targetHour - now.getHours();
                playerStats.debugTimeOffsetHours = Math.max(-23, Math.min(23, offset));
                playerStats.schoolLastDate = null;
                break;
            }
            case 'toilet': {
                playerStats.feedCount = Math.max(playerStats.feedCount || 0, 3);
                break;
            }
            case 'park2': {
                playerStats.level = Math.max(playerStats.level || 0, 2);
                await refreshFriendsCache(true);
                const friend = (friendsCache || [])[0];
                if (!friend) return { success: false, message: '친구가 없어.' };
                if (!playerStats.friendIntimacyOverrides || typeof playerStats.friendIntimacyOverrides !== 'object') {
                    playerStats.friendIntimacyOverrides = {};
                }
                playerStats.friendIntimacyOverrides[friend.friendCharacterId] = 70;
                const used = new Set(playerStats.park2UsedFriendIds || []);
                used.delete(friend.friendCharacterId);
                playerStats.park2UsedFriendIds = Array.from(used);
                break;
            }
            case 'pharmacy': {
                const FIVE_HOURS = 5 * 60 * 60 * 1000;
                playerStats.visibleAccumMillis = FIVE_HOURS;
                break;
            }
            default:
                return { success: false, message: '알 수 없는 장소야.' };
        }

        saveUserData({ touchLocalUpdatedAt: false });
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

async function checkPlaceConditionsFromDebug() {
    if (!playerStats || !isGameRunning) return false;
    await refreshFriendsCache(true);
    if (maybeTriggerPoliceAfterBank()) return true;
    if (maybeTriggerSchoolVisit()) return true;
    if (maybeTriggerCafeVisit()) return true;
    if (maybeTriggerToiletVisit()) return true;
    if (maybeTriggerPark2Visit()) return true;
    return false;
}

ipcMain.handle('debug-check-places', async () => {
    try {
        const triggered = await checkPlaceConditionsFromDebug();
        return { success: true, triggered };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

ipcMain.handle('debug-force-breeding', async () => {
    try {
        if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
        playerStats.level = Math.max(playerStats.level || 0, 3);
        await refreshFriendsCache(true);
        if (!friendsCache || !friendsCache.length) {
            return { success: false, message: '친구가 없어.' };
        }
        const friend = friendsCache[0];
        if (!playerStats.friendIntimacyOverrides || typeof playerStats.friendIntimacyOverrides !== 'object') {
            playerStats.friendIntimacyOverrides = {};
        }
        playerStats.friendIntimacyOverrides[friend.friendCharacterId] = 100;
        saveUserData({ touchLocalUpdatedAt: false });
        const started = await startBreedingFlow(friend);
        if (started && homeWindow) {
            homeWindow.webContents.send('home-speech', '...');
        }
        return { success: started };
    } catch (err) {
        return { success: false, message: err.message };
    }
});
ipcMain.handle('debug-adjust-friend-intimacy', async (event, payload = {}) => {
    if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
    const friendCharacterId = payload.friendCharacterId;
    const delta = Number(payload.delta) || 0;
    if (!friendCharacterId) return { success: false, message: '친구 정보를 찾지 못했어.' };

    const currentFriend = (friendsCache || []).find((f) => f.friendCharacterId === friendCharacterId);
    const baseValue = Number(
        playerStats.friendIntimacyOverrides?.[friendCharacterId] ??
        currentFriend?.intimacy ??
        0
    ) || 0;
    const next = Math.max(0, Math.min(100, baseValue + delta));

    if (!playerStats.friendIntimacyOverrides || typeof playerStats.friendIntimacyOverrides !== 'object') {
        playerStats.friendIntimacyOverrides = {};
    }
    playerStats.friendIntimacyOverrides[friendCharacterId] = next;

    if (currentFriend) {
        currentFriend.intimacy = next;
    }

    saveUserData({ touchLocalUpdatedAt: false });
    return { success: true, intimacy: next };
});

ipcMain.handle('reset-game', () => {
    // 1. Archive current dead pet into history
    if (playerStats) {
        // Add death timestamp or mark it
        const deadPet = { ...playerStats, deathTime: Date.now() };
        petHistory.push(deadPet);
    }
    resetPlayerStatsForNewPet({ preservePlacements: true, preserveMeta: true });

    saveUserData();
    return { success: true };
});

function handleDeath() {
    if (characterWindow) {
        characterWindow.close();
        characterWindow = null;
    }
    console.log('--- CHARACTER HAS DIED ---');
    if (!playerStats.firstDeathAchievement) {
        markAchievement(
            'first-death-tamagotchi',
            '사람이 죽으면 먼저 가있던 다마고치가 마중나온다는 말이 있다.',
            '나는 이 말을 정말 좋아한다.'
        );
        playerStats.firstDeathAchievement = true;
    }
    playerStats.debugTimeOffsetHours = 0;
    playerStats.cafeChance = DEFAULT_CAFE_CHANCE;
    playerStats.breedingChance = DEFAULT_BREEDING_CHANCE;
    playerStats.friendIntimacyOverrides = {};
    playerStats.pendingPaydayDebug = false;
    if (!playerStats.deathEventSent) {
        playerStats.deathEventSent = true;
        recordCharacterEvent('DEATH', '세상을 떠났다.', {
            level: playerStats.level,
            happiness: playerStats.happiness
        });
        saveUserData();
    }
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

function resolveSpritePathFor(name, level, emotion = 'normal.webp') {
    if (!name) return null;
    const candidate = path.join(__dirname, `assets/level${level}`, name, emotion);
    if (fs.existsSync(candidate)) return candidate;
    const fallback = path.join(__dirname, `assets/level${level}`, name, 'normal.webp');
    if (fs.existsSync(fallback)) return fallback;
    return null;
}

function normalizeCharacterKey(name) {
    if (!name) return null;
    return getEnglishNameFromKorean(name) || name;
}

function resolveBreedingPartnerImageUrl(partner) {
    const partnerName = partner?.friendName || '';
    const partnerPath =
        resolveSpritePathFor(partnerName, 3, 'kissing.webp') ||
        resolveSpritePathFor(partnerName, 3, 'normal.webp') ||
        path.join(__dirname, 'assets/level3/mametchi/normal.webp');
    return pathToFileURL(partnerPath).toString();
}

function resolveBreedingPartnerNormalImageUrl(partner) {
    const partnerName = partner?.friendName || '';
    const partnerPath =
        resolveSpritePathFor(partnerName, 3, 'normal.webp') ||
        path.join(__dirname, 'assets/level3/mametchi/normal.webp');
    return pathToFileURL(partnerPath).toString();
}

async function createHouseWindow(
    placeId = 'home',
    isNewPlace = false,
    breedingStage = null,
    breedingPartner = null,
    companion = null
) {
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
    const placementData = resolvePlacementForView(place.id);
    const placementName = normalizePlacePlacement(place.id)?.customName;
    const isNightHours = getGameNow().getHours() < 6;
    const sleeping = isNightHours;
    const isBreedingKissing = breedingStage === BREEDING_STAGES.KISSING;
    const isBreedingEggHome = breedingStage === BREEDING_STAGES.EGG_HOME;
    const debugPlacement = breedingStage === 'DEBUG';

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

    let spritePath = playerStats?.characterImage || '';
    if (isBreedingEggHome) {
        spritePath = '';
    } else if (isBreedingKissing) {
        const kissingPath =
            resolveSpritePathFor(playerStats.characterName, 3, 'kissing.webp') ||
            resolveSpritePathFor(playerStats.characterName, 3, 'normal.webp');
        if (kissingPath) spritePath = kissingPath;
    } else if (sleeping) {
        const sleepPath =
            resolveSpritePathFor(playerStats.characterName, playerStats.level || 1, 'sleeping.webp') ||
            resolveSpritePathFor(playerStats.characterName, playerStats.level || 1, 'normal.webp');
        if (sleepPath) spritePath = sleepPath;
    } else {
        const placeEmotionMap = {
            bank: 'happy',
            police: 'sad',
            cafe: 'happy',
            school: 'boring',
            toilet: 'happy',
            park2: 'happy'
        };
        const emotion = placeEmotionMap[place.id];
        if (emotion) {
            const emotionPath =
                resolveSpritePathFor(playerStats.characterName, playerStats.level || 1, `${emotion}.webp`) ||
                resolveSpritePathFor(playerStats.characterName, playerStats.level || 1, 'normal.webp');
            if (emotionPath) spritePath = emotionPath;
        }
    }
    const imgUrl = spritePath ? pathToFileURL(spritePath).toString() : '';
    const partnerImgUrl = isBreedingKissing ? resolveBreedingPartnerImageUrl(breedingPartner) : '';

    let companionImgUrl = '';
    let companionPlacement = null;
    if (place.id === 'park2' && companion?.name) {
        const rawName = companion.name;
        const normalized = normalizeCharacterKey(rawName);
        const rawLevel = Number(companion.friendLevel);
        const compLevel = Number.isFinite(rawLevel) && rawLevel >= 1 ? rawLevel : 3;
        const compPath =
            resolveSpritePathFor(normalized, compLevel, 'happy.webp') ||
            resolveSpritePathFor(normalized, compLevel, 'normal.webp') ||
            resolveSpritePathFor(normalized, 3, 'happy.webp') ||
            resolveSpritePathFor(normalized, 3, 'normal.webp') ||
            resolveSpritePathFor(normalized, 2, 'happy.webp') ||
            resolveSpritePathFor(normalized, 2, 'normal.webp') ||
            resolveSpritePathFor(normalized, 1, 'happy.webp') ||
            resolveSpritePathFor(normalized, 1, 'normal.webp');
        if (compPath) companionImgUrl = pathToFileURL(compPath).toString();
        companionPlacement = getPlacementByLabel(place.id, '다리2');
    }
    const primaryPlacement = place.id === 'park2'
        ? (getPlacementByLabel(place.id, '다리1') || placementData)
        : placementData;

    try {
        houseWindow.loadFile('house-viewer.html', {
            query: {
                mode: 'overlay',
                img: imgUrl,
                screen: '',
                placeId: place.id,
                placeName: placementName || place.name,
                model: place.model,
                isNew: isNewPlace ? '1' : '0',
                sleeping: sleeping ? '1' : '0',
                level: String(playerStats?.level ?? 0),
                hasEgg: (playerStats && playerStats.hasEgg) ? '1' : '0',
                breedingStage: breedingStage || '',
                breeding: isBreedingKissing ? '1' : '0',
                partnerImg: partnerImgUrl,
                partnerName: breedingPartner?.friendName || '',
                partnerCharacterId: breedingPartner?.friendCharacterId || '',
                debugPlacement: debugPlacement ? '1' : '0',
                placementX: primaryPlacement?.x ?? '',
                placementY: primaryPlacement?.y ?? '',
                placementZ: primaryPlacement?.z ?? '',
                placementModelY: primaryPlacement?.modelY ?? '',
                companionImg: companionImgUrl,
                companionX: companionPlacement?.x ?? '',
                companionY: companionPlacement?.y ?? '',
                companionZ: companionPlacement?.z ?? '',
                timeOffsetHours: String(playerStats?.debugTimeOffsetHours ?? 0)
            }
        });
    } catch (err) {
        console.error('House viewer load error:', err);
    }
    houseWindow.on('closed', () => {
        houseWindow = null;
    });

    houseWindow.webContents.on('did-finish-load', () => {
        if (!houseWindow) return;
        houseWindow.setBounds(
            { x: targetX, y: targetY, width: targetWidth, height: targetHeight },
            true
        );
        houseWindow.show();
        if (screenCaptureUrl) {
            houseWindow.webContents.send('house-screen', screenCaptureUrl);
        }

        // DEBUG: Open devTools for breeding debugging
        houseWindow.webContents.openDevTools({ mode: 'detach' });
    });
}

// ==================== CHARACTER WINDOW ====================
const CHAT_WINDOW_WIDTH = 280;
const CHAT_WINDOW_HEIGHT = 128;
const CHAT_WINDOW_OFFSET_Y = -6;

function positionChatWindow() {
    if (!chatWindow || !characterWindow) return;
    const bounds = characterWindow.getBounds();
    const x = Math.round(bounds.x + (bounds.width - CHAT_WINDOW_WIDTH) / 2);
    const y = Math.round(bounds.y + bounds.height + CHAT_WINDOW_OFFSET_Y);
    chatWindow.setBounds({ x, y, width: CHAT_WINDOW_WIDTH, height: CHAT_WINDOW_HEIGHT });
}

function closeChatWindow() {
    if (!chatWindow) return;
    try {
        chatWindow.close();
    } catch (e) { }
    chatWindow = null;
}

function createChatWindow() {
    if (!characterWindow) return;
    if (chatWindow && !chatWindow.isDestroyed()) {
        positionChatWindow();
        chatWindow.show();
        chatWindow.focus();
        return;
    }

    chatWindow = new BrowserWindow({
        width: CHAT_WINDOW_WIDTH,
        height: CHAT_WINDOW_HEIGHT,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });
    chatWindow.setAlwaysOnTop(true, 'screen-saver');
    chatWindow.moveTop();
    chatWindow.loadFile('chat.html');
    chatWindow.webContents.on('did-finish-load', () => {
        positionChatWindow();
        chatWindow.show();
        chatWindow.focus();
        try {
            chatWindow.webContents.send('chat-focus');
        } catch (e) { }
    });
    chatWindow.on('closed', () => {
        chatWindow = null;
    });
}

function createCharacterWindow() {
    playerStats.awayModeActive = false;
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
        if (!characterState.isReturningHome && !characterState.isFocusMode && !characterState.isWindowDragging) {
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
        if (characterState.isWindowDragging) {
            x = currentBounds.x;
            y = currentBounds.y;
            positionChatWindow();
            return;
        }
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
            positionChatWindow();
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
            positionChatWindow();

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
        closeChatWindow();

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

// ==================== WINDOW MANAGEMENT ====================

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

function loadDeviceData() {
    try {
        if (fs.existsSync(deviceDataPath)) {
            return JSON.parse(fs.readFileSync(deviceDataPath, 'utf8')) || {};
        }
    } catch (e) { }
    return {};
}

function getDevicePlacePlacements() {
    const data = loadDeviceData();
    return (data && data.placePlacements) ? data.placePlacements : {};
}

function saveDevicePlacePlacements(placePlacements) {
    try {
        const data = loadDeviceData();
        data.placePlacements = placePlacements || {};
        fs.writeFileSync(deviceDataPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save device place placements:', e);
    }
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
        await syncFullStateFromDB();
        recomputeSleepMode(new Date());
        await syncStageFloorFromServerOnLogin();
        refreshFriendsCache(true);
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
    recomputeSleepMode(getGameNow());

    if (isBreedingActive()) {
        let placeId = 'school';
        if (playerStats.breedingStage === BREEDING_STAGES.EGG_HOME) {
            placeId = ensureAssignedHouseId() || 'house1';
        } else if (playerStats.breedingStage === BREEDING_STAGES.CRADLE) {
            placeId = 'cradle';
        }
        addDiscoveredPlace(placeId);
        const discoveredPlaces = (playerStats.discoveredPlaces || []).map((id) => getPlaceById(id));
        saveUserData({ touchLocalUpdatedAt: false });
        return {
            place: getPlaceById(placeId),
            isNew: false,
            discoveredPlaces,
            breedingStage: playerStats.breedingStage,
            breedingPartner: playerStats.breedingPartner || null,
            hasEgg: playerStats.hasEgg,
            companion: placeId === 'park2' ? (() => {
                const friendId = playerStats.forcedAwayMeta?.friendCharacterId;
                if (!friendId) return null;
                const friend = (friendsCache || []).find((f) => f.friendCharacterId === friendId);
                if (!friend) return null;
                return {
                    name: friend.friendName,
                    species: friend.friendSpecies || null,
                    friendLevel: friend.friendLevel ?? friend.friendStageIndex ?? null
                };
            })() : null
        };
    }

    if (characterWindow && !characterState.isReturningHome) {
        return { alreadyVisible: true };
    }

    let place;
    const park2FriendId = playerStats?.forcedAwayMeta?.friendCharacterId || null;
    if (playerStats.level === 0) {
        place = getPlaceById('cradle');
        if (!isBreedingActive()) {
            markAchievement('lullaby-baby', '자장자장 우리아가');
        }
    } else if (playerStats.sickModeActive) {
        ensureSickForcedAway();
        place = getPlaceById('pharmacy');
    } else if (playerStats.sleepModeActive) {
        const assignedHouseId = ensureAssignedHouseId();
        place = getPlaceById(assignedHouseId || 'house1');
    } else if (playerStats.forcedAwayPlaceId) {
        place = getPlaceById(playerStats.forcedAwayPlaceId);
        resolveForcedAwayOnPeek(place.id);
    } else if (playerStats.awayModeActive) {
        place = pickAwayPlace();
        playerStats.awayModeActive = false;
        saveUserData();
    } else {
        const assignedHouseId = ensureAssignedHouseId();
        place = getPlaceById(assignedHouseId || 'house1');
    }

    addDiscoveredPlace(place.id);
    saveUserData();
    const discoveredPlaces = playerStats.discoveredPlaces.map((id) => getPlaceById(id));
    // Peek always starts with the erase overlay.
    const companion = place.id === 'park2' && park2FriendId
        ? (() => {
            const friend = (friendsCache || []).find((f) => f.friendCharacterId === park2FriendId);
            if (!friend) return null;
            return {
                name: friend.friendName,
                species: friend.friendSpecies || null,
                friendLevel: friend.friendLevel ?? friend.friendStageIndex ?? null
            };
        })()
        : null;
    return { place, isNew: true, discoveredPlaces, companion };
});

ipcMain.handle('get-places', () => {
    if (playerStats.level === 0) {
        const cradle = getPlaceById('cradle');
        return [{ ...cradle, unlocked: true }];
    }

    const assignedHouseId = ensureAssignedHouseId();
    const assignedHouse = getPlaceById(assignedHouseId || 'house1');
    return [{ ...assignedHouse, unlocked: true }];
});

ipcMain.on('open-house-viewer', (event, payload = {}) => {
    if (houseWindow) {
        houseWindow.close();
        return;
    }
    if (characterWindow && !characterState.isReturningHome) {
        characterState.isReturningHome = true;
        closeChatWindow();
    }
    recomputeSleepMode(new Date());
    const placeId = payload.placeId || 'home';
    const isNewPlace = !!payload.isNew;
    const breedingStage = payload.debugPlacement
        ? 'DEBUG'
        : (payload.breedingStage || (isBreedingActive() ? playerStats.breedingStage : null));
    const breedingPartner = payload.breedingPartner || playerStats?.breedingPartner || null;
    const companion = payload.companion || null;
    createHouseWindow(placeId, isNewPlace, breedingStage, breedingPartner, companion);
});

ipcMain.on('close-house-viewer', () => {
    if (houseWindow) houseWindow.close();
});

ipcMain.handle('get-all-places', () => {
    const data = PLACES.map((place) => {
        const normalized = normalizePlacePlacement(place.id);
        return {
            ...place,
            name: normalized?.customName || place.name
        };
    });
    return { success: true, data };
});

ipcMain.handle('capture-primary-screen', async () => {
    return capturePrimaryScreenDataUrl();
});

ipcMain.on('toggle-focus-mode', (event, isFocusOn) => {
    characterState.isFocusMode = isFocusOn;
});

ipcMain.on('open-chat-window', () => {
    createChatWindow();
});

ipcMain.on('toggle-character', () => {
    if (characterWindow) {
        (async () => {
            const breedingStarted = await startBreedingFlow();
            if (breedingStarted) {
                if (homeWindow) homeWindow.webContents.send('home-speech', '...');
                if (!characterState.isReturningHome) {
                    characterState.isReturningHome = true;
                    closeChatWindow();
                }
                return;
            }
            if (!characterState.isReturningHome) {
                characterState.isReturningHome = true;
                closeChatWindow();
            }
        })().catch((e) => console.error('[Home] toggle-character (out) failed', e));
    } else {
        (async () => {
            recomputeSleepMode(new Date());
            if (isBreedingActive()) {
                if (homeWindow) homeWindow.webContents.send('home-speech', '...');
                return;
            }

            refreshFriendsCache();
            if (playerStats.sleepModeActive) {
                playerStats.awayModeActive = false;
                saveUserData();
                if (homeWindow) {
                    homeWindow.webContents.send('home-speech', '...');
                }
                return;
            }
            if (playerStats.forcedAwayPlaceId) {
                if (homeWindow) {
                    homeWindow.webContents.send('home-speech', '...');
                }
                return;
            }

        // Breeding starts only when the user presses home and conditions are met.
        const breedingStarted = await startBreedingFlow();
        if (breedingStarted) {
            if (homeWindow) homeWindow.webContents.send('home-speech', '...');
            return;
        }

        if (playerStats.pendingPaydayDebug) {
            playerStats.pendingPaydayDebug = false;
            triggerPaydaySequence();
            if (homeWindow) homeWindow.webContents.send('home-speech', '...');
            return;
        }

        if (maybeTriggerPoliceAfterBank()) return;
        if (maybeTriggerCafeVisit()) return;
        if (maybeTriggerSchoolVisit()) return;
        if (maybeTriggerToiletVisit()) return;
            if (maybeTriggerPark2Visit()) return;
            if (playerStats.awayModeActive) {
                playerStats.awayModeActive = false;
                saveUserData();
                createCharacterWindow();
                return;
            }
            if (playerStats.level >= 1 && Math.random() < 0.3) {
                playerStats.awayModeActive = true;
                saveUserData();
                if (homeWindow) {
                    homeWindow.webContents.send('home-speech', '...');
                }
                return;
            }
            createCharacterWindow();
        })().catch((e) => console.error('[Home] toggle-character failed', e));
    }
});

ipcMain.handle('wake-up-from-sleep', async () => {
    try {
        if (!playerStats) return { success: false, message: '캐릭터가 없어.' };
        const now = new Date();
        const todayKey = toDateKey(now);

        playerStats.happiness = Math.max(0, (playerStats.happiness || 0) - 10);
        playerStats.wokeUpEarlyDate = todayKey;
        playerStats.sleepModeActive = false;
        characterState.isSleeping = false;
        saveUserData();

        if (!characterWindow) {
            createCharacterWindow();
        }
        setTimeout(() => {
            if (characterWindow) {
                characterWindow.webContents.send('show-speech', '아 왜 깨워... 짜증나.');
            }
        }, 400);

        syncCharacterToDB();
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

ipcMain.handle('pharmacy-take-medicine', async () => {
    try {
        if (!playerStats?.sickModeActive) {
            return { success: false, message: '지금은 약이 필요 없어.' };
        }
        playerStats.sickModeActive = false;
        playerStats.sickRecovered = true;
        playerStats.sickAnnounced = false;
        playerStats.visibleAccumMillis = 0;
        playerStats.visibleLastTickAt = Date.now();
        clearForcedAway();
        markAchievement('medicine', '병주고 약주고');
        saveUserData({ touchLocalUpdatedAt: false });

        if (characterWindow && !characterWindow.isDestroyed()) {
            characterWindow.webContents.send('set-emotion', 'happy');
            characterWindow.webContents.send('show-speech', '고마워 기운 나는거 같아!');
        }
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
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

        let candidateFolders = charFolders;
        if (playerStats?.gender === 'female') {
            const females = charFolders.filter((name) => getGenderForCharacterName(name) === 'female');
            if (females.length > 0) candidateFolders = females;
        } else if (playerStats?.gender === 'male') {
            const males = charFolders.filter((name) => getGenderForCharacterName(name) === 'male');
            if (males.length > 0) candidateFolders = males;
        }

        // 2. Pick random folder
        const randomCharName = candidateFolders[Math.floor(Math.random() * candidateFolders.length)];
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
            const previousLevel = playerStats.level || 0;
            playerStats.level = targetLevel;
            playerStats.evolutionProgress = 0;
            playerStats.lastEvolutionTime = Date.now();
            playerStats.characterImage = fullPath;
            playerStats.characterName = randomCharName; // Save name
            if (!playerStats.gender) {
                playerStats.gender = getGenderForCharacterName(randomCharName);
            }

            playerStats.evolutionHistory.push({ level: targetLevel, name: randomCharName, date: Date.now() });

            if (targetLevel === 1 && playerStats.breedingEggOrigin) {
                markAchievement('origin-village', '태초마을');
                playerStats.breedingEggOrigin = false;
                playerStats.hasEgg = false;
                clearForcedAway();
                friendsCache = [];
                friendsCacheAt = 0;
            }

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

            // Push name/level changes immediately so friends see updated name.
            syncCharacterToDB();

            saveUserData();
            console.log(`[Evolution] Success! Level ${targetLevel}`);

            if (previousLevel === 0 && !playerStats.birthEventSent) {
                playerStats.birthEventSent = true;
                recordCharacterEvent('MILESTONE', `${getKoreanName(randomCharName)}가 태어났다.`, {
                    level: targetLevel,
                    name: getKoreanName(randomCharName)
                });
                saveUserData();
            } else if (targetLevel > previousLevel) {
                recordCharacterEvent('EVOLUTION', `${getKoreanName(randomCharName)}로 진화했다.`, {
                    fromLevel: previousLevel,
                    toLevel: targetLevel,
                    name: getKoreanName(randomCharName)
                });
            }
        });
    });
}

function maybeEvolveFromProgress() {
    if (!playerStats) return;
    if (playerStats.level > 0 && playerStats.level < 3 && playerStats.hp > 0 && playerStats.evolutionProgress >= 100) {
        evolveCharacter(playerStats.level + 1);
    }
}

// Check evolution progress periodically (Level 1+)
// Update character image based on happiness and level
function updateDynamicImage() {
    if (playerStats?.breedingStage === BREEDING_STAGES.EGG_HOME) {
        return;
    }
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
function getFriendStageIndex(friend) {
    return (
        friend?.friendStageIndex ??
        friend?.friendStage ??
        friend?.stageIndex ??
        friend?.stage_index ??
        0
    );
}

function getFriendGender(friend) {
    const raw =
        friend?.friendGender ??
        friend?.gender ??
        null;
    if (raw === 'male' || raw === 'female') return raw;
    const name = friend?.friendName || friend?.friendCharacterName || '';
    return getGenderForCharacterName(name) || 'male';
}

async function findEligibleBreedingPartner() {
    if (!playerStats || playerStats.level < 3 || isBreedingActive() || playerStats.hasEgg) return null;
    const myGender = playerStats.gender || getGenderForCharacterName(playerStats.characterName);
    if (!myGender) return null;

    try {
        const charId = await getOrSyncCharacterId();
        if (!charId) return null;
        const friends = await getFriends(charId);
        const now = Date.now();

        const candidates = friends.filter((f) => {
            let intimacy = f.intimacy || 0;
            const override = playerStats?.friendIntimacyOverrides?.[f.friendCharacterId];
            if (typeof override === 'number') {
                intimacy = override;
            } else {
                const baseTime = f.createdAt || f.created_at || f.updatedAt || f.updated_at;
                if (baseTime) {
                    const elapsed = now - new Date(baseTime).getTime();
                    const computed = Math.floor(Math.min(1, elapsed / 1800000) * 100);
                    if (computed > intimacy) intimacy = computed;
                }
            }
            if (intimacy < 100) {
                console.log('[Breeding] skip (intimacy)', f.friendName, intimacy);
                return false;
            }
            const stage = getFriendStageIndex(f);
            if (stage < 3) {
                console.log('[Breeding] skip (level)', f.friendName, stage);
                return false;
            }
            const friendGender = getFriendGender(f);
            if (!friendGender) {
                console.log('[Breeding] skip (gender missing)', f.friendName);
                return false;
            }
            if (friendGender === myGender) {
                console.log('[Breeding] skip (same gender)', f.friendName, friendGender);
                return false;
            }
            console.log('[Breeding] candidate', f.friendName, { intimacy, stage, friendGender, myGender });
            return true;
        });

        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    } catch (e) {
        console.error('[Breeding] Partner search failed', e);
        return null;
    }
}

function hideCharacterImage() {
    playerStats.characterImage = '';
    if (characterWindow && !characterWindow.isDestroyed()) {
        characterWindow.webContents.send('update-image', '');
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-image', '');
    }
}

function showEggInUi() {
    const eggPath = path.join(__dirname, 'assets/level0/level0.png');
    playerStats.characterImage = eggPath;
    const renderable = toRenderableImage(eggPath);
    if (characterWindow && !characterWindow.isDestroyed()) {
        characterWindow.webContents.send('update-image', renderable);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-image', renderable);
    }
}

async function retireCurrentCharacterForBreeding() {
    const parentId = playerStats.breedingParentCharacterId;
    if (!ENABLE_DB_SYNC || !parentId) return;
    try {
        await updateCharacterInDB(parentId, {
            isAlive: false,
            diedAt: new Date().toISOString()
        });
    } catch (e) {
        // Best effort only.
    }
}

async function startBreedingFlow(partnerOverride = null) {
    const partner = partnerOverride || await findEligibleBreedingPartner();
    if (!partner) return false;

    playerStats.breedingStage = BREEDING_STAGES.KISSING;
    playerStats.breedingPartner = {
        friendCharacterId: partner.friendCharacterId,
        friendName: partner.friendName,
        friendSpecies: partner.friendSpecies,
        friendGender: getFriendGender(partner),
        friendStageIndex: getFriendStageIndex(partner)
    };
    playerStats.breedingParentCharacterId = playerStats.dbCharacterId || null;
    playerStats.awayModeActive = false;
    playerStats.hasEgg = false;
    saveUserData({ touchLocalUpdatedAt: false });
    return true;
}

let breedingAutoInProgress = false;

async function maybeAutoStartBreeding() {
    if (!playerStats || !isGameRunning) return;
    if (breedingAutoInProgress) return;
    if (isBreedingActive() || playerStats.hasEgg) return;
    const partner = await findEligibleBreedingPartner();
    if (!partner) return;
    const chance = typeof playerStats.breedingChance === 'number' ? playerStats.breedingChance : DEFAULT_BREEDING_CHANCE;
    if (Math.random() >= chance) return;

    breedingAutoInProgress = true;
    try {
        const started = await startBreedingFlow(partner);
        if (started && homeWindow) {
            homeWindow.webContents.send('home-speech', '...');
        }
    } finally {
        breedingAutoInProgress = false;
    }
}

setInterval(() => {
    if (!playerStats) return;

    // 0. Watchdog: Ensure Home icon exists
    if (isGameRunning && !homeWindow) {
        console.log('[Watchdog] Home icon missing. Recreating...');
        createHomeWindow();
    }

    const now = Date.now();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const FIVE_HOURS = 5 * 60 * 60 * 1000;

    // Track how long the character has been kept outside continuously.
    const lastTick = playerStats.visibleLastTickAt || now;
    const delta = Math.max(0, now - lastTick);
    playerStats.visibleLastTickAt = now;
    if (isCharacterVisibleOut()) {
        playerStats.visibleAccumMillis = (playerStats.visibleAccumMillis || 0) + delta;
    } else {
        playerStats.visibleAccumMillis = 0;
    }
    if (!playerStats.sickModeActive && playerStats.visibleAccumMillis >= FIVE_HOURS) {
        triggerSickMode();
    }
    if (playerStats.sickModeActive) {
        ensureSickForcedAway();
    }

    if (playerStats.hunger === undefined) playerStats.hunger = 0;
    if (playerStats.hunger > 0) {
        const decayPerMinute = 100 / (12 * 60);
        playerStats.hunger = Math.max(0, playerStats.hunger - decayPerMinute);
    }

    // 1. Happiness Decay (Passive)
    if (playerStats.happiness > 0) {
        playerStats.happiness = Math.max(0, playerStats.happiness - 1);
        // console.log(`[Status] Happiness decayed to: ${playerStats.happiness}`);
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
        }
    } else if (!isStarving) {
        // HP recovers if happy and well-fed (Approx 5 per day => 5/1440 chance per minute)
        if (playerStats.hp < 100 && Math.random() < 0.00347) {
            playerStats.hp = Math.min(100, playerStats.hp + 1);
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
    const currentHour = getGameNow().getHours();
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
    const sleepModeActive = recomputeSleepMode(getGameNow());
    if (characterState.isSleeping !== sleepModeActive) {
        characterState.isSleeping = sleepModeActive;
        console.log(`[Status] Sleep Mode Changed: ${sleepModeActive}`);
        if (sleepModeActive && characterWindow && !characterState.isReturningHome) {
            characterState.isReturningHome = true;
            closeChatWindow();
        }
        updateDynamicImage();
        saveUserData();
    }

    // 2. Evolution Progress (Level 1+)
    if (playerStats.level > 0 && playerStats.level < 3 && playerStats.hp > 0) {
        // Targets: 1->2 (5 days = 7200 mins), 2->3 (10 days = 14400 mins)
        // Base rate per minute to reach 100%
        let baseRate = (playerStats.level === 1) ? (100 / 7200) : (100 / 14400);

        // Bonus: If happy (> 60), grow 2x faster
        const multiplier = (playerStats.happiness > 60) ? 2 : 1;
        const growth = baseRate * multiplier;

        const before = playerStats.evolutionProgress || 0;
        playerStats.evolutionProgress = Math.min(100, before + growth);

        // console.log(`[Evolution] Level ${playerStats.level} Progress: ${playerStats.evolutionProgress.toFixed(4)}% (+${growth.toFixed(5)})`);

        if (playerStats.evolutionProgress !== before) {
            maybeEvolveFromProgress();
        }
    }

    saveUserData();
}, 60000); // Check every 1 minute

// Refresh emotion more often without full status tick.
setInterval(() => {
    if (!playerStats || !isGameRunning) return;
    updateDynamicImage();
}, 15000);

// Refresh friends cache periodically for park2 triggers.
setInterval(() => {
    if (isGameRunning) {
        refreshFriendsCache();
    }
}, 5 * 60 * 1000);

// Breeding auto check (every 10 seconds)
setInterval(() => {
    maybeAutoStartBreeding();
}, 10000);

// LLM speech bubble timer (every 2 minutes)
setInterval(async () => {
    // Debug Log
    // console.log(`[Timer] Tick. GameRunning: ${isGameRunning}, DB_ID: ${playerStats?.dbCharacterId ? 'YES' : 'NO'}`);

    // Call LLM every 2 minutes
    if (playerStats && isGameRunning) {
        if (playerStats.sickModeActive && !playerStats.sickRecovered) {
            return;
        }
        if (isBreedingActive()) {
            return;
        }

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
                        screenshotBuffer = sources[0].thumbnail.toPNG();
                    }
                } catch (e) {
                    console.error('Failed to capture screenshot:', e);
                }

                // 전형적인 400 에러를 피하기 위해 가장 강력한 형태의 JSON 지시어와 예시 구조를 보냅니다.
                const userPrompt = "Respond ONLY with a valid JSON object. No markdown, no pre-text. Structure: {\"message\": \"string\", \"actions\": [], \"emotion\": \"string\", \"intimacyDelta\": 0}";
                const llmResponse = await callLlmApi(playerStats.dbCharacterId, userPrompt, context, screenshotBuffer);

                if (llmResponse && llmResponse.message) {
                    handleLlmActions(llmResponse);
                    if (characterWindow && !characterWindow.isDestroyed()) {
                        const emotion = resolveEmotionOverride(llmResponse.emotion || 'happy');
                        characterWindow.webContents.send('show-speech', llmResponse.message);
                        characterWindow.webContents.send('set-emotion', emotion);
                    }
                    if (typeof llmResponse.intimacyScore === 'number') {
                        playerStats.intimacyScore = llmResponse.intimacyScore;
                        saveUserData({ touchLocalUpdatedAt: false });
                    }
                }
            } catch (err) {
                console.error('LLM speech error:', err);
            }

            // Sync to DB
            syncCharacterToDB();
        }
    }
}, 120000);

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

        const bootstrap = await getBootstrapSafe();
        const me = bootstrap?.characters?.find((c) => c.id === characterId) || null;

        if (direction === 'incoming' && status === 'PENDING' && Array.isArray(me?.incomingFriendRequests)) {
            const incoming = me.incomingFriendRequests.map((r) => ({
                ...r,
                otherCharacterId: r.requesterCharacterId,
                otherName: r.requesterName || null,
                otherInviteCode: r.requesterInviteCode || null,
                otherSpecies: r.requesterSpecies || null
            }));
            return { success: true, data: incoming };
        }

        const data = await getFriendRequests(characterId, direction, status);
        const characterMap = getCharacterDetailsMap(bootstrap?.characters || []);

        const enriched = data.map((r) => {
            const otherId = direction === 'outgoing' ? r.receiverCharacterId : r.requesterCharacterId;
            const other = characterMap.get(otherId);
            return {
                ...r,
                otherCharacterId: otherId,
                otherName: other?.name || null,
                otherInviteCode: other?.inviteCode || null,
                otherSpecies: other?.species || null
            };
        });
        return { success: true, data: enriched };
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

        const bootstrap = await getBootstrapSafe();
        const me = bootstrap?.characters?.find((c) => c.id === characterId) || null;

        let data = Array.isArray(me?.friends) ? me.friends : await getFriends(characterId);
        console.log('[Debug] Friend list raw data:', JSON.stringify(data, null, 2));

        // Calculate Intimacy based on created_at (0 to 100 over 30 minutes)
        const now = Date.now();
        const updates = [];
        data.forEach(f => {
            // Priority: createdAt > updatedAt
            // If createdAt is missing (e.g. backend issue), fall back to updatedAt.
            // CAUTION: updatedAt changes on update, so we must enforce monotonic increase.
            const baseTime = f.createdAt || f.created_at || f.updatedAt || f.updated_at;

            if (baseTime) {
                const elapsed = now - new Date(baseTime).getTime();
                // 30 minutes = 1800000 ms
                const ratio = Math.min(1, elapsed / 1800000);
                const computedIntimacy = Math.floor(ratio * 100);

                // Update only if computed intimacy is HIGHER than current (Monotonic Increase)
                // This prevents reset when updatedAt is refreshed.
                if (computedIntimacy > (f.intimacy || 0)) {
                    f.intimacy = computedIntimacy;
                    // updates.push(updateFriendIntimacy(characterId, f.friendCharacterId, computedIntimacy));
                }
            } else {
                console.log(`[Friend] No time data for ${f.friendName || 'Unknown'}`);
            }
        });

        // Fire updates in background
        if (updates.length > 0) {
            Promise.allSettled(updates);
        }
        data = applyFriendDebugOverrides(data);
        friendsCache = Array.isArray(data) ? data : [];
        friendsCacheAt = Date.now();

        // Intimacy milestone: 100 => lover, and then child once.
        const lover = data.find((f) => (f.intimacy || 0) >= 100);
        if (lover && !playerStats.loverFriendCharacterId) {
            playerStats.loverFriendCharacterId = lover.friendCharacterId;
            recordCharacterEvent('MILESTONE', `${lover.friendName}와(과) 연인이 됐다.`, {
                friendCharacterId: lover.friendCharacterId,
                friendName: lover.friendName,
                intimacy: lover.intimacy
            });
            saveUserData();
        }
        if (lover && playerStats.loverFriendCharacterId === lover.friendCharacterId && !playerStats.childBornWithFriendId) {
            playerStats.childBornWithFriendId = lover.friendCharacterId;
            recordCharacterEvent('MILESTONE', `${lover.friendName}와(과) 아이를 낳았다.`, {
                friendCharacterId: lover.friendCharacterId,
                friendName: lover.friendName
            });
            playerStats.pendingLineageParents = {
                parentACharacterId: characterId,
                parentBCharacterId: lover.friendCharacterId
            };
            playerStats.lineageCreated = false;
            saveUserData();
        }


        const enrichedData = await Promise.all(data.map(async (f) => {
            const characterMap = getCharacterDetailsMap(bootstrap?.characters || []);
            const detail = characterMap.get(f.friendCharacterId);

            return {
                ...f,
                // Do not fetch other users' character detail; use friend fields when available.
                friendLevel: f.friendStageIndex ?? f.friendLevel ?? detail?.stageIndex ?? 0
            };
        }));

        return {
            success: true,
            data: enrichedData
        };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('friend-get-my-character', async () => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const bootstrap = await getBootstrapSafe();
        const characters = bootstrap?.characters || await getCharactersFromDB();
        const me = characters.find((c) => c.id === characterId) || null;
        if (!me) return { success: false, message: '내 캐릭터를 찾지 못했어.' };
        return { success: true, data: me };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('lineage-get-graph', async (event, { depth = 4 } = {}) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const data = await getLineageGraph(characterId, depth);
        return { success: true, data: { ...data, rootCharacterId: characterId } };
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

ipcMain.handle('friend-get-messages', async (event, { friendCharacterId, limit = 30 }) => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };

        const data = await getFriendMessages(characterId, friendCharacterId, limit);
        return { success: true, data };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('progress-get-achievements', async () => {
    try {
        const [definitions, unlocked] = await Promise.all([
            apiRequest({ method: 'GET', url: `${API_BASE_URL}/users/me/achievements/definitions` }),
            apiRequest({ method: 'GET', url: `${API_BASE_URL}/users/me/achievements` })
        ]);

        const unlockedList = Array.isArray(unlocked) ? unlocked : [];
        const unlockedById = new Map(unlockedList.map((a) => [a.achievementId, a]));
        const defList = Array.isArray(definitions) ? definitions : [];

        const achievements = defList.map((def) => {
            const existing = unlockedById.get(def.achievementId);
            if (existing) {
                return { ...def, ...existing };
            }
            return {
                ...def,
                unlockedAt: null,
                progress: 0
            };
        });

        const byId = new Map(achievements.map((a) => [a.achievementId, a]));
        const local = playerStats?.achievements || {};
        Object.entries(local).forEach(([achievementId, info]) => {
            if (byId.has(achievementId)) return;
            achievements.push({
                achievementId,
                name: info.label || achievementId,
                description: info.description || info.label || achievementId,
                category: 'local',
                points: 0,
                hidden: false,
                unlockedAt: info.achievedAt ? new Date(info.achievedAt).toISOString() : null
            });
        });
        return { success: true, data: achievements };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('progress-get-places', async () => {
    try {
        const [definitions, discovered] = await Promise.all([
            apiRequest({ method: 'GET', url: `${API_BASE_URL}/users/me/places/definitions` }),
            apiRequest({ method: 'GET', url: `${API_BASE_URL}/users/me/places` })
        ]);

        const discoveredList = Array.isArray(discovered) ? discovered : [];
        const discoveredIds = new Set(discoveredList.map((d) => d.placeId));
        const localDiscovered = Array.isArray(playerStats?.discoveredPlaces) ? playerStats.discoveredPlaces : [];
        localDiscovered.forEach((id) => discoveredIds.add(id));

        const assignedHouseId = ensureAssignedHouseId();
        if (assignedHouseId) discoveredIds.add(assignedHouseId);

        const defList = Array.isArray(definitions) ? definitions : [];
        let places = defList.map((def) => {
            const local = getPlaceById(def.placeId);
            return {
                id: def.placeId,
                name: def.name,
                region: def.region,
                rarity: def.rarity,
                icon: local?.icon,
                model: local?.model,
                unlocked: discoveredIds.has(def.placeId)
            };
        });

        if (!places.length) {
            const fallback = PLACES.map((p) => ({
                id: p.id,
                name: p.name,
                region: null,
                rarity: null,
                icon: p.icon,
                model: p.model,
                unlocked: discoveredIds.has(p.id)
            }));
            places = fallback;
        }

        return { success: true, data: places };
    } catch (err) {
        const localDiscovered = Array.isArray(playerStats?.discoveredPlaces) ? playerStats.discoveredPlaces : [];
        const discoveredIds = new Set(localDiscovered);
        const assignedHouseId = ensureAssignedHouseId();
        if (assignedHouseId) discoveredIds.add(assignedHouseId);
        const fallback = PLACES.map((p) => ({
            id: p.id,
            name: p.name,
            region: null,
            rarity: null,
            icon: p.icon,
            model: p.model,
            unlocked: discoveredIds.has(p.id)
        }));
        return { success: true, data: fallback };
    }
});

ipcMain.handle('character-get-info', async () => {
    try {
        const characterId = await getOrSyncCharacterId();
        if (!characterId) return { success: false, message: '캐릭터 ID가 없어.' };
        const [character, events] = await Promise.all([
            getCharacterDetailFromDB(characterId),
            getCharacterEventsFromDB(characterId, 40)
        ]);
        if (!character) {
            return { success: false, message: '캐릭터 정보를 가져오지 못했어.' };
        }
        return { success: true, data: { character, events } };
    } catch (err) {
        return { success: false, message: err.response?.data?.message || err.message };
    }
});

ipcMain.handle('get-player-status', () => {
    const now = Date.now();
    const timeSinceLastPlay = now - playerStats.lastPlayTime;
    const remainingCooldown = Math.max(0, PLAY_COOLDOWN - timeSinceLastPlay);
    const hunger = Math.max(0, Math.min(100, Number(playerStats.hunger) || 0));

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
        dbCharacterId: playerStats.dbCharacterId || null,
        characterName: koreanName,
        intimacyScore: playerStats.intimacyScore ?? 0,
        hunger,
        feedCount: playerStats.feedCount || 0,
        visibleMinutes: Math.floor((playerStats.visibleAccumMillis || 0) / 60000),
        cafeChance: typeof playerStats.cafeChance === 'number' ? playerStats.cafeChance : DEFAULT_CAFE_CHANCE,
        breedingChance: typeof playerStats.breedingChance === 'number' ? playerStats.breedingChance : DEFAULT_BREEDING_CHANCE,
        timeOffsetHours: playerStats.debugTimeOffsetHours || 0,
        evolutionProgress: playerStats.evolutionProgress || 0,
        hp: (playerStats.hp !== undefined) ? playerStats.hp : 100,
        discoveredPlaces
    };
});

ipcMain.handle('start-play-mode', (event, mode) => {
    const now = Date.now();
    if (playerStats?.sickModeActive && !playerStats?.sickRecovered) {
        return { success: false, message: '쿨럭쿨럭... 지금은 힘들어.' };
    }
    if (isBreedingActive()) {
        return { success: false, message: '지금은 바빠...' };
    }
    if (mode === 'food') {
        const lastFed = playerStats.lastFedTime || 0;
        if (now - lastFed < FEED_COOLDOWN) {
            const remaining = Math.ceil((FEED_COOLDOWN - (now - lastFed)) / (60 * 1000));
            return { success: false, message: `아직 배불러... (${remaining}분 후)` };
        }
    }
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
        playerStats.hunger = Math.min(100, (playerStats.hunger || 0) + 80);
        playerStats.feedCount = (playerStats.feedCount || 0) + 1;
        const chance = typeof playerStats.cafeChance === 'number' ? playerStats.cafeChance : DEFAULT_CAFE_CHANCE;
        if (playerStats.level >= 2 && Math.random() < chance) {
            playerStats.cafePending = true;
        }
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

function archiveCurrentPet(reason) {
    if (!playerStats) return;
    const snapshot = {
        ...playerStats,
        retiredAt: Date.now(),
        retiredReason: reason
    };
    petHistory.push(snapshot);
}

ipcMain.on('breeding-kiss-seen', () => {
    if (!isBreedingActive() || playerStats.breedingStage !== BREEDING_STAGES.KISSING) return;
    markAchievement('heart-emoji', '하트 이모지');
    playerStats.breedingStage = BREEDING_STAGES.EGG_HOME;
    hideCharacterImage();
    saveUserData({ touchLocalUpdatedAt: false });
});

ipcMain.on('breeding-egg-acquired', async () => {
    if (!isBreedingActive() || playerStats.breedingStage !== BREEDING_STAGES.EGG_HOME) return;

    const parentACharacterId = playerStats.breedingParentCharacterId || playerStats.dbCharacterId || null;
    const parentBCharacterId = playerStats.breedingPartner?.friendCharacterId || null;

    archiveCurrentPet('BREEDING');
    await retireCurrentCharacterForBreeding();

    // Reset into a fresh egg state using the same flow as "새로운 펫 입양하기".
    resetPlayerStatsForNewPet({ preservePlacements: true, preserveMeta: true });

    if (parentACharacterId && parentBCharacterId) {
        playerStats.pendingLineageParents = { parentACharacterId, parentBCharacterId };
        playerStats.lineageCreated = false;
    }

    playerStats.lastSyncedStageIndex = 0;
    playerStats.serverVersion = 0;
    playerStats.serverUpdatedAt = 0;
    playerStats.localUpdatedAt = Date.now();
    friendsCache = [];
    friendsCacheAt = 0;

    saveUserData({ touchLocalUpdatedAt: false });

    if (homeWindow) homeWindow.webContents.send('home-speech', '...');
});

ipcMain.handle('save-place-placement', (event, payload) => {
    if (!playerStats || !payload?.placeId) return { success: false, message: 'Invalid payload' };
    const { placeId, x, y, z, modelY, placementId, label } = payload;
    if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        return { success: false, message: 'Invalid coordinates' };
    }
    playerStats.placePlacements = playerStats.placePlacements || {};
    const placeData = normalizePlacePlacement(placeId) || {
        customName: null,
        activeId: null,
        placements: {}
    };
    const id = placementId || `slot-${Date.now()}`;
    placeData.placements[id] = {
        label: label || placeData.placements[id]?.label || '저장 위치',
        x,
        y,
        z,
        modelY: (typeof modelY === 'number' && Number.isFinite(modelY)) ? modelY : (placeData.placements[id]?.modelY ?? 0)
    };
    placeData.activeId = id;
    playerStats.placePlacements[placeId] = placeData;
    saveDevicePlacePlacements(playerStats.placePlacements);
    saveUserData({ touchLocalUpdatedAt: false });
    return { success: true, data: { placementId: id, ...placeData.placements[id] } };
});

ipcMain.handle('get-place-debug-data', (event, { placeId } = {}) => {
    if (!placeId) return { success: false, message: 'Invalid place' };
    const place = getPlaceById(placeId);
    const normalized = normalizePlacePlacement(placeId) || { customName: null, activeId: null, placements: {} };
    return {
        success: true,
        data: {
            placeId,
            name: normalized.customName || place.name,
            customName: normalized.customName || '',
            activeId: normalized.activeId || null,
            placements: normalized.placements || {}
        }
    };
});

ipcMain.handle('set-place-name', (event, { placeId, name } = {}) => {
    if (!placeId) return { success: false, message: 'Invalid place' };
    const placeData = normalizePlacePlacement(placeId) || {
        customName: null,
        activeId: null,
        placements: {}
    };
    placeData.customName = (name || '').trim() || null;
    playerStats.placePlacements[placeId] = placeData;
    saveUserData({ touchLocalUpdatedAt: false });
    return { success: true };
});

ipcMain.handle('set-active-placement', (event, { placeId, placementId } = {}) => {
    if (!placeId || !placementId) return { success: false, message: 'Invalid placement' };
    const placeData = normalizePlacePlacement(placeId);
    if (!placeData || !placeData.placements?.[placementId]) {
        return { success: false, message: 'Placement not found' };
    }
    placeData.activeId = placementId;
    playerStats.placePlacements[placeId] = placeData;
    saveUserData({ touchLocalUpdatedAt: false });
    return { success: true };
});

// Back-compat with older house viewer builds.
ipcMain.on('egg-acquired', () => {
    ipcMain.emit('breeding-egg-acquired');
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
    const { width, height, x, y } = primaryDisplay.workArea;

    playWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        transparent: true,
        frame: false,
        fullscreen: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    if (process.platform === 'darwin') {
        playWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        playWindow.setAlwaysOnTop(true, 'screen-saver');
    }

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
            characterImage: playerStats.characterImage,
            partner: {
                ...playerStats.breedingPartner,
                partnerImage: resolveBreedingPartnerNormalImageUrl(playerStats.breedingPartner)
            }
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
        await syncFullStateFromDB();
        recomputeSleepMode(new Date());
        await syncStageFloorFromServerOnLogin();
        createMainWindow();
        createTray();
    } else {
        // Show login window
        createLoginWindow();
    }
});

// ==================== PETTING GAME ====================

function createPetGameWindow() {
    if (petGameWindow) {
        petGameWindow.focus();
        return;
    }

    petGameWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'pet-game-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        title: '쓰다듬기',
        backgroundColor: '#667eea',
        show: false
    });

    petGameWindow.loadFile('pet-game.html');

    petGameWindow.once('ready-to-show', () => {
        petGameWindow.show();
    });

    petGameWindow.on('closed', () => {
        petGameWindow = null;
    });
}

ipcMain.on('open-pet-game', () => {
    createPetGameWindow();
});

ipcMain.on('pet-interaction', (event, { score }) => {
    // Just update last play time (happiness will be added at the end)
    if (playerStats && playerStats.hp > 0) {
        playerStats.lastPlayTime = Date.now();
    }
});

ipcMain.on('pet-game-close', (event, { finalScore }) => {
    console.log(`[Pet Game] Closed with final score: ${finalScore}`);

    // Give happiness based on final score (1:1 ratio)
    if (playerStats && playerStats.hp > 0 && finalScore > 0) {
        const bonus = finalScore; // 1 score = 1 happiness
        playerStats.happiness = Math.min(100, playerStats.happiness + bonus);
        playerStats.lastPlayTime = Date.now();

        console.log(`[Pet Game] Happiness bonus: +${bonus}`);

        // Send update to main window
        if (mainWindow) {
            mainWindow.webContents.send('stats-update', {
                happiness: playerStats.happiness,
                hp: playerStats.hp
            });
        }

        saveUserData();
    }
});

// Enable drag
ipcMain.on('window-drag', (event, { dx, dy }) => {
    if (characterWindow) {
        try {
            const bounds = characterWindow.getBounds();
            characterWindow.setBounds({
                x: bounds.x + dx,
                y: bounds.y + dy,
                width: bounds.width,
                height: bounds.height
            });
        } catch (e) { }
    }
});

ipcMain.on('set-dragging', (event, isDragging) => {
    characterState.isWindowDragging = isDragging;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
