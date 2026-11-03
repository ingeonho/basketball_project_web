const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

// 캔버스 내부 해상도 (HD 1280x720)
canvas.width = 1280;
canvas.height = 720;

// =========================================================
// [1. 그물/배경 오탐지 차단 필터 설정값]
// =========================================================
const MIN_PIXEL_COUNT = 90; // 얇은 그물 실 오탐지 방지 (30 -> 90 상향)
const MIN_BALL_RADIUS = 20; // 최소 인정 반지름
const MAX_BALL_RADIUS = 80; // 최대 인정 반지름
const MIN_ASPECT_RATIO = 0.75; // 정원형 비율 (가로/세로)
const MIN_DENSITY = 0.40; // 픽셀 응집 밀도 (더 빽빽한 덩어리만 인정)
const MIN_BALL_SPEED = 2.5; // [핵심] 최소 이동 속도 (멈춰있는 그물 완전히 무시)

// =========================================================
// [2. 게임 상태 및 변수]
// =========================================================
let score = 0;
let hoopCenter = { x: 640, y: 360 };
let hoopRadius = 120;

// S(채도), V(명도) 하한선을 높여 옅은 그물 실 색상 제외
let lowerOrange = [3, 120, 100];
let upperOrange = [22, 255, 255];

let hasScoredThisEntry = false;
let lastScoreTime = 0;
const LOCKOUT_TIME = 1.0;

// 공의 전 프레임 위치 및 속도 추적 변수
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

    // 1. 최소 픽셀 수 필터 (얇은 그물 실 제거)
    if (count < MIN_PIXEL_COUNT) return null;

    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw <= 0 || bh <= 0) return null;

    // 2. 가로/세로 비율 검사
    const aspectRatio = Math.min(bw, bh) / Math.max(bw, bh);
    if (aspectRatio < MIN_ASPECT_RATIO) return null;

    // 3. 픽셀 밀도 검사 (면적 대비 꽉 차있는지)
    const area = bw * bh;
    const density = count / area;
    if (density < MIN_DENSITY) return null;

    const scaleX = canvas.width / 320;
    const scaleY = canvas.height / 240;
    let bx = (totalX / count) * scaleX;
    let by = (totalY / count) * scaleY;
    let br = (Math.max(bw * scaleX, bh * scaleY)) / 2;

    // 4. 공 크기 범위 제한
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
        // 이동 속도 및 낙하 방향 계산
        let ballSpeed = 0;
        let isMovingDown = false;

        if (prevBallCenter) {
            let dx = ball.x - prevBallCenter.x;
            let dy = ball.y - prevBallCenter.y;
            ballSpeed = Math.hypot(dx, dy); // 프레임간 이동 거리(속도)

            if (dy > 1.2) {
                isMovingDown = true;
            }
        }

        // 멈춰있는 그물은 완전히 무시 (속도가 일정 이상 움직일 때만 원 표시)
        const isDynamicBall = ballSpeed >= MIN_BALL_SPEED;

        if (isDynamicBall || isLockedOut) {
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
            ctx.strokeStyle = isLockedOut ? '#888888' : '#00ff88';
            ctx.lineWidth = 4;
            ctx.stroke();
        }

        const dist = Math.hypot(ball.x - hoopCenter.x, ball.y - hoopCenter.y);
        const isInsideHoop = dist < (hoopRadius * 0.55);

        // 득점 조건: 림 중앙 진입 + 아래로 낙하 중 + 움직이는 공 + 락아웃 아님
        if (isInsideHoop) {
            if (!hasScoredThisEntry && !isLockedOut && isMovingDown && isDynamicBall) {
                score += 1;
                hasScoredThisEntry = true;
                lastScoreTime = currentTime;
            }
        } else {
            hasScoredThisEntry = false;
        }

        prevBallCenter = { x: ball.x, y: ball.y };
    } else {
        prevBallCenter = null;
    }

    // 골대 및 UI 표시
    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isLockedOut ? '#ff8800' : '#00d7ff';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1;
    ctx.stroke();

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

    if (e.button === 2) {
        hoopCenter = { x: Math.round(x), y: Math.round(y) };
    } else if (e.button === 0) {
        const px = Math.floor((x / canvas.width) * 320);
        const py = Math.floor((y / canvas.height) * 240);
        const pData = processCtx.getImageData(px, py, 1, 1).data;
        const hsv = rgbToHsv(pData[0], pData[1], pData[2]);

        // 공을 마우스 좌클릭으로 찍을 때 짙은 주황색 위주로 설정
        lowerOrange = [Math.max(0, hsv[0] - 10), Math.max(100, hsv[1] - 50), Math.max(100, hsv[2] - 50)];
        upperOrange = [Math.min(180, hsv[0] + 10), 255, 255];
    }
});

navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => loop();
    })
    .catch(() => alert("웹캠 권한을 허용해 주세요."));