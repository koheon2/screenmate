import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('house-canvas');
const container = document.getElementById('house-container');
const statusEl = document.getElementById('house-status');
const electronApi = window.require ? window.require('electron') : null;
const ipcRenderer = electronApi ? electronApi.ipcRenderer : null;

const params = new URLSearchParams(window.location.search);
const isFull = params.get('mode') === 'full';
const spriteUrl = params.get('img');
const modelFile = params.get('model') || 'house.glb';
const placeName = params.get('placeName') || '장소';
const placeId = params.get('placeId') || 'house1';
const sleepingMode = params.get('sleeping') === '1';
const level = Number(params.get('level') || '0');
const hasEgg = params.get('hasEgg') === '1';
const breedingStage = params.get('breedingStage') || '';
const breedingKissing = breedingStage === 'KISSING';
const breedingEggHome = breedingStage === 'EGG_HOME';
const breedingCradle = breedingStage === 'CRADLE';
const debugPlacement = params.get('debugPlacement') === '1';
const partnerImgUrl = params.get('partnerImg') || '';
const partnerName = params.get('partnerName') || '';
const companionImgUrl = params.get('companionImg') || '';
const companionCoords = {
    x: params.get('companionX'),
    y: params.get('companionY'),
    z: params.get('companionZ')
};
const hasCompanionCoords = Object.values(companionCoords).every((v) => v !== null && v !== '');
const placementOverride = {
    x: params.get('placementX'),
    y: params.get('placementY'),
    z: params.get('placementZ')
};
const placementModelY = params.get('placementModelY');
const hasPlacementOverride = Object.values(placementOverride).every((v) => v !== null && v !== '');
const hasModelYOverride = placementModelY !== null && placementModelY !== '';
const timeOffsetHours = Number(params.get('timeOffsetHours') || '0');

console.log('[HouseViewer] breedingStage:', breedingStage, 'partnerName:', partnerName);

const DEBUG_PLACE = true;
const PLACEMENTS = {
    bed: { x: -0.926, y: 0.6, z: 0.344 },
    desk: { x: 0.539, y: 0.6, z: 0.226 },
    floor: { x: -0.122, y: 0.3, z: 0.016 },
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 140, 900);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.8;
controls.minDistance = 1.2;
controls.maxDistance = isFull ? 12 : 6;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.enabled = false;
transformControls.visible = false;
transformControls.setSize(0.7);
scene.add(transformControls);

// Lighting (time-of-day aware)
const ambient = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambient);

const sunLight = new THREE.DirectionalLight(0xfff0d6, 1.0);
sunLight.position.set(6, 10, 4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 80;
sunLight.shadow.camera.left = -20;
sunLight.shadow.camera.right = 20;
sunLight.shadow.camera.top = 20;
sunLight.shadow.camera.bottom = -20;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-5, 4, -6);
scene.add(fillLight);

const hemi = new THREE.HemisphereLight(0x9ecbff, 0x1a1a1a, 0.45);
scene.add(hemi);

// Sky dome + stars + moon
const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x87b8ff, side: THREE.BackSide })
);
scene.add(skyDome);

const starCount = 600;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i += 1) {
    const r = 500 + Math.random() * 200;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    starPositions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi));
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 3.6, sizeAttenuation: true, transparent: true, opacity: 0 })
);
scene.add(stars);

const moon = new THREE.Mesh(
    new THREE.SphereGeometry(5, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xf4f6ff })
);
moon.position.set(-40, 30, -80);
moon.visible = false;
scene.add(moon);

const sun = new THREE.Mesh(
    new THREE.SphereGeometry(7, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe6b3 })
);
sun.position.set(60, 60, -120);
sun.visible = true;
scene.add(sun);

// Infinite-feeling ground plane
const GROUND_COLORS = {
    house1: 0x2f3a2e,
    house2: 0x33402f,
    house3: 0x3a352c,
    house4: 0x2b3238,
    house5: 0x3a2f36,
    house6: 0x2f2f2f,
    park: 0x2e4a2f,
    park2: 0x3b5a36,
    pharmacy: 0x24373a,
    school: 0x3a3526,
    police: 0x1f2b3c,
    toilet: 0x2a3136,
    cradle: 0x3a2f2a,
};
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({
        color: GROUND_COLORS[placeId] || 0x2f3a2e,
        roughness: 0.95,
        metalness: 0.0
    })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.05;
