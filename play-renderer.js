const { ipcRenderer } = require('electron');

const ball = document.getElementById('ball');
const food = document.getElementById('food');
const gameMsg = document.getElementById('game-msg');
const timerEl = document.getElementById('timer');
const closeBtn = document.getElementById('close-btn');
const character = document.getElementById('game-character');
const partnerImg = document.getElementById('game-partner');
const eggImg = document.getElementById('game-egg');

let currentMode = null;
let gameTimer = null;
let timeLeft = 30;

// State Variables (Separated from DOM)
let mousePos = { x: 0, y: 0 };
let dragOffset = { x: 0, y: 0 };
let isDragging = false;
let activeItem = null; // 'ball' or 'food' string

let ballState = { x: 0, y: 0, vx: 0, vy: 0, isFlying: false };
let foodState = { x: 0, y: 0 };
let charState = { x: 0, y: 0, vx: 0, vy: 0 };
let partnerState = { x: 0, y: 0 }; // For breeding partner

// For velocity calculation
let dragHistory = [];

// --- INIT ---
ipcRenderer.on('init-game', (event, { mode, startPos, characterImage, partner }) => {
    currentMode = mode;

    // Set character image
    if (characterImage) {
        character.src = characterImage;
    }

    // Init positions
    if (startPos) {
        charState.x = startPos.x;
        charState.y = startPos.y;
    } else {
        charState.x = window.innerWidth / 2 - 125;
        charState.y = window.innerHeight / 2 - 125;
    }

    // Breeding Specific Init
    if (mode === 'breeding') {
        // Center position somewhat
        charState.x = window.innerWidth / 2 - 100;
        charState.y = window.innerHeight / 2;

        partnerState.x = window.innerWidth / 2 + 20;
        partnerState.y = window.innerHeight / 2;

        // Force Mametchi for testing per request
        partnerImg.src = 'assets/level3/mametchi/normal.webp';

        // Callback if webp fails
        partnerImg.onerror = () => {
            partnerImg.src = 'assets/level3/mametchi/normal.png';
        };

        partnerImg.style.display = 'block';
        character.style.display = 'block';
        render(); // Initial placement

        startBreedingSequence();
        return;
    }

    // Init Item Positions
    ballState.x = window.innerWidth / 2 - 32;
    ballState.y = window.innerHeight - 200;

    foodState.x = window.innerWidth / 2;
    foodState.y = window.innerHeight / 2 + 100;

    // Initial Render
    render();
    character.style.display = 'block';

    // Start immediately without message
    startGame(mode);
});

function startBreedingSequence() {
    // Text Removed per request
    // gameMsg.textContent = '❤️ 뽀뽀 중... ❤️';
    // gameMsg.classList.add('visible');

    // Kiss animation: Move closer
    let step = 0;
    const interval = setInterval(() => {
        step++;
        // Move towards each other
        if (step < 20) {
            charState.x += 1;
            partnerState.x -= 1;
        }
        // Shake/Heart effect
        if (step > 20 && step < 60) {
            if (step % 5 === 0) createHeart((charState.x + partnerState.x) / 2 + 60, charState.y);
        }

        render();

        if (step >= 80) {
            clearInterval(interval);
            finishBreeding();
        }
    }, 50);
}

function createHeart(x, y) {
    const el = document.createElement('div');
    el.textContent = '❤️';
    el.style.position = 'absolute';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.fontSize = '30px';
    el.style.zIndex = 100;
    document.body.appendChild(el);

    // Animate up
    let op = 1;
    let top = y;
    const anim = setInterval(() => {
        top -= 2;
        op -= 0.05;
        el.style.top = top + 'px';
        el.style.opacity = op;
        if (op <= 0) {
            clearInterval(anim);
            el.remove();
        }
    }, 30);
}

function finishBreeding() {
    gameMsg.textContent = '알이 나타났다!';
    character.style.display = 'none';
    partnerImg.style.display = 'none';

    eggImg.src = 'assets/egg.svg';
    eggImg.style.display = 'block';
    eggImg.style.left = (window.innerWidth / 2 - 40) + 'px';
    eggImg.style.top = (window.innerHeight / 2 - 50) + 'px';

    // Add click listener to egg
    eggImg.onclick = () => {
        ipcRenderer.send('egg-acquired');
    };
}

function startGame(mode) {
    if (mode === 'ball') {
        ball.style.display = 'block';
        setupTimer();
    } else if (mode === 'food') {
        food.style.display = 'block';
    }

    // Start MAIN LOOP
    requestAnimationFrame(loop);
}

