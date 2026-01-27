console.log('[Pet Game] Script starting...');

let hands;
let camera;
let score = 0;
let characterBounds = null;
let handPosition = { x: 0, y: 0 };
let isHandDetected = false;
let wasColliding = false; // Track if hand was previously colliding

const handEmoji = document.getElementById('hand-emoji');
const characterImg = document.getElementById('character');
const scoreDisplay = document.getElementById('score');
const timerDisplay = document.getElementById('timer');
const gameContainer = document.getElementById('game-container');
const loading = document.getElementById('loading');

let gameTimer = null;
let remainingTime = 10; // 10 seconds

console.log('[Pet Game] Elements loaded');

// Initialize character image
window.electronAPI.getCurrentImage().then((imagePath) => {
    console.log('[Pet Game] Got character image:', imagePath);
    if (imagePath) {
        characterImg.src = imagePath;
        characterImg.onload = () => {
            console.log('[Pet Game] Character image loaded');
            updateCharacterBounds();
        };
    }
});

function updateCharacterBounds() {
    const rect = characterImg.getBoundingClientRect();
    characterBounds = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
    };
}

// Update hand emoji position
function updateHandPosition(x, y) {
    handPosition.x = x;
    handPosition.y = y;
    // Use transform for better performance
    handEmoji.style.transform = `translate(${x}px, ${y}px)`;
}

// Check collision between hand and character
function checkCollision() {
    if (!characterBounds || !isHandDetected) return false;

    const handX = handPosition.x;
    const handY = handPosition.y;
    const handSize = 80; // emoji size

    return (
        handX + handSize > characterBounds.left &&
        handX < characterBounds.right &&
        handY + handSize > characterBounds.top &&
        handY < characterBounds.bottom
    );
}

// Spawn heart animation
function spawnHeart() {
    const heart = document.createElement('div');
    heart.className = 'heart';
    heart.textContent = '❤️';

    // Random position near character
    const offsetX = (Math.random() - 0.5) * 100;
    const offsetY = (Math.random() - 0.5) * 100;

    heart.style.left = `${characterBounds.centerX + offsetX}px`;
    heart.style.top = `${characterBounds.centerY + offsetY}px`;

    gameContainer.appendChild(heart);

    setTimeout(() => {
        heart.remove();
    }, 2000);
}

let lastPetTime = 0;
const PET_COOLDOWN = 500; // 0.5 seconds between pets

// Canvas for hand skeleton visualization
const handCanvas = document.getElementById('hand-canvas');
const canvasCtx = handCanvas.getContext('2d');

// Draw hand skeleton on canvas
function drawHandSkeleton(landmarks) {
    const width = handCanvas.width;
    const height = handCanvas.height;

    // Clear canvas
    canvasCtx.fillStyle = '#000';
    canvasCtx.fillRect(0, 0, width, height);

    if (!landmarks) return;

    // Draw connections
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17] // Palm
    ];

    canvasCtx.strokeStyle = '#fff';
    canvasCtx.lineWidth = 2;

    connections.forEach(([start, end]) => {
        const startPoint = landmarks[start];
        const endPoint = landmarks[end];

        canvasCtx.beginPath();
        canvasCtx.moveTo((1 - startPoint.x) * width, startPoint.y * height); // Mirror x
        canvasCtx.lineTo((1 - endPoint.x) * width, endPoint.y * height); // Mirror x
        canvasCtx.stroke();
    });

    // Draw landmarks
    canvasCtx.fillStyle = '#fff';
    landmarks.forEach((landmark) => {
        canvasCtx.beginPath();
        canvasCtx.arc(
            (1 - landmark.x) * width, // Mirror x-coordinate
            landmark.y * height,
            4,
            0,
            2 * Math.PI
        );
        canvasCtx.fill();
    });
}

