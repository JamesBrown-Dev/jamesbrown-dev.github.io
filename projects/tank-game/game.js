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

let money = 0;
let gameOver = false;

// each upgrade: name, description, cost per level, max levels, and what it does
const upgradeDefinitions = [
    { name: 'Move Speed',   desc: '+15 px/s',        baseCost: 30,  maxLevel: 5,    apply() { tankSpeed += 15; } },
    { name: 'Turret Speed', desc: '+0.5 turn/s',      baseCost: 30,  maxLevel: 5,    apply() { turretSpeed += 0.25; } },
    { name: 'Bullet Speed', desc: '+100 px/s',        baseCost: 50,  maxLevel: 5,    apply() { bulletSpeed += 100; } },
    { name: 'Rotate Speed', desc: '+0.25 turn/s',     baseCost: 50, maxLevel: 5, apply() { tankRotateSpeed += 0.25; } },
    { name: 'Fire Rate',    desc: '-1 reload time',   baseCost: 75,  maxLevel: 5,    apply() { reloadTime = Math.max(1, reloadTime - 1); } },
    { name: 'Max Health',   desc: '+2 max HP',        baseCost: 150, maxLevel: 3,    apply() { player.maxHealth+=2; player.health = player.maxHealth; } },
    { name: 'Bullet Damage',desc: '+1 bullet damage',   baseCost: 150,  maxLevel: 2,    apply() { bulletDamage += 1;} },
    { name: 'Repair',       desc: 'restore 1 HP',     baseCost: 100, maxLevel: null, apply() { player.health = Math.min(player.health + 1, player.maxHealth); } },
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
let spawnTimer = 8;        // seconds until next spawn
const maxLiveEnemies = 5;  // cap so the screen doesn't get overrun

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
        if (keys['w']) {
            this.x += Math.cos(this.angle) * tankSpeed * dt;
            this.y += Math.sin(this.angle) * tankSpeed * dt;
        }
        if (keys['s']) {
            this.x -= Math.cos(this.angle) * tankSpeed * dt;
            this.y -= Math.sin(this.angle) * tankSpeed * dt;
        }
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
        // each enemy gets 1 more health per 3 defeated, capped at 3
        this.health = Math.min(3, 1 + Math.floor(enemiesDefeated / 3));
        this.maxHealth = this.health;
        this.speed = 30 + enemiesDefeated * 2;
        this.color = '#8B0000';
        this.dead = false;
        this.wreckHealth = 5;
        this.state = 'approach';
        this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
        this.strafeTimer = 2 + Math.random() * 2;
        this.fireTimer = Math.max(1, Math.random()*7 - enemiesDefeated * 0.1);
    }

    // runs the enemy AI state machine (approach/strafe/retreat), rotates toward desired angle, moves forward, and fires
    update(dt) {
        if (this.dead) return;

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angleToPlayer = Math.atan2(dy, dx);

        // turret always aims at player
        this.turretAngle = angleToPlayer;

        // switch state based on distance to player
        if (dist > 300) {
            this.state = 'approach';
        } else if (dist < 150) {
            this.state = 'retreat';
        } else {
            this.state = 'strafe';
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
        } else {
            // strafe: face perpendicular to the player, then drive forward
            desiredAngle = angleToPlayer + (Math.PI / 2) * this.strafeDirection;
        }

        // rotate body toward the desired angle
        let diff = desiredAngle - this.angle;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), 1.5 * dt);

        // always drive forward along the direction the body is facing
        this.x += Math.cos(this.angle) * this.speed * dt;
        this.y += Math.sin(this.angle) * this.speed * dt;

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

        // shoot at player when fire timer is ready (turret always faces player)
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
            enemyBullets.push({
                x: this.x + Math.cos(this.turretAngle) * 22,
                y: this.y + Math.sin(this.turretAngle) * 22,
                angle: this.turretAngle,
                speed: 400 + enemiesDefeated*5,
                shooter: this
            });
            this.fireTimer = 2 + Math.random() * 2;
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
        ctx.fillStyle = this.dead ? '#333' : '#5a0000';
        ctx.fillRect(-19, -8, 6, 3);
        ctx.fillRect(-19, -1, 6, 3);
        ctx.fillRect(-19, 5, 6, 3);

        ctx.restore();

        // turret base
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fillStyle = this.dead ? '#444' : '#5a0000';
        ctx.fill();

        // barrel
        ctx.rotate(this.turretAngle);
        ctx.fillStyle = this.dead ? '#333' : '#5a0000';
        ctx.fillRect(0, -4, 22, 8);

        // hatch
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = this.dead ? '#444' : '#8B0000';
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

            // health fill
            ctx.fillStyle = '#cc2200';
            ctx.fillRect(barX, barY, (this.health / this.maxHealth) * barW, barH);

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
            ctx.fillRect(barX, barY, (this.wreckHealth / 5) * barW, barH);

            ctx.fillStyle = '#aaa';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${this.wreckHealth}/5`, this.x, barY - 2);
            ctx.textAlign = 'left';
        }
    }
}

const player = new Player(400, 300);
const enemies = [];

// creates a new enemy at a random point on one of the four canvas edges
function spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = Math.random() * canvas.width; y = 0; }
    else if (side === 1) { x = canvas.width; y = Math.random() * canvas.height; }
    else if (side === 2) { x = Math.random() * canvas.width; y = canvas.height; }
    else { x = 0; y = Math.random() * canvas.height; }
    enemies.push(new Enemy(x, y));
}

spawnEnemy();

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
                bullets.splice(bi, 1);
                if (!enemies[ei].dead) {
                    enemies[ei].health-=bulletDamage;
                    if (enemies[ei].health <= 0) {
                        enemies[ei].dead = true;
                        enemiesDefeated++;
                        money += 20 + enemiesDefeated; //20 per tank max health
                        updateUpgradesUI();
                    }
                } else {
                    // hit a wreck — damage it and remove it entirely when destroyed
                    enemies[ei].wreckHealth-=bulletDamage;
                    if (enemies[ei].wreckHealth <= 0) {
                        enemies.splice(ei, 1);
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
                if (!enemies[wi].dead) {
                    enemies[wi].health--;
                    if (enemies[wi].health <= 0) {
                        enemies[wi].dead = true;
                        enemiesDefeated++;
                        money += 30 + enemiesDefeated * 5;
                        updateUpgradesUI();
                    }
                } else {
                    enemies[wi].wreckHealth--;
                    if (enemies[wi].wreckHealth <= 0) enemies.splice(wi, 1);
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
            enemyBullets.splice(i, 1);
            // only deal damage if player is still alive
            if (!player.dying) {
                player.health--;
                updateHealthBar();
                updateUpgradesUI();
                if (player.health <= 0) {
                    player.dying = true;
                    player.dyingTimer = 2;
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
    document.getElementById('game-over-screen').classList.add('visible');
}

// resets all game state back to defaults and restarts the game loop
function restartGame() {
    // reset upgradeable game settings to their base values
    turretSpeed = BASE_TURRET_SPEED;
    tankSpeed = BASE_TANK_SPEED;
    bulletSpeed = BASE_BULLET_SPEED;
    reloadTime = BASE_RELOAD_TIME;

    // reset counters and timers
    money = 0;
    enemiesDefeated = 0;
    spawnTimer = 8;
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

    // reset player
    player.x = 400;
    player.y = 300;
    player.angle = 0;
    player.turretAngle = 0;
    player.health = 3;
    player.maxHealth = 3;
    player.dying = false;
    player.dyingTimer = 0;

    // spawn first enemy and update UI
    spawnEnemy();
    updateUpgradesUI();
    updateHealthBar();

    document.getElementById('game-over-screen').classList.remove('visible');
    requestAnimationFrame(gameLoop);
}

// updates the HTML health bar width and colour to reflect the player's current health
function updateHealthBar() {
    const pct = player.health / player.maxHealth;
    document.getElementById('health-bar-fill').style.width = `${pct * 100}%`;
    document.getElementById('health-text').textContent = `${player.health} / ${player.maxHealth}`;
    const fill = document.getElementById('health-bar-fill');
    if (pct > 0.6) fill.style.background = '#5a8f3c';
    else if (pct > 0.3) fill.style.background = '#c8a000';
    else fill.style.background = '#b03020';
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
    checkBulletEnemyCollisions();
    updateTrackMarks(deltaTime);
    updateSpawning(deltaTime);
    for (const enemy of enemies) enemy.update(deltaTime);
    drawTrackMarks();
    for (const enemy of enemies) enemy.draw();
    player.draw();
    drawBullets();
    drawEnemyBullets();
    if (!gameOver) requestAnimationFrame(gameLoop);
}

initUpgradesUI();
updateHealthBar();
gameLoop();