function setupTimer() {
    timerEl.style.display = 'block';
    timeLeft = 3; // Testing: 30 -> 3
    timerEl.textContent = `00:${timeLeft}`;

    if (gameTimer) clearInterval(gameTimer);
    gameTimer = setInterval(() => {
        timeLeft--;
        timerEl.textContent = `00:${timeLeft < 10 ? '0' + timeLeft : timeLeft}`;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            endGame();
        }
    }, 1000);
}

// --- INPUT HANDLING (Lightweight) ---

// Helper to check touch/click
function checkHit(el, x, y) {
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

window.addEventListener('mousedown', (e) => {
    if (isDragging || currentMode === 'breeding') return; // Disable drag in breeding

    // Check what we clicked
    if (currentMode === 'ball' && checkHit(ball, e.clientX, e.clientY)) {
        e.preventDefault(); // Prevent native drag
        isDragging = true;
        activeItem = 'ball';
        dragOffset.x = e.clientX - ballState.x;
        dragOffset.y = e.clientY - ballState.y;
        ballState.isFlying = false;
        ballState.vx = 0; ballState.vy = 0;
        ball.classList.add('dragging');
        dragHistory = [];
    }
    else if (currentMode === 'food' && checkHit(food, e.clientX, e.clientY)) {
        e.preventDefault(); // Prevent native drag
        isDragging = true;
        activeItem = 'food';
        dragOffset.x = e.clientX - foodState.x;
        dragOffset.y = e.clientY - foodState.y;
        food.classList.add('dragging');
    }
});

// Safety mechanism: Stop drag if mouse leaves window
window.addEventListener('mouseleave', () => {
    if (isDragging) {
        isDragging = false;
        if (activeItem === 'ball') ball.classList.remove('dragging');
        else if (activeItem === 'food') food.classList.remove('dragging');
        activeItem = null;
    }
});

window.addEventListener('mousemove', (e) => {
    mousePos.x = e.clientX;
    mousePos.y = e.clientY;

    if (isDragging) {
        // Record history for throw logic
        dragHistory.push({ x: e.clientX, y: e.clientY, time: Date.now() });
        if (dragHistory.length > 5) dragHistory.shift();
    }
});

window.addEventListener('mouseup', () => {
    if (!isDragging) return;

    isDragging = false;
    if (activeItem === 'ball') {
        ball.classList.remove('dragging');

        // Throw logic - Calculate velocity
        let vx = 0, vy = 0;

        if (dragHistory.length >= 2) {
            // Use the most recent points for immediate direction
            const last = dragHistory[dragHistory.length - 1];
            // Look back up to 3 frames for smoother average
            const prevIndex = Math.max(0, dragHistory.length - 4);
            const first = dragHistory[prevIndex];

            const dt = last.time - first.time;

            if (dt > 0) {
                // Multiplier 20 feels good for "flinging"
                vx = (last.x - first.x) / dt * 25;
                vy = (last.y - first.y) / dt * 25;
            }
        }

        // Just send it flying if there's any velocity
        ballState.vx = vx;
        ballState.vy = vy;

        // Cap max speed
        const maxV = 40;
        ballState.vx = Math.max(-maxV, Math.min(ballState.vx, maxV));
        ballState.vy = Math.max(-maxV, Math.min(ballState.vy, maxV));

        // Always fly if released, even if velocity is 0 (it will just stop naturally)
        ballState.isFlying = true;

    } else if (activeItem === 'food') {
        food.classList.remove('dragging');
        checkFoodGiven();
    }
    activeItem = null;
    // Clear history
    dragHistory = [];
});

// --- MAIN LOOP (All logic + rendering) ---
function loop() {
    updatePhysicalState();
    updateCharacterAI();
    render();

    if (currentMode && currentMode !== 'breeding') requestAnimationFrame(loop);
}

let isHoldingBall = false;
let wanderTimer = 0;

function updatePhysicalState() {
    // 1. Dragging Logic
    if (isDragging) {
        if (activeItem === 'ball') {
            ballState.x = mousePos.x - dragOffset.x;
            ballState.y = mousePos.y - dragOffset.y;
            isHoldingBall = false; // Drop if user grabs it
        } else if (activeItem === 'food') {
            foodState.x = mousePos.x - dragOffset.x;
            foodState.y = mousePos.y - dragOffset.y;
        }
    }
    // 2. Ball Physics (Flying)
    else if (currentMode === 'ball' && ballState.isFlying && !isHoldingBall) {
        ballState.x += ballState.vx;
        ballState.y += ballState.vy;

        // Bounce Walls
        if (ballState.x < 0) { ballState.x = 0; ballState.vx *= -0.8; }
        if (ballState.x > window.innerWidth - 64) { ballState.x = window.innerWidth - 64; ballState.vx *= -0.8; }

        if (ballState.y < 0) { ballState.y = 0; ballState.vy *= -0.8; }
        if (ballState.y > window.innerHeight - 64) { ballState.y = window.innerHeight - 64; ballState.vy *= -0.8; }

        // Friction
        ballState.vx *= 0.98;
        ballState.vy *= 0.98;

        // Stop threshold
        if (Math.abs(ballState.vx) < 0.1 && Math.abs(ballState.vy) < 0.1) {
            ballState.isFlying = false;
        }
    }
    // 3. Holding Logic
    else if (isHoldingBall) {
        // Sync ball to character (Center)
        ballState.x = charState.x + 30; // 60(char center) - 32(ball center) roughly
        ballState.y = charState.y + 60; // Hold slightly lower
        ballState.vx = 0;
        ballState.vy = 0;
        ballState.isFlying = false;
    }
}

function updateCharacterAI() {
    if (currentMode !== 'ball') return;

    // Bounds for character
    const maxX = window.innerWidth - 120;
    const maxY = window.innerHeight - 120;

    if (isHoldingBall) {
        // WANDER BEHAVIOR
        wanderTimer++;
        if (wanderTimer > 60) { // Change direction every ~1 sec
            wanderTimer = 0;
            // Random slow movement
            charState.vx = (Math.random() - 0.5) * 4;
            charState.vy = (Math.random() - 0.5) * 4;
        }

        charState.x += charState.vx;
        charState.y += charState.vy;

        // Keep in bounds
        if (charState.x < 0) { charState.x = 0; charState.vx *= -1; }
        if (charState.x > maxX) { charState.x = maxX; charState.vx *= -1; }
        if (charState.y < 0) { charState.y = 0; charState.vy *= -1; }
        if (charState.y > maxY) { charState.y = maxY; charState.vy *= -1; }

        return;
    }

    // CHASE BEHAVIOR
    const ballCX = ballState.x + 32;
    const ballCY = ballState.y + 32;
    const charCX = charState.x + 60;
    const charCY = charState.y + 60;

    const dx = ballCX - charCX;
    const dy = ballCY - charCY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 60) {
        const speed = 12; // INCREASED SPEED
        charState.vx = (dx / dist) * speed;
        charState.vy = (dy / dist) * speed;

        charState.x += charState.vx;
        charState.y += charState.vy;
    } else {
        // CATCH!
        isHoldingBall = true;
        charState.vx = 0;
        charState.vy = 0;
    }
}

