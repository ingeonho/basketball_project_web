const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

// 메인 해상도 (640x480)
const W = 640;
const H = 480;

// 고속 분석 전용 경량 해상도 (320x240)
const SW = 320;
const SH = 240;

// =========================================================
// [1. 동적 파라미터 변수]
// =========================================================
let hoopCenter = [320, 220];
let hoopRadius = 80;
let GOAL_LOCKOUT_TIME = 1.5;
let RIM_BALL_RADIUS_MIN = 14;
let RIM_BALL_RADIUS_MAX = 60;
let RIM_DETECTION_RATIO = 0.88;
let MIN_BALL_SPEED = 1.2;

let lowerOrange = [3, 90, 70];
let upperOrange = [22, 255, 255];

let score = 0;
let lastScoreTime = 0;
let goalEffectTimer = 0;

let prevBallCenter = null;
let hasScoredThisEntry = false;

// 고속 영상 분석용 오프스크린 캔버스 및 버퍼
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d');
processCanvas.width = SW;
processCanvas.height = SH;

const maskBuffer = new Uint8Array(SW * SH);
const tempBuffer = new Uint8Array(SW * SH);

// =========================================================
// [2. 슬라이더 바인딩 및 이벤트 처리]
// =========================================================
function bindSlider(inputId, valId, onUpdate) {
    const input = document.getElementById(inputId);
    const val = document.getElementById(valId);
    input.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        val.innerText = v;
        onUpdate(v);
    });
}

bindSlider('inputMinRadius', 'valMinRadius', (v) => RIM_BALL_RADIUS_MIN = v);
bindSlider('inputMaxRadius', 'valMaxRadius', (v) => RIM_BALL_RADIUS_MAX = v);
bindSlider('inputMinSpeed', 'valMinSpeed', (v) => MIN_BALL_SPEED = v);
bindSlider('inputHoopRadius', 'valHoopRadius', (v) => hoopRadius = v);
bindSlider('inputLockout', 'valLockout', (v) => GOAL_LOCKOUT_TIME = v);
bindSlider('inputSMin', 'valSMin', (v) => lowerOrange[1] = v);
bindSlider('inputVMin', 'valVMin', (v) => lowerOrange[2] = v);

const panel = document.getElementById('controlPanel');
const toggleBtn = document.getElementById('togglePanelBtn');
toggleBtn.addEventListener('click', () => panel.classList.toggle('collapsed'));

// =========================================================
// [3. RGB -> HSV 변환 (OpenCV 표준: H 0~179, S 0~255, V 0~255)]
// =========================================================
function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    let max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }
    return [Math.round(h * 179), Math.round(s * 255), Math.round(v * 255)];
}

// =========================================================
// [4. 초고속 Erode & Dilate (초기화 보장 & 60 FPS 유지)]
// =========================================================
function fastErode() {
    tempBuffer.fill(0);
    for (let y = 1; y < SH - 1; y++) {
        let row = y * SW;
        for (let x = 1; x < SW - 1; x++) {
            let idx = row + x;
            if (maskBuffer[idx] === 1 && maskBuffer[idx - 1] === 1 && maskBuffer[idx + 1] === 1 &&
                maskBuffer[idx - SW] === 1 && maskBuffer[idx + SW] === 1) {
                tempBuffer[idx] = 1;
            }
        }
    }
}

function fastDilate() {
    maskBuffer.fill(0);
    for (let y = 1; y < SH - 1; y++) {
        let row = y * SW;
        for (let x = 1; x < SW - 1; x++) {
            let idx = row + x;
            if (tempBuffer[idx] === 1) {
                maskBuffer[idx] = 1;
                maskBuffer[idx - 1] = 1;
                maskBuffer[idx + 1] = 1;
                maskBuffer[idx - SW] = 1;
                maskBuffer[idx + SW] = 1;
            }
        }
    }
}

