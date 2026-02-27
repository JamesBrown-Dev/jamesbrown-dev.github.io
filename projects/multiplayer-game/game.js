/* global Peer */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// fill the browser window, update on resize
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
});

// world dimensions — larger than the viewport so the camera has room to scroll
const WORLD_W = 3200;
const WORLD_H = 2400;

const keys  = {};
const mouse = { x: 0, y: 0 }; // screen-space cursor position

// camera holds the world-space position of the viewport's top-left corner
const camera = { x: 0, y: 0 };

const PLAYER_SPEED  = 200;
const PLAYER_RADIUS = 14;
const BULLET_SPEED  = 700;
const BULLET_LIFE   = 1.2; // seconds before expiring

const player = {
    x: WORLD_W / 2,
    y: WORLD_H / 2 + 50, // inside the building, slightly south of centre
    angle: 0,
};

// 0 = slot 1, etc. — only slot 0 (pistol) is defined for now
let currentWeapon  = 0;
let weaponCooldown = 0; // counts down to 0 before you can fire again

const MAG_SIZE    = 8;
const RELOAD_TIME = 1.5; // seconds
let magAmmo      = MAG_SIZE;
let reloading    = false;
let reloadTimer  = 0;

const bullets       = []; // this player's bullets
const remoteBullets = []; // other player's bullets

// holds the last state received from the other player
let remotePeer = null;

let money = 0; // currency — to be used for future upgrades/purchases

// ─── building ─────────────────────────────────────────────────────────────────

const BUILDING = {
    x: WORLD_W / 2 - 300,
    y: WORLD_H / 2 - 200,
    w: 600,
    h: 400,
    wallThickness: 24,
};

// A window is a gap in one of the walls.
// planks tracks how many boards cover it (ready for future destruction logic).
class GameWindow {
    constructor(x, y, w, h, side) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.side = side; // 'top' | 'bottom' | 'left' | 'right'
        this.planks = 3;
    }
}

// Window gap size along the wall face
const WINDOW_GAP = 55;

// One window centred on each wall side
const windows = (() => {
    const b = BUILDING;
    const t = b.wallThickness;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return [
        new GameWindow(cx - WINDOW_GAP / 2, b.y,           WINDOW_GAP, t, 'top'),
        new GameWindow(b.x + 100,            b.y + b.h - t, WINDOW_GAP, t, 'bottom'),
        new GameWindow(b.x, b.y + b.h - WINDOW_GAP - 100, t, WINDOW_GAP, 'left'),
        new GameWindow(b.x + b.w - t, cy - WINDOW_GAP / 2, t, WINDOW_GAP, 'right'),
    ];
})();

// Build solid wall rects from BUILDING, with gaps cut out for each window.
// Returns an array of { x, y, w, h } axis-aligned rects.
function buildWalls() {
    const b  = BUILDING;
    const t  = b.wallThickness;
    const rects = [];

    for (const win of windows) {
        if (win.side === 'top' || win.side === 'bottom') {
            const wallY = win.y;
            const wallH = t;
            // segment left of gap
            rects.push({ x: b.x, y: wallY, w: win.x - b.x, h: wallH });
            // segment right of gap
            const rightX = win.x + win.w;
            rects.push({ x: rightX, y: wallY, w: (b.x + b.w) - rightX, h: wallH });
        } else {
            const wallX = win.x;
            const wallW = t;
            // segment above gap
            rects.push({ x: wallX, y: b.y, w: wallW, h: win.y - b.y });
            // segment below gap
            const belowY = win.y + win.h;
            rects.push({ x: wallX, y: belowY, w: wallW, h: (b.y + b.h) - belowY });
        }
    }
    return rects;
}

const walls = buildWalls();

// ─── collision helpers ────────────────────────────────────────────────────────

// Push a circle (entity with .x/.y and given radius) out of an AABB rect.
// Modifies entity.x / entity.y in place.
function resolveCircleRect(entity, radius, rect) {
    const nearX = Math.max(rect.x, Math.min(entity.x, rect.x + rect.w));
    const nearY = Math.max(rect.y, Math.min(entity.y, rect.y + rect.h));
    const dx = entity.x - nearX;
    const dy = entity.y - nearY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= radius * radius) return; // no overlap

    const dist = Math.sqrt(distSq) || 0.001;
    const overlap = radius - dist;
    entity.x += (dx / dist) * overlap;
    entity.y += (dy / dist) * overlap;
}

// Returns true if a point (px, py) is inside an AABB rect.
function pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w &&
           py >= rect.y && py <= rect.y + rect.h;
}

// ─── networking ───────────────────────────────────────────────────────────────

let peer = null;
let conn = null;

