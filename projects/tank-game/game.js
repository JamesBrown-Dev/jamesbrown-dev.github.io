const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const keys = {};
const mouse = { x: 0, y: 0 };


// game settings — use let so upgrades can modify them
let turretSpeed = 1;
let tankRotateSpeed = 1;
let tankSpeed = 50;
let bulletSpeed = 400;
let reloadTime = 7;
let bulletDamage = 1;

// base values used to reset upgradeable settings on restart
const BASE_TURRET_SPEED = 1;
const BASE_TANK_SPEED = 50;
const BASE_BULLET_SPEED = 400;
const BASE_RELOAD_TIME = 6;
const BASE_BULLET_DAMAGE = 1

let money = 0;
let score = 0;
let gameOver = false;

// each upgrade: name, description, cost per level, max levels, and what it does
const upgradeDefinitions = [
    { name: 'Move Speed',   desc: '+15 px/s',        baseCost: 30,  maxLevel: 5,    apply() { tankSpeed += 15; } },
    { name: 'Turret Speed', desc: '+0.5 turn/s',      baseCost: 30,  maxLevel: 5,    apply() { turretSpeed += 0.25; } },
    { name: 'Rotate Speed', desc: '+0.25 turn/s',     baseCost: 30, maxLevel: 5, apply() { tankRotateSpeed += 0.25; } },
    { name: 'Bullet Speed', desc: '+100 px/s',        baseCost: 50,  maxLevel: 5,    apply() { bulletSpeed += 100; } },
    { name: 'Fire Rate',    desc: '-1s reload time',   baseCost: 75,  maxLevel: 5,    apply() { reloadTime = Math.max(1, reloadTime - 1); } },
    { name: 'Max Health',   desc: '+2 max HP',        baseCost: 100, maxLevel: 3,    apply() { player.maxHealth += 2; player.health += 2; updateHealthBar(); } },
    { name: 'Bullet Damage',desc: '+1 bullet damage',   baseCost: 100,  maxLevel: 2,    apply() { bulletDamage += 1;} },
];
const upgradeLevels = upgradeDefinitions.map(() => 0);

// returns the current price of an upgrade, scaling up 50% per level already bought
function getUpgradeCost(index) {
    const def = upgradeDefinitions[index];
    // repair always costs the same; others scale up 50% per level bought
    if (def.maxLevel === null) return def.baseCost;
    return def.baseCost + upgradeLevels[index] * Math.floor(def.baseCost * 0.5);
}

// validates and applies an upgrade purchase, deducting the cost from money
function buyUpgrade(index) {
    const def = upgradeDefinitions[index];
    const isRepair = def.maxLevel === null;
    if (!isRepair && upgradeLevels[index] >= def.maxLevel) return;
    if (isRepair && player.health >= player.maxHealth) return;
    const cost = getUpgradeCost(index);
    if (money < cost) return;
    money -= cost;
    if (!isRepair) upgradeLevels[index]++;
    def.apply();
    updateUpgradesUI();
}

// refreshes the money display and all upgrade button states (cost, level, disabled)
function updateUpgradesUI() {
    document.getElementById('money-display').textContent = `£${money}`;
    document.querySelectorAll('.upgrade-item').forEach((item, i) => {
        const def = upgradeDefinitions[i];
        const isRepair = def.maxLevel === null;
        const level = upgradeLevels[i];
        const cost = getUpgradeCost(i);
        const maxed = !isRepair && level >= def.maxLevel;
        const cantAfford = money < cost;
        const noHealth = isRepair && player.health >= player.maxHealth;

        item.querySelector('.upgrade-level').textContent =
            isRepair ? `${player.health}/${player.maxHealth} HP` : `${level}/${def.maxLevel}`;
        const btn = item.querySelector('.upgrade-btn');
        btn.textContent = maxed ? 'MAXED' : `£${cost}`;
        btn.disabled = maxed || cantAfford || noHealth;
    });
    updateHealthBar();
}

// builds the upgrade panel HTML from upgradeDefinitions on first load
function initUpgradesUI() {
    const list = document.getElementById('upgrade-list');
    upgradeDefinitions.forEach((def, i) => {
        const item = document.createElement('div');
        item.className = 'upgrade-item';
        const levelText = def.maxLevel === null ? '3/3 HP' : `0/${def.maxLevel}`;
        item.innerHTML = `
            <div class="upgrade-header">
                <span class="upgrade-name">${def.name}</span>
                <span class="upgrade-level">${levelText}</span>
            </div>
            <div class="upgrade-desc">${def.desc}</div>
            <button class="upgrade-btn" onclick="buyUpgrade(${i})">£${def.baseCost}</button>
        `;
        list.appendChild(item);
    });
}

