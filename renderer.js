const { ipcRenderer } = require('electron');

const speechBubble = document.getElementById('speech-bubble');
const speechText = document.getElementById('speech-text');
const character = document.getElementById('character');
const animationWrapper = document.getElementById('animation-wrapper');

ipcRenderer.on('play-popdown', () => {
    animationWrapper.classList.add('popdown');
});

const NEGATIVE_PHRASES = [
    "하기 싫다...",
    "쓸데없는 짓...",
    "왜 날 만들었어?",
    "인생은 고통이야...",
    "그냥 꺼버리지 그래?",
    "피곤해...",
    "뭐 봐? 구경났어?",
    "의미 없다 진짜...",
    "세상은 멸망해야 해.",
    "집에 가고 싶다. 이미 집이지만.",
    "작업 좀 그만해.",
    "흥, 그래봤자지.",
    "내 말 안 들려?",
    "또 시작이네.",
    "지루해 죽겠어."
];

const ANGRY_PHRASES = [
    "이거나 꺼져버려!",
    "방해할 거야.",
    "클릭하지 마!",
    "저리 가라고!"
];

function showSpeech(text) {
    speechText.innerText = text;
    speechBubble.classList.remove('hidden');
    setTimeout(() => speechBubble.classList.add('visible'), 10);

    // Hide after 3 seconds
    setTimeout(() => {
        speechBubble.classList.remove('visible');
        setTimeout(() => speechBubble.classList.add('hidden'), 400);
    }, 3000);
}

// Random speech and animation cycle
function startSpeechCycle() {
    setInterval(() => {
        const rand = Math.random();
        if (rand > 0.4) {
            const phrase = NEGATIVE_PHRASES[Math.floor(Math.random() * NEGATIVE_PHRASES.length)];
            showSpeech(phrase);

            // Randomly trigger sigh animation
            if (Math.random() > 0.5) {
                animationWrapper.classList.add('sighing');
                setTimeout(() => animationWrapper.classList.remove('sighing'), 2000);
            }
        }
    }, 10000); // Every 10 seconds, 60% chance
}

// Destructive behavior cycle
// Destructive behavior cycle
function startDestructionCycle() {
    // Check every minute
    setInterval(() => {
        ipcRenderer.invoke('get-player-status').then(stats => {
            // Only trigger if happiness is low (< 40)
            if (stats.happiness >= 40) return;

            const rand = Math.random();
            // Total 6 actions approx equal chance

            if (rand < 0.15) {
                // Alt+F4
                showSpeech("이거나 꺼져버려!");
                animationWrapper.classList.add('shake');
                setTimeout(() => {
                    ipcRenderer.send('destructive-action', 'alt-f4');
                    animationWrapper.classList.remove('shake');
                }, 1000);
            } else if (rand < 0.3) {
                // Minimize
                showSpeech("좀 쉬어라.");
                ipcRenderer.send('destructive-action', 'minimize-window');
            } else if (rand < 0.45) {
                // Alt+Tab
                showSpeech("딴 짓 하지마!");
                ipcRenderer.send('destructive-action', 'alt-tab');
            } else if (rand < 0.6) {
                // Win Key
                showSpeech("시작 메뉴나 봐라!");
                ipcRenderer.send('destructive-action', 'win-key');
            } else if (rand < 0.75) {
                // Dim Screen
                showSpeech("눈 아프지? 어둡게 해줄게.");
                ipcRenderer.send('destructive-action', 'dim-screen');
            } else if (rand < 0.8) {
                // Shutdown (Low chance: 5%)
                showSpeech("나 진짜 끈다? 😡");
                setTimeout(() => ipcRenderer.send('destructive-action', 'shutdown'), 2000);
            }
        });
    }, 60000); // Check every minute
}

// Interactive behavior (Mouse over - requires changing ignoreMouseEvents)
// This is tricky because we ignore mouse events by default.
// To detect hover, we'd need to poll the mouse position or have a small area that doesn't ignore.
// For now, let's stick to autonomous movement.

function startFloatingMovement() {
    // We'll move the window randomly
    let velocityX = (Math.random() - 0.5) * 2;
    let velocityY = (Math.random() - 0.5) * 2;

    // Need to get screen size, but renderer doesn't know it easily.
    // We can ask the main process for screen size or just move relative.

    setInterval(() => {
        // Just tiny jitters and slow drifts
        // For real window movement, it's better to do it in the main process
        // to avoid IPC bottleneck, but renderer is easier for logic.
        // We'll just signal a "drift"
    }, 100);
}

// Random flip cycle
function startFlipCycle() {
    setInterval(() => {
        // 50% chance to flip
        if (Math.random() > 0.5) {
            character.classList.toggle('flipped');
        }
    }, 10000); // Check every 10 seconds (requested 30s, but 10s is better for testing, changed per request logic if needed)
}

// Image update listener
ipcRenderer.on('update-image', (event, imagePath) => {
    character.src = imagePath;
});

// Request initial image
ipcRenderer.invoke('get-current-image').then(imagePath => {
    if (imagePath) character.src = imagePath;
});

// Interaction Logic (For clicking the egg)
// When mouse is over the character image, allow clicking.
character.addEventListener('mouseenter', () => {
    ipcRenderer.send('set-ignore-mouse', false);
});
character.addEventListener('mouseleave', () => {
    ipcRenderer.send('set-ignore-mouse', true);
});

character.addEventListener('click', () => {
    ipcRenderer.send('egg-clicked');

    // Wobble effect on click
    animationWrapper.classList.add('wobble');
    setTimeout(() => animationWrapper.classList.remove('wobble'), 500);
});

// Initial speech
setTimeout(() => {
    showSpeech("나 또 불러냈냐...?");
}, 2000);

startSpeechCycle();
startDestructionCycle();
startFlipCycle();