ground.receiveShadow = true;
scene.add(ground);

let debugHour = null;

function applyTimeOfDayLighting(hourOverride = null) {
    const baseHour = (() => {
        const now = new Date();
        const offsetMs = timeOffsetHours * 60 * 60 * 1000;
        const adjusted = new Date(now.getTime() + offsetMs);
        return adjusted.getHours() + adjusted.getMinutes() / 60 + adjusted.getSeconds() / 3600;
    })();
    const hour = (hourOverride !== null && !Number.isNaN(hourOverride))
        ? hourOverride
        : baseHour;
    // Map 6..18 to 0..1, clamp outside to night edges.
    const dayT = Math.min(1, Math.max(0, (hour - 6) / 12));
    const isNight = hour < 6 || hour > 18;

    // Sunrise/sunset tinting near the edges of the day.
    const edge = Math.min(dayT, 1 - dayT) * 2; // 0 at edges, 1 mid-day
    const warm = new THREE.Color(0xffb56b);
    const cool = new THREE.Color(0xfff1dc);
    const sunColor = cool.clone().lerp(warm, 1 - edge);

    sunLight.color.copy(isNight ? new THREE.Color(0x6f7ea6) : sunColor);

    ambient.intensity = isNight ? 0.22 : 0.45 + dayT * 0.35;
    hemi.intensity = isNight ? 0.25 : 0.35 + dayT * 0.2;

    // Sky colors: blue -> sunset -> night -> sunrise
    const daySky = new THREE.Color(0x7db7ff);
    const sunsetSky = new THREE.Color(0xff9966);
    const nightSky = new THREE.Color(0x05070f);

    let skyColor = daySky.clone();
    if (isNight) {
        skyColor.copy(nightSky);
    } else if (hour < 9) {
        const t = Math.max(0, Math.min(1, (hour - 6) / 3));
        skyColor = sunsetSky.clone().lerp(daySky, t);
    } else if (hour > 15) {
        const t = Math.max(0, Math.min(1, (18 - hour) / 3));
        skyColor = sunsetSky.clone().lerp(daySky, t);
    }

    skyDome.material.color.copy(skyColor);
    scene.fog.color.copy(skyColor.clone().lerp(new THREE.Color(0x000000), 0.55));

    // Stars and moon at night
    const nightStrength = isNight ? 1 : Math.max(0, 1 - dayT * 1.8) * 0.8;
    stars.material.opacity = Math.min(1, nightStrength);
    stars.visible = stars.material.opacity > 0.02;

    const sunAngle = ((hour - 6) / 24) * Math.PI * 2;
    const sunPos = new THREE.Vector3(
        Math.cos(sunAngle) * 60,
        55 + Math.sin(sunAngle) * 40,
        0
    );
    sun.position.copy(sunPos);

    // Keep the light aligned with the sun's apparent position.
    sunLight.position.copy(sunPos.clone().multiplyScalar(0.9));
    const sunAboveHorizon = sunPos.y > 8;
    sunLight.intensity = sunAboveHorizon ? (0.55 + dayT * 0.75) : 0.05;
    sun.visible = sunAboveHorizon;

    // Moon follows the exact opposite arc of the sun.
    const moonPos = sunPos.clone().multiplyScalar(-1);
    moon.position.copy(moonPos);
    moon.visible = !sunAboveHorizon;
}

applyTimeOfDayLighting();

window.__setDebugHour = (hour) => {
    debugHour = Number.isFinite(hour) ? hour : null;
    applyTimeOfDayLighting(debugHour);
};


let modelRoot = null;
let characterSprite = null;
let companionSprite = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
const placementPoint = new THREE.Vector3();
const eggInteractionMode = breedingCradle || level === 0;
let currentPlacement = sleepingMode && !eggInteractionMode ? 'bed' : 'floor';
let sleepInteractionLocked = sleepingMode && !eggInteractionMode;
let manualPlacement = null;
let modelYOffset = 0;
let cameraOnlyMode = false;
let bubbleTimeout = null;

if (hasPlacementOverride) {
    manualPlacement = {
        x: Number(placementOverride.x),
        y: Number(placementOverride.y),
        z: Number(placementOverride.z)
    };
}
if (hasModelYOverride) {
    modelYOffset = Number(placementModelY);
}