const bullets = [];
const enemyBullets = [];
let reloadTimer = 0;
const trackMarks = [];
let trackMarkTimer = 0;
let lastTime = 0;
let enemiesDefeated = 0;
let spawnTimer = 4;        // seconds until next spawn
const maxLiveEnemies = 5;  // cap so the screen doesn't get overrun
let nextSpawn = null;      // pre-picked spawn position shown as an edge indicator
let nextSpawn2 = null;     // second spawn position when a double spawn is pre-rolled
let playerHitTimer = 0;    // drives the red vignette flash when the player is hit
const floatingTexts = [];  // pickup popups that rise and fade over a crate collection

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 40;
        this.height = 30;
        this.color = '#5a8f3c';
        this.angle = 0;
        this.turretAngle = 0;
        this.health = 3;
        this.maxHealth = 3;
        this.dying = false;
        this.dyingTimer = 0;
        this.currentSpeed = 0; // actual movement speed, lerped for smooth acceleration
        this.vx = 0;           // world-space velocity, used by snipers to lead shots
        this.vy = 0;
        this.muzzleFlashTimer = 0;
    }

    // handles WASD movement, rotation, boundary clamping, and collision push-out with enemies
    update(dt) {
        if (this.dying) {
            this.dyingTimer -= dt;
            if (this.dyingTimer <= 0) triggerGameOver();
            return;
        }

        const rot = tankRotateSpeed * dt;
        if (keys['a']) {
            this.angle -= rot;
            this.turretAngle -= rot;
        }
        if (keys['d']) {
            this.angle += rot;
            this.turretAngle += rot;
        }
        // lerp toward target speed so the tank accelerates and decelerates smoothly
        let targetSpeed = 0;
        if (keys['w']) targetSpeed =  tankSpeed;
        if (keys['s']) targetSpeed = -tankSpeed;
        this.currentSpeed += (targetSpeed - this.currentSpeed) * Math.min(1, 8 * dt);

        this.x += Math.cos(this.angle) * this.currentSpeed * dt;
        this.y += Math.sin(this.angle) * this.currentSpeed * dt;

        // keep world-space velocity up to date for sniper prediction
        this.vx = Math.cos(this.angle) * this.currentSpeed;
        this.vy = Math.sin(this.angle) * this.currentSpeed;
        if (this.muzzleFlashTimer > 0) this.muzzleFlashTimer -= dt;
        // clamp position so the tank can't drive off the edge of the canvas
        this.x = Math.max(this.width / 2, Math.min(canvas.width - this.width / 2, this.x));
        this.y = Math.max(this.height / 2, Math.min(canvas.height - this.height / 2, this.y));

        // push player out of all enemies (dead or alive)
        for (const enemy of enemies) {
            const dx = this.x - enemy.x;
            const dy = this.y - enemy.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = 38;
            if (dist < minDist && dist > 0) {
                this.x += (dx / dist) * (minDist - dist);
                this.y += (dy / dist) * (minDist - dist);
            }
        }

        // push player out of rocks
        for (const rock of rocks) {
            const dx = this.x - rock.x;
            const dy = this.y - rock.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = rock.r + 22;
            if (dist < minDist && dist > 0) {
                this.x += (dx / dist) * (minDist - dist);
                this.y += (dy / dist) * (minDist - dist);
            }
        }
    }

    // rotates the turret toward the mouse at a constant speed using shortest-path angle normalisation
    updateTurret(dt) {
        if (this.dying) return;
        // get the angle from the tank centre to the mouse in world space
        const targetAngle = Math.atan2(mouse.y - this.y, mouse.x - this.x);

        // find the difference between where the turret is and where it needs to go
        let diff = targetAngle - this.turretAngle;

        // normalise so the turret always takes the shortest route
        // without this it could spin the long way around (e.g. 350° instead of -10°)
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;

        // move at constant speed but stop exactly at the target if close enough
        const step = Math.sign(diff) * Math.min(Math.abs(diff), turretSpeed * dt);
        this.turretAngle += step;

        // keep turretAngle within -PI to PI to prevent drift over time
        if (this.turretAngle > Math.PI) this.turretAngle -= Math.PI * 2;
        if (this.turretAngle < -Math.PI) this.turretAngle += Math.PI * 2;
    }

    // draws the player tank body, tracks, turret, and aim line; uses grey colours when dying
    draw() {
        const bodyColor   = this.dying ? '#555' : this.color;
        const detailColor = this.dying ? '#333' : '#2d5216';
        const hatchColor  = this.dying ? '#444' : '#3d6b1f';

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // tracks
        ctx.fillStyle = this.dying ? '#1a1a1a' : '#2a2a2a';
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
        ctx.fillStyle = bodyColor;
        ctx.fillRect(-20, -11, 40, 22);

        // vents on the back
        ctx.fillStyle = detailColor;
        ctx.fillRect(-19, -8, 6, 3);
        ctx.fillRect(-19, -1, 6, 3);
        ctx.fillRect(-19, 5, 6, 3);

        ctx.restore();

        // turret base circle
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fillStyle = detailColor;
        ctx.fill();

        // barrel
        ctx.rotate(this.turretAngle);
        ctx.fillStyle = detailColor;
        ctx.fillRect(0, -4, 22, 8);

        // muzzle flash
        if (this.muzzleFlashTimer > 0) {
            const alpha = this.muzzleFlashTimer / 0.12;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#fff7a0';
            ctx.beginPath();
            ctx.arc(22, 0, 7 * alpha, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // hatch on turret
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = hatchColor;
        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.stroke();

        // aim line — hidden when dying
        if (!this.dying) {
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
        }

        ctx.restore();
    }
}

class Enemy {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.angle = 0;
        this.turretAngle = 0;
        this.width = 40;
        this.height = 30;
        this.health = 1 + Math.floor(Math.random() * Math.min(3, 1 + Math.max(0, enemiesDefeated - 2) / 3));
        this.maxHealth = this.health;
        this.speed = 30 + enemiesDefeated * 1;
        this.isSniper = enemiesDefeated >= 5 && Math.random() < 0.2;
        this.color       = this.isSniper ? '#6b0a0a' : '#8B0000';
        this.detailColor = this.isSniper ? '#420000' : '#5a0000';
        this.hatchColor  = this.isSniper ? '#6b0a0a' : '#8B0000';
        this.dead = false;
        this.wreckHealth = 3;
        this.state = 'approach';
        this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
        this.strafeTimer = 2 + Math.random() * 2;
        this.fireTimer = this.isSniper
            ? 3 + Math.random() * 5
            : Math.max(1, 1 + Math.random() * 7 - enemiesDefeated * 0.05);
        this.spawnMoveTimer = this.isSniper ? 1 : 0; // must drive forward for 1s before holding
        this.currentSpeed = this.speed; // used by snipers to smoothly decelerate to a halt
        this.retreatCooldown = this.isSniper ? this.fireTimer : 0; // prevents immediate retreat; resets after each shot
        this.muzzleFlashTimer = 0;
        this.hitFlashTimer = 0;
        this.trackMarkTimer = 0;
        this.spawnProtectionTimer = 2; // can't fire for 2s after spawning
    }

    // runs the enemy AI state machine (approach/strafe/retreat), rotates toward desired angle, moves forward, and fires
    update(dt) {
        if (this.dead) return;

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angleToPlayer = Math.atan2(dy, dx);

        // turret aims at player; snipers lead the shot based on player velocity
        if (this.isSniper && this.state === 'hold') {
            const sniperBulletSpeed = 700 + enemiesDefeated * 7;
            const travelTime = dist / sniperBulletSpeed;
            const predictX = player.x + player.vx * travelTime;
            const predictY = player.y + player.vy * travelTime;
            this.turretAngle = Math.atan2(predictY - this.y, predictX - this.x);
        } else {
            this.turretAngle = angleToPlayer;
        }

        // switch state based on distance to player
        if (this.isSniper) {
            if (this.spawnMoveTimer > 0) {
                // force approach for the first second after spawning
                this.spawnMoveTimer -= dt;
                this.state = 'approach';
            } else if (dist > (this.state === 'hold' ? 850 : 750)) {
                // approach until 750px; once holding, don't leave until 850px
                this.state = 'approach';
            } else if (dist < 220) {
                // wait out the cooldown so the sniper can get a shot off before retreating
                this.state = this.retreatCooldown > 0 ? 'hold' : 'retreat';
            } else {
                this.state = 'hold';
            }
        } else {
            if (dist > 300) {
                this.state = 'approach';
            } else if (dist < 150) {
                this.state = 'retreat';
            } else {
                this.state = 'strafe';
            }
        }

        // occasionally flip strafe direction to feel less predictable
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
            this.strafeDirection *= -1;
            this.strafeTimer = 2 + Math.random() * 2;
        }

        // determine the angle the body should face based on state
        let desiredAngle;
        if (this.state === 'approach') {
            desiredAngle = angleToPlayer;
        } else if (this.state === 'retreat') {
            desiredAngle = angleToPlayer + Math.PI;
        } else if (this.state === 'hold') {
            desiredAngle = this.angle; // stay facing current direction
        } else {
            // strafe: face perpendicular to the player, then drive forward
            desiredAngle = angleToPlayer + (Math.PI / 2) * this.strafeDirection;
        }

        // rotate body toward the desired angle
        let diff = desiredAngle - this.angle;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), 1.5 * dt);

        // snipers decelerate smoothly toward 0 when holding, accelerate back when moving
        if (this.isSniper) {
            const targetSpeed = this.state === 'hold' ? 0 : this.speed;
            this.currentSpeed += (targetSpeed - this.currentSpeed) * Math.min(1, 4 * dt);
            this.x += Math.cos(this.angle) * this.currentSpeed * dt;
            this.y += Math.sin(this.angle) * this.currentSpeed * dt;
        } else if (this.state !== 'hold') {
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
        }

        // clamp to canvas
        this.x = Math.max(this.width / 2, Math.min(canvas.width - this.width / 2, this.x));
        this.y = Math.max(this.height / 2, Math.min(canvas.height - this.height / 2, this.y));

        // push out of dead tanks (wrecks)
        for (const other of enemies) {
            if (other === this) continue; //if (!other.dead || other === this) continue;
            const dx = this.x - other.x;
            const dy = this.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = 38;
            if (dist < minDist && dist > 0) {
                this.x += (dx / dist) * (minDist - dist);
                this.y += (dy / dist) * (minDist - dist);
            }
        }

        // push out of rocks
        for (const rock of rocks) {
            const dx = this.x - rock.x;
            const dy = this.y - rock.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = rock.r + 22;
            if (dist < minDist && dist > 0) {
                this.x += (dx / dist) * (minDist - dist);
                this.y += (dy / dist) * (minDist - dist);
            }
        }

        // drop track marks while moving; snipers only leave marks when actually rolling
        this.trackMarkTimer -= dt;
        if (this.trackMarkTimer <= 0 && (!this.isSniper || this.currentSpeed > 3)) {
            trackMarks.push({ x: this.x, y: this.y, angle: this.angle, alpha: 0.3 });
            this.trackMarkTimer = 0.1;
        }

        // shoot at player when fire timer is ready; snipers only tick their timer once nearly stopped
        if (this.isSniper && this.retreatCooldown > 0) this.retreatCooldown -= dt;
        if (this.muzzleFlashTimer > 0) this.muzzleFlashTimer -= dt;
        if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
        if (this.spawnProtectionTimer > 0) this.spawnProtectionTimer -= dt;
        if (!this.isSniper || this.currentSpeed < 3) this.fireTimer -= dt;
        if (this.fireTimer <= 0 && this.spawnProtectionTimer <= 0 && (!this.isSniper || this.state === 'hold')) {
            enemyBullets.push({
                x: this.x + Math.cos(this.turretAngle) * 22,
                y: this.y + Math.sin(this.turretAngle) * 22,
                angle: this.turretAngle,
                speed: this.isSniper ? 700 + enemiesDefeated * 7 : 400 + enemiesDefeated * 5,
                shooter: this
            });
            this.fireTimer = this.isSniper
                ? 3 + Math.random() * 3
                : 2 + Math.random() * 2;
            if (this.isSniper) this.retreatCooldown = 2.0; // allow 2s after each shot before retreating
            this.muzzleFlashTimer = 0.12;
        }
    }

    // draws the enemy tank; uses grey colours when dead to show it as a wreck
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // tracks
        ctx.fillStyle = this.dead ? '#1a1a1a' : '#2a2a2a';
        ctx.fillRect(-22, -14, 44, 3);
        ctx.fillRect(-22, 11, 44, 3);

        // body
        ctx.fillStyle = this.dead ? '#555' : this.color;
        ctx.fillRect(-20, -11, 40, 22);

        // vents
        ctx.fillStyle = this.dead ? '#333' : this.detailColor;
        ctx.fillRect(-19, -8, 6, 3);
        ctx.fillRect(-19, -1, 6, 3);
        ctx.fillRect(-19, 5, 6, 3);

        ctx.restore();

        // turret — rotate first so the sniper triangle base points with the barrel
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.turretAngle);

        // turret base: triangle for snipers, circle for regular
        ctx.fillStyle = this.dead ? '#444' : this.detailColor;
        if (this.isSniper) {
            ctx.beginPath();
            ctx.moveTo(12,  0);   // front tip (points toward barrel)
            ctx.lineTo(-8, -8);   // back top
            ctx.lineTo(-8,  8);   // back bottom
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, 9, 0, Math.PI * 2);
            ctx.fill();
        }

        // barrel
        ctx.fillStyle = this.dead ? '#333' : this.detailColor;
        if (this.isSniper) {
            ctx.fillRect(0, -3, 34, 6);
        } else {
            ctx.fillRect(0, -4, 22, 8);
        }

        // muzzle flash
        if (!this.dead && this.muzzleFlashTimer > 0) {
            const alpha = this.muzzleFlashTimer / 0.12;
            const tipX = this.isSniper ? 34 : 22;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#fff7a0';
            ctx.beginPath();
            ctx.arc(tipX, 0, 7 * alpha, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // hatch
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = this.dead ? '#444' : this.hatchColor;
        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();

        // health bar — live enemies show red HP bar, wrecks show brown durability bar
        if (!this.dead) {
            const barW = 40;
            const barH = 5;
            const barX = this.x - barW / 2;
            const barY = this.y - 32;

            // background track
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(barX, barY, barW, barH);

            ctx.fillStyle = '#cc2200';
            ctx.fillRect(barX, barY, (this.health / this.maxHealth) * barW, barH);

            // hit flash — brief white overlay when damaged
            if (this.hitFlashTimer > 0) {
                ctx.globalAlpha = (this.hitFlashTimer / 0.15) * 0.75;
                ctx.fillStyle = 'white';
                ctx.fillRect(barX, barY, barW, barH);
                ctx.globalAlpha = 1;
            }

            // text
            ctx.fillStyle = 'white';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${this.health}/${this.maxHealth}`, this.x, barY - 2);
            ctx.textAlign = 'left'; // reset to default
        } else {
            // wreck durability bar
            const barW = 40;
            const barH = 4;
            const barX = this.x - barW / 2;
            const barY = this.y - 32;

            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(barX, barY, barW, barH);

            ctx.fillStyle = '#6b4423';
            ctx.fillRect(barX, barY, (this.wreckHealth / 3) * barW, barH);

            ctx.fillStyle = '#aaa';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${this.wreckHealth}/3`, this.x, barY - 2);
            ctx.textAlign = 'left';
        }
    }
}

