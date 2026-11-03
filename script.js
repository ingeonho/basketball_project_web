const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

// 캔버스 내부 해상도 (HD 1280x720)
canvas.width = 1280;
canvas.height = 720;

// =========================================================
// [1. 오탐지 방지 필터 설정값]
// =========================================================
const MIN_PIXEL_COUNT = 40; // 감지할 최소 픽셀 수 (작은 자잘한 노이즈 무시)
const MIN_BALL_RADIUS = 20; // 최소 인정 반지름 (픽셀)
const MAX_BALL_RADIUS = 160; // 최대 인정 반지름 (픽셀)
const MIN_ASPECT_RATIO = 0.65; // 가로/세로 비율 (1.0에 가까울수록 정원형)
const MIN_DENSITY = 0.30; // 영역 내 픽셀 밀도 (흩어진 픽셀 방지)

// =========================================================
// [2. 게임 상태 변수]
// =========================================================
let score = 0;
let hoopCenter = { x: 640, y: 360 }; // 림 중심 위치
let hoopRadius = 120; // 림 반지름

let lowerOrange = [3, 90, 70]; // 공 HSV 기본값
let upperOrange = [22, 255, 255];

let hasScoredThisEntry = false;
let lastScoreTime = 0;
const LOCKOUT_TIME = 1.0; // 득점 후 1초간 재감지 방지

// 오프스크린 분석 캔버스 (320x240)
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
// [3. 정밀 공 트래킹 및 형태 검증 필터]
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

    // [검증 1] 최소 픽셀 수 필터링
    if (count < MIN_PIXEL_COUNT) return null;

    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw <= 0 || bh <= 0) return null;

    // [검증 2] 원형 형태 (가로/세로 비율) 검사
    const aspectRatio = Math.min(bw, bh) / Math.max(bw, bh);
    if (aspectRatio < MIN_ASPECT_RATIO) return null;

    // [검증 3] 픽셀 응집 밀도 검사 (바운딩 박스 대비 채움 비율)
    const area = bw * bh;
    const density = count / area;
    if (density < MIN_DENSITY) return null;

    // 좌표 비례 확장 (320x240 -> 1280x720)
    const scaleX = canvas.width / 320;
    const scaleY = canvas.height / 240;
    let bx = (totalX / count) * scaleX;
    let by = (totalY / count) * scaleY;
    let br = (Math.max(bw * scaleX, bh * scaleY)) / 2;

    // [검증 4] 공 반지름 크기 필터링
    if (br < MIN_BALL_RADIUS || br > MAX_BALL_RADIUS) return null;

    return { x: bx, y: by, r: br };
}

// =========================================================
// [4. 메인 루프]
// =========================================================
function loop() {
    const currentTime = Date.now() / 1000;
    const isLockedOut = (currentTime - lastScoreTime) < LOCKOUT_TIME;

    // 영상 출력
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 공 트래킹 및 득점 조건 검사
    const ball = trackBall();

    if (ball) {
        // 검증 통과한 공만 원형 표시
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.strokeStyle = isLockedOut ? '#888888' : '#00ff88';
        ctx.lineWidth = 4;
        ctx.stroke();

        const dist = Math.hypot(ball.x - hoopCenter.x, ball.y - hoopCenter.y);
        const isInsideHoop = dist < (hoopRadius * 0.85);

        if (isInsideHoop) {
            if (!hasScoredThisEntry && !isLockedOut) {
                score += 1;
                hasScoredThisEntry = true;
                lastScoreTime = currentTime;
            }
        } else {
            hasScoredThisEntry = false;
        }
    }

    // 골대 표시
    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isLockedOut ? '#ff8800' : '#00d7ff';
    ctx.lineWidth = 5;
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

    if (e.button === 2) {
        // 우클릭: 골대 위치 지정
        hoopCenter = { x: Math.round(x), y: Math.round(y) };
    } else if (e.button === 0) {
        // 좌클릭: 공 색상 지정 (실제 농구공 중앙 클릭)
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