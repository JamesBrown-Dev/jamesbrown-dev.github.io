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
const BULLET_LIFE   = 1.2; // seconds before expiring
const GUN_TIP_X     = 18;  // barrel tip offset in player-local space
const GUN_TIP_Y     = 9.5;

const player = {
    x: WORLD_W / 2,
    y: WORLD_H / 2 + 50, // inside the building, slightly south of centre
    angle: 0,
};

// ─── weapon definitions ───────────────────────────────────────────────────────

class WeaponDef {
    constructor(opts) {
        this.id           = opts.id;
        this.name         = opts.name;
        this.magSize      = opts.magSize;
        this.reloadTime   = opts.reloadTime;
        this.cooldown     = opts.cooldown;
        this.pellets      = opts.pellets      ?? 1;
        this.spread       = opts.spread       ?? 0;
        this.cost         = opts.cost         ?? 0;
        this.bulletSpeed  = opts.bulletSpeed;
        this.aoeRadius    = opts.aoeRadius    ?? 0;
        this.reserve      = opts.reserve;
        this.autoFire     = opts.autoFire     ?? false;
        // accuracy bloom — spread increases the longer the trigger is held
        this.bloomPerShot      = opts.bloomPerShot      ?? 0;   // extra spread added per shot
        this.maxBloom          = opts.maxBloom          ?? 0;   // cap on accumulated bloom
        this.bloomDecay        = opts.bloomDecay        ?? 0;   // spread lost per second on release
        this.firstShotCooldown = opts.firstShotCooldown ?? 0;   // seconds before bloom can reset again
        // bullet visuals — read by Bullet constructor
        this.bulletRadius    = opts.bulletRadius    ?? 2;
        this.bulletColor     = opts.bulletColor     ?? '#f5e642';
        this.bulletGlowing   = opts.bulletGlowing   ?? false;
        this.bulletGlowColor = opts.bulletGlowColor ?? null;
        // drawing — stored as functions so they run in whatever transform is active
        this._drawModel = opts.drawModel ?? null;
        this._drawIcon  = opts.drawIcon  ?? null;
    }
    // Call after ctx.translate(playerX, playerY) + ctx.rotate(angle)
    drawModel() { if (this._drawModel) this._drawModel(); }
    // Draws the hotbar icon centred on (cx, cy); handles its own save/restore
    drawIcon(cx, cy) { if (this._drawIcon) this._drawIcon(cx, cy); }
}

const WEAPON_DEFS = [
    new WeaponDef({
        id: 0, name: 'pistol', magSize: 8, reloadTime: 1.5, cooldown: 0.25,
        pellets: 1, spread: 0, cost: 0, bulletSpeed: 700, aoeRadius: 0, reserve: Infinity,
        bulletRadius: 2, bulletColor: '#f5e642',
        drawModel() {
            ctx.fillStyle = '#111';
            ctx.fillRect(2, 7, 16, 5);
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#111';    ctx.fillRect(-2, -3, 14, 4);   // barrel
            ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-7, -2, 7, 9);    // handle
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(-2, 5, 3.5, 0, Math.PI); ctx.stroke(); // trigger guard
            ctx.restore();
        },
    }),
    new WeaponDef({
        id: 1, name: 'shotgun', magSize: 2, reloadTime: 2.2, cooldown: 0.9,
        pellets: 12, spread: 0.28, cost: 200, bulletSpeed: 700, aoeRadius: 0, reserve: 16,
        bulletRadius: 2, bulletColor: '#f5e642',
        drawModel() {
            ctx.fillStyle = '#6b4a0f'; ctx.fillRect(-1, 7, 5, 7);    // stock
            ctx.fillStyle = '#444';    ctx.fillRect(4, 6, 5, 9);     // receiver
            ctx.fillStyle = '#555';
            ctx.fillRect(9, 6, 13, 4);   // barrel 1
            ctx.fillRect(9, 11, 13, 4);  // barrel 2
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#8b6914'; ctx.fillRect(-16, -1, 9, 6);  // stock
            ctx.fillStyle = '#888';    ctx.fillRect(-7, -3, 8, 8);   // receiver
            ctx.fillStyle = '#aaa';
            ctx.fillRect(1, -4, 16, 3);  // barrel 1
            ctx.fillRect(1,  1, 16, 3);  // barrel 2
            ctx.restore();
        },
    }),
    new WeaponDef({
        id: 2, name: 'raygun', magSize: 12, reloadTime: 1.8, cooldown: 0.5,
        pellets: 1, spread: 0, cost: 0, bulletSpeed: 900, aoeRadius: 80, reserve: 36,
        bulletRadius: 4, bulletColor: '#80ffaa', bulletGlowing: true, bulletGlowColor: '#40ff60',
        drawModel() {
            ctx.fillStyle = '#3a2060'; ctx.fillRect(0, 7, 8, 7);   // grip
            ctx.fillStyle = '#7050cc'; ctx.fillRect(8, 8, 10, 6);  // barrel
            ctx.save();
            ctx.shadowColor = '#40ff60'; ctx.shadowBlur = 8;
            ctx.fillStyle = '#60ffaa';
            ctx.beginPath(); ctx.arc(19, 11, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#3a2a6a'; ctx.fillRect(-12, -1, 7, 7);   // handle
            ctx.fillStyle = '#5a3aaa'; ctx.fillRect(-5, -4, 10, 9);   // body
            ctx.fillStyle = '#8860dd'; ctx.fillRect(5, -2, 12, 5);    // barrel
            ctx.shadowColor = '#40ff60'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#80ffaa';
            ctx.beginPath(); ctx.arc(18, 0, 3, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        },
    }),
    new WeaponDef({
        id: 3, name: 'machinegun', magSize: 30, reloadTime: 3.0, cooldown: 0.1,
        pellets: 1, spread: 0.06, cost: 0, bulletSpeed: 680, aoeRadius: 0, reserve: 90,
        autoFire: true, bulletRadius: 2, bulletColor: '#f5e642',
        bloomPerShot: 0.015, maxBloom: 0.18, bloomDecay: 1.5, firstShotCooldown: 0.3,
        drawModel() {
            ctx.fillStyle = '#8B5E1A'; ctx.fillRect(-7, 7, 7, 6);      // stock
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-7, 7, 1.5, 6);    // butt plate
            ctx.fillStyle = '#252525'; ctx.fillRect(0, 6, 11, 8);      // receiver
            ctx.fillStyle = '#1a1a1a';                                   // banana mag
            ctx.beginPath();
            ctx.moveTo(1.5, 14); ctx.lineTo(8, 14); ctx.lineTo(9.5, 21); ctx.lineTo(3, 21);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#8B5E1A'; ctx.fillRect(11, 8, 9, 5);     // handguard
            ctx.fillStyle = '#383838'; ctx.fillRect(11, 6, 17, 2);    // gas tube
            ctx.fillStyle = '#3a3a3a'; ctx.fillRect(20, 8.5, 10, 3);  // barrel
            ctx.fillStyle = '#555';    ctx.fillRect(29, 7.5, 3, 5);   // muzzle
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#8B5E1A'; ctx.fillRect(-20, 0, 8, 4);    // stock
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-20, 0, 1.5, 4);  // butt plate
            ctx.fillStyle = '#252525'; ctx.fillRect(-12, -3, 12, 8);  // receiver
            ctx.fillStyle = '#1a1a1a';                                  // banana mag
            ctx.beginPath();
            ctx.moveTo(-11, 5); ctx.lineTo(-4, 5); ctx.lineTo(-2.5, 13); ctx.lineTo(-9, 13);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#8B5E1A'; ctx.fillRect(0, -2, 10, 6);   // handguard
            ctx.fillStyle = '#444';    ctx.fillRect(0, -5, 22, 2);   // gas tube
            ctx.fillStyle = '#3a3a3a'; ctx.fillRect(10, -1, 12, 3);  // barrel
            ctx.fillStyle = '#555';    ctx.fillRect(22, -2, 3, 5);   // muzzle
            ctx.restore();
        },
    }),
    new WeaponDef({
        id: 4, name: 'uzi', magSize: 20, reloadTime: 1.4, cooldown: 0.07,
        pellets: 1, spread: 0.04, cost: 150, bulletSpeed: 750, aoeRadius: 0, reserve: 60,
        autoFire: true, bulletRadius: 2, bulletColor: '#f5e642',
        bloomPerShot: 0.04, maxBloom: 0.38, bloomDecay: 2.5, firstShotCooldown: 0.4,
        drawModel() {
            ctx.fillStyle = '#252525'; ctx.fillRect(0, 7, 11, 7);    // receiver
            ctx.fillStyle = '#3a3a3a'; ctx.fillRect(11, 8, 7, 5);    // short barrel
            ctx.fillStyle = '#444';    ctx.fillRect(0, 6, 18, 2);    // top rail
            ctx.fillStyle = '#111';    ctx.fillRect(3, 14, 5, 5);    // grip
            ctx.fillStyle = '#2a2a2a'; ctx.fillRect(4, 12, 4, 4);    // box mag
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#252525'; ctx.fillRect(-13, -3, 13, 7); // receiver
            ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, -2, 7, 5);   // short barrel
            ctx.fillStyle = '#444';    ctx.fillRect(-13, -5, 20, 2); // top rail
            ctx.fillStyle = '#111';    ctx.fillRect(-9, 4, 5, 7);   // grip
            ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-8, 3, 4, 5);   // box mag
            ctx.restore();
        },
    }),
];
const RAYGUN_AOE_DAMAGE = 4;

// ─── bullet ───────────────────────────────────────────────────────────────────