function hostGame() {
    setStatus('Connecting...');
    peer = new Peer();

    peer.on('open', (id) => {
        document.getElementById('lobby-buttons').style.display = 'none';
        document.getElementById('code-display').style.display = 'flex';
        document.getElementById('code-text').textContent = id;
        setStatus('Waiting for player to join...');
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
    });

    peer.on('error', (err) => setStatus(`Error: ${err.type}`));
}

function joinGame() {
    const code = document.getElementById('code-input').value.trim();
    if (!code) return;

    setStatus('Connecting...');
    peer = new Peer();

    peer.on('open', () => {
        conn = peer.connect(code);
        setupConnection();
    });

    peer.on('error', (err) => setStatus(`Error: ${err.type}`));
}

function setupConnection() {
    conn.on('open', () => {
        setStatus('Connected — starting game...');
        setTimeout(startGame, 800);
    });

    conn.on('data', (data) => {
        if (data.type === 'move') {
            remotePeer = data;
        } else if (data.type === 'shoot') {
            // spawn the other player's bullet on our end
            remoteBullets.push({ x: data.x, y: data.y, vx: data.vx, vy: data.vy, life: BULLET_LIFE });
        }
    });

    conn.on('close', () => {
        remotePeer = null;
        setStatus('Other player disconnected.');
    });
}

function setStatus(msg) {
    document.getElementById('lobby-status').textContent = msg;
}

function startGame() {
    document.getElementById('lobby').style.display = 'none';
    requestAnimationFrame(gameLoop);
}

// ─── input ────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    keys[e.key] = true;

    // weapon switching
    if (e.key === '1') currentWeapon = 0;
    if (e.key === '2') currentWeapon = 1;
    if (e.key === '3') currentWeapon = 2;

    // reload
    if ((e.key === 'r' || e.key === 'R') && !reloading && magAmmo < MAG_SIZE) {
        reloading   = true;
        reloadTimer = RELOAD_TIME;
    }
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

document.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

// fire on click
canvas.addEventListener('click', () => {
    if (weaponCooldown > 0 || reloading) return;
    if (currentWeapon !== 0) return; // only pistol for now

    // auto-reload if empty
    if (magAmmo <= 0) {
        reloading   = true;
        reloadTimer = RELOAD_TIME;
        return;
    }

    // spawn bullet from the tip of the gun barrel (local space tip is at x=18, y=9.5)
    const GUN_TIP_X = 18, GUN_TIP_Y = 9.5;
    const bx = player.x + Math.cos(player.angle) * GUN_TIP_X - Math.sin(player.angle) * GUN_TIP_Y;
    const by = player.y + Math.sin(player.angle) * GUN_TIP_X + Math.cos(player.angle) * GUN_TIP_Y;
    const vx = Math.cos(player.angle) * BULLET_SPEED;
    const vy = Math.sin(player.angle) * BULLET_SPEED;

    bullets.push({ x: bx, y: by, vx, vy, life: BULLET_LIFE });
    magAmmo--;
    weaponCooldown = 0.25; // 4 shots per second max

    // tell the other player about this bullet
    if (conn && conn.open) {
        conn.send({ type: 'shoot', x: bx, y: by, vx, vy });
    }
});

// ─── update ───────────────────────────────────────────────────────────────────

function updatePlayer(dt) {
    let dx = 0, dy = 0;
    if (keys['w'] || keys['W'] || keys['ArrowUp'])    dy -= 1;
    if (keys['s'] || keys['S'] || keys['ArrowDown'])  dy += 1;
    if (keys['a'] || keys['A'] || keys['ArrowLeft'])  dx -= 1;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

    player.x += dx * PLAYER_SPEED * dt;
    player.y += dy * PLAYER_SPEED * dt;

    player.x = Math.max(PLAYER_RADIUS, Math.min(player.x, WORLD_W - PLAYER_RADIUS));
    player.y = Math.max(PLAYER_RADIUS, Math.min(player.y, WORLD_H - PLAYER_RADIUS));

    for (const wall of walls) {
        resolveCircleRect(player, PLAYER_RADIUS, wall);
    }
    // windows always block the player regardless of plank count
    for (const win of windows) {
        resolveCircleRect(player, PLAYER_RADIUS, win);
    }

    const worldMouseX = mouse.x + camera.x;
    const worldMouseY = mouse.y + camera.y;
    player.angle = Math.atan2(worldMouseY - player.y, worldMouseX - player.x);

    if (weaponCooldown > 0) weaponCooldown -= dt;

    if (reloading) {
        reloadTimer -= dt;
        if (reloadTimer <= 0) {
            magAmmo   = MAG_SIZE;
            reloading = false;
        }
    }

    // send position + current weapon to the other player
    if (conn && conn.open) {
        conn.send({ type: 'move', x: player.x, y: player.y, angle: player.angle, weapon: currentWeapon });
    }
}