function render() {
    // Transform is most efficient
    character.style.transform = `translate(${charState.x}px, ${charState.y}px)`;

    // Character Flip
    const img = character;
    // We can't apply two transforms easily like this without nesting or complex string.
    // Let's use scaleX inside translate string.
    const flip = charState.vx > 0.1 ? -1 : 1;
    character.style.transform = `translate(${charState.x}px, ${charState.y}px) scaleX(${flip})`;

    if (currentMode === 'ball') {
        ball.style.transform = `translate(${ballState.x}px, ${ballState.y}px)`;
    } else if (currentMode === 'food') {
        food.style.transform = `translate(${foodState.x}px, ${foodState.y}px)`;
    } else if (currentMode === 'breeding') {
        // Fixed positioning? No, we update charState.
        // Also render partner
        partnerImg.style.transform = `translate(${partnerState.x}px, ${partnerState.y}px) scaleX(-1)`; // Face left
    }
}

// --- HELPERS ---
function checkFoodGiven() {
    const fx = foodState.x + 32;
    const fy = foodState.y + 32;
    const cx = charState.x + 60;
    const cy = charState.y + 60;
    const dist = Math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2);

    if (dist < 100) {
        isDragging = false;
        // currentMode = null; // Don't clear this, needed for endGame score calculation
        food.style.display = 'none';
        ipcRenderer.send('food-eaten');

        // Show speech bubble
        const txt = document.createElement('div');
        txt.textContent = "존맛탱!";
        txt.style.cssText = `
            position: absolute;
            left: ${charState.x + 60}px;
            top: ${charState.y - 60}px;
            font-size: 28px;
            font-weight: bold;
            color: #333;
            background: white;
            padding: 12px 20px;
            border-radius: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            z-index: 100;
            animation: popIn 0.3s ease;
        `;
        document.body.appendChild(txt);

        // Close faster (0.5s) to reduce latency feel
        setTimeout(() => endGame(), 800);
    }
}

function endGame() {
    ipcRenderer.invoke('finish-play-mode', currentMode);
    setTimeout(() => {
        ipcRenderer.send('close-play-window');
    }, 100);
}

closeBtn.addEventListener('click', () => {
    ipcRenderer.send('close-play-window');
});
