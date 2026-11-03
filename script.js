// =========================================================
// [1. 웹 오디오 엔진 (효과음 자체 합성)]
// =========================================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type, param = 1) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    if (type === 'swish') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.25);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
    } else if (type === 'combo') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const pitch = 440 + (param * 110);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(pitch, now);
        osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, now + 0.3);
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
    } else if (type === 'buzzer') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.8);
    }
}

// =========================================================
// [2. 게임 상태 및 파라미터]
// =========================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('webcam');

const GAME_DURATION = 30;
const GOAL_LOCKOUT_TIME = 1.2;
const COMBO_TIMEOUT = 3.0;

let hoopCenter = { x: 480, y: 330 };
let hoopRadius = 120;
let rimDetectionRatio = 0.88;

let ballRadiusMin = 18;
let ballRadiusMax = 90;
let minBallSpeed = 1.8;

// HSV 마스킹 설정 (주황색 공)
let lowerOrange = [3, 90, 70];
let upperOrange = [22, 255, 255];

let gameState = "IDLE"; // IDLE, PLAYING, GAMEOVER
let score = 0;
let highScore = parseInt(localStorage.getItem('arcade_basketball_high') || '0');
let comboCount = 0;
let lastScoreTime = 0;
let gameStartTime = 0;
let goalEffectTimer = 0;
let showDebug = false;

let prevBallCenter = null;
let hasScoredThisEntry = false;

// 오프스크린 분석 캔버스
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d');
processCanvas.width = 320;
processCanvas.height = 240;

// =========================================================
// [3. 실시간 트래킹 알고리즘 (RGB -> HSV)]
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
    return [Math.round(h * 180), Math.round(s * 255), Math.round(v * 255)];
}

