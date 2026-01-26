const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Window references
let loginWindow = null;
let mainWindow = null;
let homeWindow = null;
let characterWindow = null;
let characterState = { isReturningHome: false, isFocusMode: false, isExiting: false };
let tray = null;

// User state (in production, this would come from a backend)
let currentUser = null;

// ==================== LOGIN WINDOW ====================
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 350,
        height: 400,
        resizable: false,
        frame: false,
        transparent: false,
        backgroundColor: '#ffffff',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    loginWindow.loadFile('login.html');

    loginWindow.on('closed', () => {
        loginWindow = null;
    });
}

// ==================== MAIN SCREEN WINDOW ====================
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 300,
        height: 400,
        resizable: false,
        frame: false,
        transparent: false,
        backgroundColor: '#ffffff',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.loadFile('main-screen.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
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
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    homeWindow.loadFile('home.html');
    homeWindow.setIgnoreMouseEvents(false);

    homeWindow.on('closed', () => {
        homeWindow = null;
    });
}

// ==================== CHARACTER WINDOW ====================
function createCharacterWindow(startX, startY) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    // Use provided position or random initial position
    const x = startX !== undefined ? startX : Math.floor(Math.random() * (width - 200));
    const y = startY !== undefined ? startY : Math.floor(Math.random() * (height - 200));

    characterWindow = new BrowserWindow({
        width: 250,
        height: 250,
        x: x,
        y: y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    characterWindow.loadFile('character.html');
    characterWindow.setIgnoreMouseEvents(true, { forward: true });

    // Floating movement logic
    let vx = (Math.random() - 0.5) * 1.5;
    let vy = (Math.random() - 0.5) * 1.5;
    let isMoving = true;
    characterState.isReturningHome = false;
    characterState.isExiting = false;

    // Toggle movement state every 5 seconds
    const movementToggle = setInterval(() => {
        if (!characterWindow) {
            clearInterval(movementToggle);
            return;
        }

        // Don't toggle movement if returning home
        if (characterState.isReturningHome) return;

        if (isMoving) {
            if (Math.random() < 0.4) {
                isMoving = false;
                console.log('Character is resting...');
            }
        } else {
            if (Math.random() < 0.6) {
                isMoving = true;
                vx = (Math.random() - 0.5) * 1.5;
                vy = (Math.random() - 0.5) * 1.5;
                console.log('Character is moving...');
            }
        }
    }, 5000);

    const movementLoop = setInterval(() => {
        if (!characterWindow) {
            clearInterval(movementLoop);
            return;
        }

        let { x, y } = characterWindow.getBounds();
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        // RETURN HOME LOGIC
        if (characterState.isReturningHome && homeWindow) {
            const homeBounds = homeWindow.getBounds();
            // Target center: home center
            const homeCX = homeBounds.x + homeBounds.width / 2;
            const homeCY = homeBounds.y + homeBounds.height / 2;

            // Character center offset is 125, 125
            const targetX = homeCX - 125;
            const targetY = homeCY - 180; // Adjusted to be higher (was 125)

            // Move fast towards target
            const dx = targetX - x;
            const dy = targetY - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 10) {
                // Arrived
                if (!characterState.isExiting) {
                    characterState.isExiting = true;
                    // Send signal to renderer to play popdown animation
                    try {
                        characterWindow.webContents.send('play-popdown');
                    } catch (e) {
                        characterWindow.close();
                    }

                    // Wait for animation (500ms) then close
                    setTimeout(() => {
                        try {
                            if (characterWindow) characterWindow.close();
                        } catch (e) { }
                    }, 500);
                }
                return;
            }

            // Move speed 
            const speed = Math.max(5, dist / 10);
            vx = (dx / dist) * speed;
            vy = (dy / dist) * speed;

            x += vx;
            y += vy;

            characterWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: 250, height: 250 });
            return; // Skip other movement logic
        }

        if (isMoving) {
            // FOCUS MODE: Hover above home
            if (characterState.isFocusMode && homeWindow) {
                try {
                    const homeBounds = homeWindow.getBounds();
                    const homeCX = homeBounds.x + homeBounds.width / 2;
                    // Target: Above home
                    const targetX = homeCX - 155; // Centered horizontally
                    const targetY = homeBounds.y - 250; // Fixed height above home (increased from 180)

                    // Add slight hovering motion
                    const hoverOffset = Math.sin(Date.now() / 800) * 15;

                    // Smooth lerp to target
                    const dx = targetX - x;
                    const dy = (targetY + hoverOffset) - y;

                    x += dx * 0.05;
                    y += dy * 0.05;

                    // Update vx/vy for consistency
                    vx = dx * 0.05;
                    vy = dy * 0.05;
                } catch (e) {
                    // Fallback
                }
            } else {
                // NORMAL MODE
                x += vx;
                y += vy;

                // Bounce off edges
                if (x < 0 || x > width - 250) {
                    vx *= -1;
                    x = Math.max(0, Math.min(x, width - 250));
                }
                if (y < 0 || y > height - 250) {
                    vy *= -1;
                    y = Math.max(0, Math.min(y, height - 250));
                }

                // Occasional change in direction
                if (Math.random() < 0.01) {
                    vx = (Math.random() - 0.5) * 1.5;
                    vy = (Math.random() - 0.5) * 1.5;
                }
            }
        }

        // Mouse interference logic
        const cursor = screen.getCursorScreenPoint();
        const distance = Math.sqrt(Math.pow(cursor.x - (x + 125), 2) + Math.pow(cursor.y - (y + 125), 2));

        if (distance < 150) {
            isMoving = true;
            if (Math.random() < 0.05) {
                vx = (cursor.x - (x + 125)) / 10;
                vy = (cursor.y - (y + 125)) / 10;
            } else if (Math.random() < 0.1) {
                vx = (x + 125 - cursor.x) / 10;
                vy = (y + 125 - cursor.y) / 10;
            }
        }

        characterWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: 250, height: 250 });
    }, 30);

    characterWindow.on('closed', () => {
        characterWindow = null;
        clearInterval(movementToggle);
        clearInterval(movementLoop);
    });
}