class Bullet {
    constructor(x, y, vx, vy, weaponId) {
        const wDef      = WEAPON_DEFS[weaponId] || WEAPON_DEFS[0];
        this.x          = x;
        this.y          = y;
        this.vx         = vx;
        this.vy         = vy;
        this.life       = BULLET_LIFE;
        this.weaponId   = weaponId;
        this.radius     = wDef.bulletRadius;
        this.color      = wDef.bulletColor;
        this.glowing    = wDef.bulletGlowing;
        this.glowColor  = wDef.bulletGlowColor;
    }

    update(dt) {
        this.x    += this.vx * dt;
        this.y    += this.vy * dt;
        this.life -= dt;
    }

    get alive() {
        return this.life > 0 &&
               this.x >= 0 && this.x <= WORLD_W &&
               this.y >= 0 && this.y <= WORLD_H;
    }

    draw() {
        if (this.glowing) {
            ctx.save();
            ctx.shadowColor = this.glowColor;
            ctx.shadowBlur  = 8;
            ctx.fillStyle   = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// ─── particle ─────────────────────────────────────────────────────────────────

class Particle {
    constructor(x, y, color, dirAngle) {
        const a = dirAngle !== undefined
            ? dirAngle + (Math.random() - 0.5) * Math.PI * 0.6
            : Math.random() * Math.PI * 2;
        const speed  = 150 + Math.random() * 250;
        this.x       = x;
        this.y       = y;
        this.vx      = Math.cos(a) * speed;
        this.vy      = Math.sin(a) * speed;
        this.life    = 0.12 + Math.random() * 0.12;
        this.maxLife = 0.24; // fixed reference so alpha starts < 1 for shorter-lived sparks
        this.color   = color;
    }

    update(dt) {
        this.x    += this.vx * dt;
        this.y    += this.vy * dt;
        this.vx   *= 0.82;
        this.vy   *= 0.82;
        this.life -= dt;
    }

    get alive() { return this.life > 0; }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life / this.maxLife;
        ctx.fillStyle   = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

let currentWeapon  = 0;                                    // active slot index
let inventory      = [0, -1, -1];                         // WEAPON_DEFS id per slot; -1 = empty
let savedAmmo      = [WEAPON_DEFS[0].magSize, 0, 0];      // mag ammo saved per slot
let reserveAmmo    = [Infinity, 0, 0];                    // reserve (spare) ammo per slot
let weaponCooldown     = 0;
let mouseHeld          = false;
let fireBloom          = 0;   // accumulated extra spread while holding trigger
let firstShotCooldown  = 0;   // while > 0, mousedown will not reset bloom
let moveSyncTimer   = 0;

let magAmmo      = WEAPON_DEFS[0].magSize;
let reloading    = false;
let reloadTimer  = 0;

function curWeaponDef() { return WEAPON_DEFS[inventory[currentWeapon]] || WEAPON_DEFS[0]; }
function isHoldingF()   { return !!(keys['f'] || keys['F']); }

function switchWeapon(slot) {
    if (slot === currentWeapon) return;
    if (inventory[slot] === -1) return;
    savedAmmo[currentWeapon] = magAmmo;
    reloading   = false;
    reloadTimer = 0;
    fireBloom   = 0;
    currentWeapon = slot;
    magAmmo = savedAmmo[slot];
}

const bullets       = []; // this player's bullets
const remoteBullets = []; // other player's bullets
const particles     = []; // visual hit effects
const plankDebris   = []; // broken barricade pieces
const groundMarks   = []; // blood smears and scorch marks
const ammoDrops     = []; // max ammo power-up drops
let   nextDropId    = 0;

// holds the last state received from the other player
let remotePeer = null;

let localPlayerName = 'Player';

let money = 0; // currency — to be used for future upgrades/purchases

// ─── player health ────────────────────────────────────────────────────────────

const PLAYER_MAX_HP = 100;
let playerHp        = PLAYER_MAX_HP;
let playerDead      = false;
let timeSinceDamage = 0; // seconds since last hit — regen starts after a delay
const ZOMBIE_DPS    = 120;  // damage per second while in contact
const HP_REGEN_RATE = 4;   // hp per second regenerated when not taking damage
const ZOMBIE_RADIUS = 12;

// ─── zombies & waves ──────────────────────────────────────────────────────────

const ZOMBIE_BASE_SPEED  = 60;
const ZOMBIE_HP          = 2;
const ZOMBIE_KILL_REWARD = 10;
const WAVE_DELAY         = 5;  // seconds between waves
const PLANK_ATTACK_TIME  = 1.5; // seconds to destroy one plank
const ZOMBIES_PER_WAVE   = (w) => 6 + w * 3; // wave 1=9, wave 2=12, wave 3=15, …
const ZOMBIE_WAVE_SPEED  = (w) => Math.min(ZOMBIE_BASE_SPEED + (w - 1) * 6, 140); // +6/wave, cap 140

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
        this.state        = 'toWindow'; // 'toWindow' | 'attacking' | 'entering' | 'hunting'
        this.hp           = ZOMBIE_HP + Math.floor(wave / 5); // +1 HP every 5 waves
        this.speed        = ZOMBIE_WAVE_SPEED(wave);
        this.attackTimer  = 0;
        this.waypoints    = []; // pre-computed path waypoints (approach + optional corners)
        this.huntTimer    = 0;  // countdown to next hunt-path refresh
        this.huntWaypoints = []; // routing waypoints while hunting
        this.id           = nextZombieId++;
        this.angle        = 0;
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

// ─── extra room (below the main building) ────────────────────────────────────
const DOOR_GAP  = 70;   // width of the door opening in the bottom wall
const DOOR_COST = 250;

// Corridor + end room positioned below the building
const EXTRA_ROOM = (() => {
    const b = BUILDING, t = b.wallThickness;
    const doorCX          = b.x + b.w * 0.70; // door at 70% across the bottom wall
    const buildingBottomY = b.y + b.h;         // outer face of building's bottom wall
    const CORRIDOR_H      = 200;               // inner height of narrow corridor
    const END_ROOM_W      = 400;               // outer width of end room (including walls)
    const END_ROOM_H      = 280;               // inner height of end room
    const endRoomL        = doorCX - END_ROOM_W / 2;
    const endRoomR        = doorCX + END_ROOM_W / 2;
    const endRoomTopY     = buildingBottomY + CORRIDOR_H;
    return {
        doorCX, buildingBottomY,
        CORRIDOR_H, END_ROOM_W, END_ROOM_H,
        endRoomL, endRoomR, endRoomTopY,
        wallThickness: t,
    };
})();

// The barrier rect that physically seals the doorway when locked
const DOOR_BARRIER = (() => {
    const b = BUILDING, t = b.wallThickness;
    return {
        x: EXTRA_ROOM.doorCX - DOOR_GAP / 2,
        y: b.y + b.h - t,
        w: DOOR_GAP,
        h: t,
    };
})();

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
        // pre-computed plank geometry (constant for the window's dimensions)
        const diagLen  = Math.hypot(w, h) + 4;
        const crossLen = Math.max(w, h) + 4;
        this.plankDefs = [
            { angle: Math.atan2(h, w),  len: diagLen },
            { angle: Math.atan2(-h, w), len: diagLen },
            { angle: w >= h ? 0 : Math.PI / 2, len: crossLen },
        ];
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

// Carve the door gap out of the main building's bottom wall.
// buildWalls() created a segment to the right of the bottom window — split it.
(() => {
    const b  = BUILDING, t = b.wallThickness;
    const dx  = DOOR_BARRIER.x;
    const dx2 = DOOR_BARRIER.x + DOOR_BARRIER.w;
    const idx = walls.findIndex(w =>
        Math.abs(w.y - (b.y + b.h - t)) < 1 && // bottom wall
        w.x > b.x + 100 &&                       // right of the bottom window
        w.x + w.w >= b.x + b.w - 10             // extends to the right edge
    );
    if (idx !== -1) {
        const s = walls[idx];
        walls.splice(idx, 1,
            { x: s.x,  y: s.y, w: dx - s.x,           h: t }, // left of door
            { x: dx2,  y: s.y, w: (s.x + s.w) - dx2,  h: t }, // right of door
        );
    }
})();

// Windows carved into the end room walls (one per side: left, right, bottom)
const extraRoomWindows = (() => {
    const r = EXTRA_ROOM, t = r.wallThickness;
    const { endRoomL, endRoomR, endRoomTopY, END_ROOM_H } = r;
    const midY = endRoomTopY + (END_ROOM_H + t) / 2 - WINDOW_GAP / 2;
    const midX = (endRoomL + endRoomR) / 2;
    return [
        new GameWindow(endRoomL,               midY,                         t,          WINDOW_GAP, 'left'),
        new GameWindow(endRoomR - t,            midY,                         t,          WINDOW_GAP, 'right'),
        new GameWindow(midX - WINDOW_GAP / 2,  endRoomTopY + END_ROOM_H,     WINDOW_GAP, t,          'bottom'),
    ];
})();

// Corridor + end room walls (end room side walls carved around windows)
const extraRoomWalls = (() => {
    const r = EXTRA_ROOM, t = r.wallThickness;
    const { doorCX, buildingBottomY, CORRIDOR_H, END_ROOM_H, endRoomL, endRoomR, endRoomTopY } = r;
    const cL = doorCX - DOOR_GAP / 2;
    const cR = doorCX + DOOR_GAP / 2;
    const [winL, winR, winB] = extraRoomWindows;
    return [
        // corridor walls
        { x: cL - t, y: buildingBottomY, w: t, h: CORRIDOR_H + t },
        { x: cR,     y: buildingBottomY, w: t, h: CORRIDOR_H + t },
        // end room top wall segments (gap aligns with corridor)
        { x: endRoomL, y: endRoomTopY, w: cL - t - endRoomL,   h: t },
        { x: cR + t,   y: endRoomTopY, w: endRoomR - (cR + t), h: t },
        // end room left wall — split around window
        { x: endRoomL, y: endRoomTopY,         w: t, h: winL.y - endRoomTopY },
        { x: endRoomL, y: winL.y + WINDOW_GAP, w: t, h: (endRoomTopY + END_ROOM_H + t) - (winL.y + WINDOW_GAP) },
        // end room right wall — split around window
        { x: endRoomR - t, y: endRoomTopY,         w: t, h: winR.y - endRoomTopY },
        { x: endRoomR - t, y: winR.y + WINDOW_GAP, w: t, h: (endRoomTopY + END_ROOM_H + t) - (winR.y + WINDOW_GAP) },
        // end room bottom wall — split around window
        { x: endRoomL,             y: endRoomTopY + END_ROOM_H, w: winB.x - endRoomL,               h: t },
        { x: winB.x + WINDOW_GAP, y: endRoomTopY + END_ROOM_H, w: endRoomR - (winB.x + WINDOW_GAP), h: t },
    ];
})();
walls.push(...extraRoomWalls);

// Door barrier seals the gap; removed from walls[] on unlock
walls.push(DOOR_BARRIER);

// Extra room windows joined AFTER buildWalls() so they aren't processed as main-building windows
windows.push(...extraRoomWindows);

// ─── indoor furniture (block walking, bullets, and zombie vision) ─────────────
const FURNITURE = (() => {
    const b = BUILDING, t = b.wallThickness;
    const S = 22; // barrel collision size

    // Cluster of 3 barrels — triangle shape, slightly left of main room centre
    const bx = b.x + b.w / 2 - 70;
    const by = b.y + b.h / 2 - 12;
    const barrels = [
        { x: bx,      y: by,      w: S, h: S, isFurniture: true },
        { x: bx + 25, y: by - 15, w: S, h: S, isFurniture: true },
        { x: bx + 25, y: by + 15, w: S, h: S, isFurniture: true },
    ];

    // Toppled bookcase flat against the right wall, below its window
    const bookcase = {
        x: b.x + b.w - t - 110,
        y: b.y + 290,
        w: 110, h: 24,
        isFurniture: true,
    };

    // Cluster of 4 barrels in the middle of the extra (bottom) room
    const r  = EXTRA_ROOM;
    const ex = (r.endRoomL + r.endRoomR) / 2; // room centre x
    const ey = r.endRoomTopY + r.END_ROOM_H / 2; // room centre y
    const extraBarrels = [
        { x: ex - 11,  y: ey - 30, w: S, h: S, isFurniture: true },
        { x: ex + 14,  y: ey - 15, w: S, h: S, isFurniture: true },
        { x: ex - 36,  y: ey - 15, w: S, h: S, isFurniture: true },
        { x: ex - 11,  y: ey + 10, w: S, h: S, isFurniture: true },
    ];

    return { barrels, bookcase, extraBarrels };
})();
walls.push(...FURNITURE.barrels, FURNITURE.bookcase, ...FURNITURE.extraBarrels);

let extraRoomUnlocked = false;
let doorProgress      = 0; // 0..1 buy-progress

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

// Returns true if the straight line between two points is unobstructed by any wall.
function hasLineOfSight(x1, y1, x2, y2) {
    for (const w of walls) {
        if (segmentIntersectsAABB(x1, y1, x2, y2, w.x, w.y, w.w, w.h)) return false;
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
    return { x: win.x + win.w / 2, y: win.y + win.h / 2 }; // fallback
}

// Returns a point just INSIDE the room past the window — zombies walk here
// after breaking through so they clear the wall gap and stop bunching.
function windowInteriorPoint(win) {
    const inset = 50;
    if (win.side === 'top')    return { x: win.x + win.w / 2, y: win.y + win.h + inset };
    if (win.side === 'bottom') return { x: win.x + win.w / 2, y: win.y - inset };
    if (win.side === 'left')   return { x: win.x + win.w + inset, y: win.y + win.h / 2 };
    if (win.side === 'right')  return { x: win.x - inset,         y: win.y + win.h / 2 };
    return { x: win.x + win.w / 2, y: win.y + win.h / 2 }; // fallback
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

// Strategic interior navigation nodes: room corners, door approach, corridor
// centre-line, and extra-room corners.  A* uses these as the search graph.
const NAV_WAYPOINTS = (() => {
    const b = BUILDING, t = b.wallThickness;
    const R = ZOMBIE_RADIUS + 10; // clearance from walls
    const { doorCX, buildingBottomY, CORRIDOR_H, endRoomTopY,
            endRoomL, endRoomR, END_ROOM_H } = EXTRA_ROOM;
    return [
        // ── main room interior corners ──
        { x: b.x + t + R,         y: b.y + t + R         },
        { x: b.x + b.w - t - R,   y: b.y + t + R         },
        { x: b.x + t + R,         y: b.y + b.h - t - R   },
        { x: b.x + b.w - t - R,   y: b.y + b.h - t - R   },
        // ── door approach (main-room side) ──
        { x: doorCX, y: b.y + b.h - t - R },
        // ── corridor centre-line ──
        { x: doorCX, y: buildingBottomY + R            },
        { x: doorCX, y: buildingBottomY + CORRIDOR_H - R },
        // ── extra room entry and corners ──
        { x: doorCX,                          y: endRoomTopY + R                },
        { x: endRoomL + t + R,                y: endRoomTopY + R                },
        { x: endRoomR - t - R,                y: endRoomTopY + R                },
        { x: endRoomL + t + R,                y: endRoomTopY + END_ROOM_H - R   },
        { x: endRoomR - t - R,                y: endRoomTopY + END_ROOM_H - R   },
        { x: (endRoomL + endRoomR) / 2,       y: endRoomTopY + END_ROOM_H / 2   },
    ];
})();

// Compute waypoints for a hunting zombie using A* over NAV_WAYPOINTS.
// Returns [] when the zombie has direct line of sight (walk straight to target).
function computeHuntWaypoints(zx, zy, tx, ty) {
    if (hasLineOfSight(zx, zy, tx, ty)) return [];

    const n     = NAV_WAYPOINTS.length;
    const gCost = new Array(n).fill(Infinity);
    const prev  = new Array(n).fill(-1);
    const closed = new Array(n).fill(false);
    const open   = [];

    // Seed open set with all waypoints visible from the zombie
    for (let i = 0; i < n; i++) {
        const wp = NAV_WAYPOINTS[i];
        if (hasLineOfSight(zx, zy, wp.x, wp.y)) {
            const g = Math.hypot(wp.x - zx, wp.y - zy);
            gCost[i] = g;
            open.push({ idx: i, g, f: g + Math.hypot(tx - wp.x, ty - wp.y) });
        }
    }

    while (open.length > 0) {
        // Pick entry with lowest f (graph is tiny — linear scan is fine)
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
        const curr = open.splice(bi, 1)[0];
        if (closed[curr.idx]) continue;
        closed[curr.idx] = true;

        const cn = NAV_WAYPOINTS[curr.idx];

        // If the target is visible from here, reconstruct and return the path
        if (hasLineOfSight(cn.x, cn.y, tx, ty)) {
            const path = [];
            let idx = curr.idx;
            while (idx !== -1) { path.unshift(NAV_WAYPOINTS[idx]); idx = prev[idx]; }
            return path;
        }

        // Expand to all visible neighbours
        for (let i = 0; i < n; i++) {
            if (closed[i]) continue;
            const nb = NAV_WAYPOINTS[i];
            if (!hasLineOfSight(cn.x, cn.y, nb.x, nb.y)) continue;
            const g = curr.g + Math.hypot(nb.x - cn.x, nb.y - cn.y);
            if (g < gCost[i]) {
                gCost[i] = g;
                prev[i] = curr.idx;
                open.push({ idx: i, g, f: g + Math.hypot(tx - nb.x, ty - nb.y) });
            }
        }
    }

    return []; // no path found — fall back to direct movement
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
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'move') {
            remotePeer = data;
        } else if (data.type === 'shoot') {
            // spawn the other player's bullet(s) on our end
            const batch = data.bullets || [{ x: data.x, y: data.y, vx: data.vx, vy: data.vy }];
            for (const b of batch) remoteBullets.push(new Bullet(b.x, b.y, b.vx, b.vy, b.weaponId ?? 0));
        } else if (data.type === 'zombies') {
            // joiner receives zombie positions + wave info from host
            remoteZombies = data.zombies;
            const prevWave = wave;
            wave      = data.wave;
            waveDelay = data.waveDelay;
            // reset mystery box for joiner when a new wave starts (mirrors host-side reset)
            if (data.wave > prevWave) {
                mysteryBoxOpened = false;
                if (playerDead) { playerDead = false; playerHp = PLAYER_MAX_HP; }
            }
            if (data.windowPlanks) data.windowPlanks.forEach((p, i) => { windows[i].planks = p; });
        } else if (data.type === 'zombieHit') {
            // host receives a hit report from joiner — apply damage to the zombie
            const idx = zombies.findIndex(z => z.id === data.id);
            if (idx !== -1) {
                zombies[idx].hp -= data.damage ?? 1;
                if (zombies[idx].hp <= 0) {
                    const zx = zombies[idx].x, zy = zombies[idx].y;
                    zombies.splice(idx, 1);
                    spawnBloodSmear(zx, zy);
                    trySpawnAmmoDrop(zx, zy);
                    if (conn && conn.open) {
                        conn.send({ type: 'killReward', amount: ZOMBIE_KILL_REWARD });
                        conn.send({ type: 'deathMark', markType: 'blood', x: zx, y: zy });
                    }
                }
            }
        } else if (data.type === 'killReward') {
            money += data.amount;
        } else if (data.type === 'addPlank') {
            // either player repaired a barricade — apply on this end
            // host also applies it (joiner sent it); joiner receives it back from host broadcast OR host repairs
            applyAddPlank(data.windowIndex);
        } else if (data.type === 'plankDebris') {
            // host tells joiner to spawn debris when a zombie destroys a plank
            spawnPlankDebris(windows[data.windowIndex], data.outDir);
        } else if (data.type === 'zombieAoE') {
            // joiner's ray gun hit — apply AoE without rewarding host, send kills back to joiner
            const kills = spawnRaygunExplosion(data.x, data.y, false);
            if (kills > 0 && conn && conn.open) {
                conn.send({ type: 'killReward', amount: ZOMBIE_KILL_REWARD * kills });
            }
        } else if (data.type === 'deathMark') {
            if (data.markType === 'blood') spawnBloodSmear(data.x, data.y);
            else if (data.markType === 'scorch') spawnScorchMark(data.x, data.y);
        } else if (data.type === 'ammoDrop') {
            ammoDrops.push({ id: data.id, x: data.x, y: data.y, life: 15, anim: 0 });
        } else if (data.type === 'pickupAmmoDrop') {
            const di = ammoDrops.findIndex(d => d.id === data.id);
            if (di !== -1) ammoDrops.splice(di, 1);
            applyMaxAmmo();
        } else if (data.type === 'unlockRoom') {
            if (!extraRoomUnlocked) {
                extraRoomUnlocked = true;
                const idx = walls.indexOf(DOOR_BARRIER);
                if (idx !== -1) walls.splice(idx, 1);
            }
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
    const nameEl = document.getElementById('name-input');
    localPlayerName = (nameEl && nameEl.value.trim()) || 'Player';
    document.getElementById('lobby').style.display = 'none';
    requestAnimationFrame(gameLoop);
}

// ─── input ────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    keys[e.key] = true;

    // weapon switching
    if (e.key === '1') switchWeapon(0);
    if (e.key === '2') switchWeapon(1);
    if (e.key === '3') switchWeapon(2);

    // reload
    if ((e.key === 'r' || e.key === 'R') && !reloading && magAmmo < curWeaponDef().magSize && reserveAmmo[currentWeapon] > 0) {
        reloading   = true;
        reloadTimer = curWeaponDef().reloadTime;
    }
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

document.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

function tryFire() {
    if (weaponCooldown > 0 || reloading || playerDead) return;
    const wDef = curWeaponDef();

    // auto-reload if empty (only if reserve available)
    if (magAmmo <= 0) {
        if (reserveAmmo[currentWeapon] > 0) {
            reloading   = true;
            reloadTimer = wDef.reloadTime;
        }
        return;
    }

    // spawn bullet(s) from the tip of the gun barrel (local space tip is at x=18, y=9.5)
    const GUN_TIP_X = 18, GUN_TIP_Y = 9.5;
    const bx = player.x + Math.cos(player.angle) * GUN_TIP_X - Math.sin(player.angle) * GUN_TIP_Y;
    const by = player.y + Math.sin(player.angle) * GUN_TIP_X + Math.cos(player.angle) * GUN_TIP_Y;

    const spd = wDef.bulletSpeed || BULLET_SPEED;
    const effectiveSpread = wDef.spread + (wDef.bloomPerShot ? fireBloom : 0);
    const newBullets = [];
    for (let i = 0; i < wDef.pellets; i++) {
        const a = player.angle + (Math.random() - 0.5) * effectiveSpread;
        newBullets.push(new Bullet(bx, by, Math.cos(a) * spd, Math.sin(a) * spd, wDef.id));
    }
    bullets.push(...newBullets);
    magAmmo--;
    weaponCooldown = wDef.cooldown;

    // build bloom after each shot
    if (wDef.bloomPerShot) {
        fireBloom = Math.min(wDef.maxBloom, fireBloom + wDef.bloomPerShot);
        firstShotCooldown = wDef.firstShotCooldown;
    }

    if (conn && conn.open) {
        conn.send({ type: 'shoot', bullets: newBullets.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, weaponId: b.weaponId })) });
    }
}

canvas.addEventListener('mousedown', () => {
    mouseHeld = true;
    // first shot is always perfect — reset bloom unless the cooldown is still active
    if (firstShotCooldown <= 0) fireBloom = 0;
    tryFire();
});
canvas.addEventListener('mouseup', () => { mouseHeld = false; });

// ─── update ───────────────────────────────────────────────────────────────────

function updatePlayer(dt) {
    moveSyncTimer -= dt;
    if (playerDead) {
        // still broadcast dead state so the other player and zombies know
        if (moveSyncTimer <= 0 && conn && conn.open) {
            moveSyncTimer = 1 / 60;
            conn.send({ type: 'move', x: player.x, y: player.y, angle: player.angle, weapon: currentWeapon, weaponId: inventory[currentWeapon], dead: true });
        }
        return;
    }
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

    weaponCooldown    = Math.max(0, weaponCooldown - dt);
    firstShotCooldown = Math.max(0, firstShotCooldown - dt);
    if (!mouseHeld && curWeaponDef().bloomDecay)
        fireBloom = Math.max(0, fireBloom - curWeaponDef().bloomDecay * dt);

    if (reloading) {
        reloadTimer -= dt;
        if (reloadTimer <= 0) {
            const wDef  = curWeaponDef();
            const space = wDef.magSize - magAmmo;
            const fill  = reserveAmmo[currentWeapon] === Infinity
                ? space
                : Math.min(space, reserveAmmo[currentWeapon]);
            magAmmo += fill;
            if (reserveAmmo[currentWeapon] !== Infinity) reserveAmmo[currentWeapon] -= fill;
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

    // health regeneration — kicks in 4s after last damage
    timeSinceDamage += dt;
    if (timeSinceDamage > 4 && playerHp > 0 && playerHp < PLAYER_MAX_HP) {
        playerHp = Math.min(PLAYER_MAX_HP, playerHp + HP_REGEN_RATE * dt);
    }

    // auto-fire while mouse held (machine gun and any other autoFire weapons)
    if (mouseHeld && curWeaponDef().autoFire) tryFire();

    // send position + current weapon to the other player (~60 Hz)
    if (moveSyncTimer <= 0 && conn && conn.open) {
        moveSyncTimer = 1 / 60;
        conn.send({ type: 'move', x: player.x, y: player.y, angle: player.angle, weapon: currentWeapon, weaponId: inventory[currentWeapon], dead: playerDead, name: localPlayerName });
    }
}

// dirAngle: direction particles fly toward (use bullet's opposite angle for impact spray)
// rewardMoney=false when called from a joiner's AoE on the host (joiner gets rewards instead)
function spawnRaygunExplosion(x, y, rewardMoney = true) {
    spawnParticles(x, y, '#40ff60', 20);
    spawnParticles(x, y, '#a0ffb0', 10);
    spawnScorchMark(x, y);
    // tell joiner about the scorch — skip when handling joiner's AoE (they already have it)
    if (shouldSimulateZombies() && rewardMoney && conn && conn.open) {
        conn.send({ type: 'deathMark', markType: 'scorch', x, y });
    }

    const radius = WEAPON_DEFS[2].aoeRadius;
    let kills = 0;

    if (shouldSimulateZombies()) {
        for (let i = zombies.length - 1; i >= 0; i--) {
            if (Math.hypot(zombies[i].x - x, zombies[i].y - y) < radius) {
                zombies[i].hp -= RAYGUN_AOE_DAMAGE;
                if (zombies[i].hp <= 0) {
                    const zx = zombies[i].x, zy = zombies[i].y;
                    zombies.splice(i, 1);
                    if (rewardMoney) money += ZOMBIE_KILL_REWARD;
                    kills++;
                    trySpawnAmmoDrop(zx, zy);
                }
            }
        }
    } else {
        // joiner: tell host to handle the AoE damage
        if (conn && conn.open) conn.send({ type: 'zombieAoE', x, y, radius });
    }
    return kills;
}

function spawnParticles(x, y, color, count, dirAngle) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color, dirAngle));
    }
}

const BARRICADE_REPAIR_TIME = 1.2; // seconds to hold F to add one plank
const BARRICADE_RANGE       = 60;  // px from window centre

// ─── shotgun wall pickup ──────────────────────────────────────────────────────
// positioned on the top wall, midway between the top window's right edge and the top-right corner
const SHOTGUN_PICKUP = (() => {
    const b  = BUILDING;
    const t  = b.wallThickness;
    const cx = b.x + b.w / 2;                        // building horizontal centre
    const winRightEdge = cx + WINDOW_GAP / 2;         // top window right edge
    const cornerX      = b.x + b.w;                  // top-right corner
    const midX         = (winRightEdge + cornerX) / 2;
    return { x: midX - 18, y: b.y, w: 36, h: t };    // 36px wide, full wall thickness
})();

let shotgunBuyProgress = 0; // 0..1 while holding F near pickup

// ─── uzi wall pickup ──────────────────────────────────────────────────────────
// on the left wall, upper section (above the left-wall window)
const UZI_PICKUP = (() => {
    const b = BUILDING, t = b.wallThickness;
    // left window sits at y = b.y + b.h - WINDOW_GAP - 100; place uzi halfway above it
    const midY = b.y + (b.h - 55 - 100) / 2 - 18;
    return { x: b.x, y: midY, w: t, h: 36 };
})();

let uziBuyProgress = 0; // 0..1 while holding F near pickup

// ─── mystery box ──────────────────────────────────────────────────────────────
const MYSTERY_BOX = (() => {
    const r = EXTRA_ROOM, t = r.wallThickness;
    // top-right corner of the bottom room interior
    return { x: r.endRoomR - t - 48, y: r.endRoomTopY + t + 12, w: 32, h: 32, cost: 200 };
})();

let mysteryBoxProgress = 0;  // 0..1 hold-F progress
let mysteryBoxOpened   = false; // resets each wave
let mysteryBoxAnim     = 0;  // 0..1 pulsing glow timer
let mysteryBoxResult   = null; // { text, timer } — shown briefly after opening

function applyAddPlank(winIndex) {
    const win = windows[winIndex];
    if (!win || win.planks >= 3) return;
    win.planks++;
    win.buildAnim = 0; // trigger pop-in
}

function updateBarricadeRepair(dt) {
    const holding = isHoldingF();
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

function updateMysteryBox(dt) {
    mysteryBoxAnim = (mysteryBoxAnim + dt * 2) % (Math.PI * 2); // pulse timer

    // tick result overlay
    if (mysteryBoxResult) {
        mysteryBoxResult.timer -= dt;
        if (mysteryBoxResult.timer <= 0) mysteryBoxResult = null;
    }

    if (mysteryBoxOpened) return;
    const mb   = MYSTERY_BOX;
    const cx   = mb.x + mb.w / 2;
    const cy   = mb.y + mb.h / 2;
    const dist = Math.hypot(player.x - cx, player.y - cy);
    const holding = isHoldingF();

    if (dist < BARRICADE_RANGE && holding) {
        mysteryBoxProgress = Math.min(1, mysteryBoxProgress + dt / 1.5);
        if (mysteryBoxProgress >= 1) {
            mysteryBoxProgress = 0;
            if (money < mb.cost) return;
            money -= mb.cost;
            mysteryBoxOpened = true;
            const roll = Math.random();
            // 10% ray gun | 20% shotgun | 30% machine gun | 20% uzi | 20% teddy bear
            const prize = roll < 0.10 ? 2
                        : roll < 0.30 ? 1
                        : roll < 0.60 ? 3
                        : roll < 0.80 ? 4
                        : -1; // teddy bear
            if (prize !== -1) {
                let targetSlot = inventory.indexOf(-1);
                if (targetSlot === -1) targetSlot = currentWeapon;
                inventory[targetSlot]   = prize;
                savedAmmo[targetSlot]   = WEAPON_DEFS[prize].magSize;
                reserveAmmo[targetSlot] = WEAPON_DEFS[prize].reserve;
                if (targetSlot === currentWeapon) { magAmmo = WEAPON_DEFS[prize].magSize; reloading = false; reloadTimer = 0; }
                switchWeapon(targetSlot);
                const labels = { 1: ['SHOTGUN!', '#e8c020'], 2: ['RAY GUN!', '#40ff60'], 3: ['MACHINE GUN!', '#e8c020'], 4: ['UZI!', '#40c8ff'] };
                const [text, color] = labels[prize];
                mysteryBoxResult = { text, color, timer: 2.5 };
            } else {
                mysteryBoxResult = { text: 'TEDDY BEAR!', color: '#c8843a', timer: 2.5 };
            }
        }
    } else {
        mysteryBoxProgress = Math.max(0, mysteryBoxProgress - dt * 3);
    }
}

function updateExtraRoomDoor(dt) {
    if (extraRoomUnlocked) return;
    const db   = DOOR_BARRIER;
    const cx   = db.x + db.w / 2;
    const cy   = db.y + db.h / 2;
    const dist = Math.hypot(player.x - cx, player.y - cy);
    const holding = isHoldingF();

    if (dist < BARRICADE_RANGE && holding) {
        if (money >= DOOR_COST) {
            doorProgress = Math.min(1, doorProgress + dt / 1.5);
            if (doorProgress >= 1) {
                doorProgress = 0;
                money -= DOOR_COST;
                unlockExtraRoom();
            }
        }
    } else {
        doorProgress = Math.max(0, doorProgress - dt * 3);
    }
}

function unlockExtraRoom() {
    extraRoomUnlocked = true;
    const idx = walls.indexOf(DOOR_BARRIER);
    if (idx !== -1) walls.splice(idx, 1);
    if (conn && conn.open) conn.send({ type: 'unlockRoom' });
}

function drawExtraRoom() {
    const r = EXTRA_ROOM, t = r.wallThickness;
    const { doorCX, buildingBottomY, CORRIDOR_H, END_ROOM_W, END_ROOM_H, endRoomL, endRoomTopY } = r;
    const cL = doorCX - DOOR_GAP / 2;

    // corridor floor (narrow strip below the door)
    ctx.fillStyle = '#202020';
    ctx.fillRect(cL, buildingBottomY, DOOR_GAP, CORRIDOR_H);

    // end room floor (wider area at the bottom of the corridor)
    ctx.fillRect(endRoomL + t, endRoomTopY + t, END_ROOM_W - t * 2, END_ROOM_H - t);

    // door — wooden panels when locked, open gap when unlocked
    const db = DOOR_BARRIER;
    if (!extraRoomUnlocked) {
        // wooden door fill
        ctx.fillStyle = '#5a3e14';
        ctx.fillRect(db.x, db.y, db.w, db.h);
        ctx.strokeStyle = '#8B6020';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(db.x, db.y, db.w, db.h);

        // decorative panel lines
        ctx.strokeStyle = '#4a3010';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const mid = db.x + db.w / 2;
        ctx.moveTo(mid, db.y + 3);
        ctx.lineTo(mid, db.y + db.h - 3);
        ctx.stroke();

        // price label (inside building, above the door)
        ctx.save();
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#e8c060';
        ctx.fillText(`[F] £${DOOR_COST}`, db.x + db.w / 2, db.y - 3);
        ctx.restore();

        // progress bar
        if (doorProgress > 0) {
            ctx.fillStyle = '#222';
            ctx.fillRect(db.x, db.y - 9, db.w, 4);
            ctx.fillStyle = '#e8c060';
            ctx.fillRect(db.x, db.y - 9, db.w * doorProgress, 4);
        }
    }
}

function drawMysteryBox() {
    const mb   = MYSTERY_BOX;
    const cx   = mb.x + mb.w / 2;
    const cy   = mb.y + mb.h / 2;
    const glow = 0.5 + 0.5 * Math.sin(mysteryBoxAnim);

    ctx.save();

    if (!mysteryBoxOpened) {
        // pulsing green glow
        const glowR = mb.w * 0.9 + glow * 8;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grad.addColorStop(0, `rgba(60,255,80,${0.25 * glow})`);
        grad.addColorStop(1, 'rgba(60,255,80,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    }

    // box body
    ctx.fillStyle = mysteryBoxOpened ? '#1a1a1a' : '#1a2e1a';
    ctx.fillRect(mb.x, mb.y, mb.w, mb.h);
    ctx.strokeStyle = mysteryBoxOpened ? '#333' : `rgba(60,220,80,${0.5 + 0.5 * glow})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mb.x, mb.y, mb.w, mb.h);

    // ? or empty label
    ctx.font = `bold ${mysteryBoxOpened ? 10 : 18}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = mysteryBoxOpened ? '#333' : `rgba(80,255,100,${0.7 + 0.3 * glow})`;
    ctx.fillText(mysteryBoxOpened ? 'EMPTY' : '?', cx, cy);
    ctx.textBaseline = 'alphabetic';

    // buy progress bar
    if (!mysteryBoxOpened && mysteryBoxProgress > 0) {
        ctx.fillStyle = '#222';
        ctx.fillRect(mb.x, mb.y + mb.h + 2, mb.w, 3);
        ctx.fillStyle = '#40e060';
        ctx.fillRect(mb.x, mb.y + mb.h + 2, mb.w * mysteryBoxProgress, 3);
    }

    ctx.restore();
}

function updateWeaponPickup(dt) {
    const holding = isHoldingF();

    // ── shotgun ──
    {
        const sp  = SHOTGUN_PICKUP;
        const cx  = sp.x + sp.w / 2, cy = sp.y + sp.h / 2;
        const near = Math.hypot(player.x - cx, player.y - cy) < BARRICADE_RANGE;
        if (near && holding && !inventory.includes(1)) {
            shotgunBuyProgress = Math.min(1, shotgunBuyProgress + dt / 1.5);
            if (shotgunBuyProgress >= 1) {
                shotgunBuyProgress = 0;
                if (money < WEAPON_DEFS[1].cost) return;
                money -= WEAPON_DEFS[1].cost;
                let targetSlot = inventory.indexOf(-1);
                if (targetSlot === -1) targetSlot = currentWeapon;
                inventory[targetSlot]   = 1;
                savedAmmo[targetSlot]   = WEAPON_DEFS[1].magSize;
                reserveAmmo[targetSlot] = WEAPON_DEFS[1].reserve;
                if (targetSlot === currentWeapon) { magAmmo = WEAPON_DEFS[1].magSize; reloading = false; reloadTimer = 0; }
                switchWeapon(targetSlot);
            }
        } else {
            shotgunBuyProgress = Math.max(0, shotgunBuyProgress - dt * 3);
        }
    }

    // ── uzi ──
    {
        const up  = UZI_PICKUP;
        const cx  = up.x + up.w / 2, cy = up.y + up.h / 2;
        const near = Math.hypot(player.x - cx, player.y - cy) < BARRICADE_RANGE;
        if (near && holding && !inventory.includes(4)) {
            uziBuyProgress = Math.min(1, uziBuyProgress + dt / 1.5);
            if (uziBuyProgress >= 1) {
                uziBuyProgress = 0;
                if (money < WEAPON_DEFS[4].cost) return;
                money -= WEAPON_DEFS[4].cost;
                let targetSlot = inventory.indexOf(-1);
                if (targetSlot === -1) targetSlot = currentWeapon;
                inventory[targetSlot]   = 4;
                savedAmmo[targetSlot]   = WEAPON_DEFS[4].magSize;
                reserveAmmo[targetSlot] = WEAPON_DEFS[4].reserve;
                if (targetSlot === currentWeapon) { magAmmo = WEAPON_DEFS[4].magSize; reloading = false; reloadTimer = 0; }
                switchWeapon(targetSlot);
            }
        } else {
            uziBuyProgress = Math.max(0, uziBuyProgress - dt * 3);
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

function spawnBloodSmear(x, y) {
    const angle = Math.random() * Math.PI * 2;
    const blobs = [];
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        blobs.push({
            ox:  (Math.random() - 0.5) * 16,
            oy:  (Math.random() - 0.5) * 8,
            rx:  5 + Math.random() * 9,
            ry:  3 + Math.random() * 4,
            rot: (Math.random() - 0.5) * 1.5,
        });
    }
    const life = 10 + Math.random() * 5;
    groundMarks.push({ type: 'blood', x, y, life, maxLife: life, angle, blobs });
}

function spawnScorchMark(x, y) {
    const r    = 22 + Math.random() * 16;
    const life = 15 + Math.random() * 8;
    groundMarks.push({ type: 'scorch', x, y, r, life, maxLife: life });
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

function updateGroundMarks(dt) {
    for (let i = groundMarks.length - 1; i >= 0; i--) {
        groundMarks[i].life -= dt;
        if (groundMarks[i].life <= 0) groundMarks.splice(i, 1);
    }
}

function drawGroundMarks() {
    for (const m of groundMarks) {
        const t = m.life / m.maxLife;
        const alpha = Math.min(1, t * 4) * t * 0.85; // fade in fast, fade out slowly
        ctx.save();
        ctx.globalAlpha = alpha;
        if (m.type === 'blood') {
            ctx.translate(m.x, m.y);
            ctx.rotate(m.angle);
            for (const b of m.blobs) {
                ctx.save();
                ctx.translate(b.ox, b.oy);
                ctx.rotate(b.rot);
                ctx.fillStyle = '#6a0000';
                ctx.beginPath();
                ctx.ellipse(0, 0, b.rx, b.ry, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        } else {
            // scorch — dark radial gradient
            const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
            grad.addColorStop(0,   'rgba(8,5,2,0.95)');
            grad.addColorStop(0.45, 'rgba(14,10,4,0.7)');
            grad.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function applyMaxAmmo() {
    for (let i = 0; i < inventory.length; i++) {
        if (inventory[i] === -1) continue;
        const wDef = WEAPON_DEFS[inventory[i]];
        savedAmmo[i] = wDef.magSize;
        if (reserveAmmo[i] !== Infinity) reserveAmmo[i] = wDef.reserve;
    }
    magAmmo   = curWeaponDef().magSize;
    reloading = false;
    reloadTimer = 0;
}

function trySpawnAmmoDrop(x, y) {
    if (Math.random() >= 0.05) return; // 5% chance per kill
    const id = nextDropId++;
    ammoDrops.push({ id, x, y, life: 15, anim: 0 });
    if (conn && conn.open) conn.send({ type: 'ammoDrop', id, x, y });
}

function updateAmmoDrops(dt) {
    for (let i = ammoDrops.length - 1; i >= 0; i--) {
        const d = ammoDrops[i];
        d.anim = (d.anim + dt * 3) % (Math.PI * 2);
        d.life -= dt;
        if (d.life <= 0) { ammoDrops.splice(i, 1); continue; }
        if (!playerDead && Math.hypot(player.x - d.x, player.y - d.y) < 20) {
            applyMaxAmmo();
            if (conn && conn.open) conn.send({ type: 'pickupAmmoDrop', id: d.id });
            ammoDrops.splice(i, 1);
        }
    }
}

function drawAmmoDrops() {
    for (const d of ammoDrops) {
        const glow = 0.5 + 0.5 * Math.sin(d.anim);
        const bob  = Math.sin(d.anim * 0.7) * 3;
        const cx = d.x, cy = d.y + bob;
        const w = 28, h = 18;
        ctx.save();
        // pulsing glow
        const glowR = 20 + glow * 8;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grad.addColorStop(0, `rgba(255,200,0,${0.3 * glow})`);
        grad.addColorStop(1, 'rgba(255,200,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
        // box
        ctx.fillStyle = '#1a1200';
        ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
        ctx.strokeStyle = `rgba(255,190,0,${0.6 + 0.4 * glow})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
        // label
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255,210,0,${0.85 + 0.15 * glow})`;
        ctx.font = 'bold 7px monospace';
        ctx.fillText('MAX', cx, cy - 3);
        ctx.font = '6px monospace';
        ctx.fillText('AMMO', cx, cy + 5);
        ctx.restore();
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
        particles[i].update(dt);
        if (!particles[i].alive) particles.splice(i, 1);
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
        b.update(dt);
        if (!b.alive) {
            bullets.splice(i, 1);
            continue;
        }
        if (bulletHitsWall(b)) {
            if (b.weaponId === 2) spawnRaygunExplosion(b.x, b.y);
            else spawnParticles(b.x, b.y, '#f5e642', 8, Math.atan2(b.vy, b.vx) + Math.PI);
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
                    if (b.weaponId === 2) {
                        spawnRaygunExplosion(b.x, b.y);
                    } else {
                        z.hp -= b.weaponId === 3 ? 2 : 1;
                        if (z.hp <= 0) {
                            const zx = z.x, zy = z.y;
                            zombies.splice(j, 1);
                            money += ZOMBIE_KILL_REWARD;
                            spawnBloodSmear(zx, zy);
                            trySpawnAmmoDrop(zx, zy);
                            if (conn && conn.open) conn.send({ type: 'deathMark', markType: 'blood', x: zx, y: zy });
                        }
                    }
                    zombieHit = true;
                    break;
                }
            }
        } else {
            for (let j = 0; j < remoteZombies.length; j++) {
                const z = remoteZombies[j];
                const dx = b.x - z.x, dy = b.y - z.y;
                if (dx * dx + dy * dy < ZOMBIE_RADIUS * ZOMBIE_RADIUS) {
                    if (b.weaponId === 2) spawnRaygunExplosion(b.x, b.y);
                    else if (conn && conn.open) conn.send({ type: 'zombieHit', id: z.id, damage: b.weaponId === 3 ? 2 : 1 });
                    zombieHit = true;
                    break;
                }
            }
        }
        if (zombieHit) {
            if (b.weaponId !== 2) spawnParticles(b.x, b.y, '#cc2020', 8, Math.atan2(b.vy, b.vx) + Math.PI);
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
        b.update(dt);
        if (!b.alive) {
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


function spawnZombie() {
    const margin = ZOMBIE_RADIUS + 4;

    // Pick the target window first, then spawn on the edge that faces it.
    // This guarantees the zombie has direct line of sight and never needs
    // to route around the building.
    const available = extraRoomUnlocked
        ? windows
        : windows.filter(w => !extraRoomWindows.includes(w));
    const win = available[Math.floor(Math.random() * available.length)];
    const ap  = windowApproachPoint(win);

    // Spawn at a random position along the world edge that faces the approach point,
    // biased toward the approach point's axis position (±400 px spread).
    const spread = 400;
    let sx, sy;
    if (win.side === 'top') {
        sx = Math.max(margin, Math.min(WORLD_W - margin, ap.x + (Math.random() - 0.5) * spread));
        sy = margin;
    } else if (win.side === 'bottom') {
        sx = Math.max(margin, Math.min(WORLD_W - margin, ap.x + (Math.random() - 0.5) * spread));
        sy = WORLD_H - margin;
    } else if (win.side === 'left') {
        sx = margin;
        sy = Math.max(margin, Math.min(WORLD_H - margin, ap.y + (Math.random() - 0.5) * spread));
    } else { // right
        sx = WORLD_W - margin;
        sy = Math.max(margin, Math.min(WORLD_H - margin, ap.y + (Math.random() - 0.5) * spread));
    }

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
            // revive dead players at the start of each new wave
            if (playerDead) { playerDead = false; playerHp = PLAYER_MAX_HP; }
            mysteryBoxOpened = false;
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
            // ── follow waypoints toward the window approach point ──
            if (z.waypoints.length === 0) { z.state = 'hunting'; continue; }
            const wp = z.waypoints[0];
            const dx = wp.x - z.x, dy = wp.y - z.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            if (dist < 8) {
                z.waypoints.shift();
                if (z.waypoints.length === 0) {
                    // reached the approach point
                    if (z.targetWindow.planks > 0) {
                        z.state       = 'attacking';
                        z.attackTimer = PLANK_ATTACK_TIME;
                    } else {
                        // window already open — pass through to interior
                        z.state     = 'entering';
                        z.waypoints = [windowInteriorPoint(z.targetWindow)];
                    }
                }
            } else {
                z.angle = Math.atan2(dy, dx);
                z.x += (dx / dist) * z.speed * dt;
                z.y += (dy / dist) * z.speed * dt;
            }
            for (const wall of walls) resolveCircleRect(z, ZOMBIE_RADIUS, wall);

        } else if (z.state === 'attacking') {
            // ── destroy planks one at a time, then enter ──
            z.attackTimer -= dt;
            if (z.attackTimer <= 0) {
                const win = z.targetWindow;
                win.planks = Math.max(0, win.planks - 1);
                const outAngles = { top: -Math.PI/2, bottom: Math.PI/2, left: Math.PI, right: 0 };
                const outDir = outAngles[win.side];
                spawnPlankDebris(win, outDir);
                if (conn && conn.open) {
                    conn.send({ type: 'plankDebris', windowIndex: windows.indexOf(win), outDir });
                }
                if (win.planks === 0) {
                    z.state     = 'entering';
                    z.waypoints = [windowInteriorPoint(win)];
                } else {
                    z.attackTimer = PLANK_ATTACK_TIME;
                }
            }

        } else if (z.state === 'entering') {
            // ── walk to the interior rally point then start hunting ──
            if (z.waypoints.length === 0) { z.state = 'hunting'; z.huntTimer = 0; continue; }
            const wp = z.waypoints[0];
            const dx = wp.x - z.x, dy = wp.y - z.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            if (dist < 8) {
                z.waypoints.shift();
                if (z.waypoints.length === 0) { z.state = 'hunting'; z.huntTimer = 0; }
            } else {
                z.angle = Math.atan2(dy, dx);
                z.x += (dx / dist) * z.speed * dt;
                z.y += (dy / dist) * z.speed * dt;
            }
            for (const wall of walls) resolveCircleRect(z, ZOMBIE_RADIUS, wall);

        } else if (z.state === 'hunting') {
            // ── chase nearest player, routing around the building if needed ──
            const targets = [];
            if (!playerDead) targets.push(player);
            if (remotePeer && !remotePeer.dead) targets.push(remotePeer);
            if (targets.length === 0) continue;

            let nearestDist = Infinity, nearestTarget = targets[0];
            for (const t of targets) {
                const d = Math.hypot(t.x - z.x, t.y - z.y);
                if (d < nearestDist) { nearestDist = d; nearestTarget = t; }
            }

            // Refresh route every 1.2 s so zombies adapt as players move
            z.huntTimer -= dt;
            if (z.huntTimer <= 0) {
                z.huntTimer    = 0.4;
                z.huntWaypoints = computeHuntWaypoints(z.x, z.y, nearestTarget.x, nearestTarget.y);
            }

            // Advance along any routing corners
            while (z.huntWaypoints.length > 0 &&
                   Math.hypot(z.huntWaypoints[0].x - z.x, z.huntWaypoints[0].y - z.y) < 12) {
                z.huntWaypoints.shift();
            }

            const tx = z.huntWaypoints.length > 0 ? z.huntWaypoints[0].x : nearestTarget.x;
            const ty = z.huntWaypoints.length > 0 ? z.huntWaypoints[0].y : nearestTarget.y;
            const dx = tx - z.x, dy = ty - z.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            z.angle = Math.atan2(dy, dx);
            z.x += (dx / dist) * z.speed * dt;
            z.y += (dy / dist) * z.speed * dt;

            for (const wall of walls) resolveCircleRect(z, ZOMBIE_RADIUS, wall);

            if (!playerDead) {
                const pdx = z.x - player.x, pdy = z.y - player.y;
                if (pdx * pdx + pdy * pdy < (ZOMBIE_RADIUS + PLAYER_RADIUS) * (ZOMBIE_RADIUS + PLAYER_RADIUS)) {
                    playerHp = Math.max(0, playerHp - ZOMBIE_DPS * dt);
                    timeSinceDamage = 0;
                    if (playerHp === 0) playerDead = true;
                }
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
    if (playerDead) return;
    const minDistSq = (ZOMBIE_RADIUS + PLAYER_RADIUS) * (ZOMBIE_RADIUS + PLAYER_RADIUS);
    for (const z of remoteZombies) {
        if (z.state !== 'hunting') continue;
        const dx = z.x - player.x, dy = z.y - player.y;
        if (dx * dx + dy * dy < minDistSq) {
            playerHp = Math.max(0, playerHp - ZOMBIE_DPS * dt);
            timeSinceDamage = 0;
            if (playerHp === 0) playerDead = true;
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

function drawWorldBorder() {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, WORLD_W - 6, WORLD_H - 6);
}

function drawFurniture() {
    ctx.save();

    // ── barrels ──────────────────────────────────────────────────────────────
    for (const rect of [...FURNITURE.barrels, ...FURNITURE.extraBarrels]) {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r  = rect.w / 2;

        // body
        ctx.fillStyle = '#3d2b0e';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // metal bands
        ctx.strokeStyle = '#6a6a6a';
        ctx.lineWidth = 2.5;
        for (const oy of [-r * 0.38, r * 0.38]) {
            const hw = Math.sqrt(Math.max(0, r * r - oy * oy));
            ctx.beginPath();
            ctx.moveTo(cx - hw, cy + oy);
            ctx.lineTo(cx + hw, cy + oy);
            ctx.stroke();
        }

        // top vent / rim
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6a6a6a';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // subtle highlight
        ctx.fillStyle = 'rgba(255,200,80,0.10)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.28, cy - r * 0.28, r * 0.38, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── toppled bookcase ─────────────────────────────────────────────────────
    {
        const r = FURNITURE.bookcase;

        // wood back panel
        ctx.fillStyle = '#4a2e10';
        ctx.fillRect(r.x, r.y, r.w, r.h);

        // book spines — colourful vertical strips
        const spineColors = ['#8b1a1a','#1a5c8b','#2a7a3a','#7a6a10','#5a1a8b','#8b4010','#1a7a6a'];
        const spineW = 12;
        const margin = 4;
        let sx = r.x + margin;
        let ci = 0;
        while (sx + spineW <= r.x + r.w - margin) {
            ctx.fillStyle = spineColors[ci % spineColors.length];
            ctx.fillRect(sx, r.y + 3, spineW - 2, r.h - 6);
            // thin dark gap between spines
            ctx.fillStyle = '#111';
            ctx.fillRect(sx + spineW - 2, r.y + 3, 2, r.h - 6);
            sx += spineW;
            ci++;
        }

        // wood frame outline
        ctx.strokeStyle = '#2a1a08';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        // top-edge highlight (suggests the front edge of the case)
        ctx.strokeStyle = 'rgba(255,200,120,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x + 1, r.y + 1);
        ctx.lineTo(r.x + r.w - 1, r.y + 1);
        ctx.stroke();
    }

    ctx.restore();
}

function drawBuilding() {
    const b = BUILDING;
    const t = b.wallThickness;

    // interior floor — slightly lighter than the outside world
    ctx.fillStyle = '#252525';
    ctx.fillRect(b.x + t, b.y + t, b.w - t * 2, b.h - t * 2);

    // solid wall rects (furniture drawn separately)
    ctx.fillStyle = '#2a2a2a';
    for (const wall of walls) {
        if (wall.isFurniture) continue;
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    }
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    for (const wall of walls) {
        if (wall.isFurniture) continue;
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
            const thickness = 6;
            const plankDefs = win.plankDefs;

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

// draws a character — weaponId is the WEAPON_DEFS id (0=pistol, 1=shotgun, 2=raygun, 3=machinegun)
function drawCharacter(x, y, angle, bodyColor, weaponId) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // weapon model — drawn first so it sits behind the body
    WEAPON_DEFS[weaponId]?.drawModel();

    // body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // arm — always shown
    ctx.fillStyle = '#c8906a';
    ctx.beginPath();
    ctx.ellipse(7, 9, 4, 2.5, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // head
    ctx.fillStyle = '#c8906a';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawPlayerName(x, y, name, color) {
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const tw = ctx.measureText(name).width;
    ctx.fillRect(x - tw / 2 - 3, y - 26, tw + 6, 13);
    ctx.fillStyle = color;
    ctx.fillText(name, x, y - 14);
    ctx.restore();
}

function drawDeadCharacter(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2); ctx.fill(); // body
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); // head
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#cc2020'; ctx.lineWidth = 1.5;
    for (const [ox, oy] of [[-2.5, -1.5], [2.5, -1.5]]) {
        ctx.beginPath(); ctx.moveTo(ox - 1.5, oy - 1.5); ctx.lineTo(ox + 1.5, oy + 1.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox + 1.5, oy - 1.5); ctx.lineTo(ox - 1.5, oy + 1.5); ctx.stroke();
    }
    ctx.restore();
}

function drawPlayer() {
    if (playerDead) {
        drawDeadCharacter(player.x, player.y);
        drawPlayerName(player.x, player.y, localPlayerName, '#cc2020');
        return;
    }
    drawCharacter(player.x, player.y, player.angle, '#3a3a3a', inventory[currentWeapon]);
    drawPlayerName(player.x, player.y, localPlayerName, '#ddd');
}

function drawRemotePlayer() {
    if (!remotePeer) return;
    if (remotePeer.dead) {
        drawDeadCharacter(remotePeer.x, remotePeer.y);
        drawPlayerName(remotePeer.x, remotePeer.y, remotePeer.name ?? 'Player', '#cc2020');
        return;
    }
    drawCharacter(remotePeer.x, remotePeer.y, remotePeer.angle, '#8b2020', remotePeer.weaponId ?? 0);
    drawPlayerName(remotePeer.x, remotePeer.y, remotePeer.name ?? 'Player', '#e07070');
}

function drawBullets() {
    for (const b of [...bullets, ...remoteBullets]) {
        b.draw();
    }
}

function drawParticles() {
    for (const p of particles) p.draw();
}

// ─── weapon pickup (world-space) ─────────────────────────────────────────────

function drawWeaponPickup() {
    // ── shotgun (top wall) ──
    {
        const sp = SHOTGUN_PICKUP;
        const owned = inventory.includes(1);
        ctx.fillStyle = '#3a3020';
        ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
        ctx.strokeStyle = '#a08030';
        ctx.lineWidth = 1;
        ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);
        const cx = sp.x + sp.w / 2, cy = sp.y + sp.h / 2;
        ctx.save();
        ctx.globalAlpha = owned ? 0.35 : 1.0;
        ctx.translate(cx, cy);
        ctx.fillStyle = '#c8a84b';
        ctx.fillRect(-14, -2, 8, 5);
        ctx.fillRect(-6, -3, 7, 6);
        ctx.fillRect(1, -4, 13, 3);
        ctx.fillRect(1,  0, 13, 3);
        ctx.restore();
        if (!owned && shotgunBuyProgress > 0) {
            ctx.fillStyle = '#333';
            ctx.fillRect(sp.x, sp.y + sp.h - 3, sp.w, 3);
            ctx.fillStyle = '#c8a84b';
            ctx.fillRect(sp.x, sp.y + sp.h - 3, sp.w * shotgunBuyProgress, 3);
        }
    }

    // ── uzi (left wall) ──
    {
        const up = UZI_PICKUP;
        const owned = inventory.includes(4);
        ctx.fillStyle = '#20303a';
        ctx.fillRect(up.x, up.y, up.w, up.h);
        ctx.strokeStyle = '#4090c0';
        ctx.lineWidth = 1;
        ctx.strokeRect(up.x, up.y, up.w, up.h);
        // icon rotated 90° to fit on the vertical wall
        const cx = up.x + up.w / 2, cy = up.y + up.h / 2;
        ctx.save();
        ctx.globalAlpha = owned ? 0.35 : 1.0;
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 2); // rotate to align with wall orientation
        ctx.fillStyle = '#aac8e0';
        ctx.fillRect(-13, -3, 13, 7); // receiver
        ctx.fillRect(0, -2, 7, 5);    // barrel
        ctx.fillRect(-13, -5, 20, 2); // top rail
        ctx.fillStyle = '#778899';
        ctx.fillRect(-9, 4, 5, 7);    // grip
        ctx.fillRect(-8, 3, 4, 5);    // box mag
        ctx.restore();
        if (!owned && uziBuyProgress > 0) {
            ctx.fillStyle = '#333';
            ctx.fillRect(up.x + up.w - 3, up.y, 3, up.h);
            ctx.fillStyle = '#4090c0';
            ctx.fillRect(up.x + up.w - 3, up.y, 3, up.h * uziBuyProgress);
        }
    }
}

function drawHudPrompt(text) {
    const sx = canvas.width / 2;
    const sy = canvas.height / 2 - 60;
    ctx.save();
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx - tw / 2 - 10, sy - 16, tw + 20, 24);
    ctx.fillStyle = '#e8d080';
    ctx.fillText(text, sx, sy);
    ctx.restore();
}

function drawBarricadePrompt() {
    // extra room door prompt
    if (!extraRoomUnlocked) {
        const db  = DOOR_BARRIER;
        const dcx = db.x + db.w / 2, dcy = db.y + db.h / 2;
        if (Math.hypot(player.x - dcx, player.y - dcy) < BARRICADE_RANGE) {
            const canAfford = money >= DOOR_COST;
            const label = canAfford
                ? `[F] Unlock Room  £${DOOR_COST}`
                : `Unlock Room  £${DOOR_COST}  (need £${DOOR_COST - money} more)`;
            drawHudPrompt(label);
            return;
        }
    }

    // mystery box prompt
    if (!mysteryBoxOpened) {
        const mb  = MYSTERY_BOX;
        const mcx = mb.x + mb.w / 2, mcy = mb.y + mb.h / 2;
        if (Math.hypot(player.x - mcx, player.y - mcy) < BARRICADE_RANGE) {
            const canAfford = money >= mb.cost;
            const label = canAfford
                ? `[F] Mystery Box  £${mb.cost}`
                : `Mystery Box  £${mb.cost}  (need £${mb.cost - money} more)`;
            drawHudPrompt(label);
            return;
        }
    }

    // shotgun buy prompt
    {
        const sp  = SHOTGUN_PICKUP;
        const scx = sp.x + sp.w / 2, scy = sp.y + sp.h / 2;
        if (Math.hypot(player.x - scx, player.y - scy) < BARRICADE_RANGE && !inventory.includes(1)) {
            const canAfford = money >= WEAPON_DEFS[1].cost;
            drawHudPrompt(canAfford
                ? `[F] Buy Shotgun  £${WEAPON_DEFS[1].cost}`
                : `Shotgun  £${WEAPON_DEFS[1].cost}  (need £${WEAPON_DEFS[1].cost - money} more)`);
            return;
        }
    }

    // uzi buy prompt
    {
        const up  = UZI_PICKUP;
        const ucx = up.x + up.w / 2, ucy = up.y + up.h / 2;
        if (Math.hypot(player.x - ucx, player.y - ucy) < BARRICADE_RANGE && !inventory.includes(4)) {
            const canAfford = money >= WEAPON_DEFS[4].cost;
            drawHudPrompt(canAfford
                ? `[F] Buy Uzi  £${WEAPON_DEFS[4].cost}`
                : `Uzi  £${WEAPON_DEFS[4].cost}  (need £${WEAPON_DEFS[4].cost - money} more)`);
            return;
        }
    }

    for (const win of windows) {
        if (win.planks >= 3) continue;
        const cx = win.x + win.w / 2;
        const cy = win.y + win.h / 2;
        const dist = Math.hypot(player.x - cx, player.y - cy);
        if (dist > BARRICADE_RANGE) continue;
        drawHudPrompt('[F] Barricade');
        break;
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

        // weapon icon — delegated to each weapon's drawIcon method
        const wid = inventory[i];
        WEAPON_DEFS[wid]?.drawIcon(x + slotSize / 2, y + slotSize / 2 + 2);
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

    const wDef = curWeaponDef();
    if (reloading) {
        const progress = 1 - reloadTimer / wDef.reloadTime;
        ctx.fillStyle = '#555';
        ctx.fillText('RELOADING', ax, ay - 6);
        ctx.fillStyle = '#333';
        ctx.fillRect(ax, ay + 2, 80, 6);
        ctx.fillStyle = '#cc2020';
        ctx.fillRect(ax, ay + 2, 80 * progress, 6);
    } else {
        const reserve  = reserveAmmo[currentWeapon];
        const lowAmmo  = magAmmo <= Math.ceil(wDef.magSize / 4);
        const noReserve = reserve === 0 && magAmmo === 0;
        const color = noReserve ? '#cc2020' : lowAmmo ? '#e08020' : '#ccc';
        const reserveStr = reserve === Infinity ? '∞' : `${reserve}`;
        ctx.fillStyle = color;
        ctx.fillText(`${magAmmo}`, ax, ay + 6);
        ctx.font = '17px monospace';
        ctx.fillStyle = '#666';
        ctx.fillText(` / ${reserveStr}`, ax + ctx.measureText(`${magAmmo}`).width + 2, ay + 6);
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

    ctx.font      = '11px monospace';
    ctx.textAlign = 'left';

    if (playerDead) {
        ctx.fillStyle = '#cc2020';
        ctx.fillText('DEAD', bx, by - 4);
        ctx.fillStyle = '#1a0000';
        ctx.fillRect(bx, by, barW, barH);
        ctx.strokeStyle = '#cc2020';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, barW, barH);
        ctx.fillStyle = '#cc2020';
        ctx.fillText('reviving next wave', bx + barW + 8, by + barH - 1);
        return;
    }

    const pct = playerHp / PLAYER_MAX_HP;

    ctx.fillStyle = '#888';
    ctx.fillText('HEALTH', bx, by - 4);

    ctx.fillStyle = '#222';
    ctx.fillRect(bx, by, barW, barH);

    const r = Math.round(200 - pct * 110);
    const g = Math.round(pct * 160);
    ctx.fillStyle = `rgb(${r},${g},30)`;
    ctx.fillRect(bx, by, barW * pct, barH);

    ctx.strokeStyle = '#444';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx, by, barW, barH);

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

function drawMysteryBoxResult() {
    if (!mysteryBoxResult) return;
    const t = mysteryBoxResult.timer / 2.5; // 1→0 as it fades
    const alpha = Math.min(1, t * 4); // quick fade in, slow fade out
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 32px monospace';
    ctx.fillStyle = mysteryBoxResult.color;
    ctx.shadowColor = mysteryBoxResult.color;
    ctx.shadowBlur = 18;
    ctx.fillText(mysteryBoxResult.text, canvas.width / 2, canvas.height / 2 - 60);
    ctx.restore();
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
    updateGroundMarks(dt);
    updateAmmoDrops(dt);
    updateBarricadeRepair(dt);
    updateWeaponPickup(dt);
    updateMysteryBox(dt);
    updateExtraRoomDoor(dt);
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
    drawExtraRoom();
    drawFurniture();
    drawGroundMarks();
    drawMysteryBox();
    drawWeaponPickup();
    drawAmmoDrops();
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
    drawMysteryBoxResult();

    requestAnimationFrame(gameLoop);
}

// game loop starts only once the peer connection opens