function bulletHitsWall(b) {
    for (const wall of walls) {
        if (pointInRect(b.x, b.y, wall)) return true;
    }
    return false;
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H || bulletHitsWall(b)) {
            bullets.splice(i, 1);
        }
    }
    for (let i = remoteBullets.length - 1; i >= 0; i--) {
        const b = remoteBullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H || bulletHitsWall(b)) {
            remoteBullets.splice(i, 1);
        }
    }
}

// centres the camera on the player, clamped so it never shows outside the world
function updateCamera() {
    camera.x = player.x - canvas.width  / 2;
    camera.y = player.y - canvas.height / 2;
    camera.x = Math.max(0, Math.min(camera.x, WORLD_W - canvas.width));
    camera.y = Math.max(0, Math.min(camera.y, WORLD_H - canvas.height));
}

// ─── draw ─────────────────────────────────────────────────────────────────────

function drawFloor() {
    const tileSize = 64;
    const startX = Math.floor(camera.x / tileSize) * tileSize;
    const startY = Math.floor(camera.y / tileSize) * tileSize;
    const endX   = camera.x + canvas.width  + tileSize;
    const endY   = camera.y + canvas.height + tileSize;

    for (let x = startX; x < endX && x < WORLD_W; x += tileSize) {
        for (let y = startY; y < endY && y < WORLD_H; y += tileSize) {
            const even = ((x / tileSize) + (y / tileSize)) % 2 === 0;
            ctx.fillStyle = even ? '#161616' : '#191919';
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }
}

function drawGrid() {
    const tileSize = 64;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const startX = Math.floor(camera.x / tileSize) * tileSize;
    const startY = Math.floor(camera.y / tileSize) * tileSize;
    ctx.beginPath();
    for (let x = startX; x < camera.x + canvas.width + tileSize && x <= WORLD_W; x += tileSize) {
        ctx.moveTo(x, camera.y);
        ctx.lineTo(x, camera.y + canvas.height);
    }
    for (let y = startY; y < camera.y + canvas.height + tileSize && y <= WORLD_H; y += tileSize) {
        ctx.moveTo(camera.x, y);
        ctx.lineTo(camera.x + canvas.width, y);
    }
    ctx.stroke();
}

function drawWorldBorder() {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, WORLD_W - 6, WORLD_H - 6);
}

function drawBuilding() {
    const b = BUILDING;
    const t = b.wallThickness;

    // interior floor — slightly lighter than the outside world
    ctx.fillStyle = '#252525';
    ctx.fillRect(b.x + t, b.y + t, b.w - t * 2, b.h - t * 2);

    // solid wall rects
    ctx.fillStyle = '#2a2a2a';
    for (const wall of walls) {
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    }
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    for (const wall of walls) {
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
    }

    // windows — draw the gap opening, then planks on top
    for (const win of windows) {
        // gap background (slightly lighter to read as an opening)
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(win.x, win.y, win.w, win.h);

        // draw planks stacked across the window gap
        if (win.planks > 0) {
            const isHorizontal = (win.side === 'top' || win.side === 'bottom');
            const plankCount = win.planks;
            ctx.fillStyle = '#7a5c2e';
            ctx.strokeStyle = '#5a3e18';
            ctx.lineWidth = 1;
            for (let p = 0; p < plankCount; p++) {
                let px, py, pw, ph;
                if (isHorizontal) {
                    // planks run horizontally across the gap
                    ph = win.h / plankCount;
                    px = win.x;
                    py = win.y + p * ph;
                    pw = win.w;
                } else {
                    // planks run vertically across the gap
                    pw = win.w / plankCount;
                    px = win.x + p * pw;
                    py = win.y;
                    ph = win.h;
                }
                ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
                ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
            }
        }
    }
}

