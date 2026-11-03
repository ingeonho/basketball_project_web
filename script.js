const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

// 캔버스 내부 해상도 (HD 1280x720)
canvas.width = 1280;
canvas.height = 720;

// =========================================================
// [1. 바닥 튕김 & 오탐지 방지 필터 설정값]
// =========================================================
const MIN_PIXEL_COUNT = 30; // 최소 픽셀 수
const MIN_BALL_RADIUS = 15; // 최소 인정 반지름
const MAX_BALL_RADIUS = 70; // 최대 인정 반지름 (크기 팽창 방지)
const MIN_ASPECT_RATIO = 0.70; // 정원형 비율 (가로/세로)
const MIN_DENSITY = 0.35; // 픽셀 응집 밀도

// =========================================================
// [2. 게임 상태 및 공 이동 추적 변수]
// =========================================================
let score = 0;
let hoopCenter = { x: 640, y: 360 };
let hoopRadius = 120;

let lowerOrange = [3, 90, 70];
let upperOrange = [22, 255, 255];

let hasScoredThisEntry = false;
let lastScoreTime = 0;
const LOCKOUT_TIME = 1.0; // 득점 후 1초간 재감지 방지

// 공의 전 프레임 위치 추적 (낙하 방향 검증용)
let prevBallCenter = null;

// 분석용 오프스크린 캔버스
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d');
processCanvas.width = 320;
processCanvas.height = 240;

// RGB -> HSV 색상 변환
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
    return [Math.round(h * 180), Math.round(s * 255), Math.round(v * 255)];
}

// =========================================================
// [3. 정밀 공 트래킹]
// =========================================================
function trackBall() {
    processCtx.drawImage(video, 0, 0, 320, 240);
    const imgData = processCtx.getImageData(0, 0, 320, 240);
    const data = imgData.data;

    let totalX = 0,
        totalY = 0,
        count = 0;
    let minX = 320,
        maxX = 0,
        minY = 240,
        maxY = 0;

    for (let y = 0; y < 240; y += 2) {
        for (let x = 0; x < 320; x += 2) {
            let idx = (y * 320 + x) * 4;
            let hsv = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);

            if (hsv[0] >= lowerOrange[0] && hsv[0] <= upperOrange[0] &&
                hsv[1] >= lowerOrange[1] && hsv[1] <= upperOrange[1] &&
                hsv[2] >= lowerOrange[2] && hsv[2] <= upperOrange[2]) {
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

    if (count < MIN_PIXEL_COUNT) return null;

    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw <= 0 || bh <= 0) return null;

    // 가로/세로 비율 및 밀도 검사
    const aspectRatio = Math.min(bw, bh) / Math.max(bw, bh);
    if (aspectRatio < MIN_ASPECT_RATIO) return null;

    const area = bw * bh;
    const density = count / area;
    if (density < MIN_DENSITY) return null;

    const scaleX = canvas.width / 320;
    const scaleY = canvas.height / 240;
    let bx = (totalX / count) * scaleX;
    let by = (totalY / count) * scaleY;
    let br = (Math.max(bw * scaleX, bh * scaleY)) / 2;

    // 공 크기 제한 (초록원 거대화 차단)
    if (br < MIN_BALL_RADIUS || br > MAX_BALL_RADIUS) return null;

    return { x: bx, y: by, r: br };
}

// =========================================================
// [4. 메인 루프]
// =========================================================
function loop() {
    const currentTime = Date.now() / 1000;
    const isLockedOut = (currentTime - lastScoreTime) < LOCKOUT_TIME;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const ball = trackBall();

    if (ball) {
        // 공의 이동 방향(Y축 변화량) 계산
        let isMovingDown = false;
        if (prevBallCenter) {
            let dy = ball.y - prevBallCenter.y; // dy > 0 이면 아래로 낙하 중
            if (dy > 1.5) { // 최소 1.5px 이상 아래로 떨어지는 중이어야 인정
                isMovingDown = true;
            }
        }
        prevBallCenter = { x: ball.x, y: ball.y };

        // 공 외곽선 (초록색 원)
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.strokeStyle = isLockedOut ? '#888888' : '#00ff88';
        ctx.lineWidth = 4;
        ctx.stroke();

        // 림 중심과의 거리 계산
        const dist = Math.hypot(ball.x - hoopCenter.x, ball.y - hoopCenter.y);

        // 득점 판정 범위 (림 정중앙 진입 필요)
        const isInsideHoop = dist < (hoopRadius * 0.55);

        // 득점 조건: 림 중앙 진입 + 위에서 아래로 낙하 중 + 락아웃 아님
        if (isInsideHoop) {
            if (!hasScoredThisEntry && !isLockedOut && isMovingDown) {
                score += 1;
                hasScoredThisEntry = true;
                lastScoreTime = currentTime;
            }
        } else {
            hasScoredThisEntry = false;
        }
    } else {
        prevBallCenter = null;
    }

    // 골대 표시 (외곽선 + 타깃 중앙링)
    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isLockedOut ? '#ff8800' : '#00d7ff';
    ctx.lineWidth = 5;
    ctx.stroke();

    // 내부에 득점 정밀 타깃 표시 (노란색 원)
    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 점수판 UI
    ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
    ctx.fillRect(30, 30, 260, 80);
    ctx.strokeStyle = '#00d7ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, 260, 80);

    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(`SCORE: ${score}`, 50, 87);

    requestAnimationFrame(loop);
}

// =========================================================
// [5. 마우스 캘리브레이션]
// =========================================================
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (e.button === 2) { // 우클릭: 골대 위치 지정
        hoopCenter = { x: Math.round(x), y: Math.round(y) };
    } else if (e.button === 0) { // 좌클릭: 공 색상 지정
        const px = Math.floor((x / canvas.width) * 320);
        const py = Math.floor((y / canvas.height) * 240);
        const pData = processCtx.getImageData(px, py, 1, 1).data;
        const hsv = rgbToHsv(pData[0], pData[1], pData[2]);

        lowerOrange = [Math.max(0, hsv[0] - 10), Math.max(50, hsv[1] - 60), Math.max(50, hsv[2] - 70)];
        upperOrange = [Math.min(180, hsv[0] + 10), 255, 255];
    }
});

// 웹캠 카메라 시작
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => loop();
    })
    .catch(() => alert("웹캠 권한을 허용해 주세요."));