function processFrame() {
    processCtx.drawImage(video, 0, 0, 320, 240);
    const imgData = processCtx.getImageData(0, 0, 320, 240);
    const data = imgData.data;

    let totalX = 0, totalY = 0, count = 0;
    let minX = 320, maxX = 0, minY = 240, maxY = 0;

    for (let y = 0; y < 240; y += 2) {
        for (let x = 0; x < 320; x += 2) {
            let idx = (y * 320 + x) * 4;
            let r = data[idx], g = data[idx + 1], b = data[idx + 2];
            let hsv = rgbToHsv(r, g, b);

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

    if (count > 10) {
        const scaleX = canvas.width / 320;
        const scaleY = canvas.height / 240;

        let bx = (totalX / count) * scaleX;
        let by = (totalY / count) * scaleY;
        let br = (Math.max((maxX - minX) * scaleX, (maxY - minY) * scaleY)) / 2;

        return { x: bx, y: by, r: br };
    }
    return null;
}

// =========================================================
// [4. 메인 루프 & 루프 업데이트]
// =========================================================
function update() {
    const currentTime = Date.now() / 1000;
    const isLockedOut = (currentTime - lastScoreTime) < GOAL_LOCKOUT_TIME;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const ball = processFrame();
    let ballSpeed = 0;

    if (ball) {
        if (prevBallCenter) {
            ballSpeed = Math.hypot(ball.x - prevBallCenter.x, ball.y - prevBallCenter.y);
        }

        if (ball.r >= ballRadiusMin && ball.r <= ballRadiusMax) {
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
            ctx.strokeStyle = isLockedOut ? '#969696' : '#00ff88';
            ctx.lineWidth = 3;
            ctx.stroke();

            const dist = Math.hypot(ball.x - hoopCenter.x, ball.y - hoopCenter.y);
            let isInsideRim = dist < (hoopRadius * rimDetectionRatio);

            if (isInsideRim) {
                if (gameState === "PLAYING" && !isLockedOut && !hasScoredThisEntry && ballSpeed >= minBallSpeed) {
                    if (currentTime - lastScoreTime <= COMBO_TIMEOUT) {
                        comboCount++;
                    } else {
                        comboCount = 1;
                    }

                    const pts = 1 + (comboCount - 1);
                    score += pts;

                    if (score > highScore) {
                        highScore = score;
                        localStorage.setItem('arcade_basketball_high', highScore.toString());
                    }

                    if (comboCount >= 2) {
                        playSound('combo', comboCount);
                    } else {
                        playSound('swish');
                    }

                    lastScoreTime = currentTime;
                    goalEffectTimer = currentTime;
                    hasScoredThisEntry = true;
                }
            } else {
                hasScoredThisEntry = false;
            }
        }
        prevBallCenter = ball;
    }

    if (currentTime - lastScoreTime > COMBO_TIMEOUT) comboCount = 0;

    let time_left = 0;
    if (gameState === "PLAYING") {
        let elapsed = currentTime - gameStartTime;
        time_left = Math.max(0, Math.ceil(GAME_DURATION - elapsed));
        if (time_left === 0) {
            gameState = "GAMEOVER";
            playSound('buzzer');
        }
    }

    renderUI(currentTime, isLockedOut, time_left, ball, ballSpeed);
    requestAnimationFrame(update);
}

// =========================================================
// [5. 아케이드 UI & 애니메이션 렌더링]
// =========================================================
function renderUI(currentTime, isLockedOut, time_left, ball, ballSpeed) {
    const w = canvas.width;
    const h = canvas.height;

    // A. 골대 타깃 링
    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius, 0, Math.PI * 2);
    ctx.strokeStyle = (currentTime - goalEffectTimer < 0.8) ? '#00ff88' : (isLockedOut ? '#969696' : '#00d7ff');
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hoopCenter.x, hoopCenter.y, hoopRadius * rimDetectionRatio, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1;
    ctx.stroke();

    // B. 상단 반투명 글래스 패널
    ctx.fillStyle = 'rgba(15, 18, 25, 0.85)';
    ctx.fillRect(0, 0, w, 90);
    ctx.fillStyle = '#00d7ff';
    ctx.fillRect(0, 88, w, 2);

    // C. 점수판 / 최고점수 / 타이머
    ctx.fillStyle = '#969696';
    ctx.font = '600 16px "Segoe UI"';
    ctx.fillText("SCORE", 30, 30);
    ctx.fillStyle = '#00e1ff';
    ctx.font = '700 36px "Segoe UI"';
    ctx.fillText(score.toString(), 30, 70);

    ctx.fillStyle = '#969696';
    ctx.font = '600 16px "Segoe UI"';
    ctx.fillText("HIGH SCORE", 200, 30);
    ctx.fillStyle = '#ffd700';
    ctx.font = '700 36px "Segoe UI"';
    ctx.fillText(highScore.toString(), 200, 70);

    ctx.fillStyle = '#969696';
    ctx.font = '600 16px "Segoe UI"';
    ctx.fillText("TIME", 400, 30);
    ctx.fillStyle = time_left <= 5 ? '#ff3366' : '#00ff88';
    ctx.font = '700 36px "Segoe UI"';
    ctx.fillText(gameState === "PLAYING" ? `${time_left}s` : "30s", 400, 70);

    // D. 슛 상태 배너 (READY... vs SHOOT!)
    const statusMsg = isLockedOut ? "READY..." : "SHOOT!";
    const statusColor = isLockedOut ? "#ff8800" : "#00ff88";

    ctx.fillStyle = 'rgba(25, 28, 38, 0.9)';
    ctx.fillRect(w - 220, 20, 190, 50);
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(w - 220, 20, 190, 50);

    ctx.fillStyle = statusColor;
    ctx.font = '700 24px "Segoe UI"';
    ctx.fillText(statusMsg, w - 180, 54);

    // E. 득점 & 콤보 이펙트
    if (currentTime - goalEffectTimer < 0.8) {
        ctx.fillStyle = '#00ffff';
        ctx.font = '900 50px "Segoe UI"';
        ctx.fillText("+1 SWISH!!", w * 0.32, h * 0.55);

        if (comboCount >= 2) {
            ctx.fillStyle = '#ff00aa';
            ctx.font = '900 42px "Segoe UI"';
            ctx.fillText(`${comboCount} COMBO! (+${comboCount}pts)`, w * 0.28, h * 0.65);
        }
    }

    // F. 모달 패널 (IDLE & GAMEOVER)
    if (gameState === "IDLE") {
        ctx.fillStyle = 'rgba(8, 9, 13, 0.85)';
        ctx.fillRect(w * 0.15, h * 0.3, w * 0.7, h * 0.45);
        ctx.strokeStyle = '#00d7ff';
        ctx.lineWidth = 3;
        ctx.strokeRect(w * 0.15, h * 0.3, w * 0.7, h * 0.45);

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 36px "Segoe UI"';
        ctx.fillText("PRESS [SPACE] TO START", w * 0.22, h * 0.48);
        ctx.fillStyle = '#969696';
        ctx.font = '400 20px "Segoe UI"';
        ctx.fillText("30 Seconds Time Attack Mode", w * 0.33, h * 0.60);
    } else if (gameState === "GAMEOVER") {
        ctx.fillStyle = 'rgba(15, 10, 25, 0.92)';
        ctx.fillRect(w * 0.15, h * 0.25, w * 0.7, h * 0.52);
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3;
        ctx.strokeRect(w * 0.15, h * 0.25, w * 0.7, h * 0.52);

        ctx.fillStyle = '#ff0055';
        ctx.font = '900 48px "Segoe UI"';
        ctx.fillText("GAME OVER", w * 0.33, h * 0.42);

        ctx.fillStyle = '#00ffff';
        ctx.font = '700 36px "Segoe UI"';
        ctx.fillText(`FINAL SCORE: ${score}`, w * 0.31, h * 0.55);

        ctx.fillStyle = '#cccccc';
        ctx.font = '400 20px "Segoe UI"';
        ctx.fillText("Press [SPACE] or [S] to Restart", w * 0.30, h * 0.68);
    }

    // G. 디버그 안내
    if (showDebug && ball) {
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px monospace';
        ctx.fillText(`Radius: ${Math.round(ball.r)} | Speed: ${ballSpeed.toFixed(1)} | Combo: ${comboCount}`, 20, 120);
    }
}

// =========================================================
// [6. 마우스 & 키보드 이벤트]
// =========================================================
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (e.button === 2) { // 우클릭: 림 위치 설정
        hoopCenter = { x: Math.round(x), y: Math.round(y) };
    } else if (e.button === 0) { // 좌클릭: 색상 추출
        const pCtx = processCanvas.getContext('2d');
        const px = Math.floor((x / canvas.width) * 320);
        const py = Math.floor((y / canvas.height) * 240);
        const pData = pCtx.getImageData(px, py, 1, 1).data;
        const hsv = rgbToHsv(pData[0], pData[1], pData[2]);

        lowerOrange = [Math.max(0, hsv[0] - 10), Math.max(40, hsv[1] - 60), Math.max(40, hsv[2] - 70)];
        upperOrange = [Math.min(180, hsv[0] + 10), 255, 255];
    }
});

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 's') {
        if (gameState === "IDLE" || gameState === "GAMEOVER") {
            gameState = "PLAYING";
            score = 0;
            comboCount = 0;
            gameStartTime = Date.now() / 1000;
        } else if (gameState === "PLAYING") {
            score++;
            lastScoreTime = Date.now() / 1000;
            goalEffectTimer = lastScoreTime;
            playSound('swish');
            if (score > highScore) {
                highScore = score;
                localStorage.setItem('arcade_basketball_high', highScore.toString());
            }
        }
    } else if (k === 'r') {
        gameState = "IDLE";
        score = 0;
    } else if (k === 'd' || k === '-') {
        if (score > 0) score--;
    } else if (k === 'v') {
        showDebug = !showDebug;
    }
});

// 웹캠 연결 및 시작
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            update();
        };
    })
    .catch((err) => {
        alert("웹캠을 찾을 수 없거나 접근 권한이 거부되었습니다.");
    });