function applyPlacement(name) {
    const target = PLACEMENTS[name];
    if (!characterSprite || !target) return;
    currentPlacement = name;
    manualPlacement = null;
    characterSprite.position.set(target.x, target.y, target.z);
    console.log(
        `[HousePlacement] preset=${name} x=${target.x.toFixed(3)} y=${target.y.toFixed(3)} z=${target.z.toFixed(3)}`
    );
}

// Expose a tiny debug hook for the renderer HTML.
window.__setPlacement = applyPlacement;
window.__getPlacement = () => {
    if (!characterSprite) return null;
    return {
        x: characterSprite.position.x,
        y: characterSprite.position.y,
        z: characterSprite.position.z
    };
};
window.__getModelYOffset = () => {
    if (!modelRoot) return null;
    return modelRoot.position.y - 0.6;
};

window.__setModelYOffset = (value) => {
    if (!modelRoot) return;
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    modelRoot.position.y = 0.6 + num;
    modelYOffset = num;
};

window.__setPlacementCoords = (coords) => {
    if (!characterSprite || !coords) return;
    const x = Number(coords.x);
    const y = Number(coords.y);
    const z = Number(coords.z);
    if (![x, y, z].every((v) => Number.isFinite(v))) return;
    characterSprite.position.set(x, y, z);
    manualPlacement = { x, y, z };
    if (debugPlacement && transformControls.object !== characterSprite) {
        transformControls.attach(characterSprite);
    }
};

window.__setCameraOnlyMode = (enabled) => {
    cameraOnlyMode = !!enabled;
    if (cameraOnlyMode) {
        transformControls.detach();
        controls.enabled = true;
    }
};

function toggleCameraOnlyMode() {
    window.__setCameraOnlyMode(!cameraOnlyMode);
    window.dispatchEvent(new CustomEvent('camera-only-toggle', { detail: { enabled: cameraOnlyMode } }));
}

const loader = new GLTFLoader();
const modelUrl = new URL(`assets/models/${modelFile}`, window.location.href).href;

function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
}

setStatus(`${placeName} 로딩 중...`);
loader.load(
    modelUrl,
    (gltf) => {
        modelRoot = gltf.scene;
        modelRoot.traverse((obj) => {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
            }
        });
        scene.add(modelRoot);

        // Center and scale model
        const box = new THREE.Box3().setFromObject(modelRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        modelRoot.position.sub(center);
        modelRoot.position.y += 0.6;

        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = isFull ? 4.2 : 3.2;
        const scale = targetSize / maxDim;
        modelRoot.scale.setScalar(scale);

        // Recompute after scale
        const scaledBox = new THREE.Box3().setFromObject(modelRoot);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);
        modelRoot.position.sub(scaledCenter);
        modelRoot.position.y += 0.6 + modelYOffset;

        camera.position.set(3.5, 2.2, 3.5);
        controls.target.set(0, 0.8, 0);
        controls.update();

        setStatus(placeName);
    },
    (event) => {
        if (event.total) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setStatus(`로딩 ${progress}%`);
        }
    },
    (err) => {
        console.error('GLB load error:', err);
        setStatus(`${placeName} 모델을 불러오지 못했어요.`);
    }
);

if (spriteUrl) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
        spriteUrl,
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
            characterSprite = new THREE.Sprite(material);
            characterSprite.scale.set(0.44, 0.44, 1);

            if (breedingKissing) {
                // 번식 모드: 왼쪽에 배치
                characterSprite.position.set(-0.3, 0.3, 0.016);
            } else if (manualPlacement) {
                characterSprite.position.set(manualPlacement.x, manualPlacement.y, manualPlacement.z);
            } else {
                applyPlacement(currentPlacement);
            }
            if (debugPlacement && transformControls.object !== characterSprite) {
                transformControls.attach(characterSprite);
            }
            scene.add(characterSprite);
        },
        undefined,
        (err) => {
            console.warn('Sprite load error:', err);
        }
    );
}

