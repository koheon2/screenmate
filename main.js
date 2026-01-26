const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Window references
let loginWindow = null;
let mainWindow = null;
let homeWindow = null;
let characterWindow = null;
let playWindow = null;
let characterState = { isReturningHome: false, isFocusMode: false, isExiting: false };
let tray = null;

// User state
let currentUser = null;
let isGameRunning = false;
let playerStats = null;
let petHistory = []; // Archive for dead pets
// 5 minutes cooldown (Disabled for testing)
const PLAY_COOLDOWN = 0;
const userDataPath = path.join(app.getPath('userData'), 'user-data.json');

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
    birthday: Date.now()
};

function loadUserData() {
    playerStats = { ...INITIAL_STATS };
    petHistory = [];

    try {
        if (fs.existsSync(userDataPath)) {
            const fileData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
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
        fs.writeFileSync(userDataPath, JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log('Saved user data (including history)');
    } catch (e) {
        console.error('Failed to save user data:', e);
    }
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
    return petHistory;
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
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    homeWindow.loadFile('home.html');
    homeWindow.on('closed', () => homeWindow = null);
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

    characterWindow.loadFile('character.html');

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
            else if (characterState.isFocusMode && homeWindow) {
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

ipcMain.on('google-login', () => {
    currentUser = {
        id: '12345',
        nickname: '테스트 유저',
        email: 'test@example.com'
    };
    // Load persisted data
    loadUserData();

    console.log('User logged in:', currentUser.nickname);
    if (loginWindow) loginWindow.close();
    createMainWindow();
    createTray();
});

ipcMain.on('logout', () => {
    currentUser = null;
    isGameRunning = false;
    if (mainWindow) mainWindow.close();
    if (characterWindow) characterWindow.close();
    if (homeWindow) homeWindow.close();
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
    return playerStats.characterImage;
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
        if (characterWindow) characterWindow.webContents.send('update-image', playerStats.characterImage);
        if (mainWindow) mainWindow.webContents.send('update-image', playerStats.characterImage);
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
            if (characterWindow) characterWindow.webContents.send('update-image', playerStats.characterImage);
            if (mainWindow) mainWindow.webContents.send('update-image', playerStats.characterImage);
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
                characterWindow.webContents.send('update-image', fullPath);
                characterWindow.webContents.send('show-speech', '진화했다! ✨');
                // Force redraw if needed
                characterWindow.setBounds(characterWindow.getBounds());
            }
            if (mainWindow) {
                mainWindow.webContents.send('update-image', fullPath);
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

        if (characterWindow) characterWindow.webContents.send('update-image', fullPath);
        if (mainWindow) mainWindow.webContents.send('update-image', fullPath);
    } else {
        // Fallback to normal if specific emotion missing
        const normalPath = path.join(baseDir, 'normal.webp');
        if (fs.existsSync(normalPath)) {
            playerStats.characterImage = normalPath;
        }
    }
}

// Check evolution progress and decrease happiness periodically
setInterval(() => {
    // 0. Ensure Home Window always exists if game is running
    if (isGameRunning && !homeWindow) {
        console.log('[Watchdog] Home icon missing. Recreating...');
        createHomeWindow();
    }

    // 1. Decrease Happiness (Decay)
    if (playerStats.happiness > 0) {
        playerStats.happiness = Math.max(0, playerStats.happiness - 1);
        console.log(`[Status] Happiness decayed to: ${playerStats.happiness}`);
    }

    // Hunger Check (Recursive every 8 hours)
    // 8 hours = 28800000 ms
    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    const now = Date.now();

    // Check if we need to apply damage (based on last damage time)
    // Initialize lastHungerDamageTime if missing using lastFedTime
    if (!playerStats.lastHungerDamageTime) playerStats.lastHungerDamageTime = playerStats.lastFedTime || now;

    if (now - playerStats.lastHungerDamageTime >= EIGHT_HOURS) {
        playerStats.hp = Math.max(0, playerStats.hp - 30);
        playerStats.lastHungerDamageTime = now; // Reset damage timer
        console.log(`[Status] HP penalty (-30) due to hunger!`);
    }

    // For recovery, we check actual last Fed Time
    const timeSinceFed = now - (playerStats.lastFedTime || now);
    const isStarving = timeSinceFed >= EIGHT_HOURS;

    // HP Logic (Decay or Recover)
    if (playerStats.hp === undefined) playerStats.hp = 100;

    if (playerStats.happiness < 50) {
        // Decay due to sadness (approx 10 per hour => 10/60 chance per minute)
        if (playerStats.hp > 0 && Math.random() < 0.17) {
            playerStats.hp = Math.max(0, playerStats.hp - 1);
            console.log(`[Status] HP decayed due to sadness: ${playerStats.hp}`);
        }
    } else if (!isStarving) {
        // Recover if Happy (>=50) and Not Starving
        if (playerStats.hp < 100) {
            playerStats.hp = Math.min(100, playerStats.hp + 1);
            // console.log(`[Status] HP recovered: ${playerStats.hp}`);
        }
    }

    // Update Image based on new happiness
    updateDynamicImage();

    // 3. Death Check
    if (playerStats.hp <= 0) {
        handleDeath();
    }

    // 2. Evolution Progress (Level 1+)
    if (playerStats.level > 0 && playerStats.level < 3 && playerStats.hp > 0) {
        // Normal speed: 1% per minute
        // Bonus: If happy (> 60), grow faster (+2%)
        const growthRate = (playerStats.happiness > 60) ? 2 : 1;

        playerStats.evolutionProgress = Math.min(100, (playerStats.evolutionProgress || 0) + growthRate);

        console.log(`[Evolution] Level ${playerStats.level} Progress: ${playerStats.evolutionProgress}% (+${growthRate})`);

        if (playerStats.evolutionProgress >= 100) {
            evolveCharacter(playerStats.level + 1);
        }
    }

    saveUserData();
}, 60000); // Check every 1 minute

// ==================== PLAY MODE & MINIGAMES ====================

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

    return {
        happiness: playerStats.happiness,
        remainingCooldown,
        characterImage: playerStats.characterImage,
        level: playerStats.level,
        characterName: displayName,
        evolutionProgress: playerStats.evolutionProgress || 0,
        hp: (playerStats.hp !== undefined) ? playerStats.hp : 100
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
        characterWindow.webContents.send('show-speech', '존맛탱! 🍖');
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
app.whenReady().then(() => {
    createLoginWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
