import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('house-canvas');
const container = document.getElementById('house-container');
const statusEl = document.getElementById('house-status');

const params = new URLSearchParams(window.location.search);
const isFull = params.get('mode') === 'full';
const spriteUrl = params.get('img');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

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

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.8;
controls.minDistance = 1.2;
controls.maxDistance = isFull ? 12 : 6;

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(4, 6, 3);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.4);
scene.add(hemi);


let modelRoot = null;
let characterSprite = null;

const loader = new GLTFLoader();
const modelUrl = new URL('assets/models/house.glb', window.location.href).href;

function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
}

setStatus('모델 로딩 중...');
loader.load(
    modelUrl,
    (gltf) => {
        modelRoot = gltf.scene;
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

        setStatus('');
    },
    (event) => {
        if (event.total) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setStatus(`로딩 ${progress}%`);
        }
    },
    (err) => {
        console.error('GLB load error:', err);
        setStatus('모델을 불러오지 못했어요.');
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
            characterSprite.scale.set(1.1, 1.1, 1);
            characterSprite.position.set(0.4, 1.0, 1.2);
            scene.add(characterSprite);
        },
        undefined,
        (err) => {
            console.warn('Sprite load error:', err);
        }
    );
}

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
    controls.update();
    renderer.render(scene, camera);
}

animate();
