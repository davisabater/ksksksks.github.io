import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// ==========================================================================
// Visualizador 3D + Realidade Aumentada (WebXR) para o modelo Capybara.stl
// ==========================================================================

// ---------- Cena, câmera e renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d0f);

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    2000
);
camera.position.set(0, 0, 150);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true; // habilita WebXR (necessário para RA)
document.body.appendChild(renderer.domElement);

// Controles de mouse (arrastar para girar, scroll para zoom) - só fazem
// sentido no modo "mesa" (fora da RA)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ---------- Luzes ----------
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
backLight.position.set(-1, -1, -1);
scene.add(backLight);

// Luz extra usada só durante a sessão de RA (o ambiente real é escuro/variável)
const arLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
arLight.visible = false;
scene.add(arLight);

// ---------- Estado do modelo ----------
let previewMesh = null;      // modelo mostrado na tela "de mesa" (giratório)
let arTemplate = null;       // versão em escala real (metros), usada para clonar em RA
const AR_TARGET_SIZE = 0.35; // tamanho alvo do maior eixo da capivara em RA, em metros

const infoEl = document.getElementById('info');
const loadingEl = document.getElementById('loading');

// A disponibilidade de RA não depende do modelo 3D ter carregado -
// por isso essa checagem roda de forma independente, imediatamente.
// Antes, ela só era chamada dentro do sucesso do loader.load do STL,
// então se o modelo falhasse ao carregar (arquivo não encontrado, erro
// de CORS ao abrir via file://, etc.) o botão de RA nunca aparecia,
// mesmo em dispositivos que suportam WebXR normalmente.
checkARSupport();

// ---------- Carregamento do STL ----------
const loader = new STLLoader();

loader.load(
    './Capybara.stl',
    (geometry) => {
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();

        const center = new THREE.Vector3();
        geometry.boundingBox.getCenter(center);
        geometry.translate(-center.x, -center.y, -center.z);

        const size = new THREE.Vector3();
        geometry.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const material = new THREE.MeshStandardMaterial({
            color: 0xd8a765,
            metalness: 0.05,
            roughness: 0.85
        });

        // Modelo "de mesa" (visualização normal, fora da RA)
        previewMesh = new THREE.Mesh(geometry, material);
        camera.position.set(0, 0, maxDim * 2);
        controls.target.set(0, 0, 0);
        controls.update();
        scene.add(previewMesh);

        // Template para RA: mesma geometria, escalado para tamanho real (metros)
        arTemplate = new THREE.Mesh(geometry, material.clone());
        const arScale = AR_TARGET_SIZE / maxDim;
        arTemplate.scale.setScalar(arScale);
        arTemplate.visible = false; // nunca é exibido diretamente, só clonado

        if (loadingEl) loadingEl.style.display = 'none';
    },
    (xhr) => {
        if (xhr.total && loadingEl) {
            const pct = ((xhr.loaded / xhr.total) * 100).toFixed(0);
            loadingEl.textContent = `Carregando modelo... ${pct}%`;
        }
    },
    (error) => {
        console.error('Erro ao carregar o STL:', error);
        if (loadingEl) {
            loadingEl.textContent = 'Erro ao carregar Capybara.stl. Verifique se o arquivo está na mesma pasta.';
        }
    }
);

// ---------- Suporte a RA (WebXR) ----------
async function checkARSupport() {
    const arContainer = document.getElementById('ar-button-container');
    const arWarning = document.getElementById('ar-warning');

    if (!('xr' in navigator)) {
        showNoARMessage(arWarning);
        return;
    }

    try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (supported) {
            const button = ARButton.createButton(renderer, {
                requiredFeatures: ['hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: document.body }
            });
            button.id = 'ar-button';
            arContainer.appendChild(button);
            arContainer.classList.add('ready');
        } else {
            showNoARMessage(arWarning);
        }
    } catch (e) {
        showNoARMessage(arWarning);
    }
}

function showNoARMessage(el) {
    if (!el) return;
    el.style.display = 'block';
    el.textContent = 'Este navegador/dispositivo não suporta RA via WebXR. ' +
        'Use um Android com Chrome atualizado (ARCore). No iPhone, o Safari ainda não suporta WebXR.';
}

// ---------- Hit-test (posicionamento no mundo real) ----------
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
const placedModels = [];

reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7fd6c2 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const controller = renderer.xr.getController(0);
controller.addEventListener('select', onSelect);
scene.add(controller);

function onSelect() {
    if (reticle.visible && arTemplate) {
        const clone = arTemplate.clone();
        clone.visible = true;
        clone.position.setFromMatrixPosition(reticle.matrix);
        clone.quaternion.setFromRotationMatrix(reticle.matrix);
        scene.add(clone);
        placedModels.push(clone);
        if (infoEl) infoEl.textContent = 'Capivara posicionada! Toque novamente para adicionar outra.';
    }
}

// ---------- Eventos de sessão RA (entrar/sair) ----------
renderer.xr.addEventListener('sessionstart', () => {
    if (previewMesh) previewMesh.visible = false;
    arLight.visible = true;
    ambientLight.intensity = 0;
    directionalLight.intensity = 0;
    backLight.intensity = 0;
    if (infoEl) infoEl.textContent = 'Aponte para uma superfície e toque na tela para posicionar a capivara.';
});

renderer.xr.addEventListener('sessionend', () => {
    if (previewMesh) previewMesh.visible = true;
    arLight.visible = false;
    ambientLight.intensity = 0.7;
    directionalLight.intensity = 1;
    backLight.intensity = 0.4;
    reticle.visible = false;
    hitTestSource = null;
    hitTestSourceRequested = false;
    placedModels.forEach((m) => scene.remove(m));
    placedModels.length = 0;
    if (infoEl) infoEl.textContent = 'Capybara 3D - arraste para girar, scroll para zoom';
});

// ---------- Loop de renderização ----------
renderer.setAnimationLoop((timestamp, frame) => {
    if (frame) {
        // Estamos numa sessão WebXR (RA) ativa
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (!hitTestSourceRequested) {
            session.requestReferenceSpace('viewer').then((viewerSpace) => {
                session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', () => {
                hitTestSource = null;
                hitTestSourceRequested = false;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    } else {
        // Modo "de mesa" normal
        controls.update();
    }

    renderer.render(scene, camera);
});

// ---------- Responsividade ----------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- QR Code de acesso rápido ----------
function renderQRCode() {
    const target = document.getElementById('qrcode');
    if (!target || typeof QRCode === 'undefined') return;
    target.innerHTML = '';
    new QRCode(target, {
        text: window.location.href,
        width: 180,
        height: 180,
        colorDark: '#0b0d0f',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
    const urlEl = document.getElementById('qr-url');
    if (urlEl) urlEl.textContent = window.location.href;
}

const qrToggle = document.getElementById('qr-toggle');
const qrPanel = document.getElementById('qr-panel');
if (qrToggle && qrPanel) {
    qrToggle.addEventListener('click', () => {
        const isOpen = qrPanel.classList.toggle('open');
        if (isOpen) renderQRCode();
    });
    const qrClose = document.getElementById('qr-close');
    if (qrClose) qrClose.addEventListener('click', () => qrPanel.classList.remove('open'));
}
