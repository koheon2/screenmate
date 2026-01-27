import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
    bakery: 0x4a3a2a,
    pharmacy: 0x24373a,
    school: 0x3a3526,
    police: 0x1f2b3c,
    gym: 0x2b2b2b,
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
    const hour = (hourOverride !== null && !Number.isNaN(hourOverride))
        ? hourOverride
        : (() => {
            const now = new Date();
            return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
        })();
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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
const placementPoint = new THREE.Vector3();
let currentPlacement = sleepingMode ? 'bed' : 'floor';
let sleepInteractionLocked = sleepingMode;

function applyPlacement(name) {
    const target = PLACEMENTS[name];
    if (!characterSprite || !target) return;
    currentPlacement = name;
    characterSprite.position.set(target.x, target.y, target.z);
    console.log(
        `[HousePlacement] preset=${name} x=${target.x.toFixed(3)} y=${target.y.toFixed(3)} z=${target.z.toFixed(3)}`
    );
}

// Expose a tiny debug hook for the renderer HTML.
window.__setPlacement = applyPlacement;

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
        modelRoot.position.y += 0.6;

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
            applyPlacement(currentPlacement);
            scene.add(characterSprite);
        },
        undefined,
        (err) => {
            console.warn('Sprite load error:', err);
        }
    );
}

function handleDebugPlacement(event) {
    if (!DEBUG_PLACE || !characterSprite || !event.shiftKey) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(placementPlane, placementPoint)) {
        characterSprite.position.set(placementPoint.x, characterSprite.position.y, placementPoint.z);
        console.log(
            `[HousePlacement] x=${placementPoint.x.toFixed(3)} y=${characterSprite.position.y.toFixed(3)} z=${placementPoint.z.toFixed(3)}`
        );
    }
}

renderer.domElement.addEventListener('pointerdown', handleDebugPlacement);

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

function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
}

window.addEventListener('resize', resize);
resize();

function animate() {
    requestAnimationFrame(animate);
    applyTimeOfDayLighting(debugHour);
    controls.update();
    renderer.render(scene, camera);
}

animate();
