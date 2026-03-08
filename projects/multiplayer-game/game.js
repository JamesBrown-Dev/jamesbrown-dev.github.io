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
const isMobile = ('ontouchstart' in window) && navigator.maxTouchPoints > 0;
const JOY_RADIUS = 60;
let mobileMove = { x: 0, y: 0 };
let leftTouch  = null; // { id, baseX, baseY, curX, curY }
let rightTouch = null;
let fTouchId   = null;
const PLAYER_RADIUS = 14;
const BULLET_LIFE   = 2.0; // seconds before expiring
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
        // muzzle position in player-local space (where flash/bullet spawns)
        this.muzzleX = opts.muzzleX ?? 18;
        this.muzzleY = opts.muzzleY ?? 9.5;
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
        autoFire: true, pellets: 1, spread: 0, cost: 0, bulletSpeed: 750, aoeRadius: 0, reserve: Infinity,
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
        autoFire: true, pellets: 12, spread: 0.28, cost: 200, bulletSpeed: 750, aoeRadius: 0, reserve: 16,
        muzzleX: 22, muzzleY: 10,
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
        autoFire: true, pellets: 1, spread: 0, cost: 0, bulletSpeed: 900, aoeRadius: 80, reserve: 36,
        muzzleX: 22, muzzleY: 11,
        bulletRadius: 4, bulletColor: '#80ffaa', bulletGlowing: true, bulletGlowColor: '#40ff60',
        drawModel() {
            ctx.fillStyle = '#3a2060'; ctx.fillRect(0, 7, 8, 7);   // grip
            ctx.fillStyle = '#7050cc'; ctx.fillRect(8, 8, 10, 6);  // barrel
            ctx.save();
            const raySlot = inventory.indexOf(2);
            const rayAmmo = raySlot !== -1 ? (raySlot === currentWeapon ? magAmmo : savedAmmo[raySlot]) : 0;
            if (rayAmmo > 0) {
                const t = performance.now() / 1000;
                const pulse = 0.92 + 0.15 * Math.sin(t * 5);
                // pulsing tip orb
                ctx.shadowColor = '#40ff60';
                ctx.shadowBlur = 12 * pulse;
                ctx.fillStyle = '#80ffcc';
                ctx.globalAlpha = pulse;
                ctx.beginPath(); ctx.arc(19, 11, 2.5 * pulse, 0, Math.PI * 2); ctx.fill();
                // orbiting energy sparks
                ctx.shadowBlur = 6;
                for (let i = 0; i < 3; i++) {
                    const a = t * 3 + i * (Math.PI * 2 / 3);
                    const r = 4 + Math.sin(t * 4 + i) * 1.2;
                    ctx.globalAlpha = 0.4 + 0.45 * Math.sin(t * 5 + i * 1.8);
                    ctx.fillStyle = i === 1 ? '#a0ffc0' : '#40ff80';
                    ctx.beginPath(); ctx.arc(19 + Math.cos(a) * r, 11 + Math.sin(a) * r, 1, 0, Math.PI * 2); ctx.fill();
                }
            }
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
        pellets: 1, spread: 0.06, cost: 0, bulletSpeed: 750, aoeRadius: 0, reserve: 90,
        autoFire: true, bulletRadius: 2, bulletColor: '#f5e642',
        muzzleX: 32, muzzleY: 10,
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
    new WeaponDef({
        id: 5, name: 'railgun', magSize: 4, reloadTime: 2.8, cooldown: 1.0,
        autoFire: true, pellets: 1, spread: 0, cost: 0, bulletSpeed: 2000, aoeRadius: 0, reserve: 12,
        muzzleX: 32, muzzleY: 10,
        bulletRadius: 3, bulletColor: '#a0d8ff', bulletGlowing: true, bulletGlowColor: '#0060ff',
        drawModel() {
            // grip
            ctx.fillStyle = '#1a1a2e'; ctx.fillRect(-5, 7, 6, 7);
            ctx.fillStyle = '#111';    ctx.fillRect(-5, 8, 2, 7);    // grip detail
            // receiver body
            ctx.fillStyle = '#162040'; ctx.fillRect(1, 6, 10, 8);
            // energy core glow
            ctx.save();
            ctx.shadowColor = '#0080ff'; ctx.shadowBlur = 10;
            ctx.fillStyle = '#60b0ff';
            ctx.beginPath(); ctx.arc(7, 10, 3, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            // top and bottom rails
            ctx.fillStyle = '#304070';
            ctx.fillRect(11, 5, 19, 3);   // top rail
            ctx.fillRect(11, 12, 19, 3);  // bottom rail
            // barrel between rails
            ctx.fillStyle = '#1a2a50'; ctx.fillRect(11, 8, 19, 4);
            // muzzle tip glow
            ctx.save();
            ctx.shadowColor = '#0060ff'; ctx.shadowBlur = 8;
            ctx.fillStyle = '#c0e8ff';
            ctx.fillRect(30, 8, 2, 4);
            ctx.restore();
            // charge sparks between the rails
            const charge = (inventory[currentWeapon] === 5)
                ? Math.max(0, 1 - weaponCooldown / 1.0)
                : 1;
            if (charge > 0.02 && magAmmo > 0) {
                const t = performance.now() * 0.001;
                ctx.save();
                ctx.shadowColor = '#60b8ff';
                ctx.shadowBlur  = 4;
                ctx.lineWidth   = 0.8;
                for (let i = 0; i < 4; i++) {
                    const frac = (i + 0.5) / 4;
                    if (frac > charge) continue; // only show arcs that have charged up
                    const xc      = 13 + frac * 14;
                    const flicker = 0.4 + 0.6 * Math.abs(Math.sin(t * 14 + i * 2.4));
                    ctx.globalAlpha = charge * flicker;
                    ctx.strokeStyle = i % 2 === 0 ? '#80c8ff' : '#c0e8ff';
                    const off = Math.sin(t * 10 + i * 1.9) * 1.5;
                    ctx.beginPath();
                    ctx.moveTo(xc,       8);  // top rail inner edge
                    ctx.lineTo(xc + off, 10); // midpoint with zigzag
                    ctx.lineTo(xc - off, 12); // bottom rail inner edge
                    ctx.stroke();
                }
                // muzzle tip pulses when fully charged
                if (charge >= 1) {
                    const pulse = 0.6 + 0.4 * Math.sin(t * 8);
                    ctx.globalAlpha = pulse;
                    ctx.shadowBlur  = 10;
                    ctx.fillStyle   = '#ffffff';
                    ctx.beginPath(); ctx.arc(31, 10, 1.5, 0, Math.PI * 2); ctx.fill();
                }
                ctx.restore();
            }
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            // grip
            ctx.fillStyle = '#1a1a2e'; ctx.fillRect(-16, 0, 5, 6);
            // receiver
            ctx.fillStyle = '#162040'; ctx.fillRect(-11, -2, 10, 8);
            // energy core
            ctx.save();
            ctx.shadowColor = '#0080ff'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#60b0ff';
            ctx.beginPath(); ctx.arc(-5, 2, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            // rails
            ctx.fillStyle = '#304070';
            ctx.fillRect(-1, -4, 19, 2);  // top rail
            ctx.fillRect(-1,  4, 19, 2);  // bottom rail
            // barrel
            ctx.fillStyle = '#1a2a50'; ctx.fillRect(-1, -2, 19, 4);
            // muzzle glow
            ctx.save();
            ctx.shadowColor = '#0060ff'; ctx.shadowBlur = 5;
            ctx.fillStyle = '#c0e8ff';
            ctx.beginPath(); ctx.arc(18, 0, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            ctx.restore();
        },
    }),
    new WeaponDef({
        id: 6, name: 'deagle', magSize: 7, reloadTime: 1.8, cooldown: 0.45,
        autoFire: true, pellets: 1, spread: 0.02, cost: 300, bulletSpeed: 1100, aoeRadius: 0, reserve: 28,
        muzzleX: 22, muzzleY: 9,
        bulletRadius: 3, bulletColor: '#f5e642',
        drawModel() {
            ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-3, 8, 6, 6);   // grip
            ctx.fillStyle = '#222';    ctx.fillRect(-2, 9, 2, 5);   // grip detail
            ctx.fillStyle = '#909090'; ctx.fillRect(3,  6, 10, 7);  // frame
            ctx.fillStyle = '#c0c0c0'; ctx.fillRect(3,  6, 10, 2);  // slide
            ctx.fillStyle = '#808080'; ctx.fillRect(13, 7,  9, 5);  // barrel
            ctx.fillStyle = '#aaaaaa'; ctx.fillRect(13, 7,  1, 5);  // barrel seam
            ctx.fillStyle = '#555';    ctx.fillRect(3, 11,  4, 2);  // trigger guard
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-12, 1,  6, 6); // grip
            ctx.fillStyle = '#222';    ctx.fillRect(-11, 2,  2, 5); // grip detail
            ctx.fillStyle = '#909090'; ctx.fillRect(-6, -2, 10, 7); // frame
            ctx.fillStyle = '#c0c0c0'; ctx.fillRect(-6, -2, 10, 2); // slide
            ctx.fillStyle = '#808080'; ctx.fillRect(4,  -1,  9, 5); // barrel
            ctx.restore();
        },
    }),
    new WeaponDef({
        id: 7, name: 'blaster', magSize: 15, reloadTime: 1.6, cooldown: 0.22,
        autoFire: true, pellets: 1, spread: 0, cost: 350, bulletSpeed: 1100, aoeRadius: 0, reserve: 45,
        muzzleX: 22, muzzleY: 9,
        bulletRadius: 3, bulletColor: '#ff3030', bulletGlowing: true, bulletGlowColor: '#ff0000',
        drawModel() {
            // grip
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-2, 8, 5, 7);
            ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-1, 9, 2, 5);   // grip texture
            // body
            ctx.fillStyle = '#3a3a4a'; ctx.fillRect(3, 6, 9, 8);
            // power cell glow
            ctx.save();
            ctx.shadowColor = '#ff2020'; ctx.shadowBlur = 8;
            ctx.fillStyle = '#ff4444';
            ctx.beginPath(); ctx.arc(7, 10, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            // barrel
            ctx.fillStyle = '#555'; ctx.fillRect(12, 7, 10, 5);
            ctx.fillStyle = '#222'; ctx.fillRect(12, 8, 10, 1);     // barrel seam
            // muzzle
            ctx.save();
            ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#ff6060';
            ctx.fillRect(22, 7.5, 2, 4);
            ctx.restore();
        },
        drawIcon(cx, cy) {
            ctx.save(); ctx.translate(cx, cy);
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-13, 1, 5, 7);   // grip
            ctx.fillStyle = '#3a3a4a'; ctx.fillRect(-8, -2, 9, 8);   // body
            ctx.save();
            ctx.shadowColor = '#ff2020'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#ff4444';
            ctx.beginPath(); ctx.arc(-3, 2, 2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#555'; ctx.fillRect(1, -1, 12, 5);      // barrel
            ctx.save();
            ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 5;
            ctx.fillStyle = '#ff6060';
            ctx.beginPath(); ctx.arc(14, 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            ctx.restore();
        },
    }),
];
const RAYGUN_AOE_DAMAGE = 5;

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
        this.startX     = x;
        this.startY     = y;
        this.age        = 0;
        this.isCrit     = weaponId === 6 && Math.random() < 0.25; // deagle 25% crit
        this.pierceLeft = weaponId === 5 ? Infinity : 0;
    }

    update(dt) {
        this.x    += this.vx * dt;
        this.y    += this.vy * dt;
        this.life -= dt;
        this.age  += dt;
    }

    get alive() {
        return this.life > 0 &&
               this.x >= 0 && this.x <= WORLD_W &&
               this.y >= 0 && this.y <= WORLD_H;
    }

    draw() {
        if (this.weaponId === 5) {
            // ── railgun spiral beam ──
            const fadeAlpha = Math.max(0, 1 - this.age / 0.22);
            if (fadeAlpha > 0) {
                const dx = this.x - this.startX;
                const dy = this.y - this.startY;
                const len = Math.hypot(dx, dy);
                if (len > 1) {
                    const nx = dx / len, ny = dy / len; // beam direction
                    const px = -ny,      py = nx;       // perpendicular
                    ctx.save();
                    ctx.globalAlpha = fadeAlpha;

                    // outer glow beam
                    ctx.shadowColor = '#0040ff';
                    ctx.shadowBlur  = 16;
                    ctx.strokeStyle = '#4090ff';
                    ctx.lineWidth   = 5;
                    ctx.beginPath();
                    ctx.moveTo(this.startX, this.startY);
                    ctx.lineTo(this.x, this.y);
                    ctx.stroke();

                    // inner bright core
                    ctx.shadowBlur  = 6;
                    ctx.strokeStyle = '#e0f4ff';
                    ctx.lineWidth   = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(this.startX, this.startY);
                    ctx.lineTo(this.x, this.y);
                    ctx.stroke();

                    // double helix — two sine waves 180° out of phase
                    const freq  = 0.07; // cycles per pixel
                    const amp   = 7;    // perpendicular amplitude
                    const steps = Math.min(Math.ceil(len / 5), 90);
                    for (let side = 0; side < 2; side++) {
                        ctx.strokeStyle = side === 0 ? '#60b8ff' : '#b0d8ff';
                        ctx.lineWidth   = 1.2;
                        ctx.shadowBlur  = 6;
                        ctx.beginPath();
                        for (let k = 0; k <= steps; k++) {
                            const t   = k / steps;
                            const d   = t * len;
                            const off = Math.sin(d * freq * Math.PI * 2 + side * Math.PI) * amp;
                            const wx  = this.startX + nx * d + px * off;
                            const wy  = this.startY + ny * d + py * off;
                            if (k === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
                        }
                        ctx.stroke();
                    }
                    ctx.restore();
                }
            }
            // slug — elongated streak in the direction of travel
            const spd = Math.hypot(this.vx, this.vy) || 1;
            const nx  = this.vx / spd, ny = this.vy / spd;
            ctx.save();
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur  = 6;
            ctx.strokeStyle = '#e0f4ff';
            ctx.lineWidth   = 2.5;
            ctx.beginPath();
            ctx.moveTo(this.x - nx * 6, this.y - ny * 6);
            ctx.lineTo(this.x + nx * 3, this.y + ny * 3);
            ctx.stroke();
            ctx.restore();
            return;
        }


        if (this.weaponId === 7) {
            // ── Star Wars blaster bolt — elongated red capsule ──
            const spd = Math.hypot(this.vx, this.vy) || 1;
            const nx = this.vx / spd, ny = this.vy / spd;
            ctx.save();
            // outer glow
            ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 14;
            ctx.strokeStyle = '#cc0000'; ctx.lineWidth = 5; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(this.x - nx * 10, this.y - ny * 10);
            ctx.lineTo(this.x + nx * 6,  this.y + ny * 6);
            ctx.stroke();
            // bright core
            ctx.shadowBlur = 4;
            ctx.strokeStyle = '#ffaaaa'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(this.x - nx * 9, this.y - ny * 9);
            ctx.lineTo(this.x + nx * 5, this.y + ny * 5);
            ctx.stroke();
            ctx.restore();
            return;
        }

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
let inventory      = [0, 7, -1];                          // WEAPON_DEFS id per slot; -1 = empty
let savedAmmo      = [WEAPON_DEFS[0].magSize, WEAPON_DEFS[7].magSize, 0];
let reserveAmmo    = [Infinity, WEAPON_DEFS[7].reserve, 0];                    // reserve (spare) ammo per slot
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
const critTexts     = []; // floating CRIT! indicators
const plankDebris   = []; // broken barricade pieces
const groundMarks   = []; // blood smears and scorch marks
const ammoDrops     = []; // max ammo power-up drops
let   nextDropId    = 0;

// holds the last state received from the other player
let remotePeer = null;

// muzzle flash state — { x, y, angle, timer, weaponId } or null
let muzzleFlash       = null;
let remoteMuzzleFlash = null;

let localPlayerName = 'Player';

let money = 5000; // currency — to be used for future upgrades/purchases

// ─── player health ────────────────────────────────────────────────────────────

const PLAYER_MAX_HP = 100;
let playerHp        = PLAYER_MAX_HP;
let playerDead      = false;
let allDeadTimer    = 0;   // counts up once all players are dead
let allDeadShowing  = false;
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
        this.maxHp        = this.hp;
        this.speed        = ZOMBIE_WAVE_SPEED(wave);
        this.attackTimer  = 0;
        this.waypoints    = []; // pre-computed path waypoints (approach + optional corners)
        this.huntTimer    = 0;  // countdown to next hunt-path refresh
        this.huntWaypoints = []; // routing waypoints while hunting
        this.id           = nextZombieId++;
        this.angle        = 0;
        this.kbVx         = 0;  // knockback velocity x
        this.kbVy         = 0;  // knockback velocity y
        this.isBoss       = false;
        this.radius       = ZOMBIE_RADIUS;
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

// Turret mounted on the exterior bottom-left corner of the building, barrel poking outward
const TURRET = (() => {
    const b = BUILDING;
    return { x: b.x - 10, y: b.y + b.h + 10, range: 550, fireRate: 0.3 };
})();

// ─── extension room (above the main building top wall) ────────────────────────
const EXTENSION = (() => {
    const b = BUILDING, t = b.wallThickness;
    const cx = b.x + b.w / 2;
    const intH    = 90;    // interior height
    const outerL  = b.x;                   // flush with main building left wall
    const outerR  = cx + 154;              // right side unchanged
    const outerTop = b.y - intH - t;
    const intW    = outerR - outerL - 2 * t;
    const ent1L = b.x + t + 55;           // left entrance left x
    const ent1R = b.x + t + 115;          // left entrance right x (60px wide)
    const ent2L = cx + 40;   // right entrance left x
    const ent2R = cx + 100;  // right entrance right x
    return { cx, t, intW, intH, outerL, outerR, outerTop, ent1L, ent1R, ent2L, ent2R };
})();

// ─── extra room (below the main building) ────────────────────────────────────
const DOOR_GAP      = 70;   // width of the door opening in the bottom wall
const DOOR_COST     = 250;
const GEN_ROOM_COST = 500;

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

// ─── side room (pocket between main building bottom and extra room top-left) ──
// It occupies the void between endRoomL, the corridor left outer wall, the main
// building bottom, and the extra room top-left wall segment.
const SIDE_ROOM = (() => {
    const b = BUILDING, t = b.wallThickness;
    const { doorCX, endRoomL, CORRIDOR_H } = EXTRA_ROOM;
    const corridorLX  = doorCX - DOOR_GAP / 2 - t; // left face of corridor left outer-wall
    const SIDE_DOOR_W = 80;                           // door gap width in the bottom wall
    const doorX       = endRoomL + t;                // door left x (right of corner cap)
    const winY        = b.y + b.h + CORRIDOR_H / 2 - WINDOW_GAP / 2; // window centred vertically
    return { doorX, SIDE_DOOR_W, winY, corridorLX };
})();

// Barrier rect that physically seals the side-room doorway until unlocked
const SIDE_ROOM_BARRIER = (() => {
    const t = BUILDING.wallThickness;
    return {
        x: SIDE_ROOM.doorX,
        y: EXTRA_ROOM.endRoomTopY,
        w: SIDE_ROOM.SIDE_DOOR_W,
        h: t,
    };
})();

// One window centred on each wall side
const windows = (() => {
    const b = BUILDING;
    const t = b.wallThickness;
    const cy = b.y + b.h / 2;
    return [
        new GameWindow(EXTENSION.outerR + 60 - WINDOW_GAP / 2, b.y, WINDOW_GAP, t, 'top'),
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

// Carve extension entrance gaps into the main building top wall.
// buildWalls() created a large left-of-window segment spanning the extension area;
// replace it with segments split around the two entrance openings.
(() => {
    const b = BUILDING, t = b.wallThickness;
    const e = EXTENSION;
    const topWinX = windows[0].x;
    const idx = walls.findIndex(w =>
        Math.abs(w.y - b.y) < 1 &&   // main building top wall
        Math.abs(w.x - b.x) < 1 &&   // starts at left edge
        w.x + w.w > e.ent1L           // wide enough to cover the extension area
    );
    if (idx !== -1) {
        walls.splice(idx, 1,
            { x: b.x,    y: b.y, w: e.ent1L - b.x,          h: t }, // left of entrance 1
            { x: e.ent1R, y: b.y, w: e.ent2L - e.ent1R,     h: t }, // center solid
            { x: e.ent2R, y: b.y, w: topWinX - e.ent2R,     h: t }, // right of entrance 2 to window
        );
    }
})();

// Extension outer walls
// Door gap centred in the extension top wall
const SLIDING_DOOR_W = 80;
const SLIDING_DOOR_X = (EXTENSION.outerL + EXTENSION.outerR) / 2 - SLIDING_DOOR_W / 2;
const SLIDING_DOOR_Y = EXTENSION.outerTop;

(() => {
    const e = EXTENSION, t = e.t;
    const dL = SLIDING_DOOR_X, dR = SLIDING_DOOR_X + SLIDING_DOOR_W;
    walls.push(
        { x: e.outerL,     y: e.outerTop, w: t,          h: e.intH + t }, // left outer wall
        { x: e.outerR - t, y: e.outerTop, w: t,          h: e.intH + t }, // right outer wall
        // top wall split around door gap
        { x: e.outerL, y: e.outerTop, w: dL - e.outerL,           h: t }, // top-left of door
        { x: dR,       y: e.outerTop, w: e.outerR - dR,           h: t }, // top-right of door
    );
})();

// Barrier sealing the door gap — removed from walls when power turns on
const SLIDING_DOOR_BARRIER = {
    x: SLIDING_DOOR_X, y: SLIDING_DOOR_Y,
    w: SLIDING_DOOR_W, h: EXTENSION.t,
    isSlidingDoor: true,
};
walls.push(SLIDING_DOOR_BARRIER);

// ─── final room (above the extension, reached through the sliding door) ───────
const FINAL_ROOM = (() => {
    const e = EXTENSION, t = e.t;
    const intH    = 240;
    const outerTop = e.outerTop - intH - t;
    return {
        outerL: e.outerL, outerR: e.outerR,
        outerTop, outerBot: e.outerTop,
        t, intH, intW: e.intW,
    };
})();

const ESCAPE_CAR = (() => {
    const fr = FINAL_ROOM, t = fr.t;
    const cx = (fr.outerL + fr.outerR) / 2;
    return { x: cx - 65, y: fr.outerTop + t + 100, w: 130, h: 64, isFurniture: true };
})();

const GARAGE_DOOR_Y = ESCAPE_CAR.y - 8;
const GARAGE_DOOR_H = ESCAPE_CAR.h + 16;
const GARAGE_DOOR_BARRIER = {
    x: FINAL_ROOM.outerL, y: GARAGE_DOOR_Y,
    w: FINAL_ROOM.t,      h: GARAGE_DOOR_H,
    isGarageDoor: true,
};

const garageWindows = (() => {
    const fr = FINAL_ROOM, t = fr.t;
    const totalW = fr.outerR - fr.outerL;
    const win1X  = fr.outerL + totalW / 3       - WINDOW_GAP / 2;
    const win2X  = fr.outerL + totalW * 2 / 3   - WINDOW_GAP / 2;
    const winRY  = fr.outerTop + t + fr.intH / 2 - WINDOW_GAP / 2;
    return [
        new GameWindow(win1X,        fr.outerTop, WINDOW_GAP, t, 'top'),   // top-left window
        new GameWindow(win2X,        fr.outerTop, WINDOW_GAP, t, 'top'),   // top-right window
        new GameWindow(fr.outerR - t, winRY,      t, WINDOW_GAP, 'right'), // right window
    ];
})();

const garageWalls = (() => {
    const fr = FINAL_ROOM, t = fr.t;
    const [wT1, wT2, wR] = garageWindows;
    return [
        // top wall — 3 segments split around the 2 windows
        { x: fr.outerL,          y: fr.outerTop, w: wT1.x - fr.outerL,               h: t },
        { x: wT1.x + WINDOW_GAP, y: fr.outerTop, w: wT2.x - (wT1.x + WINDOW_GAP),   h: t },
        { x: wT2.x + WINDOW_GAP, y: fr.outerTop, w: fr.outerR - (wT2.x + WINDOW_GAP), h: t },
        // right wall — 2 segments split around the window
        { x: fr.outerR - t, y: fr.outerTop,           w: t, h: wR.y - fr.outerTop              },
        { x: fr.outerR - t, y: wR.y + WINDOW_GAP,     w: t, h: (fr.outerTop + fr.intH + t) - (wR.y + WINDOW_GAP) },
    ];
})();

(() => {
    const fr = FINAL_ROOM, t = fr.t;
    const gdT = GARAGE_DOOR_Y, gdB = GARAGE_DOOR_Y + GARAGE_DOOR_H;
    walls.push(
        // left wall split around garage door gap
        { x: fr.outerL, y: fr.outerTop, w: t, h: gdT - fr.outerTop }, // left-top
        { x: fr.outerL, y: gdB,         w: t, h: fr.outerBot - gdB }, // left-bottom
        ...garageWalls,
        ESCAPE_CAR,
        GARAGE_DOOR_BARRIER,
    );
})();

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

// ─── east wing: corridor going north then east from end room top wall ─────────
// Entry door replaces the left portion of the end room top-wall right segment.
const EAST_WING = (() => {
    const b  = BUILDING, t = b.wallThickness;
    const { buildingBottomY, endRoomTopY, endRoomR } = EXTRA_ROOM;
    const cR = EXTRA_ROOM.doorCX + DOOR_GAP / 2;
    const CW = 80; // inner corridor width

    // Vertical segment (alongside existing corridor, going north from end room)
    const vL   = cR + t;          // left inner  (shares existing corridor right outer wall)
    const vR   = vL + CW;         // right inner
    const vTop = buildingBottomY; // top inner   (building south face)
    const vBot = endRoomTopY;     // bottom inner (end room ceiling = entry door)

    // Horizontal segment (turns east at building-bottom level)
    const hTop = buildingBottomY;
    const hBot = buildingBottomY + CW;

    // New room inner bounds — centred on corridor mid-line
    const roomL = vR + 220;       // left inner  (end of horizontal corridor)
    const roomR = roomL + 300;    // right inner
    const roomT = hTop - 100;     // top inner
    const roomB = hBot + 100;     // bottom inner

    const walls = [
        // vertical corridor — right outer wall (only below the horizontal junction)
        { x: vR,         y: hBot,          w: t,  h: vBot - hBot                },
        // horizontal corridor — top outer wall (extends building bottom wall east)
        { x: b.x + b.w,  y: vTop - t,      w: roomL - t - (b.x + b.w), h: t   },
        // horizontal corridor — bottom outer wall (east of junction corner)
        { x: vR + t,     y: hBot,          w: roomL - t - (vR + t),     h: t   },
        // room — left wall above door gap
        { x: roomL - t,  y: roomT - t,     w: t,  h: hTop - (roomT - t)        },
        // room — left wall below door gap
        { x: roomL - t,  y: hBot,          w: t,  h: roomB + t - hBot          },
        // top / right / bottom walls are split around windows and added via genRoomWalls
    ];

    return { CW, t, vL, vR, vTop, vBot, hTop, hBot, roomL, roomR, roomT, roomB, walls };
})();

// Generator room windows — one on the top, right, and bottom walls
const genRoomWindows = (() => {
    const { roomL, roomR, roomT, roomB, t } = EAST_WING;
    const midX = (roomL + roomR) / 2;
    const midY = (roomT + roomB) / 2;
    return [
        new GameWindow(midX - WINDOW_GAP / 2, roomT - t, WINDOW_GAP, t, 'top'),
        new GameWindow(roomR,                  midY - WINDOW_GAP / 2, t, WINDOW_GAP, 'right'),
        new GameWindow(midX - WINDOW_GAP / 2, roomB,     WINDOW_GAP, t, 'bottom'),
    ];
})();

// Generator room outer walls split around the three windows
const genRoomWalls = (() => {
    const { roomL, roomR, roomT, roomB, t } = EAST_WING;
    const [winT, winR, winB] = genRoomWindows;
    return [
        // top wall — left of window
        { x: roomL - t, y: roomT - t, w: winT.x - (roomL - t),              h: t },
        // top wall — right of window
        { x: winT.x + winT.w, y: roomT - t, w: (roomR + t) - (winT.x + winT.w), h: t },
        // right wall — above window
        { x: roomR, y: roomT - t, w: t, h: winR.y - (roomT - t)             },
        // right wall — below window
        { x: roomR, y: winR.y + winR.h, w: t, h: (roomB + t) - (winR.y + winR.h) },
        // bottom wall — left of window
        { x: roomL - t, y: roomB, w: winB.x - (roomL - t),                  h: t },
        // bottom wall — right of window
        { x: winB.x + winB.w, y: roomB, w: (roomR + t) - (winB.x + winB.w), h: t },
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
        // top-left segment: corner cap + gap for side-room door + remainder
        { x: endRoomL,                                              y: endRoomTopY, w: t,                                                          h: t },
        { x: SIDE_ROOM.doorX + SIDE_ROOM.SIDE_DOOR_W,             y: endRoomTopY, w: (cL - t) - (SIDE_ROOM.doorX + SIDE_ROOM.SIDE_DOOR_W),       h: t },
        // right segment split: left portion is now the east-wing door gap
        { x: EAST_WING.vR, y: endRoomTopY, w: endRoomR - EAST_WING.vR, h: t },
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

// ─── side room walls and window ──────────────────────────────────────────────
const sideRoomWindow = (() => {
    const { endRoomL } = EXTRA_ROOM;
    return new GameWindow(endRoomL, SIDE_ROOM.winY, BUILDING.wallThickness, WINDOW_GAP, 'left');
})();
const sideRoomWalls = (() => {
    const b = BUILDING, t = b.wallThickness;
    const { endRoomL, endRoomTopY } = EXTRA_ROOM;
    const win = sideRoomWindow;
    const topY = b.y + b.h - t; // flush with main building bottom outer-wall top
    return [
        // left exterior wall — split around window
        { x: endRoomL, y: topY,               w: t, h: win.y - topY                       },
        { x: endRoomL, y: win.y + WINDOW_GAP, w: t, h: endRoomTopY - (win.y + WINDOW_GAP) },
    ];
})();
walls.push(...sideRoomWalls);
walls.push(SIDE_ROOM_BARRIER);
windows.push(sideRoomWindow);
walls.push(...EAST_WING.walls);
walls.push(...genRoomWalls);

// Barrier sealing the generator room entrance — removed when player pays £500
const GEN_ROOM_BARRIER = (() => {
    const { roomL, hTop, hBot, t } = EAST_WING;
    return { x: roomL - t, y: hTop, w: t, h: hBot - hTop };
})();
walls.push(GEN_ROOM_BARRIER);
windows.push(...genRoomWindows);
windows.push(...garageWindows);

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

// ─── generator room furniture & power switch ──────────────────────────────────
const GEN_ROOM = (() => {
    const { roomL, roomR, roomT, roomB, t } = EAST_WING;
    const cx = (roomL + roomR) / 2;
    const cy = (roomT + roomB) / 2;
    const S  = 22; // barrel collision size

    // Large generator body — central obstacle forces navigation around it
    const generator = { x: cx - 60, y: cy - 28, w: 120, h: 56, isFurniture: true };

    // Fuel barrel cluster — upper-left corner
    const fuelBarrels = [
        { x: roomL + 16, y: roomT + 22, w: S, h: S, isFurniture: true },
        { x: roomL + 40, y: roomT + 44, w: S, h: S, isFurniture: true },
        { x: roomL + 16, y: roomT + 48, w: S, h: S, isFurniture: true },
    ];

    // Workbench against top-right wall
    const workbench = { x: roomR - 80, y: roomT + t, w: 70, h: 22, isFurniture: true };

    // Power switch panel — mounted on right wall, upper area (not a collision rect)
    const powerSwitch = { x: roomR, y: roomT + 55, w: t, h: 32 };

    return { generator, fuelBarrels, workbench, powerSwitch, cx, cy };
})();
walls.push(GEN_ROOM.generator, ...GEN_ROOM.fuelBarrels, GEN_ROOM.workbench);

let powerOn        = false;
let powerLeverT    = 0;     // 0=off lever-down, 1=on lever-up (animated)
let fPrevHeld      = false; // edge-detect for power switch tap
let slidingDoorOpen = false;
let turretCooldown  = 0;
let turretAngle     = 0;    // current drawn barrel angle (smoothly rotated)
let turretTargetAngle = 0;  // desired barrel angle toward target

let carRepairStage    = 0;     // 0..5 (5 = fully repaired / won)
let carRepairProgress = 0;     // 0..1 within the current stage
let gameWon           = false;
let winPhase          = 0;     // 0=none 1=car animating out 2=message+countdown
let carAnimX          = 0;     // car visual X during win animation
let winMessageTimer   = 0;     // countdown after car exits before reload
let winLockedCamX     = 0;     // camera X locked when car exits
let winLockedCamY     = 0;

let extraRoomUnlocked = false;
let doorProgress      = 0; // 0..1 buy-progress
let sideRoomUnlocked  = false;
let sideRoomDoorProgress = 0; // 0..1 buy-progress
let genRoomUnlocked   = false;
let genRoomDoorProgress = 0; // 0..1 buy-progress

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
    const { doorX, SIDE_DOOR_W, corridorLX } = SIDE_ROOM;
    const e = EXTENSION;
    const ent1CX = (e.ent1L + e.ent1R) / 2;
    const ent2CX = (e.ent2L + e.ent2R) / 2;
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
        // ── side room (pocket left of corridor) ──
        { x: doorX + SIDE_DOOR_W / 2,                  y: endRoomTopY - R                              }, // door approach from inside
        { x: (endRoomL + t + corridorLX) / 2,          y: buildingBottomY + CORRIDOR_H / 2             }, // room centre
        // ── extension room (above main building top wall) ──
        { x: ent1CX, y: b.y + t + R          }, // entrance 1 — main room side
        { x: ent2CX, y: b.y + t + R          }, // entrance 2 — main room side
        { x: ent1CX, y: b.y - R              }, // entrance 1 — extension side
        { x: ent2CX, y: b.y - R              }, // entrance 2 — extension side
        { x: e.outerL + t + R, y: e.outerTop + t + R }, // extension top-left corner
        { x: e.outerR - t - R, y: e.outerTop + t + R }, // extension top-right corner
        { x: (e.outerL + e.outerR) / 2, y: e.outerTop + t + R }, // extension top-centre
        // ── final room (above extension) ──
        { x: (FINAL_ROOM.outerL + FINAL_ROOM.outerR) / 2, y: FINAL_ROOM.outerBot - R     }, // door approach from inside final room
        { x: FINAL_ROOM.outerL + t + R,                   y: FINAL_ROOM.outerTop + t + R }, // final room top-left
        { x: FINAL_ROOM.outerR - t - R,                   y: FINAL_ROOM.outerTop + t + R }, // final room top-right
        { x: (FINAL_ROOM.outerL + FINAL_ROOM.outerR) / 2, y: FINAL_ROOM.outerTop + t + R }, // final room top-centre
        // ── east wing: vertical corridor, horizontal corridor, new room ──
        { x: (EAST_WING.vL + EAST_WING.vR) / 2, y: EAST_WING.vTop + R    }, // top of vertical (junction)
        { x: (EAST_WING.vL + EAST_WING.vR) / 2, y: EAST_WING.vBot - R    }, // bottom of vertical (end room entry)
        { x: (EAST_WING.vR + EAST_WING.roomL) / 2, y: (EAST_WING.hTop + EAST_WING.hBot) / 2 }, // horizontal midpoint
        { x: EAST_WING.roomL + R, y: EAST_WING.roomT + R }, // room top-left
        { x: EAST_WING.roomR - R, y: EAST_WING.roomT + R }, // room top-right
        { x: EAST_WING.roomL + R, y: EAST_WING.roomB - R }, // room bottom-left
        { x: EAST_WING.roomR - R, y: EAST_WING.roomB - R }, // room bottom-right
        { x: (EAST_WING.roomL + EAST_WING.roomR) / 2, y: (EAST_WING.roomT + EAST_WING.roomB) / 2 }, // room centre
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

function soloGame() {
    isHost = true;
    startGame();
}

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
            const fb = batch[0];
            remoteMuzzleFlash = { x: fb.x, y: fb.y, angle: Math.atan2(fb.vy, fb.vx), timer: 0.08, weaponId: fb.weaponId ?? 0 };
        } else if (data.type === 'zombies') {
            // joiner receives zombie positions + wave info from host
            remoteZombies = data.zombies;
            const prevWave = wave;
            wave      = data.wave;
            waveDelay = data.waveDelay;
            if (data.wave > prevWave) {
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
                } else if (data.angle !== undefined) {
                    zombies[idx].kbVx += Math.cos(data.angle) * 260;
                    zombies[idx].kbVy += Math.sin(data.angle) * 260;
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
            else if (data.markType === 'burn') spawnBurnMark(data.x, data.y);
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
        } else if (data.type === 'unlockSideRoom') {
            if (!sideRoomUnlocked) {
                sideRoomUnlocked = true;
                const idx = walls.indexOf(SIDE_ROOM_BARRIER);
                if (idx !== -1) walls.splice(idx, 1);
            }
        } else if (data.type === 'unlockGenRoom') {
            if (!genRoomUnlocked) {
                genRoomUnlocked = true;
                const idx = walls.indexOf(GEN_ROOM_BARRIER);
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

    // spawn bullet(s) from the tip of the gun barrel
    const GUN_TIP_X = wDef.muzzleX, GUN_TIP_Y = wDef.muzzleY;
    const bx = player.x + Math.cos(player.angle) * GUN_TIP_X - Math.sin(player.angle) * GUN_TIP_Y;
    const by = player.y + Math.sin(player.angle) * GUN_TIP_X + Math.cos(player.angle) * GUN_TIP_Y;

    const spd = wDef.bulletSpeed || BULLET_SPEED;
    const effectiveSpread = wDef.spread + (wDef.bloomPerShot ? fireBloom : 0);
    const worldMouseX = mouse.x + camera.x;
    const worldMouseY = mouse.y + camera.y;
    const aimAngle = Math.atan2(worldMouseY - by, worldMouseX - bx);
    const newBullets = [];
    for (let i = 0; i < wDef.pellets; i++) {
        const a = aimAngle + (Math.random() - 0.5) * effectiveSpread;
        newBullets.push(new Bullet(bx, by, Math.cos(a) * spd, Math.sin(a) * spd, wDef.id));
    }
    bullets.push(...newBullets);
    magAmmo--;
    weaponCooldown = wDef.cooldown;
    muzzleFlash = { x: bx, y: by, angle: player.angle, timer: 0.08, weaponId: wDef.id };
    if (wDef.id === 6) spawnParticles(bx, by, '#ffe090', 10, player.angle);

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

// ─── mobile touch controls ────────────────────────────────────────────────────
if (isMobile) {
    const BTN_R = 40; // button hit-radius

    function reloadBtn()   { return { x: canvas.width - 70, y: canvas.height - 110 }; }
    function interactBtn() { return { x: 70,                y: canvas.height - 110 }; }

    function inBtn(tx, ty, btn) { return Math.hypot(tx - btn.x, ty - btn.y) < BTN_R; }

    function inHotbar(tx, ty) {
        const slotSize = 54, gap = 6, totalW = 3 * slotSize + 2 * gap;
        const hx = (canvas.width - totalW) / 2;
        const hy = canvas.height - slotSize - 18;
        if (ty < hy || ty > hy + slotSize) return -1;
        for (let i = 0; i < 3; i++) {
            const sx = hx + i * (slotSize + gap);
            if (tx >= sx && tx <= sx + slotSize) return i;
        }
        return -1;
    }

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            const tx = t.clientX, ty = t.clientY;

            // hotbar weapon switch
            const slot = inHotbar(tx, ty);
            if (slot !== -1) { switchWeapon(slot); continue; }

            // reload button
            if (inBtn(tx, ty, reloadBtn())) {
                if (!reloading && magAmmo < curWeaponDef().magSize && reserveAmmo[currentWeapon] > 0) {
                    reloading = true; reloadTimer = curWeaponDef().reloadTime;
                }
                continue;
            }

            // interact (F) button
            if (inBtn(tx, ty, interactBtn())) {
                fTouchId = t.identifier; keys['f'] = true; continue;
            }

            // left half → movement joystick
            if (tx < canvas.width / 2 && !leftTouch) {
                leftTouch = { id: t.identifier, baseX: tx, baseY: ty, curX: tx, curY: ty };
                continue;
            }

            // right half → aim / fire joystick
            if (tx >= canvas.width / 2 && !rightTouch) {
                rightTouch = { id: t.identifier, baseX: tx, baseY: ty, curX: tx, curY: ty };
                if (firstShotCooldown <= 0) fireBloom = 0;
                mouseHeld = true;
                tryFire();
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (leftTouch && t.identifier === leftTouch.id) {
                leftTouch.curX = t.clientX; leftTouch.curY = t.clientY;
                const dx = leftTouch.curX - leftTouch.baseX;
                const dy = leftTouch.curY - leftTouch.baseY;
                const dist = Math.hypot(dx, dy) || 1;
                const scale = Math.min(dist, JOY_RADIUS) / JOY_RADIUS;
                mobileMove.x = (dx / dist) * scale;
                mobileMove.y = (dy / dist) * scale;
            }
            if (rightTouch && t.identifier === rightTouch.id) {
                rightTouch.curX = t.clientX; rightTouch.curY = t.clientY;
                const dx = rightTouch.curX - rightTouch.baseX;
                const dy = rightTouch.curY - rightTouch.baseY;
                const dist = Math.hypot(dx, dy);
                if (dist > 10) {
                    mouse.x = (player.x - camera.x) + (dx / dist) * 200;
                    mouse.y = (player.y - camera.y) + (dy / dist) * 200;
                }
            }
        }
    }, { passive: false });

    function onTouchEnd(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (leftTouch  && t.identifier === leftTouch.id)  { leftTouch = null; mobileMove.x = 0; mobileMove.y = 0; }
            if (rightTouch && t.identifier === rightTouch.id) { rightTouch = null; mouseHeld = false; }
            if (t.identifier === fTouchId)                     { fTouchId = null; keys['f'] = false; }
        }
    }
    canvas.addEventListener('touchend',    onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

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

    if (isMobile) { dx += mobileMove.x; dy += mobileMove.y; }
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
    const pxBefore = player.x, pyBefore = player.y;
    for (const z of zombieList) {
        const minZDist = (z.radius ?? ZOMBIE_RADIUS) + PLAYER_RADIUS;
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
    if (mouseHeld && (curWeaponDef().autoFire || isMobile)) tryFire();

    // send position + current weapon to the other player (~60 Hz)
    if (moveSyncTimer <= 0 && conn && conn.open) {
        moveSyncTimer = 1 / 60;
        conn.send({ type: 'move', x: player.x, y: player.y, angle: player.angle, weapon: currentWeapon, weaponId: inventory[currentWeapon], dead: playerDead, name: localPlayerName });
    }
}

// dirAngle: direction particles fly toward (use bullet's opposite angle for impact spray)
// rewardMoney=false when called from a joiner's AoE on the host (joiner gets rewards instead)
function spawnRaygunExplosion(x, y, rewardMoney = true) {
    spawnParticles(x, y, '#40ff60', 14);
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

function spawnCritExplosion(x, y) {
    const colors = ['#ff4040', '#cc2020', '#880000', '#ff6020', '#ff2000'];
    for (let i = 0; i < 60; i++) {
        const p = new Particle(x, y, colors[i % colors.length], undefined);
        p.vx *= 2.2;
        p.vy *= 2.2;
        p.life   *= 1.8;
        p.maxLife = p.life;
        particles.push(p);
    }
}

const BARRICADE_REPAIR_TIME = 1.2; // seconds to hold F to add one plank
const BARRICADE_RANGE       = 60;  // px from window centre

// ─── shotgun wall pickup ──────────────────────────────────────────────────────
// right wall of main building, upper section (swapped with deagle)
const SHOTGUN_PICKUP = (() => {
    const b = BUILDING, t = b.wallThickness;
    return { x: b.x + b.w - t, y: b.y + 70, w: t, h: 36 };
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

// ─── deagle wall pickup ───────────────────────────────────────────────────────
// right wall of the end room, lower section (below the right-wall window)
const DEAGLE_PICKUP = (() => {
    const t = BUILDING.wallThickness;
    const { endRoomR, endRoomTopY, END_ROOM_H } = EXTRA_ROOM;
    return { x: endRoomR - t, y: endRoomTopY + END_ROOM_H - 50, w: t, h: 36 };
})();

let deagleBuyProgress = 0; // 0..1 while holding F near pickup

// ─── mystery box ──────────────────────────────────────────────────────────────
const MYSTERY_BOX = (() => {
    const b = BUILDING, t = b.wallThickness;
    const { endRoomL } = EXTRA_ROOM;
    const { corridorLX } = SIDE_ROOM;
    // top-centre of the side room interior (just below the main building bottom wall)
    const cx = (endRoomL + t + corridorLX) / 2;
    return { x: cx - 16, y: b.y + b.h + 10, w: 32, h: 32, cost: 200 };
})();

let mysteryBoxProgress = 0;  // 0..1 hold-F progress
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
                money += 10;
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
            const roll = Math.random();
            // 5% ray gun | 5% railgun | 10% shotgun | 30% machine gun | 10% uzi | 10% blaster | 30% teddy bear
            const prize = roll < 0.05 ? 2
                        : roll < 0.10 ? 5
                        : roll < 0.20 ? 1
                        : roll < 0.50 ? 3
                        : roll < 0.60 ? 4
                        : roll < 0.70 ? 7
                        : -1; // teddy bear
            if (prize !== -1) {
                let targetSlot = inventory.indexOf(-1);
                if (targetSlot === -1) targetSlot = currentWeapon;
                inventory[targetSlot]   = prize;
                savedAmmo[targetSlot]   = WEAPON_DEFS[prize].magSize;
                reserveAmmo[targetSlot] = WEAPON_DEFS[prize].reserve;
                if (targetSlot === currentWeapon) { magAmmo = WEAPON_DEFS[prize].magSize; reloading = false; reloadTimer = 0; }
                switchWeapon(targetSlot);
                const labels = { 1: ['SHOTGUN!', '#e8c020'], 2: ['RAY GUN!', '#40ff60'], 3: ['MACHINE GUN!', '#e8c020'], 4: ['UZI!', '#40c8ff'], 5: ['RAILGUN!', '#a0d8ff'], 7: ['BLASTER!', '#ff4444'] };
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

function unlockSideRoom() {
    sideRoomUnlocked = true;
    const idx = walls.indexOf(SIDE_ROOM_BARRIER);
    if (idx !== -1) walls.splice(idx, 1);
    if (conn && conn.open) conn.send({ type: 'unlockSideRoom' });
}

function updateSideRoomDoor(dt) {
    if (sideRoomUnlocked) return;
    const db   = SIDE_ROOM_BARRIER;
    const cx   = db.x + db.w / 2;
    const cy   = db.y + db.h / 2;
    const dist = Math.hypot(player.x - cx, player.y - cy);
    const holding = isHoldingF();

    if (dist < BARRICADE_RANGE && holding) {
        if (money >= DOOR_COST) {
            sideRoomDoorProgress = Math.min(1, sideRoomDoorProgress + dt / 1.5);
            if (sideRoomDoorProgress >= 1) {
                sideRoomDoorProgress = 0;
                money -= DOOR_COST;
                unlockSideRoom();
            }
        }
    } else {
        sideRoomDoorProgress = Math.max(0, sideRoomDoorProgress - dt * 3);
    }
}

function unlockGenRoom() {
    genRoomUnlocked = true;
    const idx = walls.indexOf(GEN_ROOM_BARRIER);
    if (idx !== -1) walls.splice(idx, 1);
    if (conn && conn.open) conn.send({ type: 'unlockGenRoom' });
}

function updateGenRoomDoor(dt) {
    if (genRoomUnlocked) return;
    const db   = GEN_ROOM_BARRIER;
    const cx   = db.x + db.w / 2;
    const cy   = db.y + db.h / 2;
    const dist = Math.hypot(player.x - cx, player.y - cy);
    const holding = isHoldingF();

    if (dist < BARRICADE_RANGE && holding) {
        if (money >= GEN_ROOM_COST) {
            genRoomDoorProgress = Math.min(1, genRoomDoorProgress + dt / 1.5);
            if (genRoomDoorProgress >= 1) {
                genRoomDoorProgress = 0;
                money -= GEN_ROOM_COST;
                unlockGenRoom();
            }
        }
    } else {
        genRoomDoorProgress = Math.max(0, genRoomDoorProgress - dt * 3);
    }
}

function updatePowerSwitch(dt) {
    // Animate lever regardless of proximity
    const target = powerOn ? 1 : 0;
    powerLeverT += (target - powerLeverT) * Math.min(1, dt * 8);

    if (!genRoomUnlocked) return;
    const ps   = GEN_ROOM.powerSwitch;
    const cx   = ps.x - ps.w / 2;
    const cy   = ps.y + ps.h / 2;
    const dist = Math.hypot(player.x - cx, player.y - cy);
    const holding = isHoldingF();

    // rising-edge tap — turn power on (one-way, cannot be switched off)
    if (holding && !fPrevHeld && dist < BARRICADE_RANGE && !powerOn) {
        powerOn = true;
        // open the sliding door — remove barrier from collision walls
        const idx = walls.indexOf(SLIDING_DOOR_BARRIER);
        if (idx !== -1) walls.splice(idx, 1);
        slidingDoorOpen = true;
    }
    fPrevHeld = holding;
}

const CAR_REPAIR_STAGES  = 5;
const CAR_REPAIR_STAGE_T = 3.0; // seconds per stage

function updateCarRepair(dt) {
    if (gameWon || !slidingDoorOpen) return;
    const car = ESCAPE_CAR;
    const cx  = car.x + car.w / 2;
    const cy  = car.y + car.h / 2;
    const dist = Math.hypot(player.x - cx, player.y - cy);
    const holding = isHoldingF();

    const CAR_REPAIR_COST = 500;
    if (carRepairStage < CAR_REPAIR_STAGES && dist < BARRICADE_RANGE + 20 && holding && money >= CAR_REPAIR_COST) {
        carRepairProgress += dt / CAR_REPAIR_STAGE_T;
        if (carRepairProgress >= 1) {
            carRepairProgress = 0;
            money -= CAR_REPAIR_COST;
            carRepairStage++;
            if (carRepairStage >= CAR_REPAIR_STAGES) {
                gameWon  = true;
                winPhase = 1;
                carAnimX = ESCAPE_CAR.x;
                const idx = walls.indexOf(GARAGE_DOOR_BARRIER);
                if (idx !== -1) walls.splice(idx, 1);
            }
        }
    } else {
        carRepairProgress = Math.max(0, carRepairProgress - dt * 2);
    }
}

const CAR_EXIT_SPEED = 90; // px/s

function updateWinSequence(dt) {
    if (winPhase === 0) return;

    if (winPhase === 1) {
        // move car left out of the garage
        carAnimX -= CAR_EXIT_SPEED * dt;

        // follow car with camera
        const zoom = isMobile ? MOBILE_ZOOM : 1;
        const cx = carAnimX + ESCAPE_CAR.w / 2;
        const cy = ESCAPE_CAR.y + ESCAPE_CAR.h / 2;
        camera.x = Math.max(0, Math.min(cx - canvas.width / (2 * zoom),  WORLD_W - canvas.width  / zoom));
        camera.y = Math.max(0, Math.min(cy - canvas.height / (2 * zoom), WORLD_H - canvas.height / zoom));

        // car fully outside the building — lock camera, start message countdown
        if (carAnimX + ESCAPE_CAR.w < FINAL_ROOM.outerL - 20) {
            winPhase        = 2;
            winLockedCamX   = camera.x;
            winLockedCamY   = camera.y;
            winMessageTimer = 4.0;
        }
        return;
    }

    if (winPhase === 2) {
        // car keeps driving off into the distance
        carAnimX -= CAR_EXIT_SPEED * dt;
        // keep camera locked
        camera.x = winLockedCamX;
        camera.y = winLockedCamY;
        winMessageTimer -= dt;
        if (winMessageTimer <= 0) {
            winPhase = 3;
            // return to main menu
            location.reload();
        }
    }
}

function updateTurret(dt) {
    turretCooldown = Math.max(0, turretCooldown - dt);
    if (!powerOn) return;

    // Barrel tracks the nearest zombie in range that has clear LOS from the muzzle
    let target = null, bestDist = Infinity;
    for (const z of zombies) {
        const d = Math.hypot(z.x - TURRET.x, z.y - TURRET.y);
        if (d >= TURRET.range || d >= bestDist) continue;
        const angle = Math.atan2(z.y - TURRET.y, z.x - TURRET.x);
        const muzzleX = TURRET.x + Math.cos(angle) * 22;
        const muzzleY = TURRET.y + Math.sin(angle) * 22;
        if (hasLineOfSight(muzzleX, muzzleY, z.x, z.y)) { target = z; bestDist = d; }
    }

    // Rotate barrel toward target at a fixed turn speed (radians/sec), shortest arc
    const TURN_SPEED = Math.PI * 1.5; // ~270°/s
    if (target) {
        turretTargetAngle = Math.atan2(target.y - TURRET.y, target.x - TURRET.x);
    }
    let diff = ((turretTargetAngle - turretAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const step = TURN_SPEED * dt;
    turretAngle += Math.abs(diff) < step ? diff : Math.sign(diff) * step;

    if (!target) return;

    if (turretCooldown <= 0) {
        const muzzleX = TURRET.x + Math.cos(turretAngle) * 22;
        const muzzleY = TURRET.y + Math.sin(turretAngle) * 22;
        if (!hasLineOfSight(muzzleX, muzzleY, target.x, target.y)) return;
        turretCooldown = TURRET.fireRate;
        const spd = 800;
        const b = new Bullet(muzzleX, muzzleY, Math.cos(turretAngle) * spd, Math.sin(turretAngle) * spd, 0);
        b.isTurret = true;
        bullets.push(b);
    }
}

function drawExtraRoom() {
    const r = EXTRA_ROOM, t = r.wallThickness;
    const { doorCX, buildingBottomY, CORRIDOR_H, END_ROOM_W, END_ROOM_H, endRoomL, endRoomTopY } = r;
    const cL = doorCX - DOOR_GAP / 2;

    // corridor floor (narrow strip below the door)
    ctx.fillStyle = '#202020';
    ctx.fillRect(cL, buildingBottomY, DOOR_GAP, CORRIDOR_H);

    // side room floor (pocket to the left of the corridor)
    ctx.fillRect(endRoomL + t, buildingBottomY, SIDE_ROOM.corridorLX - endRoomL - t, CORRIDOR_H);

    // end room floor (wider area at the bottom of the corridor)
    ctx.fillRect(endRoomL + t, endRoomTopY + t, END_ROOM_W - t * 2, END_ROOM_H - t);

    // ── east wing floors ──
    const ew = EAST_WING;
    // vertical corridor alongside existing corridor
    ctx.fillRect(ew.vL, ew.vTop, ew.vR - ew.vL, ew.vBot - ew.vTop);
    // horizontal corridor turning east
    ctx.fillRect(ew.vR, ew.hTop, ew.roomL - ew.vR, ew.hBot - ew.hTop);
    // new room
    ctx.fillRect(ew.roomL, ew.roomT, ew.roomR - ew.roomL, ew.roomB - ew.roomT);

    // gen room door — wooden panel when locked, open when unlocked
    const gdb = GEN_ROOM_BARRIER;
    if (!genRoomUnlocked) {
        ctx.fillStyle = '#5a3e14';
        ctx.fillRect(gdb.x, gdb.y, gdb.w, gdb.h);
        ctx.strokeStyle = '#8B6020';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gdb.x, gdb.y, gdb.w, gdb.h);

        // decorative panel line across the middle
        ctx.strokeStyle = '#4a3010';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gmid = gdb.y + gdb.h / 2;
        ctx.moveTo(gdb.x + 3, gmid);
        ctx.lineTo(gdb.x + gdb.w - 3, gmid);
        ctx.stroke();

        // price label to the left of the door (in the corridor)
        ctx.save();
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e8c060';
        ctx.fillText(`[F] £${GEN_ROOM_COST}`, gdb.x - 4, gdb.y + gdb.h / 2);
        ctx.restore();

        // progress bar (above the door rect)
        if (genRoomDoorProgress > 0) {
            ctx.fillStyle = '#222';
            ctx.fillRect(gdb.x - 9, gdb.y, 4, gdb.h);
            ctx.fillStyle = '#e8c060';
            ctx.fillRect(gdb.x - 9, gdb.y + gdb.h * (1 - genRoomDoorProgress), 4, gdb.h * genRoomDoorProgress);
        }
    }

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

    // side room door — wooden panels when locked, open gap when unlocked
    const sdb = SIDE_ROOM_BARRIER;
    if (!sideRoomUnlocked) {
        ctx.fillStyle = '#5a3e14';
        ctx.fillRect(sdb.x, sdb.y, sdb.w, sdb.h);
        ctx.strokeStyle = '#8B6020';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sdb.x, sdb.y, sdb.w, sdb.h);

        // decorative panel lines
        ctx.strokeStyle = '#4a3010';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const smid = sdb.x + sdb.w / 2;
        ctx.moveTo(smid, sdb.y + 3);
        ctx.lineTo(smid, sdb.y + sdb.h - 3);
        ctx.stroke();

        // price label (inside side room, above the door)
        ctx.save();
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#e8c060';
        ctx.fillText(`[F] £${DOOR_COST}`, sdb.x + sdb.w / 2, sdb.y - 3);
        ctx.restore();

        // progress bar
        if (sideRoomDoorProgress > 0) {
            ctx.fillStyle = '#222';
            ctx.fillRect(sdb.x, sdb.y - 9, sdb.w, 4);
            ctx.fillStyle = '#e8c060';
            ctx.fillRect(sdb.x, sdb.y - 9, sdb.w * sideRoomDoorProgress, 4);
        }
    }
}

function drawMysteryBox() {
    const mb   = MYSTERY_BOX;
    const cx   = mb.x + mb.w / 2;
    const cy   = mb.y + mb.h / 2;
    const glow = 0.5 + 0.5 * Math.sin(mysteryBoxAnim);

    ctx.save();

    {
        // pulsing green glow
        const glowR = mb.w * 0.9 + glow * 8;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grad.addColorStop(0, `rgba(60,255,80,${0.25 * glow})`);
        grad.addColorStop(1, 'rgba(60,255,80,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    }

    // box body
    ctx.fillStyle = '#1a2e1a';
    ctx.fillRect(mb.x, mb.y, mb.w, mb.h);
    ctx.strokeStyle = `rgba(60,220,80,${0.5 + 0.5 * glow})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mb.x, mb.y, mb.w, mb.h);

    // ? label
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(80,255,100,${0.7 + 0.3 * glow})`;
    ctx.fillText('?', cx, cy);
    ctx.textBaseline = 'alphabetic';

    // buy progress bar
    if (mysteryBoxProgress > 0) {
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

    // ── deagle ──
    {
        const dp  = DEAGLE_PICKUP;
        const cx  = dp.x + dp.w / 2, cy = dp.y + dp.h / 2;
        const near = Math.hypot(player.x - cx, player.y - cy) < BARRICADE_RANGE;
        if (near && holding && !inventory.includes(6)) {
            deagleBuyProgress = Math.min(1, deagleBuyProgress + dt / 1.5);
            if (deagleBuyProgress >= 1) {
                deagleBuyProgress = 0;
                if (money < WEAPON_DEFS[6].cost) return;
                money -= WEAPON_DEFS[6].cost;
                let targetSlot = inventory.indexOf(-1);
                if (targetSlot === -1) targetSlot = currentWeapon;
                inventory[targetSlot]   = 6;
                savedAmmo[targetSlot]   = WEAPON_DEFS[6].magSize;
                reserveAmmo[targetSlot] = WEAPON_DEFS[6].reserve;
                if (targetSlot === currentWeapon) { magAmmo = WEAPON_DEFS[6].magSize; reloading = false; reloadTimer = 0; }
                switchWeapon(targetSlot);
            }
        } else {
            deagleBuyProgress = Math.max(0, deagleBuyProgress - dt * 3);
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

function spawnBurnMark(x, y) {
    const r    = 20 + Math.random() * 10;
    const life = 4.0 + Math.random() * 1.5; // short intense burn then fades
    groundMarks.push({ type: 'burn', x, y, r, life, maxLife: life });
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
        } else if (m.type === 'burn') {
            // burn — starts orange/fire, transitions to dark scorch as it fades
            const fireFrac = Math.min(1, t * 2.5); // fire glow only in first ~40% of life
            if (fireFrac > 0) {
                const fire = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 0.7);
                fire.addColorStop(0,   `rgba(255,220,60,${fireFrac * 0.95})`);
                fire.addColorStop(0.4, `rgba(255,100,10,${fireFrac * 0.8})`);
                fire.addColorStop(1,   'rgba(0,0,0,0)');
                ctx.fillStyle = fire;
                ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.7, 0, Math.PI * 2); ctx.fill();
            }
            // dark scorch underneath, persists longer
            const scorch = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
            scorch.addColorStop(0,   `rgba(6,4,1,0.95)`);
            scorch.addColorStop(0.5, `rgba(12,8,3,0.7)`);
            scorch.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = scorch;
            ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
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
            else if (b.weaponId === 5) { spawnParticles(b.x, b.y, '#a0d8ff', 28, Math.atan2(b.vy, b.vx) + Math.PI); spawnParticles(b.x, b.y, '#ffffff', 10, Math.atan2(b.vy, b.vx) + Math.PI); }
            else if (b.weaponId === 6) { spawnParticles(b.x, b.y, '#ffe090', 20, Math.atan2(b.vy, b.vx) + Math.PI); spawnParticles(b.x, b.y, '#ffffff', 8,  Math.atan2(b.vy, b.vx) + Math.PI); }
            else if (b.weaponId === 7) { spawnParticles(b.x, b.y, '#ff3030', 16, Math.atan2(b.vy, b.vx) + Math.PI); spawnParticles(b.x, b.y, '#ffaaaa', 6,  Math.atan2(b.vy, b.vx) + Math.PI); }
            else spawnParticles(b.x, b.y, '#f5e642', 8, Math.atan2(b.vy, b.vx) + Math.PI);
            bullets.splice(i, 1);
            continue;
        }
        // bullet-zombie collision
        let zombieHit = false;
        let bulletDead = false;
        if (shouldSimulateZombies()) {
            for (let j = zombies.length - 1; j >= 0; j--) {
                const z = zombies[j];
                const dx = b.x - z.x, dy = b.y - z.y;
                if (dx * dx + dy * dy < z.radius * z.radius) {
                    if (b.weaponId === 2) {
                        spawnRaygunExplosion(b.x, b.y);
                        bulletDead = true; break;
                    }
                    const deagleDmg = b.isCrit ? (z.isBoss ? 6 : 100) : 3;
                    const dmg = b.weaponId === 5 ? 20 : b.weaponId === 6 ? deagleDmg : b.weaponId === 7 ? 6 : b.weaponId === 3 ? 2 : 1;
                    z.hp -= dmg;
                    if (z.hp <= 0) {
                        const zx = z.x, zy = z.y;
                        zombies.splice(j, 1);
                        money += ZOMBIE_KILL_REWARD;
                        if (b.weaponId === 7) {
                            spawnBurnMark(zx, zy);
                            spawnParticles(zx, zy, '#ff8800', 20, Math.random() * Math.PI * 2);
                            spawnParticles(zx, zy, '#ffdd00', 10, Math.random() * Math.PI * 2);
                        } else {
                            spawnBloodSmear(zx, zy);
                        }
                        trySpawnAmmoDrop(zx, zy);
                        if (conn && conn.open) conn.send({ type: 'deathMark', markType: b.weaponId === 7 ? 'burn' : 'blood', x: zx, y: zy });
                    } else {
                        const ba = Math.atan2(b.vy, b.vx);
                        const kbForce = b.weaponId === 6 ? (b.isCrit ? 600 : 420) : 260;
                        z.kbVx += Math.cos(ba) * kbForce;
                        z.kbVy += Math.sin(ba) * kbForce;
                    }
                    if (b.isCrit) { spawnCritExplosion(b.x, b.y); critTexts.push({ x: b.x, y: b.y, timer: 0.7 }); }
                    else if (b.weaponId === 7) spawnParticles(b.x, b.y, '#ff6600', 8, Math.atan2(b.vy, b.vx) + Math.PI);
                    else spawnParticles(b.x, b.y, '#cc2020', b.weaponId === 6 ? 18 : 8, Math.atan2(b.vy, b.vx) + Math.PI);
                    zombieHit = true;
                    if (b.pierceLeft > 0) { b.pierceLeft--; }
                    else { bulletDead = true; break; }
                }
            }
        } else {
            for (let j = 0; j < remoteZombies.length; j++) {
                const z = remoteZombies[j];
                const dx = b.x - z.x, dy = b.y - z.y;
                if (dx * dx + dy * dy < (z.radius ?? ZOMBIE_RADIUS) * (z.radius ?? ZOMBIE_RADIUS)) {
                    if (b.weaponId === 2) { spawnRaygunExplosion(b.x, b.y); bulletDead = true; break; }
                    const dmg = b.weaponId === 5 ? 20 : b.weaponId === 6 ? (b.isCrit ? 100 : 3) : b.weaponId === 7 ? 6 : b.weaponId === 3 ? 2 : 1;
                    if (conn && conn.open) conn.send({ type: 'zombieHit', id: z.id, damage: dmg, angle: Math.atan2(b.vy, b.vx) });
                    if (b.isCrit) { spawnCritExplosion(b.x, b.y); critTexts.push({ x: b.x, y: b.y, timer: 0.7 }); }
                    else spawnParticles(b.x, b.y, '#cc2020', b.weaponId === 6 ? 18 : 8, Math.atan2(b.vy, b.vx) + Math.PI);
                    zombieHit = true;
                    if (b.pierceLeft > 0) { b.pierceLeft--; }
                    else { bulletDead = true; break; }
                }
            }
        }
        if (bulletDead) { bullets.splice(i, 1); continue; }
        if (zombieHit) continue;
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


function spawnBoss() {
    const bossRadius = 20;
    const margin = bossRadius + 4;
    const available = windows.filter(w => {
        if (extraRoomWindows.includes(w)) return extraRoomUnlocked;
        if (w === sideRoomWindow)         return sideRoomUnlocked;
        if (genRoomWindows.includes(w))   return genRoomUnlocked;
        if (garageWindows.includes(w))    return powerOn;
        return true;
    });

    for (let attempt = 0; attempt < 10; attempt++) {
        const win = available[Math.floor(Math.random() * available.length)];
        const ap  = windowApproachPoint(win);
        let sx, sy;
        if (win.side === 'top')         { sx = Math.max(margin, Math.min(WORLD_W - margin, ap.x)); sy = margin; }
        else if (win.side === 'bottom') { sx = Math.max(margin, Math.min(WORLD_W - margin, ap.x)); sy = WORLD_H - margin; }
        else if (win.side === 'left')   { sx = margin; sy = Math.max(margin, Math.min(WORLD_H - margin, ap.y)); }
        else                            { sx = WORLD_W - margin; sy = Math.max(margin, Math.min(WORLD_H - margin, ap.y)); }

        if (!hasLineOfSight(sx, sy, ap.x, ap.y)) continue;

        const z = new Zombie(sx, sy, win);
        z.isBoss  = true;
        z.hp      = 30;
        z.maxHp   = 30;
        z.radius  = bossRadius;
        z.speed   = ZOMBIE_WAVE_SPEED(wave) * 0.75;
        z.waypoints = computePathToWindow(sx, sy, win);
        zombies.push(z);
        return;
    }
}

function spawnZombie() {
    const margin = ZOMBIE_RADIUS + 4;
    const spread = 400;

    const available = windows.filter(w => {
        if (extraRoomWindows.includes(w)) return extraRoomUnlocked;
        if (w === sideRoomWindow)         return sideRoomUnlocked;
        if (genRoomWindows.includes(w))   return genRoomUnlocked;
        if (garageWindows.includes(w))    return powerOn;
        return true;
    });

    // Retry until a spawn position has direct line of sight to its window,
    // so zombies never materialise behind a wall or inside a room.
    for (let attempt = 0; attempt < 10; attempt++) {
        const win = available[Math.floor(Math.random() * available.length)];
        const ap  = windowApproachPoint(win);

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

        if (!hasLineOfSight(sx, sy, ap.x, ap.y)) continue;

        const z = new Zombie(sx, sy, win);
        z.waypoints = computePathToWindow(sx, sy, win);
        zombies.push(z);
        return;
    }
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
            // boss spawns at the start of wave 5 (and every 5 waves after)
            if (wave % 5 === 0) spawnBoss();
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

    // ── knockback: apply velocity and decay rapidly ──
    const kbDecay = Math.exp(-18 * dt); // ~95% gone in 0.17s
    for (const z of zombies) {
        if (z.kbVx === 0 && z.kbVy === 0) continue;
        z.x    += z.kbVx * dt;
        z.y    += z.kbVy * dt;
        z.kbVx *= kbDecay;
        z.kbVy *= kbDecay;
        if (Math.abs(z.kbVx) < 0.5) z.kbVx = 0;
        if (Math.abs(z.kbVy) < 0.5) z.kbVy = 0;
        for (const wall of walls) resolveCircleRect(z, ZOMBIE_RADIUS, wall);
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
            zombies: zombies.map(z => ({ x: z.x, y: z.y, state: z.state, id: z.id, angle: z.angle, isBoss: z.isBoss, hp: z.hp, maxHp: z.maxHp, radius: z.radius })),
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
    for (const z of remoteZombies) {
        if (z.state !== 'hunting') continue;
        const dx = z.x - player.x, dy = z.y - player.y;
        const minDistSq = ((z.radius ?? ZOMBIE_RADIUS) + PLAYER_RADIUS) ** 2;
        if (dx * dx + dy * dy < minDistSq) {
            playerHp = Math.max(0, playerHp - ZOMBIE_DPS * dt);
            timeSinceDamage = 0;
            if (playerHp === 0) playerDead = true;
            break;
        }
    }
}

// centres the camera on the player, clamped so it never shows outside the world
const MOBILE_ZOOM = 0.6;
function updateCamera() {
    const zoom = isMobile ? MOBILE_ZOOM : 1;
    camera.x = player.x - canvas.width  / (2 * zoom);
    camera.y = player.y - canvas.height / (2 * zoom);
    camera.x = Math.max(0, Math.min(camera.x, WORLD_W - canvas.width  / zoom));
    camera.y = Math.max(0, Math.min(camera.y, WORLD_H - canvas.height / zoom));
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

function drawGenRoom() {
    const { roomR, t } = EAST_WING;
    const { generator: gen, fuelBarrels, workbench: wb, powerSwitch: ps } = GEN_ROOM;

    ctx.save();

    // ── fuel barrels (match existing barrel style) ──
    for (const rect of fuelBarrels) {
        const bx = rect.x + rect.w / 2, by = rect.y + rect.h / 2, r = rect.w / 2;
        ctx.fillStyle = '#3d2b0e';
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 2.5;
        for (const oy of [-r * 0.38, r * 0.38]) {
            const hw = Math.sqrt(Math.max(0, r * r - oy * oy));
            ctx.beginPath(); ctx.moveTo(bx - hw, by + oy); ctx.lineTo(bx + hw, by + oy); ctx.stroke();
        }
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(bx, by, r * 0.32, 0, Math.PI * 2); ctx.fill();
    }

    // ── workbench ──
    ctx.fillStyle = '#3a2a10';
    ctx.fillRect(wb.x, wb.y, wb.w, wb.h);
    ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 1;
    ctx.strokeRect(wb.x, wb.y, wb.w, wb.h);
    // tools on surface
    ctx.fillStyle = '#777';
    ctx.fillRect(wb.x + 8,  wb.y + 5, 20, 4);  // wrench
    ctx.fillRect(wb.x + 36, wb.y + 4, 5, 14);  // screwdriver handle
    ctx.fillStyle = '#555';
    ctx.fillRect(wb.x + 37, wb.y + 3, 3, 5);   // tip

    // ── generator body ──
    const gx = gen.x, gy = gen.y, gw = gen.w, gh = gen.h;

    // base plate
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(gx - 3, gy + gh - 5, gw + 6, 9);

    // body
    ctx.fillStyle = '#2a4a2a';
    ctx.fillRect(gx, gy, gw, gh);

    // warning stripes — left end
    ctx.save();
    ctx.beginPath(); ctx.rect(gx, gy, 18, gh); ctx.clip();
    const sw = 8;
    ctx.fillStyle = '#c49010';
    for (let si = -gh; si < gw + gh; si += sw * 2) {
        ctx.beginPath();
        ctx.moveTo(gx + si, gy); ctx.lineTo(gx + si + sw, gy);
        ctx.lineTo(gx + si + sw - gh, gy + gh); ctx.lineTo(gx + si - gh, gy + gh);
        ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // exhaust pipe — right end, sticking up
    ctx.fillStyle = '#444';
    ctx.fillRect(gx + gw - 14, gy - 13, 10, 15);
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(gx + gw - 9, gy - 13, 5, Math.PI, 0); ctx.fill();

    // recessed vent panel
    ctx.fillStyle = '#1e3a1e';
    ctx.fillRect(gx + 22, gy + 6, gw - 38, gh - 12);
    ctx.fillStyle = '#111';
    for (let vi = 0; vi < 5; vi++) {
        ctx.fillRect(gx + 26, gy + 10 + vi * 7, gw - 48, 3);
    }

    // gauges — power (red/off) and fuel (amber)
    const gaugeCX = gx + gw - 20;
    for (const [oy, col] of [[10, '#cc2020'], [26, '#c87820']]) {
        ctx.fillStyle = '#333';
        ctx.beginPath(); ctx.arc(gaugeCX, gy + oy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(gaugeCX, gy + oy, 4, 0, Math.PI * 2); ctx.fill();
    }

    // rivets
    ctx.fillStyle = '#888';
    for (const [bx, by] of [[gx+4,gy+4],[gx+gw-5,gy+4],[gx+4,gy+gh-5],[gx+gw-5,gy+gh-5]]) {
        ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = '#4a6a4a'; ctx.lineWidth = 1.5;
    ctx.strokeRect(gx, gy, gw, gh);

    // ── cable from generator to power switch (conduit along wall) ──
    const cableY = gy + 8;
    const wallX  = roomR - t;
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(gx + gw, cableY); ctx.lineTo(wallX, cableY);
    ctx.lineTo(wallX, ps.y + ps.h / 2);
    ctx.stroke();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(gx + gw, cableY); ctx.lineTo(wallX, cableY);
    ctx.lineTo(wallX, ps.y + ps.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── power switch panel (mounted on right wall) ──
    const px = ps.x - ps.w, py = ps.y, ph = ps.h;
    const pcx = px + ps.w / 2;
    // lever position: T=0 → bottom (off), T=1 → top (on)
    const leverSlotH  = ph - 8;
    const leverOffY   = py + 4 + leverSlotH - 10; // lever bottom position
    const leverOnY    = py + 4;                    // lever top position
    const leverY      = leverOffY + (leverOnY - leverOffY) * powerLeverT;
    // colours interpolated between red (off) and green (on)
    const r = Math.round(187 * (1 - powerLeverT) + 20  * powerLeverT);
    const g = Math.round(32  * (1 - powerLeverT) + 187 * powerLeverT);
    const leverCol = `rgb(${r},${g},20)`;
    const ledR     = Math.round(255 * (1 - powerLeverT) + 40  * powerLeverT);
    const ledG     = Math.round(68  * (1 - powerLeverT) + 255 * powerLeverT);
    const ledCol   = `rgb(${ledR},${ledG},40)`;
    const glowCol  = powerOn ? '#20ff40' : '#ff2020';

    // panel box
    ctx.fillStyle = '#22222e';
    ctx.fillRect(px - 4, py - 5, ps.w + 5, ph + 10);
    ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 1;
    ctx.strokeRect(px - 4, py - 5, ps.w + 5, ph + 10);
    // lever slot
    ctx.fillStyle = '#111';
    ctx.fillRect(pcx - 2, py + 4, 4, leverSlotH);
    // lever handle (animated)
    ctx.fillStyle = leverCol;
    ctx.fillRect(pcx - 3, leverY, 6, 10);
    // indicator LED (colour-animated)
    ctx.shadowBlur = 8; ctx.shadowColor = glowCol;
    ctx.fillStyle = ledCol;
    ctx.beginPath(); ctx.arc(pcx, py - 1, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // label
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#888';
    ctx.fillText('PWR', pcx, py + ph + 8);

    ctx.restore();
}

function drawFinalRoom() {
    const fr = FINAL_ROOM, t = fr.t;
    const car = ESCAPE_CAR;

    // floor — same colour as other rooms
    ctx.fillStyle = '#202020';
    ctx.fillRect(fr.outerL + t, fr.outerTop + t, fr.intW, fr.intH);

    // ── garage door ───────────────────────────────────────────────────────────
    {
        const gx = fr.outerL, gy = GARAGE_DOOR_Y, gw = t, gh = GARAGE_DOOR_H;
        if (!gameWon) {
            // door frame
            ctx.fillStyle = '#1a1a22';
            ctx.fillRect(gx - 2, gy - 2, gw + 4, gh + 4);
            // horizontal panels
            ctx.fillStyle = '#3a3a4a';
            const panelH = 12;
            for (let py = gy; py < gy + gh; py += panelH) {
                const h = Math.min(panelH - 1, gy + gh - py);
                ctx.fillRect(gx, py, gw, h);
            }
            // panel grooves
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 1;
            for (let py = gy + panelH; py < gy + gh; py += panelH) {
                ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx + gw, py); ctx.stroke();
            }
            // LED indicator — red (locked), green (repairing)
            const ledColor = carRepairStage > 0 ? '#ffaa00' : '#ff3333';
            ctx.fillStyle = ledColor;
            ctx.shadowBlur = 6; ctx.shadowColor = ledColor;
            ctx.beginPath(); ctx.arc(gx + gw / 2, gy - 6, 3, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
        // when open: just the frame remains, door retracted upward (not drawn)
    }

    // ── room props ────────────────────────────────────────────────────────────
    const iL = fr.outerL + t + 6;  // interior left edge + padding
    const iR = fr.outerR - t - 6;  // interior right edge - padding
    const iT = fr.outerTop + t + 6; // interior top edge + padding
    const iB = fr.outerBot - 6;     // interior bottom edge - padding

    // helper: draw a tyre (top-down circle)
    function drawTyre(x, y, r) {
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }

    // tyre stacks — top-left corner (3 tyres)
    drawTyre(iL + 10, iT + 10, 10);
    drawTyre(iL + 24, iT + 10, 10);
    drawTyre(iL + 10, iT + 24, 10);

    // tyre stack — top-right corner (2 tyres)
    drawTyre(iR - 10, iT + 10, 10);
    drawTyre(iR - 24, iT + 10, 10);

    // tyre — bottom-right corner (single)
    drawTyre(iR - 10, iB - 10, 10);

    // toolbox — left wall, mid-height
    const tbX = iL, tbY = iT + 60;
    ctx.fillStyle = '#8a3a10'; // red metal box
    ctx.fillRect(tbX, tbY, 22, 14);
    ctx.fillStyle = '#6a2a08';
    ctx.fillRect(tbX, tbY + 5, 22, 4); // drawer divide
    ctx.fillStyle = '#bbb'; // drawer handles
    ctx.fillRect(tbX + 4, tbY + 2, 6, 2);
    ctx.fillRect(tbX + 4, tbY + 7, 6, 2);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    ctx.strokeRect(tbX, tbY, 22, 14);

    // oil drum — bottom-left corner
    const drumX = iL + 4, drumY = iB - 18;
    ctx.fillStyle = '#2a4a2a';
    ctx.beginPath(); ctx.ellipse(drumX + 8, drumY + 8, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a3a1a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(drumX + 8, drumY + 8, 8, 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#3a6a3a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(drumX + 8, drumY + 8, 8, 4, 0, 0, Math.PI * 2); ctx.stroke(); // band

    // car jack — right wall, mid-height
    const jkX = iR - 18, jkY = iT + 60;
    ctx.fillStyle = '#555';
    ctx.fillRect(jkX, jkY, 18, 10);
    ctx.fillStyle = '#777';
    ctx.fillRect(jkX + 4, jkY - 6, 10, 6); // upright
    ctx.fillRect(jkX + 2, jkY + 10, 14, 4); // base
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(jkX, jkY, 18, 10);

    // wrench on the floor near the car
    const wrX = car.x - 18, wrY = car.y + car.h / 2 - 2;
    ctx.strokeStyle = '#666'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(wrX, wrY); ctx.lineTo(wrX + 14, wrY); ctx.stroke();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(wrX, wrY); ctx.lineTo(wrX + 4, wrY); ctx.stroke();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(wrX + 10, wrY); ctx.lineTo(wrX + 14, wrY); ctx.stroke();

    const drawCarX = winPhase >= 1 ? carAnimX : car.x;
    const cx  = drawCarX + car.w / 2;
    const repairFrac = (carRepairStage + (gameWon ? 1 : carRepairProgress)) / CAR_REPAIR_STAGES;

    // body colour: rusted dark brown → painted blue
    const bR  = Math.round(90  + (20  - 90)  * repairFrac);
    const bG  = Math.round(45  + (80  - 45)  * repairFrac);
    const bB  = Math.round(20  + (180 - 20)  * repairFrac);
    const bodyColor = `rgb(${bR},${bG},${bB})`;
    const darkBody  = `rgb(${bR-15},${bG-8},${bB-5})`;

    const dx = drawCarX; // alias for brevity

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(dx + 5, car.y + 5, car.w, car.h);

    // ── main body ────────────────────────────────────────────────────────────
    // hood (front ~28px)
    ctx.fillStyle = darkBody;
    ctx.fillRect(dx, car.y, 28, car.h);
    // engine machinery visible until repaired
    if (repairFrac < 0.6) {
        ctx.fillStyle = '#1a1a1a'; // engine block
        ctx.fillRect(dx + 4, car.y + 8, 18, car.h - 16);
        ctx.fillStyle = '#555';   // cylinders
        ctx.fillRect(dx + 6, car.y + 10, 6, 5);
        ctx.fillRect(dx + 14, car.y + 10, 6, 5);
        ctx.fillRect(dx + 6, car.y + car.h - 15, 6, 5);
        ctx.fillRect(dx + 14, car.y + car.h - 15, 6, 5);
        ctx.fillStyle = '#888';   // hoses
        ctx.fillRect(dx + 5, car.y + 17, 16, 2);
        ctx.fillRect(dx + 5, car.y + car.h - 19, 16, 2);
    }
    // trunk (rear ~22px)
    ctx.fillStyle = darkBody;
    ctx.fillRect(dx + car.w - 22, car.y, 22, car.h);
    // cabin middle
    ctx.fillStyle = bodyColor;
    ctx.fillRect(dx + 28, car.y, car.w - 50, car.h);

    // front bumper strip
    ctx.fillStyle = repairFrac >= 0.3 ? '#aaa' : '#555';
    ctx.fillRect(dx, car.y + 4, 4, car.h - 8);
    // rear bumper strip
    ctx.fillRect(dx + car.w - 4, car.y + 4, 4, car.h - 8);

    // ── front windshield ─────────────────────────────────────────────────────
    const glassColor = repairFrac >= 0.4 ? '#4a8aaa' : '#1e1e1e';
    ctx.fillStyle = glassColor;
    ctx.beginPath();
    ctx.moveTo(dx + 28, car.y + 7);
    ctx.lineTo(dx + 44, car.y + 5);
    ctx.lineTo(dx + 44, car.y + car.h - 5);
    ctx.lineTo(dx + 28, car.y + car.h - 7);
    ctx.closePath();
    ctx.fill();
    // windshield glare
    if (repairFrac >= 0.4) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(dx + 30, car.y + 8);
        ctx.lineTo(dx + 40, car.y + 6);
        ctx.lineTo(dx + 40, car.y + 18);
        ctx.lineTo(dx + 30, car.y + 20);
        ctx.closePath();
        ctx.fill();
    }

    // ── rear windshield ──────────────────────────────────────────────────────
    ctx.fillStyle = repairFrac >= 0.4 ? '#3a7090' : '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(dx + car.w - 22, car.y + 8);
    ctx.lineTo(dx + car.w - 38, car.y + 6);
    ctx.lineTo(dx + car.w - 38, car.y + car.h - 6);
    ctx.lineTo(dx + car.w - 22, car.y + car.h - 8);
    ctx.closePath();
    ctx.fill();

    // ── cabin roof (slightly lighter panel) ──────────────────────────────────
    ctx.fillStyle = `rgb(${bR+12},${bG+6},${bB+8})`;
    ctx.fillRect(dx + 44, car.y + 5, car.w - 82, car.h - 10);

    // cabin centre-line
    ctx.strokeStyle = `rgb(${bR-5},${bG-3},${bB-3})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, car.y + 5); ctx.lineTo(cx, car.y + car.h - 5); ctx.stroke();

    // ── side mirrors (near front, protrude from top/bottom) ──────────────────
    ctx.fillStyle = bodyColor;
    ctx.fillRect(dx + 30, car.y - 8, 12, 5);  // top mirror
    ctx.fillRect(dx + 30, car.y + car.h + 3, 12, 5); // bottom mirror
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(dx + 30, car.y - 8, 12, 5);
    ctx.strokeRect(dx + 30, car.y + car.h + 3, 12, 5);

    // ── exhaust pipes (rear, bottom side) ────────────────────────────────────
    const exhaustColor = repairFrac >= 0.6 ? '#999' : '#3a3a3a';
    ctx.fillStyle = exhaustColor;
    ctx.beginPath(); ctx.arc(dx + car.w - 2, car.y + car.h - 10, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(dx + car.w - 2, car.y + car.h - 18, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(dx + car.w - 2, car.y + car.h - 10, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(dx + car.w - 2, car.y + car.h - 18, 3, 0, Math.PI * 2); ctx.stroke();

    // exhaust smoke puff when driving out
    if (winPhase === 1) {
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.beginPath(); ctx.arc(dx + car.w + 8, car.y + car.h - 14, 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(dx + car.w + 16, car.y + car.h - 16, 4, 0, Math.PI * 2); ctx.fill();
    }

    // ── body outline ─────────────────────────────────────────────────────────
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dx, car.y, car.w, car.h);

    // ── repair glow when near completion ─────────────────────────────────────
    if (repairFrac > 0.4 && winPhase === 0) {
        ctx.save();
        ctx.shadowBlur = 14 * repairFrac;
        ctx.shadowColor = '#40aaff';
        ctx.strokeStyle = `rgba(64,170,255,${repairFrac * 0.55})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(dx - 3, car.y - 3, car.w + 6, car.h + 6);
        ctx.restore();
    }

    // ── repair progress bar ───────────────────────────────────────────────────
    if (!gameWon && carRepairStage < CAR_REPAIR_STAGES && carRepairProgress > 0) {
        const barW = 90, barH = 6;
        const bx = cx - barW / 2, by = car.y - 18;
        ctx.fillStyle = '#111';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = '#40aaff';
        ctx.fillRect(bx, by, barW * carRepairProgress, barH);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, barW, barH);
        ctx.fillStyle = '#aaa';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${carRepairStage}/${CAR_REPAIR_STAGES}`, cx, by - 3);
    }
}

const ALL_DEAD_DELAY = 5.0; // seconds before returning to menu

function updateAllDead(dt) {
    if (gameWon || winPhase > 0) return;
    const allDead = playerDead && (!remotePeer || remotePeer.dead);
    if (allDead) {
        allDeadShowing = true;
        allDeadTimer += dt;
        if (allDeadTimer >= ALL_DEAD_DELAY) location.reload();
    } else {
        allDeadTimer   = 0;
        allDeadShowing = false;
    }
}

function drawDeathScreen() {
    if (!allDeadShowing) return;
    const fade = Math.min(1, allDeadTimer / 0.8);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowBlur = 25;
    ctx.shadowColor = '#cc2020';
    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 64px monospace';
    ctx.fillText('YOU DIED', canvas.width / 2, canvas.height / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaa';
    ctx.font = '22px monospace';
    ctx.fillText(`Survived to wave ${wave}`, canvas.width / 2, canvas.height / 2 + 30);
    ctx.fillStyle = '#666';
    ctx.font = '15px monospace';
    ctx.fillText(`Returning to menu in ${Math.ceil(ALL_DEAD_DELAY - allDeadTimer)}…`, canvas.width / 2, canvas.height / 2 + 70);
    ctx.restore();
}

function drawWinScreen() {
    if (winPhase !== 2) return;
    const fade = Math.min(1, (4.0 - winMessageTimer) / 0.6); // fade in over 0.6s
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#40ffaa';
    ctx.fillStyle = '#40ffaa';
    ctx.font = 'bold 64px monospace';
    ctx.fillText('YOU ESCAPED!', canvas.width / 2, canvas.height / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaa';
    ctx.font = '22px monospace';
    ctx.fillText('You repaired the car and escaped the horde.', canvas.width / 2, canvas.height / 2 + 30);
    ctx.fillStyle = '#666';
    ctx.font = '15px monospace';
    ctx.fillText(`Returning to menu in ${Math.ceil(winMessageTimer)}…`, canvas.width / 2, canvas.height / 2 + 70);
    ctx.restore();
}

function drawTurret() {
    const { x, y } = TURRET;
    ctx.save();
    ctx.translate(x, y);

    // static base plate bolted to the corner
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(-11, -11, 22, 22);
    // corner bolts
    ctx.fillStyle = '#666';
    for (const [bx, by] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
        ctx.beginPath(); ctx.arc(bx, by, 2, 0, Math.PI * 2); ctx.fill();
    }

    // rotating dome + barrel
    ctx.rotate(turretAngle);

    ctx.fillStyle = powerOn ? '#1a3a1a' : '#222';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = powerOn ? '#3a7a3a' : '#444';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();

    // barrel
    ctx.fillStyle = '#111';
    ctx.fillRect(5, -2.5, 18, 5);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(20, -3, 3, 6); // flash guard

    if (powerOn) {
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#40ff60';
        ctx.strokeStyle = 'rgba(60,220,80,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
    }

    ctx.restore();
}

function drawSlidingDoor() {
    const t = EXTENSION.t;
    const x = SLIDING_DOOR_X, y = SLIDING_DOOR_Y, w = SLIDING_DOOR_W;
    const mid = x + w / 2;
    // panels retract fully into the wall segments when open
    const panelW = w / 2;

    ctx.save();

    // door frame
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x - 2, y - 2, w + 4, t + 4);

    if (!slidingDoorOpen) {
        // left panel
        ctx.fillStyle = '#2e2e3e';
        ctx.fillRect(x, y, panelW, t);
        // right panel
        ctx.fillRect(mid, y, panelW, t);

        // panel highlight lines
        ctx.strokeStyle = '#3d3d52';
        ctx.lineWidth = 1;
        for (let gy = y + 6; gy < y + t - 4; gy += 7) {
            ctx.beginPath(); ctx.moveTo(x + 2, gy); ctx.lineTo(mid - 2, gy); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(mid + 2, gy); ctx.lineTo(x + w - 2, gy); ctx.stroke();
        }

        // centre seam
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mid, y); ctx.lineTo(mid, y + t); ctx.stroke();
    } else {
        // panels retracted into the wall — draw as thin slivers at the edges
        ctx.fillStyle = '#2e2e3e';
        ctx.fillRect(x - panelW + 4, y, panelW, t);  // left panel slid left
        ctx.fillRect(mid + panelW - 4, y, panelW, t); // right panel slid right
    }

    // power indicator LEDs
    const ledY = y + t / 2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = slidingDoorOpen ? '#20cc20' : '#cc2020';
    ctx.fillStyle   = slidingDoorOpen ? '#44ff44' : '#ff4444';
    ctx.beginPath(); ctx.arc(x + 5, ledY, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w - 5, ledY, 2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

function drawBuilding() {
    const b = BUILDING;
    const t = b.wallThickness;

    // interior floor — slightly lighter than the outside world
    ctx.fillStyle = '#252525';
    ctx.fillRect(b.x + t, b.y + t, b.w - t * 2, b.h - t * 2);

    // extension floor + entrance openings (same floor colour)
    const ext = EXTENSION;
    ctx.fillRect(ext.outerL + t, ext.outerTop + t, ext.intW, ext.intH);
    ctx.fillRect(ext.ent1L, b.y, ext.ent1R - ext.ent1L, t);
    ctx.fillRect(ext.ent2L, b.y, ext.ent2R - ext.ent2L, t);

    // solid wall rects (furniture and custom doors drawn separately)
    ctx.fillStyle = '#2a2a2a';
    for (const wall of walls) {
        if (wall.isFurniture || wall.isSlidingDoor || wall.isGarageDoor) continue;
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    }
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    for (const wall of walls) {
        if (wall.isFurniture || wall.isSlidingDoor || wall.isGarageDoor) continue;
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
    if (winPhase > 0) return;
    if (playerDead) {
        drawDeadCharacter(player.x, player.y);
        drawPlayerName(player.x, player.y, localPlayerName, '#cc2020');
        return;
    }
    drawCharacter(player.x, player.y, player.angle, '#3a3a3a', inventory[currentWeapon]);
    drawPlayerName(player.x, player.y, localPlayerName, '#ddd');
}

function drawRemotePlayer() {
    if (!remotePeer || winPhase > 0) return;
    if (remotePeer.dead) {
        drawDeadCharacter(remotePeer.x, remotePeer.y);
        drawPlayerName(remotePeer.x, remotePeer.y, remotePeer.name ?? 'Player', '#cc2020');
        return;
    }
    drawCharacter(remotePeer.x, remotePeer.y, remotePeer.angle, '#8b2020', remotePeer.weaponId ?? 0);
    drawPlayerName(remotePeer.x, remotePeer.y, remotePeer.name ?? 'Player', '#e07070');
}

function drawMuzzleFlash(flash) {
    if (!flash || flash.timer <= 0) return;
    const t = flash.timer / 0.08; // 1 → 0 as it fades
    const isRailgun = flash.weaponId === 5;
    const color     = isRailgun ? '#a0d8ff' : flash.weaponId === 7 ? '#ff6060' : flash.weaponId === 2 ? '#80ffaa' : '#fff7a0';
    const glowColor = isRailgun ? '#0050ff' : flash.weaponId === 7 ? '#ff0000' : flash.weaponId === 2 ? '#40ff60' : '#ffcc00';
    const size = (flash.weaponId === 1 ? 14 : flash.weaponId === 2 ? 10 : isRailgun ? 13 : 8) * t;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(flash.x, flash.y);
    ctx.rotate(flash.angle);

    // glow
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.2);
    grad.addColorStop(0,   glowColor);
    grad.addColorStop(0.4, glowColor + '99');
    grad.addColorStop(1,   glowColor + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, size * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // bright centre
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
    ctx.fill();

    if (isRailgun) {
        // elongated forward discharge beam
        ctx.shadowColor = '#0050ff';
        ctx.shadowBlur  = 10;
        ctx.strokeStyle = '#80c8ff';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(size * 5, 0);
        ctx.stroke();
        // perpendicular electric arcs
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#c0e8ff';
        for (let i = 1; i <= 3; i++) {
            const xpos = size * i * 1.2;
            const yoff = size * 0.6 * (i % 2 === 0 ? 1 : -1);
            ctx.beginPath();
            ctx.moveTo(xpos, -size * 0.6);
            ctx.lineTo(xpos + size * 0.3, yoff);
            ctx.lineTo(xpos + size * 0.6, -yoff * 0.5);
            ctx.stroke();
        }
    } else {
        // spikes — forward-biased starburst
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        const spikes = flash.weaponId === 1 ? 8 : 6;
        for (let i = 0; i < spikes; i++) {
            const a   = (i / spikes) * Math.PI * 2;
            const len = (Math.abs(Math.cos(a)) > 0.6 ? 1.8 : 1.0) * size;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
            ctx.stroke();
        }
    }

    ctx.restore();
}

function drawBullets() {
    for (const b of [...bullets, ...remoteBullets]) {
        b.draw();
    }
}

function drawParticles() {
    for (const p of particles) p.draw();
}


function updateCritTexts(dt) {
    for (let i = critTexts.length - 1; i >= 0; i--) {
        critTexts[i].timer -= dt;
        critTexts[i].y -= 28 * dt; // float upward
        if (critTexts[i].timer <= 0) critTexts.splice(i, 1);
    }
}

function drawCritTexts() {
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    for (const c of critTexts) {
        const alpha = Math.min(1, c.timer / 0.3);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = '#ffaa00';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ffe040';
        ctx.fillText('CRIT!', c.x, c.y);
    }
    ctx.restore();
}

// ─── weapon pickup (world-space) ─────────────────────────────────────────────

function drawWeaponPickup() {
    // ── shotgun (main building right wall, upper section) ──
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

    // ── deagle (end room right wall, lower section) ──
    {
        const dp = DEAGLE_PICKUP;
        const owned = inventory.includes(6);
        ctx.fillStyle = '#202020';
        ctx.fillRect(dp.x, dp.y, dp.w, dp.h);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(dp.x, dp.y, dp.w, dp.h);
        const cx = dp.x + dp.w / 2, cy = dp.y + dp.h / 2;
        ctx.save();
        ctx.globalAlpha = owned ? 0.35 : 1.0;
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-12, 1,  6, 6); // grip
        ctx.fillStyle = '#909090'; ctx.fillRect(-6, -2, 10, 7); // frame
        ctx.fillStyle = '#c0c0c0'; ctx.fillRect(-6, -2, 10, 2); // slide
        ctx.fillStyle = '#808080'; ctx.fillRect(4,  -1,  9, 5); // barrel
        ctx.restore();
        if (!owned && deagleBuyProgress > 0) {
            ctx.fillStyle = '#333';
            ctx.fillRect(dp.x + dp.w - 3, dp.y, 3, dp.h);
            ctx.fillStyle = '#aaaaaa';
            ctx.fillRect(dp.x + dp.w - 3, dp.y, 3, dp.h * deagleBuyProgress);
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

    // side room door prompt
    if (!sideRoomUnlocked) {
        const sdb = SIDE_ROOM_BARRIER;
        const scx = sdb.x + sdb.w / 2, scy = sdb.y + sdb.h / 2;
        if (Math.hypot(player.x - scx, player.y - scy) < BARRICADE_RANGE) {
            const canAfford = money >= DOOR_COST;
            const label = canAfford
                ? `[F] Unlock Side Room  £${DOOR_COST}`
                : `Unlock Side Room  £${DOOR_COST}  (need £${DOOR_COST - money} more)`;
            drawHudPrompt(label);
            return;
        }
    }

    // generator room door prompt
    if (!genRoomUnlocked) {
        const gdb = GEN_ROOM_BARRIER;
        const gcx = gdb.x + gdb.w / 2, gcy = gdb.y + gdb.h / 2;
        if (Math.hypot(player.x - gcx, player.y - gcy) < BARRICADE_RANGE) {
            const canAfford = money >= GEN_ROOM_COST;
            const label = canAfford
                ? `[F] Unlock Generator Room  £${GEN_ROOM_COST}`
                : `Unlock Generator Room  £${GEN_ROOM_COST}  (need £${GEN_ROOM_COST - money} more)`;
            drawHudPrompt(label);
            return;
        }
    }

    // power switch prompt
    if (genRoomUnlocked) {
        const ps  = GEN_ROOM.powerSwitch;
        const pcx = ps.x - ps.w / 2, pcy = ps.y + ps.h / 2;
        if (Math.hypot(player.x - pcx, player.y - pcy) < BARRICADE_RANGE) {
            drawHudPrompt(powerOn ? 'Power is ON' : '[F] Power ON');
            return;
        }
    }

    // mystery box prompt
    {
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

    // deagle buy prompt
    {
        const dp  = DEAGLE_PICKUP;
        const dcx = dp.x + dp.w / 2, dcy = dp.y + dp.h / 2;
        if (Math.hypot(player.x - dcx, player.y - dcy) < BARRICADE_RANGE && !inventory.includes(6)) {
            const canAfford = money >= WEAPON_DEFS[6].cost;
            drawHudPrompt(canAfford
                ? `[F] Buy Desert Eagle  £${WEAPON_DEFS[6].cost}`
                : `Desert Eagle  £${WEAPON_DEFS[6].cost}  (need £${WEAPON_DEFS[6].cost - money} more)`);
            return;
        }
    }

    // car repair prompt
    if (slidingDoorOpen && !gameWon) {
        const car = ESCAPE_CAR;
        const cx  = car.x + car.w / 2, cy = car.y + car.h / 2;
        if (Math.hypot(player.x - cx, player.y - cy) < BARRICADE_RANGE + 20) {
            if (carRepairStage < CAR_REPAIR_STAGES) {
                const canAfford = money >= 500;
                drawHudPrompt(canAfford
                    ? `[F] Repair Car  £500  (${carRepairStage}/${CAR_REPAIR_STAGES})`
                    : `Repair Car  £500  (need £${500 - money} more)  (${carRepairStage}/${CAR_REPAIR_STAGES})`);
            }
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

        if (z.isBoss) {
            // arms — bigger, darker
            ctx.fillStyle = '#1a3a14';
            ctx.beginPath(); ctx.ellipse(22, -11, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(22, 11, 14, 7, 0, 0, Math.PI * 2); ctx.fill();

            // body
            ctx.fillStyle = '#1e5a18';
            ctx.beginPath(); ctx.ellipse(0, 0, 14, 20, 0, 0, Math.PI * 2); ctx.fill();

            // armour chest plate
            ctx.fillStyle = '#4a4a4a';
            ctx.beginPath(); ctx.ellipse(2, 0, 11, 16, 0, 0, Math.PI * 2); ctx.fill();
            // plate highlight lines
            ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(10, -8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-7, 0);  ctx.lineTo(11, 0);  ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-6, 8);  ctx.lineTo(10, 8);  ctx.stroke();

            // head
            ctx.fillStyle = '#1a3a14';
            ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
            // armour helmet (top half)
            ctx.fillStyle = '#4a4a4a';
            ctx.beginPath(); ctx.arc(0, 0, 9, Math.PI, 0); ctx.fill();
            ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();

            // health bar above boss
            const hpRatio = (z.hp ?? z.maxHp) / (z.maxHp ?? 20);
            const bw = 44;
            ctx.rotate(-(z.angle ?? 0)); // keep bar upright
            ctx.fillStyle = '#222';
            ctx.fillRect(-bw / 2, -z.radius - 14, bw, 6);
            ctx.fillStyle = hpRatio > 0.5 ? '#40c040' : hpRatio > 0.25 ? '#c8c040' : '#c04040';
            ctx.fillRect(-bw / 2, -z.radius - 14, bw * hpRatio, 6);
            ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
            ctx.strokeRect(-bw / 2, -z.radius - 14, bw, 6);
        } else {
            // arms outstretched forward — drawn behind body
            ctx.fillStyle = '#1e5218';
            ctx.beginPath(); ctx.ellipse(16, -8, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(16, 8, 10, 5, 0, 0, Math.PI * 2); ctx.fill();

            // body
            ctx.fillStyle = '#286e20';
            ctx.beginPath(); ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2); ctx.fill();

            // head
            ctx.fillStyle = '#1e5218';
            ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        }

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

function drawMobileControls() {
    if (!isMobile) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    function drawJoy(touch, color) {
        if (!touch) return;
        const dx = touch.curX - touch.baseX;
        const dy = touch.curY - touch.baseY;
        const dist = Math.hypot(dx, dy);
        const kx = touch.baseX + (dist > JOY_RADIUS ? (dx / dist) * JOY_RADIUS : dx);
        const ky = touch.baseY + (dist > JOY_RADIUS ? (dy / dist) * JOY_RADIUS : dy);
        // outer ring
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(touch.baseX, touch.baseY, JOY_RADIUS, 0, Math.PI * 2); ctx.stroke();
        // knob
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(kx, ky, 24, 0, Math.PI * 2); ctx.fill();
    }

    drawJoy(leftTouch,  'rgba(255,255,255,0.35)');
    drawJoy(rightTouch, mouseHeld ? 'rgba(220,60,60,0.55)' : 'rgba(255,255,255,0.35)');

    function drawBtn(x, y, label, active) {
        ctx.fillStyle = active ? 'rgba(220,140,0,0.75)' : 'rgba(60,60,60,0.65)';
        ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(label, x, y);
    }

    drawBtn(canvas.width - 70, canvas.height - 110, 'R',  reloading);
    drawBtn(70,                canvas.height - 110, 'F',  fTouchId !== null);

    ctx.restore();
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
    if (muzzleFlash)       muzzleFlash.timer       -= dt;
    if (remoteMuzzleFlash) remoteMuzzleFlash.timer  -= dt;
    updateParticles(dt);
    updateCritTexts(dt);
    updatePlankDebris(dt);
    updateGroundMarks(dt);
    updateAmmoDrops(dt);
    updateBarricadeRepair(dt);
    updateWeaponPickup(dt);
    updateMysteryBox(dt);
    updateExtraRoomDoor(dt);
    updateSideRoomDoor(dt);
    updateGenRoomDoor(dt);
    updatePowerSwitch(dt);
    updateCarRepair(dt);
    updateWinSequence(dt);
    updateAllDead(dt);
    updateTurret(dt);
    updateZombies(dt);
    updateJoinerZombieDamage(dt);
    if (winPhase === 0) updateCamera();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // world-space drawing (affected by camera)
    ctx.save();
    if (isMobile) ctx.scale(MOBILE_ZOOM, MOBILE_ZOOM);
    ctx.translate(-camera.x, -camera.y);

    drawFloor();
    drawWorldBorder();
    drawBuilding();
    drawSlidingDoor();
    drawFinalRoom();
    drawExtraRoom();
    drawFurniture();
    drawGenRoom();
    drawTurret();
    drawGroundMarks();
    drawMysteryBox();
    drawWeaponPickup();
    drawAmmoDrops();
    drawPlankDebris();
    drawZombies();
    drawBullets();
    drawParticles();
    drawCritTexts();
    drawRemotePlayer();
    drawMuzzleFlash(remoteMuzzleFlash);
    drawPlayer();
    drawMuzzleFlash(muzzleFlash);

    ctx.restore();

    // screen-space drawing (not affected by camera)
    drawHotbar();
    drawAmmo();
    drawMoney();
    drawHealthBar();
    drawWaveHUD();
    drawBarricadePrompt();
    drawMysteryBoxResult();
    drawMobileControls();
    drawWinScreen();
    drawDeathScreen();

    requestAnimationFrame(gameLoop);
}

// game loop starts only once the peer connection opens