if (companionImgUrl && hasCompanionCoords) {
    const companionLoader = new THREE.TextureLoader();
    companionLoader.load(
        companionImgUrl,
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
            companionSprite = new THREE.Sprite(material);
            companionSprite.scale.set(0.44, 0.44, 1);
            companionSprite.position.set(
                Number(companionCoords.x),
                Number(companionCoords.y),
                Number(companionCoords.z)
            );
            scene.add(companionSprite);
        },
        undefined,
        (err) => {
            console.warn('Companion sprite load error:', err);
        }
    );
}

function handleDebugPlacement(event) {
    if (!DEBUG_PLACE || !characterSprite) return;
    if (!debugPlacement && !event.shiftKey) return;
    if (cameraOnlyMode) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(placementPlane, placementPoint)) {
        characterSprite.position.set(placementPoint.x, characterSprite.position.y, placementPoint.z);
        manualPlacement = {
            x: characterSprite.position.x,
            y: characterSprite.position.y,
            z: characterSprite.position.z
        };
        console.log(
            `[HousePlacement] x=${placementPoint.x.toFixed(3)} y=${characterSprite.position.y.toFixed(3)} z=${placementPoint.z.toFixed(3)}`
        );
    }
}

renderer.domElement.addEventListener('pointerdown', handleDebugPlacement);

if (debugPlacement) {
    controls.enabled = false;
    transformControls.enabled = true;
    transformControls.visible = true;
    if (characterSprite) {
        transformControls.attach(characterSprite);
    }
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
    });

    window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'm') {
            if (transformControls.object === characterSprite && modelRoot) {
                transformControls.detach();
                transformControls.attach(modelRoot);
                transformControls.showX = false;
                transformControls.showZ = false;
                transformControls.showY = true;
            } else if (characterSprite) {
                transformControls.detach();
                transformControls.attach(characterSprite);
                transformControls.showX = true;
                transformControls.showZ = true;
                transformControls.showY = true;
            }
        }
        if (event.key.toLowerCase() === 'c') {
            toggleCameraOnlyMode();
        }
    });
}

function handleSleepInteraction(event) {
    if (!sleepInteractionLocked || !characterSprite || !ipcRenderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(characterSprite, true);
    if (!hits || hits.length === 0) return;

    sleepInteractionLocked = false;
    ipcRenderer.invoke('wake-up-from-sleep').then((res) => {
        if (!res || !res.success) {
            sleepInteractionLocked = true;
            alert(res?.message || '깨우지 못했어.');
            return;
        }
        alert('잠을 깨웠어! 행복도 -10');
    }).catch((err) => {
        sleepInteractionLocked = true;
        alert(err.message);
    });
}

renderer.domElement.addEventListener('pointerdown', handleSleepInteraction);

function showSpeech(text) {
    const bubble = document.getElementById('speech-bubble');
    if (!bubble) return;
    bubble.textContent = text;
    bubble.style.opacity = '1';
    if (bubbleTimeout) clearTimeout(bubbleTimeout);
    bubbleTimeout = setTimeout(() => {
        bubble.style.opacity = '0';
    }, 2200);
}

function handlePlaceSpeechInteraction(event) {
    if (!characterSprite || !ipcRenderer) return;
    if (sleepingMode) return;
    if (debugPlacement) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(characterSprite, true);
    if (!hits || hits.length === 0) return;

    if (placeId === 'bank') {
        showSpeech('널 위해 돈을 가져다줄게!!!');
        return;
    }
    if (placeId === 'police') {
        showSpeech('잘못했어요~ㅠㅠ');
        return;
    }
    if (placeId.startsWith('house')) {
        const houseLines = ['나랑 놀고 싶어?', '지금 공부중이야!'];
        const line = houseLines[Math.floor(Math.random() * houseLines.length)];
        showSpeech(line);
    }
}

renderer.domElement.addEventListener('pointerdown', handlePlaceSpeechInteraction);

function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
}

window.addEventListener('resize', resize);
resize();

function updateBubble(pos) {
    const bubble = document.getElementById('speech-bubble');
    if (!bubble || !pos) return;
    const tempV = pos.clone();
    tempV.y += 0.5; // 머리 위
    tempV.project(camera);
    const x = (tempV.x * .5 + .5) * container.clientWidth;
    const y = (tempV.y * -.5 + .5) * container.clientHeight;
    bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
}

function animate() {
    requestAnimationFrame(animate);
    applyTimeOfDayLighting(debugHour);
    controls.update();

    if (characterSprite) {
        updateBubble(characterSprite.position);
    }

    renderer.render(scene, camera);
}