// eases from 0 to 1 with a slight overshoot — gives the crate spawn a pop feel
function easeOutBack(t) {
    const c = 1.70158 + 1;
    return 1 + c * Math.pow(t - 1, 3) + (c - 1) * Math.pow(t - 1, 2);
}

class Crate {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'heal' or 'money'
        this.r = 14;
        this.progress = 0; // 0→1 spawn animation
        this.collected = false;
        this.destroyed = false;
    }

    // animates the spawn pop-in and checks if the player has walked over it
    update(dt) {
        if (this.progress < 1) {
            this.progress = Math.min(1, this.progress + dt * 5);
        }
        if (this.progress >= 1 && !player.dying) {
            const dist = Math.hypot(player.x - this.x, player.y - this.y);
            if (dist < this.r + 18) {
                this.collected = true;
                if (this.type === 'heal') {
                    player.health = Math.min(player.health + 1, player.maxHealth);
                    updateHealthBar();
                    spawnFloatingText(this.x, this.y, '+', '#ff5555');
                } else {
                    const earned = 25 + Math.floor(Math.random() * 26); // £25–50
                    money += earned;
                    spawnFloatingText(this.x, this.y, `£${earned}`, '#f0c040');
                }
                updateUpgradesUI();
            }
            // enemy tanks driving over a crate crush it
            if (!this.destroyed) {
                for (const enemy of enemies) {
                    if (!enemy.dead && Math.hypot(enemy.x - this.x, enemy.y - this.y) < this.r + 20) {
                        this.destroyed = true;
                        spawnExplosion(this.x, this.y, 'crate');
                        break;
                    }
                }
            }
        }
    }

    // draws the crate with a wooden plank texture and a coloured type icon
    draw() {
        const scale = easeOutBack(this.progress);
        if (scale <= 0) return;
        const r = this.r;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(scale, scale);

        // horizontal plank bands — alternating shades
        const bands = ['#9b7a1a', '#8a6c16', '#9b7a1a', '#8a6c16'];
        const bandH = (r * 2) / bands.length;
        bands.forEach((col, i) => {
            ctx.fillStyle = col;
            ctx.fillRect(-r, -r + i * bandH, r * 2, bandH);
        });

        // plank dividers
        ctx.strokeStyle = '#5a3e08';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        [-r / 2, 0, r / 2].forEach(y => { ctx.moveTo(-r, y); ctx.lineTo(r, y); });
        ctx.moveTo(0, -r); ctx.lineTo(0, r);
        ctx.stroke();

        // outer border
        ctx.strokeStyle = '#3a2806';
        ctx.lineWidth = 2;
        ctx.strokeRect(-r, -r, r * 2, r * 2);

        // corner nails
        ctx.fillStyle = '#3a2806';
        const n = r * 0.15;
        [[-r + n, -r + n], [r - n, -r + n], [-r + n, r - n], [r - n, r - n]].forEach(([nx, ny]) => {
            ctx.beginPath();
            ctx.arc(nx, ny, n, 0, Math.PI * 2);
            ctx.fill();
        });

        // type icon
        ctx.fillStyle = this.type === 'heal' ? '#ff5555' : '#f0c040';
        ctx.font = `bold ${r}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.type === 'heal' ? '+' : '£', 0, 1);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';

        ctx.restore();
    }
}

class Rock {
    constructor(x, y, r) {
        this.x = x;
        this.y = y;
        this.r = r; // collision radius
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        // drop shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.beginPath();
        ctx.ellipse(4, 5, this.r * 0.9, this.r * 0.76, 0, 0, Math.PI * 2);
        ctx.fill();

        // base rock body
        ctx.fillStyle = '#7d7d72';
        ctx.beginPath();
        ctx.ellipse(0, 0, this.r, this.r * 0.82, 0.4, 0, Math.PI * 2);
        ctx.fill();

        // mid-tone patch for depth
        ctx.fillStyle = '#5e5e55';
        ctx.beginPath();
        ctx.ellipse(this.r * 0.18, this.r * 0.12, this.r * 0.55, this.r * 0.44, 1.1, 0, Math.PI * 2);
        ctx.fill();

        // highlight
        ctx.fillStyle = '#a0a095';
        ctx.beginPath();
        ctx.ellipse(-this.r * 0.28, -this.r * 0.28, this.r * 0.32, this.r * 0.26, -0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

const player = new Player(550, 375);
const enemies = [];
const crates = [];
const explosions = [];
const rocks = [];

// spawns a burst of particles at (x, y); type controls colour and scale
function spawnExplosion(x, y, type) {
    let count, colors, speedRange, sizeRange, lifetime;
    if (type === 'enemy') {
        count = 18;
        colors = ['#ff8800', '#ff4400', '#ffdd00', '#cc2200', '#ff6600'];
        speedRange = [40, 140]; sizeRange = [3, 7]; lifetime = [0.4, 0.8];
    } else if (type === 'wreck') {
        count = 10;
        colors = ['#555', '#888', '#666', '#3a3a3a', '#6b4423'];
        speedRange = [20, 80]; sizeRange = [2, 5]; lifetime = [0.3, 0.6];
    } else if (type === 'spark') {
        count = 7;
        colors = ['#ffdd00', '#ff8800', '#ffffff', '#ffaa00'];
        speedRange = [40, 130]; sizeRange = [1.5, 3]; lifetime = [0.08, 0.2];
    } else if (type === 'crate') {
        count = 16;
        colors = ['#9b7a1a', '#5a3e08', '#c49a22', '#e8c060', '#7a5c10'];
        speedRange = [60, 200]; sizeRange = [2, 6]; lifetime = [0.25, 0.55];
    } else { // player
        count = 25;
        colors = ['#5a8f3c', '#ff8800', '#ff4400', '#ffdd00', '#3d6b1f'];
        speedRange = [50, 180]; sizeRange = [4, 9]; lifetime = [0.5, 1.0];
    }
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
        const size  = sizeRange[0]  + Math.random() * (sizeRange[1]  - sizeRange[0]);
        const life  = lifetime[0]   + Math.random() * (lifetime[1]   - lifetime[0]);
        explosions.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size,
            color: colors[Math.floor(Math.random() * colors.length)],
            life,
            maxLife: life
        });
    }
}

function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const p = explosions[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // simple drag so particles slow down as they spread
        p.vx *= 1 - 4 * dt;
        p.vy *= 1 - 4 * dt;
        p.life -= dt;
        if (p.life <= 0) explosions.splice(i, 1);
    }
}

function drawExplosions() {
    for (const p of explosions) {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// spawns a floating text label that rises and fades — used for crate pickups
function spawnFloatingText(x, y, text, color) {
    floatingTexts.push({ x, y, text, color, life: 1.0, maxLife: 1.0 });
}

function updateFloatingTexts(dt) {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].y -= 55 * dt; // rises upward
        floatingTexts[i].life -= dt;
        if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
    }
}

function drawFloatingTexts() {
    for (const ft of floatingTexts) {
        const t = ft.life / ft.maxLife;            // 1 → 0 as it fades
        const scale = 1 + 0.5 * (1 - t);           // grows slightly as it rises
        const alpha = t < 0.4 ? t / 0.4 : 1;       // fade out in last 40% of life
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(ft.x, ft.y);
        ctx.scale(scale, scale);
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // dark outline for readability
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 4;
        ctx.strokeText(ft.text, 0, 0);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, 0, 0);
        ctx.restore();
    }
}

let crateSpawnTimer = 10;
const maxCrates = 3;

// returns a random position on one of the four canvas edges, at least 300px from the player
function randomEdgePos() {
    let pos;
    for (let attempt = 0; attempt < 10; attempt++) {
        const side = Math.floor(Math.random() * 4);
        if (side === 0)      pos = { x: Math.random() * canvas.width, y: 0 };
        else if (side === 1) pos = { x: canvas.width, y: Math.random() * canvas.height };
        else if (side === 2) pos = { x: Math.random() * canvas.width, y: canvas.height };
        else                 pos = { x: 0, y: Math.random() * canvas.height };
        if (Math.hypot(pos.x - player.x, pos.y - player.y) >= 300) return pos;
    }
    return pos; // fallback after 10 attempts (very unlikely to be needed)
}

// pre-picks the next spawn position(s); also pre-rolls whether a double spawn will occur
function pickNextSpawnPos() {
    nextSpawn = randomEdgePos();
    nextSpawn2 = (enemiesDefeated >= 7 && Math.random() < 0.5) ? randomEdgePos() : null;
}

// spawns enemy/enemies at the pre-picked position(s) then immediately picks the next ones
function spawnEnemy() {
    if (!nextSpawn) pickNextSpawnPos();
    const liveCount = enemies.filter(e => !e.dead).length;
    enemies.push(new Enemy(nextSpawn.x, nextSpawn.y));
    if (nextSpawn2 && liveCount + 1 < maxLiveEnemies) {
        enemies.push(new Enemy(nextSpawn2.x, nextSpawn2.y));
    }
    pickNextSpawnPos();
}

pickNextSpawnPos();

//listens for key down
document.addEventListener('keydown', function(e) {
    keys[e.key] = true;
});

//listens for key up
document.addEventListener('keyup', function(e) {
    keys[e.key] = false;
});

//tracks when the mouse moves
document.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

//tracks when click is pressed on the canvas only (prevents UI buttons from firing bullets)
canvas.addEventListener('click', function() {
    if (player.dying || gameOver || reloadTimer > 0) return;
    bullets.push({
        x: player.x + Math.cos(player.turretAngle) * 22,
        y: player.y + Math.sin(player.turretAngle) * 22,
        angle: player.turretAngle,
        speed: bulletSpeed
    });
    player.muzzleFlashTimer = 0.12;
    reloadTimer = reloadTime;
});

// checks whether a bullet point is inside a rotated rectangle (the target tank)
// works by transforming the bullet into the target's local coordinate space first
function rectCollision(bullet, target) {
    const dx = bullet.x - target.x;
    const dy = bullet.y - target.y;
    const localX = dx * Math.cos(-target.angle) - dy * Math.sin(-target.angle);
    const localY = dx * Math.sin(-target.angle) + dy * Math.cos(-target.angle);
    return Math.abs(localX) < target.width / 2 && Math.abs(localY) < target.height / 2;
}

// tests every player bullet against every enemy; removes the bullet on hit and reduces enemy health
function checkBulletEnemyCollisions() {
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
            if (rectCollision(bullets[bi], enemies[ei])) {
                const bx = bullets[bi].x, by = bullets[bi].y;
                bullets.splice(bi, 1);
                if (!enemies[ei].dead) {
                    enemies[ei].health -= bulletDamage;
                    enemies[ei].hitFlashTimer = 0.15;
                    if (enemies[ei].health <= 0) {
                        enemies[ei].dead = true;
                        spawnExplosion(enemies[ei].x, enemies[ei].y, 'enemy');
                        enemiesDefeated++;
                        score++;
                        money += 25 + enemiesDefeated * 2; //20 per tank max health
                        updateScore();
                        updateUpgradesUI();
                    } else {
                        spawnExplosion(bx, by, 'spark');
                    }
                } else {
                    // hit a wreck — damage it and remove it entirely when destroyed
                    enemies[ei].wreckHealth -= bulletDamage;
                    if (enemies[ei].wreckHealth <= 0) {
                        spawnExplosion(enemies[ei].x, enemies[ei].y, 'wreck');
                        enemies.splice(ei, 1);
                    } else {
                        spawnExplosion(bx, by, 'spark');
                    }
                }
                break;
            }
        }
    }
}

// moves enemy bullets, removes them if out of bounds or hitting a wreck, and deals damage to the player on hit
function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        enemyBullets[i].x += Math.cos(enemyBullets[i].angle) * enemyBullets[i].speed * dt;
        enemyBullets[i].y += Math.sin(enemyBullets[i].angle) * enemyBullets[i].speed * dt;

        // remove if off canvas
        if (enemyBullets[i].x < 0 || enemyBullets[i].x > canvas.width ||
            enemyBullets[i].y < 0 || enemyBullets[i].y > canvas.height) {
            enemyBullets.splice(i, 1);
            continue;
        }

        // check if enemy bullet hits any other tank (live or wreck), skipping the shooter
        let hitOtherEnemy = false;
        for (let wi = enemies.length - 1; wi >= 0; wi--) {
            if (enemies[wi] === enemyBullets[i].shooter) continue;
            if (rectCollision(enemyBullets[i], enemies[wi])) {
                const ix = enemyBullets[i].x, iy = enemyBullets[i].y;
                if (!enemies[wi].dead) {
                    enemies[wi].health--;
                    enemies[wi].hitFlashTimer = 0.15;
                    if (enemies[wi].health <= 0) {
                        enemies[wi].dead = true;
                        spawnExplosion(enemies[wi].x, enemies[wi].y, 'enemy');
                        enemiesDefeated++;
                        score++;
                        money += 30 + enemiesDefeated * 5;
                        updateScore();
                        updateUpgradesUI();
                    } else {
                        spawnExplosion(ix, iy, 'spark');
                    }
                } else {
                    enemies[wi].wreckHealth--;
                    if (enemies[wi].wreckHealth <= 0) {
                        spawnExplosion(enemies[wi].x, enemies[wi].y, 'wreck');
                        enemies.splice(wi, 1);
                    } else {
                        spawnExplosion(ix, iy, 'spark');
                    }
                }
                hitOtherEnemy = true;
                break;
            }
        }
        if (hitOtherEnemy) {
            enemyBullets.splice(i, 1);
            continue;
        }

        // check if enemy bullet hits player tank body
        if (rectCollision(enemyBullets[i], player)) {
            const ix = enemyBullets[i].x, iy = enemyBullets[i].y;
            enemyBullets.splice(i, 1);
            // only deal damage if player is still alive
            if (!player.dying) {
                player.health--;
                playerHitTimer = 0.45;
                updateHealthBar();
                flashHealthBar();
                updateUpgradesUI();
                if (player.health <= 0) {
                    player.dying = true;
                    player.dyingTimer = 2;
                    spawnExplosion(player.x, player.y, 'player');
                } else {
                    spawnExplosion(ix, iy, 'spark');
                }
            }
        }
    }
}

// draws all active enemy bullets as small red circles
function drawEnemyBullets() {
    ctx.fillStyle = '#ff4444';
    for (const bullet of enemyBullets) {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ticks the reload timer and moves player bullets forward, removing any that leave the canvas
function updateBullets(dt) {
    if (reloadTimer > 0) reloadTimer -= dt;

    // loop backwards so removing a bullet doesn't skip the next one
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].x += Math.cos(bullets[i].angle) * bullets[i].speed * dt;
        bullets[i].y += Math.sin(bullets[i].angle) * bullets[i].speed * dt;

        // remove bullet if it has left the canvas
        if (bullets[i].x < 0 || bullets[i].x > canvas.width ||
            bullets[i].y < 0 || bullets[i].y > canvas.height) {
            bullets.splice(i, 1);
        }
    }
}

// drops track mark stamps while the player is moving and fades older ones out over time
function updateTrackMarks(dt) {
    trackMarkTimer -= dt;
    if ((keys['w'] || keys['s']) && trackMarkTimer <= 0) {
        trackMarks.push({ x: player.x, y: player.y, angle: player.angle, alpha: 0.3 });
        trackMarkTimer = 0.1;
    }
    for (let i = trackMarks.length - 1; i >= 0; i--) {
        trackMarks[i].alpha -= dt * 0.15;
        if (trackMarks[i].alpha <= 0) trackMarks.splice(i, 1);
    }
}

// draws a single flashing arrow at a canvas-edge position
function drawSpawnArrow(pos, alpha, g) {
    const { x, y } = pos;
    let drawX = x, drawY = y, arrowAngle;
    if (y <= 1)                    { drawY = 14;                 arrowAngle = Math.PI / 2; }
    else if (x >= canvas.width-1)  { drawX = canvas.width - 14;  arrowAngle = Math.PI; }
    else if (y >= canvas.height-1) { drawY = canvas.height - 14; arrowAngle = -Math.PI / 2; }
    else                           { drawX = 14;                 arrowAngle = 0; }

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(arrowAngle);

    const size = 11;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size, -size * 0.65);
    ctx.lineTo(-size,  size * 0.65);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, ${g}, 0, ${alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

// draws flashing arrows on the canvas edge showing where the next enemy/enemies will spawn
function drawSpawnIndicator() {
    if (!nextSpawn || gameOver) return;
    const liveCount = enemies.filter(e => !e.dead).length;
    if (liveCount >= maxLiveEnemies) return; // timer is frozen, no spawn imminent

    // smooth sine pulse at a fixed rate
    const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(Date.now() / 700 * Math.PI * 2));
    // colour shifts yellow → orange → red as urgency increases
    const urgency = Math.max(0, 1 - spawnTimer / 8);
    const g = Math.round(180 * (1 - urgency));

    drawSpawnArrow(nextSpawn, alpha, g);
    if (nextSpawn2 && liveCount + 1 < maxLiveEnemies) drawSpawnArrow(nextSpawn2, alpha, g);
}

// draws a red radial vignette that fades out after the player is hit
function drawHitVignette() {
    if (playerHitTimer <= 0) return;
    const alpha = (playerHitTimer / 0.45) * 0.27;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const gradient = ctx.createRadialGradient(cx, cy, canvas.height * 0.55, cx, cy, canvas.height * 1.0);
    gradient.addColorStop(0, `rgba(180, 0, 0, 0)`);
    gradient.addColorStop(1, `rgba(180, 0, 0, ${alpha})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// fills the canvas with a flat green background each frame
function drawBackground() {
    ctx.fillStyle = '#7aad5c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// renders all stored track marks as faded brown rectangles at the saved position and angle
function drawTrackMarks() {
    for (const mark of trackMarks) {
        ctx.save();
        ctx.translate(mark.x, mark.y);
        ctx.rotate(mark.angle);
        ctx.fillStyle = `rgba(101, 67, 33, ${mark.alpha})`;
        ctx.fillRect(-8, -14, 16, 3);
        ctx.fillRect(-8, 11, 16, 3);
        ctx.restore();
    }
}

// sets the game over flag and shows the game over overlay
function triggerGameOver() {
    gameOver = true;
    document.getElementById('final-score-value').textContent = score;
    document.getElementById('game-over-screen').classList.add('visible');
}

// resets all game state back to defaults and restarts the game loop
function restartGame() {
    // reset upgradeable game settings to their base values
    turretSpeed = BASE_TURRET_SPEED;
    tankSpeed = BASE_TANK_SPEED;
    bulletSpeed = BASE_BULLET_SPEED;
    reloadTime = BASE_RELOAD_TIME;
    bulletDamage =BASE_BULLET_DAMAGE

    // reset counters and timers
    money = 0;
    score = 0;
    enemiesDefeated = 0;
    spawnTimer = 4;
    reloadTimer = 0;
    trackMarkTimer = 0;
    lastTime = 0;
    gameOver = false;

    // reset upgrade levels
    upgradeLevels.fill(0);

    // clear all arrays
    bullets.length = 0;
    enemyBullets.length = 0;
    enemies.length = 0;
    trackMarks.length = 0;
    crates.length = 0;
    explosions.length = 0;
    floatingTexts.length = 0;
    nextSpawn = null;
    nextSpawn2 = null;
    playerHitTimer = 0;
    crateSpawnTimer = 10;

    // reset player
    player.x = 550;
    player.y = 375;
    player.angle = 0;
    player.turretAngle = 0;
    player.health = 3;
    player.maxHealth = 3;
    player.dying = false;
    player.dyingTimer = 0;
    player.currentSpeed = 0;
    player.vx = 0;
    player.vy = 0;
    player.muzzleFlashTimer = 0;

    // re-roll rock positions for the new run
    generateRocks();

    // pick first spawn position (enemy arrives on timer, not instantly)
    pickNextSpawnPos();
    updateUpgradesUI();
    updateHealthBar();
    updateScore();

    document.getElementById('game-over-screen').classList.remove('visible');
    requestAnimationFrame(gameLoop);
}

// updates the kills counter in the HUD
function updateScore() {
    document.getElementById('score-display').textContent = score;
}

// briefly flashes the health bar track to signal a hit
function flashHealthBar() {
    const track = document.getElementById('health-bar-track');
    track.classList.remove('hit-flash');
    void track.offsetWidth; // force reflow so the animation restarts
    track.classList.add('hit-flash');
}

// updates the HTML health bar width and colour to reflect the player's current health
// linearly interpolates between two RGB triples
function lerpColor(a, b, t) {
    return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
}

function updateHealthBar() {
    const pct = player.health / player.maxHealth;
    const fill = document.getElementById('health-bar-fill');
    fill.style.width = `${pct * 100}%`;
    // dark red → amber → green across the 0–1 health range
    const red   = [107,  16,  16];
    const amber = [200, 160,   0];
    const green = [ 90, 143,  60];
    fill.style.background = pct <= 0.5
        ? lerpColor(red,   amber, pct * 2)
        : lerpColor(amber, green, (pct - 0.5) * 2);
    document.getElementById('health-text').textContent = `${player.health} / ${player.maxHealth}`;
}

// counts down the spawn timer and creates a new enemy when it expires, up to the live enemy cap
function updateSpawning(dt) {
    const liveCount = enemies.filter(e => !e.dead).length;
    if (liveCount >= maxLiveEnemies) return;

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnEnemy();
        // interval shrinks as kills pile up (10s → 3s minimum)
        spawnTimer = Math.max(3, 10 - Math.floor(enemiesDefeated / 3));
    }
}

// draws all active player bullets as small black circles
function drawBullets() {
    ctx.fillStyle = 'black';
    for (const bullet of bullets) {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// spawns new crates on a timer and updates all existing ones, removing any that have been collected
function updateCrates(dt) {
    if (crates.length < maxCrates) {
        crateSpawnTimer -= dt;
        if (crateSpawnTimer <= 0) {
            let x, y, tries = 0, valid = false;
            while (!valid && tries < 30) {
                tries++;
                x = 80 + Math.random() * (canvas.width - 160);
                y = 80 + Math.random() * (canvas.height - 160);
                if (Math.hypot(x - player.x, y - player.y) < 150) continue;
                let onRock = false;
                for (const rock of rocks) {
                    if (Math.hypot(x - rock.x, y - rock.y) < rock.r + 20) { onRock = true; break; }
                }
                if (!onRock) valid = true;
            }
            crates.push(new Crate(x, y, Math.random() < 0.5 ? 'heal' : 'money'));
            crateSpawnTimer = 12 + Math.random() * 8; // next crate in 12–20s
        }
    }
    for (let i = crates.length - 1; i >= 0; i--) {
        crates[i].update(dt);
        if (crates[i].collected || crates[i].destroyed) crates.splice(i, 1);
    }
}

// draws all active crates
function drawCrates() {
    for (const crate of crates) crate.draw();
}

// randomly places rock formations, keeping them away from canvas edges and the player start
function generateRocks() {
    rocks.length = 0;
    let attempts = 0;
    while (rocks.length < 5 && attempts < 300) {
        attempts++;
        const r = 22 + Math.random() * 16; // radius 22–38px
        const x = 110 + Math.random() * (canvas.width  - 150);
        const y = 110 + Math.random() * (canvas.height - 150);
        if (Math.hypot(x - 550, y - 375) < 20) continue; // clear of player start
        let overlaps = false;
        for (const rock of rocks) {
            if (Math.hypot(x - rock.x, y - rock.y) < r + rock.r + 20) { overlaps = true; break; }
        }
        if (!overlaps) rocks.push(new Rock(x, y, r));
    }
}

// draws all rock formations
function drawRocks() {
    for (const rock of rocks) rock.draw();
}

// removes any bullet (player or enemy) that hits a rock, spawning an impact spark
function checkBulletRockCollisions() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        for (const rock of rocks) {
            if (Math.hypot(bullets[i].x - rock.x, bullets[i].y - rock.y) < rock.r) {
                spawnExplosion(bullets[i].x, bullets[i].y, 'spark');
                bullets.splice(i, 1);
                break;
            }
        }
    }
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        for (const rock of rocks) {
            if (Math.hypot(enemyBullets[i].x - rock.x, enemyBullets[i].y - rock.y) < rock.r) {
                spawnExplosion(enemyBullets[i].x, enemyBullets[i].y, 'spark');
                enemyBullets.splice(i, 1);
                break;
            }
        }
    }
}