// ==================== TRAY ====================
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'a.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'CynicalFloater', enabled: false },
        { type: 'separator' },
        {
            label: '메인 화면 열기',
            click: () => {
                if (currentUser) {
                    if (mainWindow) {
                        mainWindow.show();
                    } else {
                        createMainWindow();
                    }
                }
            }
        },
        {
            label: '캐릭터 보이기/숨기기',
            click: () => {
                if (characterWindow) {
                    characterWindow.close();
                } else {
                    createCharacterWindow();
                }
            }
        },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() }
    ]);

    tray.setToolTip('CynicalFloater - 냉소적인 데스크탑 펫');
    tray.setContextMenu(contextMenu);
}

// ==================== IPC HANDLERS ====================

// Close app
ipcMain.on('close-app', () => {
    app.quit();
});

// Google Login (simplified - in production, use proper OAuth)
ipcMain.on('google-login', () => {
    // For now, simulate login success
    // In production, you would open a OAuth window and get the token
    currentUser = {
        id: 'user_123',
        google_sub: 'google_sub_123',
        nickname: '테스트 유저',
        email: 'test@example.com'
    };

    console.log('User logged in:', currentUser.nickname);

    // Close login window and open main window
    if (loginWindow) {
        loginWindow.close();
    }
    createMainWindow();
});

// Logout
ipcMain.on('logout', () => {
    currentUser = null;

    // Close all windows except login
    if (mainWindow) mainWindow.close();
    if (homeWindow) homeWindow.close();
    if (characterWindow) characterWindow.close();

    createLoginWindow();
});

// Get user info
ipcMain.handle('get-user-info', () => {
    return currentUser;
});

// Start game - minimize main window, show home icon
ipcMain.on('start-game', () => {
    console.log('Game started!');

    // Hide main window
    if (mainWindow) {
        mainWindow.hide();
    }

    // Show home icon at bottom-left
    if (!homeWindow) {
        createHomeWindow();
    } else {
        homeWindow.show();
    }
});

// Show main window
ipcMain.on('show-main-window', () => {
    console.log('Show main window');
    if (currentUser) {
        // Close character and home windows
        if (characterWindow) {
            try {
                characterWindow.close();
            } catch (e) { }
        }
        if (homeWindow) {
            try {
                homeWindow.close();
            } catch (e) { }
        }

        if (mainWindow) {
            mainWindow.show();
        } else {
            createMainWindow();
        }
    }
});

// Toggle Focus Mode
ipcMain.on('toggle-focus-mode', (event, isFocusOn) => {
    console.log('Focus Mode:', isFocusOn);
    characterState.isFocusMode = isFocusOn;
});

// Toggle character visibility
ipcMain.on('toggle-character', () => {
    console.log('Toggle character');

    if (characterWindow) {
        if (!characterState.isReturningHome) {
            console.log('Returning home...');
            characterState.isReturningHome = true;
        }
    } else {
        // Spawn near home
        if (homeWindow) {
            try {
                const homeBounds = homeWindow.getBounds();
                // Calc spawn pos: Center of character matches Center of home
                // Character: 250x250, Home: 140x140
                const spawnX = Math.round((homeBounds.x + homeBounds.width / 2) - 125);
                const spawnY = Math.round((homeBounds.y + homeBounds.height / 2) - 125);

                // Spawn slightly above initially to look like it pops out
                createCharacterWindow(spawnX, spawnY - 50);
            } catch (e) {
                createCharacterWindow();
            }
        } else {
            createCharacterWindow();
        }
    }
});

// Handle mouse ignore for character window
ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (characterWindow) {
        characterWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

// Handle destructive actions
ipcMain.on('destructive-action', (event, type) => {
    if (type === 'alt-f4') {
        console.log('Simulating Alt+F4');
        const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{F4}')`;
        exec(`powershell -Command "${script}"`);
    } else if (type === 'minimize-window') {
        console.log('Minimizing a window');
        const minimizeActive = `
            $wshell = New-Object -ComObject WScript.Shell;
            $wshell.SendKeys('% n');
        `;
        exec(`powershell -Command "${minimizeActive}"`);
    }
});

// ==================== APP LIFECYCLE ====================
app.whenReady().then(() => {
    createLoginWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (currentUser) {
                createMainWindow();
            } else {
                createLoginWindow();
            }
        }
    });
});

app.on('window-all-closed', () => {
    // Don't quit when all windows are closed - keep tray icon running
    // User can quit from tray menu
});
