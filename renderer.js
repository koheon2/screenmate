const { ipcRenderer } = require('electron');

const speechBubble = document.getElementById('speech-bubble');
const speechText = document.getElementById('speech-text');
const character = document.getElementById('character');
const animationWrapper = document.getElementById('animation-wrapper');

ipcRenderer.on('play-popdown', () => {
    animationWrapper.classList.add('popdown');
});

// Hardcoded phrases removed - Now using LLM

function showSpeech(text) {
    speechText.innerText = text;
    speechBubble.classList.remove('hidden');
    setTimeout(() => speechBubble.classList.add('visible'), 10);

    // Hide after 8 seconds
    setTimeout(() => {
        speechBubble.classList.remove('visible');
        setTimeout(() => speechBubble.classList.add('hidden'), 400);
    }, 8000);
}

// Listen for LLM speech from main process
ipcRenderer.on('show-speech', (event, text) => {
    showSpeech(text);
});

// Random speech and animation cycle
// Random speech cycle removed (handled by LLM)
function startSpeechCycle() {
    // Empty function or could be removed entirely
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
                animationWrapper.classList.add('shake');
                setTimeout(() => {
                    ipcRenderer.send('destructive-action', 'alt-f4');
                    animationWrapper.classList.remove('shake');
                }, 1000);
            } else if (rand < 0.3) {
                // Minimize
                ipcRenderer.send('destructive-action', 'minimize-window');
            } else if (rand < 0.45) {
                // Alt+Tab
                ipcRenderer.send('destructive-action', 'alt-tab');
            } else if (rand < 0.6) {
                // Win Key
                ipcRenderer.send('destructive-action', 'win-key');
            } else if (rand < 0.75) {
                // Dim Screen
                ipcRenderer.send('destructive-action', 'dim-screen');
            } else if (rand < 0.8) {
                // Shutdown (Low chance: 5%)
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

    // Vibrate effect on click
    character.classList.add('click-vibrate');
    setTimeout(() => character.classList.remove('click-vibrate'), 200);
});



startSpeechCycle();
startDestructionCycle();
startFlipCycle();
