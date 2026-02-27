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
const particles     = []; // visual hit effects
const plankDebris   = []; // broken barricade pieces

// holds the last state received from the other player
let remotePeer = null;

let money = 0; // currency — to be used for future upgrades/purchases

// ─── player health ────────────────────────────────────────────────────────────

const PLAYER_MAX_HP = 100;
let playerHp = PLAYER_MAX_HP;
const ZOMBIE_DPS    = 20;  // damage per second while in contact
const ZOMBIE_RADIUS = 12;

// ─── zombies & waves ──────────────────────────────────────────────────────────

const ZOMBIE_SPEED       = 60;
const ZOMBIE_HP          = 2;
const ZOMBIE_KILL_REWARD = 10;
const WAVE_DELAY         = 5;  // seconds between waves
const PLANK_ATTACK_TIME  = 1.5; // seconds to destroy one plank
const ZOMBIES_PER_WAVE   = (w) => 4 + w * 2; // wave 1=6, wave 2=8, …

let wave        = 0;
let zombiesLeft = 0;   // yet to spawn this wave
let waveDelay   = WAVE_DELAY; // countdown before wave 1
let spawnTimer  = 0;   // time until next zombie spawns

const zombies       = []; // simulated locally (host) or received (joiner)
let   remoteZombies = []; // joiner stores host's zombie data here

let isHost = false; // set true when peer.on('open') fires for the host
let nextZombieId = 0; // incremented each spawn so every zombie has a unique id

let zombieSyncTimer = 0; // rate-limits zombie network sends

class Zombie {
    constructor(x, y, targetWindow) {
        this.x            = x;
        this.y            = y;
        this.targetWindow = targetWindow;
        this.state        = 'toWindow'; // 'toWindow' | 'attacking' | 'climbing' | 'hunting'
        this.hp           = ZOMBIE_HP;
        this.climbTimer   = 0;
        this.attackTimer  = 0;
        this.waypoints    = []; // pre-computed path waypoints around the building
        this.id           = nextZombieId++;
        this.angle        = 0; // facing direction in radians
    }
}

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
        this.buildProgress = 0; // 0..1 while player holds F
        this.buildAnim     = 1; // scale of newest plank (animates 0→1 on add)
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

    if (distSq < 0.0001) {
        // Entity centre is inside the rect — push out via the nearest edge.
        const toLeft   = entity.x - rect.x;
        const toRight  = rect.x + rect.w - entity.x;
        const toTop    = entity.y - rect.y;
        const toBottom = rect.y + rect.h - entity.y;
        const min = Math.min(toLeft, toRight, toTop, toBottom);
        if      (min === toLeft)   entity.x = rect.x - radius;
        else if (min === toRight)  entity.x = rect.x + rect.w + radius;
        else if (min === toTop)    entity.y = rect.y - radius;
        else                       entity.y = rect.y + rect.h + radius;
        return;
    }

    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    entity.x += (dx / dist) * overlap;
    entity.y += (dy / dist) * overlap;
}

// Returns true if the line segment (x1,y1)→(x2,y2) passes through the filled
// area of an AABB rect. Uses the slab method with degenerate-case handling.
function segmentIntersectsAABB(x1, y1, x2, y2, rx, ry, rw, rh) {
    let tmin = 0, tmax = 1;
    const dx = x2 - x1;
    if (Math.abs(dx) < 1e-10) {
        if (x1 < rx || x1 > rx + rw) return false;
    } else {
        const t1 = (rx - x1) / dx;
        const t2 = (rx + rw - x1) / dx;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
        if (tmin > tmax) return false;
    }
    const dy = y2 - y1;
    if (Math.abs(dy) < 1e-10) {
        if (y1 < ry || y1 > ry + rh) return false;
    } else {
        const t1 = (ry - y1) / dy;
        const t2 = (ry + rh - y1) / dy;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
        if (tmin > tmax) return false;
    }
    return true;
}