function onHandDetected(results) {
    // Draw hand skeleton
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        console.log('[Pet Game] Hand detected!');
        drawHandSkeleton(results.multiHandLandmarks[0]);

        const hand = results.multiHandLandmarks[0];
        const indexTip = hand[8]; // Index finger tip

        // Convert normalized coordinates to screen coordinates
        // Note: MediaPipe coordinates are already in [0, 1] range
        const x = (1 - indexTip.x) * window.innerWidth; // Mirror horizontally
        const y = indexTip.y * window.innerHeight;

        console.log(`[Pet Game] Hand position: (${x.toFixed(0)}, ${y.toFixed(0)})`);
        updateHandPosition(x, y);
        isHandDetected = true;

        // Check collision - only score if hand exits and re-enters
        const now = Date.now();
        const isCurrentlyColliding = checkCollision();

        if (isCurrentlyColliding && !wasColliding && now - lastPetTime > PET_COOLDOWN) {
            // Hand just entered character bounds
            score++;
            scoreDisplay.textContent = score;
            spawnHeart();
            lastPetTime = now;

            // Notify main process
            window.electronAPI.sendPetInteraction({ score });
        }

        wasColliding = isCurrentlyColliding;
    } else {
        // Clear canvas if no hand detected
        canvasCtx.fillStyle = '#000';
        canvasCtx.fillRect(0, 0, handCanvas.width, handCanvas.height);
        isHandDetected = false;
        wasColliding = false; // Reset collision state
    }
}

// Initialize MediaPipe Hands
async function initializeHandTracking() {
    console.log('[Pet Game] Initializing hand tracking...');

    try {
        if (typeof Hands === 'undefined') {
            throw new Error('MediaPipe Hands library not loaded. Check CDN connection.');
        }

        hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 0, // Faster processing
            minDetectionConfidence: 0.7, // Higher confidence for stability
            minTrackingConfidence: 0.7
        });

        hands.onResults(onHandDetected);
        console.log('[Pet Game] Hands model configured');

        // Setup camera
        const videoElement = document.getElementById('webcam');

        console.log('[Pet Game] Requesting camera access...');

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480
            }
        });

        videoElement.srcObject = stream;
        console.log('[Pet Game] Camera stream obtained');

        // Wait for video to be ready
        await new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                console.log('[Pet Game] Video metadata loaded');
                resolve();
            };
        });

        await videoElement.play();
        console.log('[Pet Game] Video playing');

        // Process frames
        const processFrame = async () => {
            if (!videoElement.paused && !videoElement.ended) {
                await hands.send({ image: videoElement });
                requestAnimationFrame(processFrame);
            }
        };

        processFrame();
        loading.style.display = 'none';
        console.log('[Pet Game] Hand tracking initialized successfully');

        // Start 10-second timer
        startGameTimer();

    } catch (error) {
        console.error('[Pet Game] Initialization failed:', error);
        loading.textContent = '초기화 실패: ' + error.message;
    }
}

// Start 10-second countdown timer
function startGameTimer() {
    console.log('[Pet Game] Starting 10-second timer');

    gameTimer = setInterval(() => {
        remainingTime--;
        timerDisplay.textContent = remainingTime;

        if (remainingTime <= 0) {
            clearInterval(gameTimer);
            console.log('[Pet Game] Time up! Final score:', score);

            // Auto-close and send final score
            window.electronAPI.closePetGame({ finalScore: score });
            window.close();
        }
    }, 1000);
}

// Handle window resize
window.addEventListener('resize', () => {
    if (characterBounds) {
        updateCharacterBounds();
    }
});

// Close button
document.getElementById('close-btn').addEventListener('click', () => {
    // Clear timer
    if (gameTimer) {
        clearInterval(gameTimer);
    }

    // Send final score to main process
    window.electronAPI.closePetGame({ finalScore: score });

    // Close window
    window.close();
});

// Immediate log to verify script is loaded
console.log('[Pet Game] Script loaded!');

// Initialize on DOM ready (faster than window.load)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[Pet Game] DOM ready, starting initialization...');
        initializeHandTracking();
    });
} else {
    // DOM already loaded
    console.log('[Pet Game] DOM already ready, starting initialization...');
    initializeHandTracking();
}