// ==================== BREEDING MODE ====================
let partnerSprite = null;
let breedingStarted = false;

function tryStartBreeding() {
    if (breedingStarted) return;
    if (!characterSprite || !partnerSprite) {
        // Retry in 500ms if sprites not loaded yet
        setTimeout(tryStartBreeding, 500);
        return;
    }
    breedingStarted = true;

    // Position sprites for breeding
    characterSprite.position.set(-0.5, 0.3, 0.016);
    partnerSprite.position.set(0.5, 0.3, 0.016);

    // Start kiss animation after a short delay
    setTimeout(startBreedingAnimation, 1000);
}

if (breedingKissing) {
    // 1. 파트너 띄우기
    const partnerLoader = new THREE.TextureLoader();
    partnerLoader.load(
        partnerImgUrl || 'assets/level3/mametchi/normal.webp',
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
            partnerSprite = new THREE.Sprite(material);
            partnerSprite.scale.set(0.44, 0.44, 1);
            // Flip partner so the sprites face each other.
            partnerSprite.scale.x *= -1;
            partnerSprite.position.set(0.3, 0.3, 0.016);
            scene.add(partnerSprite);

            // 내 캐릭터 왼쪽으로 이동
            if (characterSprite) {
                characterSprite.position.set(-0.3, 0.3, 0.016);
            }

            tryStartBreeding();
        }
    );
}

function startBreedingAnimation() {
    console.log('[Breeding] startBreedingAnimation called');
    console.log('[Breeding] characterSprite:', !!characterSprite, 'partnerSprite:', !!partnerSprite);
    if (!characterSprite || !partnerSprite) {
        console.log('[Breeding] Missing sprites, aborting');
        return;
    }

    let step = 0;
    const interval = setInterval(() => {
        step++;

        // Move towards each other
        if (step < 30) {
            characterSprite.position.x += 0.015;
            partnerSprite.position.x -= 0.015;
        }

        // Create heart particles during kissing
        if (step > 30 && step < 80 && step % 8 === 0) {
            createHeartParticle();
        }

        if (step >= 100) {
            console.log('[Breeding] Animation complete');
            clearInterval(interval);
            if (ipcRenderer) {
                ipcRenderer.send('breeding-kiss-seen');
            }
            setTimeout(() => {
                if (ipcRenderer) ipcRenderer.send('close-house-viewer');
            }, 400);
        }
    }, 50);
}

function createHeartParticle() {
    // Simple heart using DOM overlay
    const heartEl = document.createElement('div');
    heartEl.textContent = '❤️';
    heartEl.style.cssText = `
        position: fixed;
        left: 50%;
        top: 50%;
        font-size: 32px;
        transform: translate(-50%, -50%);
        z-index: 50;
        pointer-events: none;
        animation: floatUp 1.5s ease-out forwards;
    `;
    document.body.appendChild(heartEl);

    // Add animation if not exists
    if (!document.getElementById('heart-anim-style')) {
        const style = document.createElement('style');
        style.id = 'heart-anim-style';
        style.textContent = `
            @keyframes floatUp {
                0% { opacity: 1; transform: translate(-50%, -50%) translateY(0); }
                100% { opacity: 0; transform: translate(-50%, -50%) translateY(-80px); }
            }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => heartEl.remove(), 1500);
}

function showEgg(mode) {
    const eggEl = document.getElementById('house-egg');
    if (!eggEl) return;
    eggEl.style.display = 'block';
    eggEl.style.opacity = '1';
    eggEl.style.pointerEvents = 'auto';
    eggEl.style.cursor = 'pointer';

    if (mode === 'egg-home') {
        eggEl.onclick = () => {
            if (!ipcRenderer) return;
            ipcRenderer.send('breeding-egg-acquired');
            eggEl.style.pointerEvents = 'none';
            setTimeout(() => ipcRenderer.send('close-house-viewer'), 300);
        };
        return;
    }

    // cradle / generic egg click behavior
    eggEl.onclick = () => {
        if (!ipcRenderer) return;
        ipcRenderer.send('egg-clicked');
    };
}

if (!breedingKissing) {
    if (breedingEggHome) {
        showEgg('egg-home');
    } else if (breedingCradle || hasEgg) {
        showEgg('cradle');
    }
}

animate();
