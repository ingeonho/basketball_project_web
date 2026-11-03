const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

// =========================================================
// [1. 파이썬 코드 동일 세팅 수치]
// =========================================================
let hoopCenter = [320, 220]; // 골대 중심 좌표 (우클릭 재설정 가능)
let hoopRadius = 80; // 림 반지름

const GOAL_LOCKOUT_TIME = 1.5; // 득점 후 감지 일시 정지 시간(초)
const RIM_BALL_RADIUS_MIN = 14; // 최소 인정 공 반지름
const RIM_BALL_RADIUS_MAX = 60; // 최대 인정 공 반지름 (손/몸통 간섭 차단)
const RIM_DETECTION_RATIO = 0.88; // 림 반지름 인정 범위 (88%)
const MIN_BALL_SPEED = 1.2; // 최소 이동 속도

// HSV 기본값 (주황색 공)
let lowerOrange = [3, 90, 70];
let upperOrange = [22, 255, 255];

let score = 0;
let lastScoreTime = 0;
let goalEffectTimer = 0;

let prevBallCenter = null;
let hasScoredThisEntry = false;

// 이미지 처리 캔버스 (640x480)
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d');
processCanvas.width = 640;
processCanvas.height = 480;

const W = 640;
const H = 480;
const maskBuffer = new Uint8Array(W * H);
const tempBuffer = new Uint8Array(W * H);

// =========================================================
// [2. RGB -> HSV 변환 (OpenCV HSV 규격: H: 0~179, S: 0~255, V: 0~255)]
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
// [3. 파이썬 cv2.erode() & cv2.dilate() 1:1 구현 (그물 실 제거용)]
// =========================================================
function erode(src, dst) {
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            let idx = y * W + x;
            if (src[idx] === 1) {
                if (src[idx - 1] && src[idx + 1] && src[idx - W] && src[idx + W]) {
                    dst[idx] = 1;
                } else {
                    dst[idx] = 0;
                }
            } else {
                dst[idx] = 0;
            }
        }
    }
}

function dilate(src, dst) {
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            let idx = y * W + x;
            if (src[idx] === 1) {
                dst[idx] = 1;
                dst[idx - 1] = 1;
                dst[idx + 1] = 1;
                dst[idx - W] = 1;
                dst[idx + W] = 1;
            } else {
                if (dst[idx] !== 1) dst[idx] = 0;
            }
        }
    }
}

// =========================================================
// [4. 공 트래킹 & 윤곽선 복원 (Convex Hull)]
// =========================================================
function processFrame() {
    processCtx.drawImage(video, 0, 0, W, H);
    const imgData = processCtx.getImageData(0, 0, W, H);
    const data = imgData.data;

    // 1) HSV 마스킹 (inRange)
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

    // 2) Erode 2회 (얇은 그물 실 노이즈 완벽 제거)
    erode(maskBuffer, tempBuffer);
    erode(tempBuffer, maskBuffer);

    // 3) Dilate 2회 (공 덩어리 원형 복원)
    dilate(maskBuffer, tempBuffer);
    dilate(tempBuffer, maskBuffer);

    // 4) 바운딩 덩어리 탐색 (Convex Hull / MinEnclosingCircle)
    let totalX = 0,
        totalY = 0,
        count = 0;
    let minX = W,
        maxX = 0,
        minY = H,
        maxY = 0;

    for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
            let idx = y * W + x;
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
        let bx = totalX / count;
        let by = totalY / count;
        let br = Math.max(maxX - minX, maxY - minY) / 2;
        return { center: [Math.round(bx), Math.round(by)], radius: Math.round(br) };
    }

    return null;
}

// =========================================================
// [5. 메인 프레임 루프 & UI 시각화]
// =========================================================
function update() {
    const currentTime = Date.now() / 1000;
    const isLockedOut = (currentTime - lastScoreTime) < GOAL_LOCKOUT_TIME;

    // 비디오 화면 렌더링
    ctx.drawImage(video, 0, 0, W, H);

    // 공 트래킹
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

            // 락아웃 대기 중: 회색 / 슛 가능 상태: 녹색
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

    // ----------------------------------------------------
    // [6. 득점 감지 (락아웃 중 감지 중단)]
    // ----------------------------------------------------
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

    // ----------------------------------------------------
    // [7. 파이썬과 동일한 UI 시각화 (READY / SHOOT!)]
    // ----------------------------------------------------
    let rimColor = 'rgb(255, 200, 0)';
    if (currentTime - goalEffectTimer < 0.8) {
        rimColor = 'rgb(0, 255, 0)';
    } else if (isLockedOut) {
        rimColor = 'rgb(150, 150, 150)';
    }

    // 림 외곽원 및 내부 득점 인정원
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

    // 상단 HUD 검은색 바
    ctx.fillStyle = 'rgb(20, 20, 20)';
    ctx.fillRect(0, 0, W, 60);

    ctx.fillStyle = 'rgb(0, 215, 255)';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(`SCORE: ${score}`, 15, 42);

    // 오른쪽 상태 박스 (READY... / SHOOT!)
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

    // 디버그 텍스트
    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.font = '14px sans-serif';
    ctx.fillText(`Radius: ${ballRadius} | Speed: ${ballSpeed.toFixed(1)}`, 15, 85);

    // 골 성공 텍스트 연출
    if (currentTime - goalEffectTimer < 0.8) {
        ctx.fillStyle = 'rgb(0, 255, 255)';
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText("+1 SWISH!!", Math.floor(W * 0.28), Math.floor(H * 0.60));
    }

    // 하단 조작 가이드
    ctx.fillStyle = 'rgb(180, 180, 180)';
    ctx.font = '12px sans-serif';
    ctx.fillText("[L-Click]: Color | [R-Click]: Center | [Space]: +1 | [d/-]: -1 | [r]: Reset", 10, H - 12);

    requestAnimationFrame(update);
}

// =========================================================
// [8. 마우스 및 키보드 조작]
// =========================================================
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (W / rect.width));
    const y = Math.round((e.clientY - rect.top) * (H / rect.height));

    if (e.button === 0) { // 좌클릭: 공 색상 보정
        const pCtx = processCanvas.getContext('2d');
        const pData = pCtx.getImageData(x, y, 1, 1).data;
        const hsv = rgbToHsv(pData[0], pData[1], pData[2]);

        lowerOrange = [Math.max(0, hsv[0] - 12), Math.max(40, hsv[1] - 60), Math.max(40, hsv[2] - 70)];
        upperOrange = [Math.min(179, hsv[0] + 12), 255, 255];
    } else if (e.button === 2) { // 우클릭: 골대 위치 보정
        hoopCenter = [x, y];
    }
});

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const currentTime = Date.now() / 1000;

    if (k === 'r') {
        score = 0;
    } else if (e.key === ' ' || k === ' ') { // 스페이스바 +1점
        score += 1;
        lastScoreTime = currentTime;
        goalEffectTimer = currentTime;
    } else if (k === 'd' || k === '-' || e.key === 'Backspace') { // -1점
        if (score > 0) score -= 1;
    }
});

// 웹캠 실행
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => update();
    })
    .catch(() => alert("웹캠 권한을 허용해 주세요."));