// removes any bullet (player or enemy) that hits a crate, destroying it with a splinter burst
function checkBulletCrateCollisions() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = crates.length - 1; j >= 0; j--) {
            const c = crates[j];
            if (c.progress < 1 || c.destroyed) continue;
            if (Math.hypot(bullets[i].x - c.x, bullets[i].y - c.y) < c.r + 3) {
                spawnExplosion(c.x, c.y, 'crate');
                c.destroyed = true;
                bullets.splice(i, 1);
                break;
            }
        }
    }
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        for (let j = crates.length - 1; j >= 0; j--) {
            const c = crates[j];
            if (c.progress < 1 || c.destroyed) continue;
            if (Math.hypot(enemyBullets[i].x - c.x, enemyBullets[i].y - c.y) < c.r + 3) {
                spawnExplosion(c.x, c.y, 'crate');
                c.destroyed = true;
                enemyBullets.splice(i, 1);
                break;
            }
        }
    }
}

// main loop — called once per frame by requestAnimationFrame, calculates delta time and runs all updates and draws
function gameLoop(timestamp) {
    // timestamp is provided by requestAnimationFrame in milliseconds
    // skip the first frame (lastTime = 0) to avoid a huge initial deltaTime
    const deltaTime = lastTime ? (timestamp - lastTime) / 1000 : 0;
    lastTime = timestamp;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    player.update(deltaTime);
    player.updateTurret(deltaTime);
    updateBullets(deltaTime);
    updateEnemyBullets(deltaTime);
    checkBulletRockCollisions();
    checkBulletCrateCollisions();
    checkBulletEnemyCollisions();
    updateTrackMarks(deltaTime);
    updateSpawning(deltaTime);
    updateCrates(deltaTime);
    updateExplosions(deltaTime);
    updateFloatingTexts(deltaTime);
    if (playerHitTimer > 0) playerHitTimer -= deltaTime;
    for (const enemy of enemies) enemy.update(deltaTime);
    drawTrackMarks();
    drawRocks();
    drawCrates();
    for (const enemy of enemies) enemy.draw();
    player.draw();
    drawBullets();
    drawEnemyBullets();
    drawExplosions();
    drawFloatingTexts();
    drawHitVignette();
    drawSpawnIndicator();
    if (!gameOver) requestAnimationFrame(gameLoop);
}

// hides the start screen and begins the game loop
function startGame() {
    document.getElementById('start-screen').classList.remove('visible');
    requestAnimationFrame(gameLoop);
}

initUpgradesUI();
updateUpgradesUI();
updateHealthBar();
generateRocks();

// draw a static map preview behind the start screen
ctx.clearRect(0, 0, canvas.width, canvas.height);
drawBackground();
drawRocks();
