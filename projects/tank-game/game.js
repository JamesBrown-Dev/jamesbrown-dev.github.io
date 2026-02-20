const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const keys = {};
const mouse = { x: 0, y: 0 };

const player = {
    x: 400,
    y: 300,
    width: 40,
    height: 30,
    color: '#5a8f3c',
    angle: 0,
    turretAngle: 0
};


document.addEventListener('keydown', function(e) {
    keys[e.key] = true;
});

document.addEventListener('keyup', function(e) {
    keys[e.key] = false;
});

turret_speed = 1;
tank_rotate_speed = 1;
bullet_speed = 400;
reloadTime = 7;
const bullets = [];
let reloadTimer = 0;

document.addEventListener('click', function() {
    if (reloadTimer > 0) return;
    bullets.push({
        x: player.x + Math.cos(player.turretAngle) * 22,
        y: player.y + Math.sin(player.turretAngle) * 22,
        angle: player.turretAngle,
        speed: bullet_speed
    });
    reloadTimer = reloadTime;
});

document.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    // tracks
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(-22, -14, 44, 3);
    ctx.fillRect(-22, 11, 44, 3);

    // track detail lines
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    for (let i = -20; i < 22; i += 6) {
        ctx.beginPath();
        ctx.moveTo(i, -14);
        ctx.lineTo(i, -11);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i, 11);
        ctx.lineTo(i, 14);
        ctx.stroke();
    }

    // body
    ctx.fillStyle = player.color;
    ctx.fillRect(-20, -11, 40, 22);

    // vents on the back
    ctx.fillStyle = '#2d5216';
    ctx.fillRect(-19, -8, 6, 3);
    ctx.fillRect(-19, -1, 6, 3);
    ctx.fillRect(-19, 5, 6, 3);

    ctx.restore();
}

function drawTurret() {
    ctx.save();
    ctx.translate(player.x, player.y);

    // turret base circle
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#2d5216';
    ctx.fill();

    // barrel
    ctx.rotate(player.turretAngle);
    ctx.fillStyle = '#2d5216';
    ctx.fillRect(0, -4, 22, 8);

    // hatch on turret
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3d6b1f';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();

    // aim line — yellow when reloading, red when ready, fades out along length
    const reloadProgress = 1 - (reloadTimer / reloadTime);
    const r = 255;
    const g = Math.round(255 * (1 - reloadProgress));
    const gradient = ctx.createLinearGradient(22, 0, 150, 0);
    gradient.addColorStop(0, `rgba(${r}, ${g}, 0, 0.6)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, 0, 0)`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(150, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
}

function updateBullets(dt) {
    if (reloadTimer > 0) reloadTimer -= dt;
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].x += Math.cos(bullets[i].angle) * bullets[i].speed * dt;
        bullets[i].y += Math.sin(bullets[i].angle) * bullets[i].speed * dt;

        if (bullets[i].x < 0 || bullets[i].x > canvas.width ||
            bullets[i].y < 0 || bullets[i].y > canvas.height) {
            bullets.splice(i, 1);
        }
    }
}

function drawBullets() {
    ctx.fillStyle = 'black';
    for (const bullet of bullets) {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBackground() {
    ctx.fillStyle = '#7aad5c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updatePlayer(dt) {
    const rot = tank_rotate_speed * dt;
    if (keys['a']) {
        player.angle -= rot;
        player.turretAngle -= rot;
    }
    if (keys['d']) {
    
        player.angle += rot;
        player.turretAngle += rot;
    }
    speed=50;
    if (keys['w']) {
        player.x += Math.cos(player.angle) * speed * dt;
        player.y += Math.sin(player.angle) * speed * dt;
    }
    if (keys['s']) {
        player.x -= Math.cos(player.angle) * speed * dt;
        player.y -= Math.sin(player.angle) * speed * dt;
    }
    player.x = Math.max(player.width / 2, Math.min(canvas.width - player.width / 2, player.x));
    player.y = Math.max(player.height / 2, Math.min(canvas.height - player.height / 2, player.y));
}

function updateTurret(dt) {
    const targetAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    let diff = targetAngle - player.turretAngle;
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), turret_speed * dt);
    player.turretAngle += step;
}

let lastTime = 0;

function gameLoop(timestamp) {
    const deltaTime = lastTime ? (timestamp - lastTime) / 1000 : 0;
    lastTime = timestamp;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    updatePlayer(deltaTime);
    updateTurret(deltaTime);
    updateBullets(deltaTime);
    drawPlayer();
    drawTurret();
    drawBullets();
    requestAnimationFrame(gameLoop);
}

gameLoop();