// draws a character — weapon param drives whether the gun is shown
function drawCharacter(x, y, angle, bodyColor, weapon) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // pistol — drawn first so it sits behind the body
    if (weapon === 0) {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(2, 7, 16, 5);   // barrel
        ctx.fillStyle = '#222';
        ctx.fillRect(-2, 9, 7, 8);   // handle
    }

    // body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // arm — skin-tone ellipse bridging body to gun
    if (weapon === 0) {
        ctx.fillStyle = '#c8906a';
        ctx.beginPath();
        ctx.ellipse(7, 9, 4, 2.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    // head
    ctx.fillStyle = '#c8906a';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawPlayer() {
    drawCharacter(player.x, player.y, player.angle, '#3a3a3a', currentWeapon);
}

function drawRemotePlayer() {
    if (!remotePeer) return;
    drawCharacter(remotePeer.x, remotePeer.y, remotePeer.angle, '#8b2020', remotePeer.weapon ?? 0);
}

function drawBullets() {
    ctx.fillStyle = '#f5e642';
    for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    for (const b of remoteBullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ─── hotbar ───────────────────────────────────────────────────────────────────

// draws a tiny pistol icon centred on cx, cy
function drawPistolIcon(cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);

    // barrel
    ctx.fillStyle = '#999';
    ctx.fillRect(-2, -3, 14, 4);

    // handle
    ctx.fillStyle = '#777';
    ctx.fillRect(-7, -2, 7, 9);

    // trigger guard
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-2, 5, 3.5, 0, Math.PI);
    ctx.stroke();

    ctx.restore();
}

function drawHotbar() {
    const slotSize = 54;
    const gap      = 6;
    const slots    = 3;
    const totalW   = slots * slotSize + (slots - 1) * gap;
    const startX   = (canvas.width - totalW) / 2;
    const y        = canvas.height - slotSize - 18;

    for (let i = 0; i < slots; i++) {
        const x      = startX + i * (slotSize + gap);
        const active = i === currentWeapon;

        // background
        ctx.fillStyle = active ? '#252525' : '#141414';
        ctx.fillRect(x, y, slotSize, slotSize);

        // border
        ctx.strokeStyle = active ? '#cc2020' : '#383838';
        ctx.lineWidth   = active ? 2 : 1;
        ctx.strokeRect(x, y, slotSize, slotSize);

        // slot number
        ctx.fillStyle = active ? '#888' : '#444';
        ctx.font      = '11px monospace';
        ctx.fillText(i + 1, x + 5, y + 14);

        // weapon icon — only slot 0 has anything in it
        if (i === 0) {
            drawPistolIcon(x + slotSize / 2, y + slotSize / 2 + 2);
        }
    }
}

function drawAmmo() {
    const slotSize = 54;
    const gap      = 6;
    const slots    = 3;
    const totalW   = slots * slotSize + (slots - 1) * gap;
    const hotbarX  = (canvas.width - totalW) / 2;
    const hotbarY  = canvas.height - slotSize - 18;

    // position the ammo counter just to the right of the hotbar
    const ax = hotbarX + totalW + 14;
    const ay = hotbarY + slotSize / 2;

    ctx.font      = 'bold 15px monospace';
    ctx.textAlign = 'left';

    if (reloading) {
        // progress bar while reloading
        const progress = 1 - reloadTimer / RELOAD_TIME;
        ctx.fillStyle = '#555';
        ctx.fillText('RELOADING', ax, ay - 6);
        ctx.fillStyle = '#333';
        ctx.fillRect(ax, ay + 2, 80, 6);
        ctx.fillStyle = '#cc2020';
        ctx.fillRect(ax, ay + 2, 80 * progress, 6);
    } else {
        const color = magAmmo === 0 ? '#cc2020' : magAmmo <= 2 ? '#e08020' : '#ccc';
        ctx.fillStyle = color;
        ctx.fillText(`${magAmmo}`, ax, ay + 6);
        ctx.font = '17px monospace';
        ctx.fillText(' / ∞', ax + ctx.measureText(`${magAmmo}`).width + 2, ay + 6);
    }

    ctx.textAlign = 'left'; // reset
}

function drawMoney() {
    const slotSize = 54;
    const gap      = 6;
    const slots    = 3;
    const totalW   = slots * slotSize + (slots - 1) * gap;
    const hotbarX  = (canvas.width - totalW) / 2;
    const hotbarY  = canvas.height - slotSize - 18;

    ctx.font      = 'bold 14px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f0c040';
    ctx.fillText(`£${money}`, hotbarX - 14, hotbarY + slotSize / 2 + 6);
    ctx.textAlign = 'left';
}

// ─── loop ─────────────────────────────────────────────────────────────────────

let lastTime = 0;

function gameLoop(timestamp) {
    const dt = lastTime ? (timestamp - lastTime) / 1000 : 0;
    lastTime = timestamp;

    updatePlayer(dt);
    updateBullets(dt);
    updateCamera();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // world-space drawing (affected by camera)
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawFloor();
    drawGrid();
    drawWorldBorder();
    drawBuilding();
    drawBullets();
    drawRemotePlayer();
    drawPlayer();

    ctx.restore();

    // screen-space drawing (not affected by camera)
    drawHotbar();
    drawAmmo();
    drawMoney();

    requestAnimationFrame(gameLoop);
}

// game loop starts only once the peer connection opens