// =========================================================
// [5. 프레임 영상 분석]
// =========================================================
function processFrame() {
    processCtx.drawImage(video, 0, 0, SW, SH);
    const imgData = processCtx.getImageData(0, 0, SW, SH);
    const data = imgData.data;

    // 1) HSV 마스킹
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        let hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        if (hsv[0] >= lowerOrange[0] && hsv[0] <= upperOrange[0] &&
            hsv[1] >= lowerOrange[1] && hsv[1] <= upperOrange[1] &&
            hsv[2] >= lowerOrange[2] && hsv[2] <= upperOrange[2]) {
            maskBuffer[p] = 1;
        } else {
            maskBuffer[p] = 0;
        }
    }

    // 2) 고속 형태학적 연산 (그물 실 제거)
    fastErode();
    fastDilate();

    // 3) 외곽 덩어리 중심 및 반지름 계산
    let totalX = 0,
        totalY = 0,
        count = 0;
    let minX = SW,
        maxX = 0,
        minY = SH,
        maxY = 0;

    for (let y = 0; y < SH; y += 2) {
        let row = y * SW;
        for (let x = 0; x < SW; x += 2) {
            let idx = row + x;
            if (maskBuffer[idx] === 1) {
                totalX += x;
                totalY += y;
                count++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (count > 0) {
        // 320x240 좌표를 640x480으로 2배 확장
        let bx = (totalX / count) * 2;
        let by = (totalY / count) * 2;
        let br = (Math.max(maxX - minX, maxY - minY) / 2) * 2;
        return { center: [Math.round(bx), Math.round(by)], radius: Math.round(br) };
    }

    return null;
}

// =========================================================
// [6. 메인 게임 루프]
// =========================================================
function update() {
    const currentTime = Date.now() / 1000;
    const isLockedOut = (currentTime - lastScoreTime) < GOAL_LOCKOUT_TIME;

    ctx.drawImage(video, 0, 0, W, H);

    const detection = processFrame();
    let ballCenter = null;
    let ballRadius = 0;
    let ballSpeed = 0.0;

    if (detection) {
        ballRadius = detection.radius;

        if (ballRadius >= RIM_BALL_RADIUS_MIN && ballRadius <= RIM_BALL_RADIUS_MAX) {
            ballCenter = detection.center;

            if (prevBallCenter !== null) {
                ballSpeed = Math.hypot(ballCenter[0] - prevBallCenter[0], ballCenter[1] - prevBallCenter[1]);
            }

            const ballColor = isLockedOut ? 'rgb(150, 150, 150)' : 'rgb(0, 255, 0)';

            ctx.beginPath();
            ctx.arc(ballCenter[0], ballCenter[1], ballRadius, 0, Math.PI * 2);
            ctx.strokeStyle = ballColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(ballCenter[0], ballCenter[1], 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgb(255, 0, 0)';
            ctx.fill();
        }
    }

    prevBallCenter = ballCenter;

    // 득점 조건 검사
    let isInsideRim = false;
    if (ballCenter !== null) {
        const dist = Math.hypot(ballCenter[0] - hoopCenter[0], ballCenter[1] - hoopCenter[1]);

        if (dist < (hoopRadius * RIM_DETECTION_RATIO)) {
            isInsideRim = true;

            if (!isLockedOut && !hasScoredThisEntry && (ballSpeed >= MIN_BALL_SPEED)) {
                score += 1;
                lastScoreTime = currentTime;
                goalEffectTimer = currentTime;
                hasScoredThisEntry = true;
            }
        }
    }

    if (!isInsideRim) {
        hasScoredThisEntry = false;
    }

    // UI 시각화
    let rimColor = 'rgb(255, 200, 0)';
    if (currentTime - goalEffectTimer < 0.8) {
        rimColor = 'rgb(0, 255, 0)';
    } else if (isLockedOut) {
        rimColor = 'rgb(150, 150, 150)';
    }

    ctx.beginPath();
    ctx.arc(hoopCenter[0], hoopCenter[1], hoopRadius, 0, Math.PI * 2);
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hoopCenter[0], hoopCenter[1], Math.round(hoopRadius * RIM_DETECTION_RATIO), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgb(255, 255, 0)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hoopCenter[0], hoopCenter[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fill();

    // 상단 HUD
    ctx.fillStyle = 'rgb(20, 20, 20)';
    ctx.fillRect(0, 0, W, 60);

    ctx.fillStyle = 'rgb(0, 215, 255)';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(`SCORE: ${score}`, 15, 42);

    const statusMsg = isLockedOut ? "READY..." : "SHOOT!";
    const statusColor = isLockedOut ? 'rgb(255, 165, 0)' : 'rgb(0, 255, 0)';

    ctx.fillStyle = 'rgb(35, 35, 35)';
    ctx.fillRect(Math.floor(W * 0.62), 10, Math.floor(W * 0.34), 40);
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.floor(W * 0.62), 10, Math.floor(W * 0.34), 40);

    ctx.fillStyle = statusColor;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(statusMsg, Math.floor(W * 0.66), 38);

    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.font = '14px sans-serif';
    ctx.fillText(`Radius: ${ballRadius} | Speed: ${ballSpeed.toFixed(1)}`, 15, 85);

    if (currentTime - goalEffectTimer < 0.8) {
        ctx.fillStyle = 'rgb(0, 255, 255)';
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText("+1 SWISH!!", Math.floor(W * 0.28), Math.floor(H * 0.60));
    }

    ctx.fillStyle = 'rgb(180, 180, 180)';
    ctx.font = '12px sans-serif';
    ctx.fillText("[L-Click]: Color | [R-Click]: Center | [Tab]: Panel Toggle", 10, H - 12);

    requestAnimationFrame(update);
}

// =========================================================
// [7. 마우스 좌표 오차 보정 & 키보드 조작]
// =========================================================
function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = W / rect.width;
    const scaleY = H / rect.height;

    const x = Math.round(clientX * scaleX);
    const y = Math.round(clientY * scaleY);
    return {
        x: Math.max(0, Math.min(W, x)),
        y: Math.max(0, Math.min(H, y))
    };
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    const coords = getCanvasCoordinates(e);

    if (e.button === 0) { // 좌클릭: 공 색상 추출 및 슬라이더 수치 자동 동기화
        const pX = Math.floor(coords.x / 2);
        const pY = Math.floor(coords.y / 2);

        const pData = processCtx.getImageData(pX, pY, 1, 1).data;
        const hsv = rgbToHsv(pData[0], pData[1], pData[2]);

        const sMin = Math.max(40, hsv[1] - 60);
        const vMin = Math.max(40, hsv[2] - 70);

        lowerOrange = [Math.max(0, hsv[0] - 12), sMin, vMin];
        upperOrange = [Math.min(179, hsv[0] + 12), 255, 255];

        document.getElementById('inputSMin').value = sMin;
        document.getElementById('valSMin').innerText = sMin;
        document.getElementById('inputVMin').value = vMin;
        document.getElementById('valVMin').innerText = vMin;
    } else if (e.button === 2) { // 우클릭: 골대 위치 설정
        hoopCenter = [coords.x, coords.y];
    }
});

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const currentTime = Date.now() / 1000;

    if (e.key === 'Tab') {
        e.preventDefault();
        panel.classList.toggle('collapsed');
    } else if (k === 'r') {
        score = 0;
    } else if (e.key === ' ' || k === ' ') {
        score += 1;
        lastScoreTime = currentTime;
        goalEffectTimer = currentTime;
    } else if (k === 'd' || k === '-' || e.key === 'Backspace') {
        if (score > 0) score -= 1;
    }
});

// 웹캠 카메라 초기화 및 실행
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => update();
    })
    .catch(() => alert("웹캠 권한을 허용해 주세요."));