// Returns the point just outside the building at a window gap — where a zombie
// should approach from before entering through the gap.
function windowApproachPoint(win) {
    const t = BUILDING.wallThickness;
    const d = 4; // px outside the wall face
    if (win.side === 'top')    return { x: win.x + win.w / 2, y: win.y - d };
    if (win.side === 'bottom') return { x: win.x + win.w / 2, y: win.y + t + d };
    if (win.side === 'left')   return { x: win.x - d,         y: win.y + win.h / 2 };
    if (win.side === 'right')  return { x: win.x + t + d,     y: win.y + win.h / 2 };
}

// Compute a list of world-space waypoints from (sx, sy) to the window approach
// point, routing around the building if the direct path is blocked.
// Returns an array ending with the approach point.
function computePathToWindow(sx, sy, win) {
    const ap  = windowApproachPoint(win);
    const b   = BUILDING;
    const pad = ZOMBIE_RADIUS + 20;
    const rx = b.x - pad, ry = b.y - pad, rw = b.w + pad * 2, rh = b.h + pad * 2;

    if (!segmentIntersectsAABB(sx, sy, ap.x, ap.y, rx, ry, rw, rh)) return [ap];

    const corners = [
        { x: rx,      y: ry      },
        { x: rx + rw, y: ry      },
        { x: rx,      y: ry + rh },
        { x: rx + rw, y: ry + rh },
    ];

    // try one-corner detour
    let best = null, bestLen = Infinity;
    for (const c of corners) {
        if (!segmentIntersectsAABB(sx, sy, c.x, c.y, rx, ry, rw, rh) &&
            !segmentIntersectsAABB(c.x, c.y, ap.x, ap.y, rx, ry, rw, rh)) {
            const len = Math.hypot(c.x - sx, c.y - sy) + Math.hypot(ap.x - c.x, ap.y - c.y);
            if (len < bestLen) { bestLen = len; best = [c, ap]; }
        }
    }
    if (best) return best;

    // two-corner fallback (shouldn't be needed for a convex shape but just in case)
    for (let i = 0; i < corners.length; i++) {
        for (let j = 0; j < corners.length; j++) {
            if (i === j) continue;
            const c1 = corners[i], c2 = corners[j];
            if (!segmentIntersectsAABB(sx, sy, c1.x, c1.y, rx, ry, rw, rh) &&
                !segmentIntersectsAABB(c1.x, c1.y, c2.x, c2.y, rx, ry, rw, rh) &&
                !segmentIntersectsAABB(c2.x, c2.y, ap.x, ap.y, rx, ry, rw, rh)) {
                const len = Math.hypot(c1.x - sx, c1.y - sy) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(ap.x - c2.x, ap.y - c2.y);
                if (len < bestLen) { bestLen = len; best = [c1, c2, ap]; }
            }
        }
    }
    return best || [ap];
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
        isHost = true;
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
        if (!isHost) player.x += 40; // offset joiner so they don't spawn on top of the host
        setTimeout(startGame, 800);
    });

    conn.on('data', (data) => {
        if (data.type === 'move') {
            remotePeer = data;
        } else if (data.type === 'shoot') {
            // spawn the other player's bullet on our end
            remoteBullets.push({ x: data.x, y: data.y, vx: data.vx, vy: data.vy, life: BULLET_LIFE });
        } else if (data.type === 'zombies') {
            // joiner receives zombie positions + wave info from host
            remoteZombies = data.zombies;
            wave      = data.wave;
            waveDelay = data.waveDelay;
            if (data.windowPlanks) data.windowPlanks.forEach((p, i) => { windows[i].planks = p; });
        } else if (data.type === 'zombieHit') {
            // host receives a hit report from joiner — apply damage to the zombie
            const idx = zombies.findIndex(z => z.id === data.id);
            if (idx !== -1) {
                zombies[idx].hp--;
                if (zombies[idx].hp <= 0) { zombies.splice(idx, 1); money += ZOMBIE_KILL_REWARD; }
            }
        } else if (data.type === 'addPlank') {
            // either player repaired a barricade — apply on this end
            // host also applies it (joiner sent it); joiner receives it back from host broadcast OR host repairs
            applyAddPlank(data.windowIndex);
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

    // player-player collision
    if (remotePeer) {
        const dx = player.x - remotePeer.x, dy = player.y - remotePeer.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDist = PLAYER_RADIUS * 2;
        if (d < minDist) {
            const overlap = minDist - d;
            player.x += (dx / d) * overlap;
            player.y += (dy / d) * overlap;
        }
    }

    // player-zombie collision — only resolves overlap caused by the player moving
    // into a zombie; zombie walking into a stationary player won't shove them
    const zombieList = shouldSimulateZombies() ? zombies : remoteZombies;
    const minZDist = ZOMBIE_RADIUS + PLAYER_RADIUS;
    const pxBefore = player.x, pyBefore = player.y;
    for (const z of zombieList) {
        const dx = player.x - z.x, dy = player.y - z.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (d < minZDist) {
            const overlap = minZDist - d;
            player.x += (dx / d) * overlap;
            player.y += (dy / d) * overlap;
        }
    }
    // clamp any zombie-caused displacement to the player's own movement this frame
    // so zombies can't shove the player — they only block
    const maxShift = Math.hypot(player.x - pxBefore, player.y - pyBefore);
    if (maxShift > PLAYER_RADIUS) {
        const scale = PLAYER_RADIUS / maxShift;
        player.x = pxBefore + (player.x - pxBefore) * scale;
        player.y = pyBefore + (player.y - pyBefore) * scale;
    }
    // re-run wall collision after overlap resolution
    for (const wall of walls) resolveCircleRect(player, PLAYER_RADIUS, wall);
    for (const win of windows) resolveCircleRect(player, PLAYER_RADIUS, win);

    // send position + current weapon to the other player
    if (conn && conn.open) {
        conn.send({ type: 'move', x: player.x, y: player.y, angle: player.angle, weapon: currentWeapon });
    }
}

// dirAngle: direction particles fly toward (use bullet's opposite angle for impact spray)
function spawnParticles(x, y, color, count, dirAngle) {
    const spread = Math.PI * 0.6; // ±54° cone
    for (let i = 0; i < count; i++) {
        const a = dirAngle !== undefined
            ? dirAngle + (Math.random() - 0.5) * spread
            : Math.random() * Math.PI * 2;
        const speed = 150 + Math.random() * 250;
        particles.push({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            life: 0.12 + Math.random() * 0.12,
            maxLife: 0.24,
            color,
        });
    }
}

const BARRICADE_REPAIR_TIME = 1.2; // seconds to hold F to add one plank
const BARRICADE_RANGE       = 60;  // px from window centre

function applyAddPlank(winIndex) {
    const win = windows[winIndex];
    if (!win || win.planks >= 3) return;
    win.planks++;
    win.buildAnim = 0; // trigger pop-in
}

function updateBarricadeRepair(dt) {
    const holding = keys['f'] || keys['F'];
    let nearWin = null;
    let nearWinIdx = -1;

    // find the closest window within range
    for (let i = 0; i < windows.length; i++) {
        const win = windows[i];
        const cx = win.x + win.w / 2;
        const cy = win.y + win.h / 2;
        const dist = Math.hypot(player.x - cx, player.y - cy);
        if (dist < BARRICADE_RANGE && win.planks < 3) {
            nearWin = win;
            nearWinIdx = i;
            break;
        }
    }

    for (const win of windows) {
        // tick pop-in animation toward 1
        if (win.buildAnim < 1) {
            win.buildAnim = Math.min(1, win.buildAnim + dt * 6);
        }

        if (win === nearWin && holding) {
            win.buildProgress = Math.min(1, win.buildProgress + dt / BARRICADE_REPAIR_TIME);
            if (win.buildProgress >= 1) {
                win.buildProgress = 0;
                if (conn && conn.open) {
                    // networked: send to peer; host also applies locally, joiner lets host apply
                    conn.send({ type: 'addPlank', windowIndex: nearWinIdx });
                    if (isHost) applyAddPlank(nearWinIdx);
                } else {
                    applyAddPlank(nearWinIdx); // solo
                }
            }
        } else {
            win.buildProgress = Math.max(0, win.buildProgress - dt * 3);
        }
    }
}

// outDir: angle in radians pointing away from the building (toward the zombie)
function spawnPlankDebris(win, outDir) {
    const cx = win.x + win.w / 2;
    const cy = win.y + win.h / 2;
    const count = 6 + Math.floor(Math.random() * 4);
    const spread = Math.PI * 0.5;
    for (let i = 0; i < count; i++) {
        const a = outDir + (Math.random() - 0.5) * spread;
        const speed = 80 + Math.random() * 160;
        const life = 1.8 + Math.random() * 1.0; // long life — slide then fade
        plankDebris.push({
            x: cx + (Math.random() - 0.5) * win.w,
            y: cy + (Math.random() - 0.5) * win.h,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            angle: Math.random() * Math.PI * 2,
            angleV: (Math.random() - 0.5) * 8,
            w: 10 + Math.random() * 8,
            h: 4,
            life,
            maxLife: life,
            slideTime: 0.35, // seconds before they stop sliding
        });
    }
}

function updatePlankDebris(dt) {
    for (let i = plankDebris.length - 1; i >= 0; i--) {
        const d = plankDebris[i];
        d.life -= dt;
        if (d.life <= 0) { plankDebris.splice(i, 1); continue; }
        if (d.slideTime > 0) {
            d.slideTime -= dt;
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.angle += d.angleV * dt;
            // friction
            d.vx *= Math.pow(0.88, dt * 60);
            d.vy *= Math.pow(0.88, dt * 60);
            d.angleV *= Math.pow(0.88, dt * 60);
        }
    }
}

function drawPlankDebris() {
    for (const d of plankDebris) {
        // fade only in the last 0.6s
        const fadeStart = 0.6;
        const alpha = d.life < fadeStart ? d.life / fadeStart : 1.0;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(d.x, d.y);
        ctx.rotate(d.angle);
        ctx.fillStyle = '#7a5c2e';
        ctx.strokeStyle = '#5a3e18';
        ctx.lineWidth = 1;
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.restore();
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
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
        if (b.life <= 0 || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
            bullets.splice(i, 1);
            continue;
        }
        if (bulletHitsWall(b)) {
            spawnParticles(b.x, b.y, '#f5e642', 8, Math.atan2(b.vy, b.vx) + Math.PI);
            bullets.splice(i, 1);
            continue;
        }
        // bullet-zombie collision
        let zombieHit = false;
        if (shouldSimulateZombies()) {
            for (let j = zombies.length - 1; j >= 0; j--) {
                const z = zombies[j];
                const dx = b.x - z.x, dy = b.y - z.y;
                if (dx * dx + dy * dy < ZOMBIE_RADIUS * ZOMBIE_RADIUS) {
                    z.hp--;
                    if (z.hp <= 0) { zombies.splice(j, 1); money += ZOMBIE_KILL_REWARD; }
                    zombieHit = true;
                    break;
                }
            }
        } else {
            for (let j = 0; j < remoteZombies.length; j++) {
                const z = remoteZombies[j];
                const dx = b.x - z.x, dy = b.y - z.y;
                if (dx * dx + dy * dy < ZOMBIE_RADIUS * ZOMBIE_RADIUS) {
                    if (conn && conn.open) conn.send({ type: 'zombieHit', id: z.id });
                    zombieHit = true;
                    break;
                }
            }
        }
        if (zombieHit) {
            spawnParticles(b.x, b.y, '#cc2020', 8, Math.atan2(b.vy, b.vx) + Math.PI);
            bullets.splice(i, 1);
            continue;
        }
        // bullet hits remote player
        if (remotePeer) {
            const dx = b.x - remotePeer.x, dy = b.y - remotePeer.y;
            if (dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS) {
                spawnParticles(b.x, b.y, '#f5e642', 8, Math.atan2(b.vy, b.vx) + Math.PI);
                bullets.splice(i, 1);
                continue;
            }
        }
    }
    for (let i = remoteBullets.length - 1; i >= 0; i--) {
        const b = remoteBullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
            remoteBullets.splice(i, 1);
            continue;
        }
        if (bulletHitsWall(b)) {
            spawnParticles(b.x, b.y, '#f5e642', 8, Math.atan2(b.vy, b.vx) + Math.PI);
            remoteBullets.splice(i, 1);
            continue;
        }
        // remote bullet hits zombie — visuals + removal only, damage is handled elsewhere
        const rzList = shouldSimulateZombies() ? zombies : remoteZombies;
        let rzHit = false;
        for (const z of rzList) {
            const zdx = b.x - z.x, zdy = b.y - z.y;
            if (zdx * zdx + zdy * zdy < ZOMBIE_RADIUS * ZOMBIE_RADIUS) {
                rzHit = true;
                break;
            }
        }
        if (rzHit) {
            spawnParticles(b.x, b.y, '#cc2020', 8, Math.atan2(b.vy, b.vx) + Math.PI);
            remoteBullets.splice(i, 1);
            continue;
        }
        // remote bullet hits local player
        const dx = b.x - player.x, dy = b.y - player.y;
        if (dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS) {
            spawnParticles(b.x, b.y, '#f5e642', 8, Math.atan2(b.vy, b.vx) + Math.PI);
            remoteBullets.splice(i, 1);
            continue;
        }
    }
}

// Returns the closest window to (sx, sy) that has a clear line of sight
// (no building between spawn and the window approach point).
// Falls back to the closest window overall if none have clear LOS.
function pickWindowForSpawn(sx, sy) {
    const b  = BUILDING;
    const pad = ZOMBIE_RADIUS + 20;
    const rx = b.x - pad, ry = b.y - pad, rw = b.w + pad * 2, rh = b.h + pad * 2;

    let bestWin = null, bestDist = Infinity;
    for (const win of windows) {
        const ap = windowApproachPoint(win);
        if (!segmentIntersectsAABB(sx, sy, ap.x, ap.y, rx, ry, rw, rh)) {
            const d = Math.hypot(ap.x - sx, ap.y - sy);
            if (d < bestDist) { bestDist = d; bestWin = win; }
        }
    }
    // fallback: no clear LOS to any window — just pick the nearest
    if (!bestWin) {
        for (const win of windows) {
            const ap = windowApproachPoint(win);
            const d = Math.hypot(ap.x - sx, ap.y - sy);
            if (d < bestDist) { bestDist = d; bestWin = win; }
        }
    }
    return bestWin;
}

function spawnZombie() {
    // pick a random point on the world edge
    const margin = ZOMBIE_RADIUS + 4;
    let sx, sy;
    const edge = Math.floor(Math.random() * 4); // 0=top 1=bottom 2=left 3=right
    if (edge === 0) { sx = Math.random() * WORLD_W; sy = margin; }
    else if (edge === 1) { sx = Math.random() * WORLD_W; sy = WORLD_H - margin; }
    else if (edge === 2) { sx = margin; sy = Math.random() * WORLD_H; }
    else               { sx = WORLD_W - margin; sy = Math.random() * WORLD_H; }

    const win = pickWindowForSpawn(sx, sy);
    const z = new Zombie(sx, sy, win);
    z.waypoints = computePathToWindow(sx, sy, win);
    zombies.push(z);
}

// True when this client is responsible for simulating zombies.
// Always true when solo or hosting; false only when joined as a peer.
function shouldSimulateZombies() {
    return isHost || !(conn && conn.open);
}

function updateZombies(dt) {
    if (!shouldSimulateZombies()) return;

    // ── wave management ──
    if (zombies.length === 0 && zombiesLeft === 0) {
        waveDelay -= dt;
        if (waveDelay <= 0) {
            wave++;
            zombiesLeft = ZOMBIES_PER_WAVE(wave);
            waveDelay   = WAVE_DELAY;
            spawnTimer  = 0;
        }
    }

    // ── spawn one zombie at a time ──
    if (zombiesLeft > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnZombie();
            zombiesLeft--;
            spawnTimer = 1.0; // one zombie per second
        }
    }

    // ── update each zombie ──
    for (const z of zombies) {
        if (z.state === 'toWindow') {
            // follow pre-computed waypoints; final destination is window centre
            let tx, ty;
            if (z.waypoints.length > 0) {
                tx = z.waypoints[0].x;
                ty = z.waypoints[0].y;
            } else {
                tx = z.targetWindow.x + z.targetWindow.w / 2;
                ty = z.targetWindow.y + z.targetWindow.h / 2;
            }
            const dx = tx - z.x, dy = ty - z.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            if (dist < 8) {
                if (z.waypoints.length > 0) {
                    z.waypoints.shift(); // advance to next waypoint
                    // just reached the approach point — attack if planks remain
                    if (z.waypoints.length === 0 && z.targetWindow.planks > 0) {
                        z.state       = 'attacking';
                        z.attackTimer = PLANK_ATTACK_TIME;
                    }
                } else {
                    z.state      = 'climbing';
                    z.climbTimer = 0.8;
                }
            } else {
                z.angle = Math.atan2(dy, dx);
                z.x += (dx / dist) * ZOMBIE_SPEED * dt;
                z.y += (dy / dist) * ZOMBIE_SPEED * dt;
            }
            // zombies collide with walls but walk freely through window gaps
            for (const wall of walls) resolveCircleRect(z, ZOMBIE_RADIUS, wall);

        } else if (z.state === 'attacking') {
            // destroy planks one at a time then walk through
            z.attackTimer -= dt;
            if (z.attackTimer <= 0) {
                const win = z.targetWindow;
                win.planks = Math.max(0, win.planks - 1);
                // outward direction: away from building toward the zombie
                const outAngles = { top: -Math.PI/2, bottom: Math.PI/2, left: Math.PI, right: 0 };
                spawnPlankDebris(win, outAngles[win.side]);
                if (win.planks === 0) {
                    z.state = 'toWindow'; // waypoints empty — will walk straight to window centre
                } else {
                    z.attackTimer = PLANK_ATTACK_TIME;
                }
            }

        } else if (z.state === 'climbing') {
            z.climbTimer -= dt;
            if (z.climbTimer <= 0) z.state = 'hunting';

        } else if (z.state === 'hunting') {
            // move toward nearest player
            const targets = [player];
            if (remotePeer) targets.push(remotePeer);
            let nearestDist = Infinity, tx = player.x, ty = player.y;
            for (const t of targets) {
                const d = Math.hypot(t.x - z.x, t.y - z.y);
                if (d < nearestDist) { nearestDist = d; tx = t.x; ty = t.y; }
            }
            const dx = tx - z.x, dy = ty - z.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            z.angle = Math.atan2(dy, dx);
            z.x += (dx / dist) * ZOMBIE_SPEED * dt;
            z.y += (dy / dist) * ZOMBIE_SPEED * dt;

            // wall collision (not window — zombies can pass through gaps)
            for (const wall of walls) resolveCircleRect(z, ZOMBIE_RADIUS, wall);

            // damage local player on contact (host only — joiner handled separately)
            const pdx = z.x - player.x, pdy = z.y - player.y;
            if (pdx * pdx + pdy * pdy < (ZOMBIE_RADIUS + PLAYER_RADIUS) * (ZOMBIE_RADIUS + PLAYER_RADIUS)) {
                playerHp = Math.max(0, playerHp - ZOMBIE_DPS * dt);
            }
        }
    }

    // ── zombie-zombie separation ──
    const minZZ = ZOMBIE_RADIUS * 2;
    for (let i = 0; i < zombies.length; i++) {
        for (let j = i + 1; j < zombies.length; j++) {
            const a = zombies[i], b = zombies[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
            if (d < minZZ) {
                const half = (minZZ - d) * 0.5;
                a.x += (dx / d) * half;
                a.y += (dy / d) * half;
                b.x -= (dx / d) * half;
                b.y -= (dy / d) * half;
            }
        }
    }

    // ── broadcast zombie state to joiner ──
    zombieSyncTimer -= dt;
    if (zombieSyncTimer <= 0 && conn && conn.open) {
        zombieSyncTimer = 0.016; // send ~60 times per second
        conn.send({
            type:    'zombies',
            zombies: zombies.map(z => ({ x: z.x, y: z.y, state: z.state, id: z.id, angle: z.angle })),
            wave,
            waveDelay:    waveDelay > 0 ? waveDelay : 0,
            windowPlanks: windows.map(w => w.planks),
        });
    }
}

// Joiner-only: apply zombie contact damage using the received remoteZombies snapshot.
// The host handles this inside updateZombies; the joiner's updateZombies returns early.
function updateJoinerZombieDamage(dt) {
    if (shouldSimulateZombies()) return;
    const minDistSq = (ZOMBIE_RADIUS + PLAYER_RADIUS) * (ZOMBIE_RADIUS + PLAYER_RADIUS);
    for (const z of remoteZombies) {
        if (z.state !== 'hunting') continue;
        const dx = z.x - player.x, dy = z.y - player.y;
        if (dx * dx + dy * dy < minDistSq) {
            playerHp = Math.max(0, playerHp - ZOMBIE_DPS * dt);
            break;
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
    // solid dark grey outside
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
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

        // draw diagonal crossing planks — fixed positions, destroyed top-down (index 2 first)
        {
            const cx = win.x + win.w / 2;
            const cy = win.y + win.h / 2;
            const diagLen = Math.hypot(win.w, win.h) + 4;
            const crossLen = Math.max(win.w, win.h) + 4;
            const thickness = 6;
            // plank definitions. Index 2 = first destroyed, 0 = last to survive
            const plankDefs = [
                { angle: Math.atan2(win.h, win.w),  len: diagLen },
                { angle: Math.atan2(-win.h, win.w), len: diagLen },
                { angle: win.w >= win.h ? 0 : Math.PI / 2, len: crossLen },
            ];

            ctx.save();
            ctx.beginPath();
            ctx.rect(win.x, win.y, win.w, win.h);
            ctx.clip();
            ctx.fillStyle = '#7a5c2e';
            ctx.strokeStyle = '#5a3e18';
            ctx.lineWidth = 1;

            for (let i = 0; i < win.planks; i++) {
                const { angle, len } = plankDefs[i];
                // newest plank (index win.planks-1) gets pop-in scale
                const scale = (i === win.planks - 1)
                    ? (0.5 + 0.5 * win.buildAnim) + 0.15 * Math.sin(win.buildAnim * Math.PI) // overshoot pop
                    : 1;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(angle);
                ctx.scale(scale, scale);
                ctx.fillRect(-len / 2, -thickness / 2, len, thickness);
                ctx.strokeRect(-len / 2, -thickness / 2, len, thickness);
                ctx.restore();
            }

            // ghost plank + progress bar while player is building
            if (win.planks < 3 && win.buildProgress > 0) {
                const nextIdx = win.planks; // index of the plank being added
                const { angle, len } = plankDefs[nextIdx];
                ctx.save();
                ctx.globalAlpha = 0.25 + 0.35 * win.buildProgress;
                ctx.translate(cx, cy);
                ctx.rotate(angle);
                ctx.fillStyle = '#7a5c2e';
                ctx.fillRect(-len / 2, -thickness / 2, len, thickness);
                ctx.restore();

                // progress bar along the window bottom edge
                ctx.globalAlpha = 1;
                const barW = win.w;
                const barH = 3;
                const barX = win.x;
                const barY = win.y + win.h - barH;
                ctx.fillStyle = '#222';
                ctx.fillRect(barX, barY, barW, barH);
                ctx.fillStyle = '#c8a84b';
                ctx.fillRect(barX, barY, barW * win.buildProgress, barH);
            }

            ctx.restore();
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

function drawParticles() {
    for (const p of particles) {
        const alpha = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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

function drawBarricadePrompt() {
    for (const win of windows) {
        if (win.planks >= 3) continue;
        const cx = win.x + win.w / 2;
        const cy = win.y + win.h / 2;
        const dist = Math.hypot(player.x - cx, player.y - cy);
        if (dist > BARRICADE_RANGE) continue;
        // draw prompt centred on screen slightly above centre
        const sx = canvas.width / 2;
        const sy = canvas.height / 2 - 60;
        ctx.save();
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(sx - 72, sy - 16, 144, 24);
        ctx.fillStyle = '#e8d080';
        ctx.fillText('[F] Barricade', sx, sy);
        ctx.restore();
        break; // only show one prompt at a time
    }
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

function drawZombies() {
    // simulate-side draws its own zombies; joiner draws the received snapshot
    const list = shouldSimulateZombies() ? zombies : remoteZombies;
    for (const z of list) {
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.rotate(z.angle ?? 0);

        // arms outstretched forward — drawn behind body
        ctx.fillStyle = '#1e5218';
        ctx.beginPath();
        ctx.ellipse(16, -8, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(16, 8, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // body
        ctx.fillStyle = '#286e20';
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
        ctx.fill();

        // head — slightly darker for contrast
        ctx.fillStyle = '#1e5218';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

function drawHealthBar() {
    const barW  = 160;
    const barH  = 12;
    const bx    = 16;
    const by    = canvas.height - 80;
    const pct   = playerHp / PLAYER_MAX_HP;

    // label
    ctx.font      = '11px monospace';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.fillText('HEALTH', bx, by - 4);

    // track
    ctx.fillStyle = '#222';
    ctx.fillRect(bx, by, barW, barH);

    // fill — red at low, green at full
    const r = Math.round(200 - pct * 110);
    const g = Math.round(pct * 160);
    ctx.fillStyle = `rgb(${r},${g},30)`;
    ctx.fillRect(bx, by, barW * pct, barH);

    // border
    ctx.strokeStyle = '#444';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx, by, barW, barH);

    // number
    ctx.fillStyle = '#aaa';
    ctx.fillText(`${Math.ceil(playerHp)}`, bx + barW + 8, by + barH - 1);
}

function drawWaveHUD() {
    ctx.font      = 'bold 13px monospace';
    ctx.textAlign = 'center';

    if (zombies.length === 0 && zombiesLeft === 0 && wave > 0) {
        // between waves — countdown
        const secs = Math.ceil(waveDelay);
        ctx.fillStyle = '#666';
        ctx.fillText(`WAVE ${wave} COMPLETE`, canvas.width / 2, 28);
        ctx.fillStyle = '#444';
        ctx.font = '11px monospace';
        ctx.fillText(`Next wave in ${secs}s`, canvas.width / 2, 46);
    } else if (wave > 0) {
        ctx.fillStyle = '#cc2020';
        ctx.fillText(`WAVE ${wave}`, canvas.width / 2, 28);
    } else {
        // pre-game countdown
        const secs = Math.ceil(waveDelay);
        ctx.fillStyle = '#555';
        ctx.fillText(`First wave in ${secs}s`, canvas.width / 2, 28);
    }
    ctx.textAlign = 'left';
}

// ─── loop ─────────────────────────────────────────────────────────────────────

let lastTime = 0;

function gameLoop(timestamp) {
    const dt = lastTime ? (timestamp - lastTime) / 1000 : 0;
    lastTime = timestamp;

    updatePlayer(dt);
    updateBullets(dt);
    updateParticles(dt);
    updatePlankDebris(dt);
    updateBarricadeRepair(dt);
    updateZombies(dt);
    updateJoinerZombieDamage(dt);
    updateCamera();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // world-space drawing (affected by camera)
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawFloor();
    drawWorldBorder();
    drawBuilding();
    drawPlankDebris();
    drawZombies();
    drawBullets();
    drawParticles();
    drawRemotePlayer();
    drawPlayer();

    ctx.restore();

    // screen-space drawing (not affected by camera)
    drawHotbar();
    drawAmmo();
    drawMoney();
    drawHealthBar();
    drawWaveHUD();
    drawBarricadePrompt();

    requestAnimationFrame(gameLoop);
}

// game loop starts only once the peer connection opens
