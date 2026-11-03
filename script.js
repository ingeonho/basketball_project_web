// =========================================================
// [1. Web Audio 사운드 엔진]
// =========================================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type, param = 1) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    if (type === 'swish') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.2);

    } else if (type === 'cheer') {
        // 사이버 네온 환호음 사운드
        const bufferSize = audioCtx.sampleRate * 1.0;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, now);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start(now);

        // 아케이드 신디사이저 화음
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const toneGain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.04);
            toneGain.gain.setValueAtTime(0.12, now + idx * 0.04);
            toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5 + idx * 0.04);
            osc.connect(toneGain);
            toneGain.connect(audioCtx.destination);
            osc.start(now + idx * 0.04);
            osc.stop(now + 0.5 + idx * 0.04);
        });

    } else if (type === 'buzzer') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.8);
    }
}

// =========================================================
// [2. 사이버 네온 파티클 시스템]
// =========================================================
let particles = [];

function createGoalParticles(x, y) {
    const colors = ['#00f3ff', '#ff007f', '#ffe600', '#ffffff'];
    for (let i = 0; i < 60; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10 + 4;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            size: Math.random() * 6 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1.0,
            decay: Math.random() * 0.025 + 0.015
        });
    }
}

function updateAndDrawParticles(ctx) {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(p.x, p.y, p.size, p.size); // 사이버 스타일 사각형 픽셀 파티클
        ctx.restore();
    }
}

// =========================================================
// [3. 명예의 전당 (Local Storage)]
// =========================================================
const LEADERBOARD_KEY = 'cyber_basketball_hof_2077';

function getLeaderboard() {
    try {
        return JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [
            { name: "NEO", score: 35 },
            { name: "CYBER", score: 28 },
            { name: "TRINITY", score: 22 },
            { name: "V_2077", score: 16 },
            { name: "ALT", score: 10 }
        ];
    } catch (e) {
        return [];
    }
}

function saveLeaderboard(board) {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(board));
}

function checkAndAddScore(playerName, newScore) {
    let board = getLeaderboard();
    board.push({ name: playerName.toUpperCase(), score: newScore });
    board.sort((a, b) => b.score - a.score);
    board = board.slice(0, 5);
    saveLeaderboard(board);
}

function resetLeaderboard() {
    localStorage.removeItem(LEADERBOARD_KEY);
    showAdminNotice("[SYSTEM]: 명예의 전당 데이터가 리셋되었습니다.");
}

function showAdminNotice(msg) {
    const notice = document.getElementById('adminNotice');
    notice.innerText = msg;
    notice.classList.remove('hidden');
    setTimeout(() => {
        notice.classList.add('hidden');
    }, 3000);
}

// =========================================================
// [4. 메인 게임 파라미터 & 캔버스 동적 리사이징]
// =========================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

function resizeCanvas() {
    canvas.width = 1280;
    canvas.height = 720;
}
resizeCanvas();

const GAME_DURATION = 30;
const GOAL_LOCKOUT_TIME = 1.2;
const COMBO_TIMEOUT = 3.0;

let hoopCenter = { x: 640, y: 360 };
let hoopRadius = 130;
let rimDetectionRatio = 0.88;

let ballRadiusMin = 18;
let ballRadiusMax = 110;
let minBallSpeed = 1.8;

let lowerOrange = [3, 90, 70];
let upperOrange = [22, 255, 255];

let gameState = "IDLE"; // IDLE, PLAYING, GAMEOVER, NICKNAME_INPUT
let score = 0;
let comboCount = 0;
let lastScoreTime = 0;
let gameStartTime = 0;
let goalEffectTimer = 0;
let showDebug = false;

let prevBallCenter = null;
let hasScoredThisEntry = false;

// 분석 캔버스
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d');
processCanvas.width = 320;
processCanvas.height = 240;

// =========================================================
// [5. 프레임 분석 & 메인 업데이트 루프]
// =========================================================
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [Math.round(h * 180), Math.round(s * 25