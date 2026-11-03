const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

// 1. 핵심 상태 변수
let score = 0;
let hoopCenter = { x: 320, y: 240 }; // 림 중심 위치 (기본값)
let hoopRadius = 70;                 // 림 반지름

let lowerOrange = [3, 90, 70];       // 공 감지 HSV 기본값
let upperOrange = [22, 255, 255];

let hasScoredThisEntry = false;      // 공이 림 안에 들어왔을 때 중복 득점 방지 플래그
let lastScoreTime = 0;
const LOCKOUT_TIME = 1.0;            // 득점 후 1초간 재감지 방지

// 오프스크린 프레임 분석용 캔버스
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d');
processCanvas.width = 320;
processCanvas.height = 240;

// 2. RGB -> HSV 색상 변환
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
    return [Math.round(h * 180), Math.round(s * 255), Math.round(v * 255)];
}

// 3. 공 위치 트래킹
function trackBall() {
    processCtx.drawImage(video, 0, 0, 320, 240);
    const imgData = processCtx.getImageData(0, 0, 320, 240);
    const data = imgData.data;

    let totalX = 0, totalY = 0, count = 0;
    let minX = 320, maxX = 0, minY = 240, maxY = 0;

    for (let y = 0; y < 240; y += 2) {
        for (let x = 0; x < 320; x += 2) {
            let idx = (y * 320 + x) * 4;
            let hsv = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);

            if (hsv[0] >= lowerOrange[0] && hsv[0] <= upperOrange[0] &&
                hsv[1] >= lowerOrange[1] && hsv[1] <= upperOrange[1] &&
                hsv[2] >= lowerOrange[2] && hsv[2] <= upperOrange[2]) {
                totalX += x; totalY += y;
                count++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (count > 8) {
        const scaleX = canvas.width / 320;
        const scaleY = canvas.height / 240;
        let bx = (totalX / count) * scaleX;
        let by = (totalY / count) * scaleY;
        let br = Math.max((maxX - minX) * scaleX, (maxY - minY) * scaleY) / 2;
        return { x: bx, y: by, r: br };
    }
    return null;
}

// 4. 메인 게임 루프
function loop() {
    const currentTime = Date.now() / 1000;
    const isLockedOut = (currentTime - lastScoreTime) < LOCKOUT_TIME;

    // 비디오 렌더링
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 공 트래킹 및 득점 판정
    const ball = trackBall();

    if (ball) {
        // 공 외곽선 그리기
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.strokeStyle = isLockedOut ? '#888888' : '#00ff00';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 공 중심과 골대 중심 간의 거리 계산
        const dist = Math.hypot(ball.x - hoopCenter.x, ball.y - hoopCenter.y);
        const isInsideHoop = dist < (hoopRadius * 0.85);

        // 득점 조건: 공이 림 안에 들어왔고, 이번 진입에 점수가 안 올라갔으며, 락아웃 상태가 아닐 때
        if (isInsideHoop) {
            if (!hasScoredThisEntry && !isLockedOut) {
                score += 1;
                hasScoredThisEntry = true;
                lastScoreTime = currentTime;
            }
        } else {
            hasScoredThisEntry = false; // 공이 림 밖으로 나가면 다음 득점 가능 상태로 리셋
        }
    }

    // 5. 단순 UI 렌더링 (골대 + 점수만 표시)
    // 골대 원 그리기
    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isLockedOut ? '#ff8800' : '#00d7ff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 점수 표시
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(10, 10, 180, 50);
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(`SCORE: ${score}`, 25, 45);

    requestAnimationFrame(loop);
}

// 6. 마우스 조작 (좌클릭: 공 색상 지정 / 우클릭: 골대 위치 지정)
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (e.button === 2) {
        // 우클릭: 클릭한 위치를 골대 중심으로 설정
        hoopCenter = { x: Math.round(x), y: Math.round(y) };
    } else if (e.button === 0) {
        // 좌클릭: 클릭한 위치의 색상을 감지 대상으로 추출
        const px = Math.floor((x / canvas.width) * 320);
        const py = Math.floor((y / canvas.height) * 240);
        const pData = processCtx.getImageData(px, py, 1, 1).data;
        const hsv = rgbToHsv(pData[0], pData[1], pData[2]);

        lowerOrange = [Math.max(0, hsv[0] - 10), Math.max(40, hsv[1] - 60), Math.max(40, hsv[2] - 70)];
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