package com.futureminers

import box2dLight.ConeLight
import box2dLight.PointLight
import box2dLight.RayHandler
import com.badlogic.gdx.ApplicationAdapter
import com.badlogic.gdx.Gdx
import com.badlogic.gdx.Input.Keys
import com.badlogic.gdx.audio.Music
import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.OrthographicCamera
import com.badlogic.gdx.graphics.g2d.BitmapFont
import com.badlogic.gdx.graphics.g2d.SpriteBatch
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector2
import com.badlogic.gdx.math.Vector3
import com.badlogic.gdx.physics.box2d.*
import com.badlogic.gdx.utils.ScreenUtils

class Main : ApplicationAdapter() {

    private val PPM     = 32f
    private val ROOM_W  = 10f
    private val ROOM_H  = 7.5f
    private val SPAWN_X = ROOM_W / 2f

    private lateinit var camera: OrthographicCamera
    private lateinit var shapeRenderer: ShapeRenderer
    private lateinit var world: World
    private lateinit var rayHandler: RayHandler
    private lateinit var playerBody: Body
    private lateinit var torch: ConeLight

    private val playerSpeed = 5f

    // Player angles
    private var playerAngle    = MathUtils.PI / 2f  // radians, toward mouse
    private var torchLagAngle  = MathUtils.PI / 2f  // lags behind playerAngle

    // Candle / table
    private lateinit var candleLight: PointLight
    private val tableW  = 1.6f
    private val tableH  = 0.9f
    private val tableX  = ROOM_W / 2f - tableW / 2f
    private val tableY  = ROOM_H / 2f - tableH / 2f
    private val candleX = tableX + tableW / 2f
    private val candleY = tableY + tableH / 2f
    private var flickerTimer = 0f

    private lateinit var music: Music
    private lateinit var rooms: List<RoomData>

    private val lootItems    = mutableListOf<LootItem>()
    private data class DroppedItem(val x: Float, val y: Float, val type: ItemType, var pickedUp: Boolean = false, var cooldown: Float = 0.5f)
    private val droppedItems = mutableListOf<DroppedItem>()
    private lateinit var uiBatch: SpriteBatch
    private lateinit var font: BitmapFont
    private lateinit var uiCamera: OrthographicCamera

    private enum class ItemType(val isLight: Boolean = false) {
        TORCH(true), CANDLE(true), SILVER, GOLD, DIAMOND
    }
    private val INV_SIZE  = 4
    private val inventory = arrayOfNulls<ItemType>(INV_SIZE)  // slot 0 = torch, rest nullable
    private var selectedSlot    = 0
    private var activeLightSlot = 0  // slot index of active light; -1 = none
    private val SLOT_PX    = 72f
    private val SLOT_GAP   = 8f
    private val DROP_BTN_R = 36f   // radius of the drop/pickup buttons in screen pixels

    private lateinit var candlePlayerLight: PointLight

    private data class WallTorchData(val mountX: Float, val mountY: Float, val headX: Float, val headY: Float, val side: WallSide, val flickerOffset: Float, val light: PointLight)
    private val wallTorches = mutableListOf<WallTorchData>()
    private val spiders     = mutableListOf<Spider>()

    override fun create() {
        camera = OrthographicCamera()
        camera.setToOrtho(false, Gdx.graphics.width / PPM, Gdx.graphics.height / PPM)

        shapeRenderer = ShapeRenderer()
        uiBatch = SpriteBatch()
        font = BitmapFont()
        font.data.setScale(1.4f)
        uiCamera = OrthographicCamera()
        uiCamera.setToOrtho(false, Gdx.graphics.width.toFloat(), Gdx.graphics.height.toFloat())
        inventory[0] = ItemType.TORCH
        inventory[1] = ItemType.CANDLE
        world = World(Vector2(0f, 0f), true)

        RayHandler.setGammaCorrection(true)
        RayHandler.useDiffuseLight(true)
        rayHandler = RayHandler(world)
        rayHandler.setAmbientLight(0f, 0f, 0f, 0.03f)

        // Music
        music = Gdx.audio.newMusic(Gdx.files.internal("dragon-studio-creepy-industrial-sounds-ambience.mp3"))
        music.isLooping = true
        music.volume = 0.3f
        music.play()

        // Rooms
        rooms = RoomManager.generate()
        rooms.forEach { room ->
            room.walls.forEach { seg ->
                createWall(room.worldX + seg.x, room.worldY + seg.y, seg.w, seg.h)
            }
            room.circle?.let { createCircleWall(room.worldX, room.worldY, it) }
            room.bend?.let   { createBendWall(room.worldX, room.worldY, it) }
        }

        // Loot — 30% chance per non-start room; position random inside room bounds (inset from walls)
        val inset = RoomBuilder.WALL_T + 0.4f
        rooms.filter { it.depth > 0 && it.type != RoomType.BEND && it.type != RoomType.CORRIDOR && MathUtils.randomBoolean(0.30f) }.forEach { room ->
            val lx = room.worldX + MathUtils.random(inset, room.width  - inset)
            val ly = room.worldY + MathUtils.random(inset, room.height - inset)
            val type = when {
                room.depth >= 6 -> LootType.DIAMOND
                room.depth >= 3 -> LootType.GOLD
                else            -> LootType.SILVER
            }
            lootItems += LootItem(lx, ly, type)
        }

        // Wall torches — each solid wall has a 10% chance; never on doorway sides
        val wallT = RoomBuilder.WALL_T
        val armLen = 0.35f
        rooms.filter { it.depth > 0 && it.type != RoomType.CORRIDOR && it.type != RoomType.BEND }.forEach { room ->
            val bx = room.worldX + room.bodyOffsetX
            val by = room.worldY + room.bodyOffsetY
            for (side in WallSide.entries) {
                if (side in room.openSides) continue
                if (!MathUtils.randomBoolean(0.10f)) continue
                val mountX = when (side) {
                    WallSide.LEFT   -> bx + wallT
                    WallSide.RIGHT  -> bx + room.width - wallT
                    else            -> bx + room.width / 2f
                }
                val mountY = when (side) {
                    WallSide.BOTTOM -> by + wallT
                    WallSide.TOP    -> by + room.height - wallT
                    else            -> by + room.height / 2f
                }
                val headX = when (side) {
                    WallSide.LEFT  -> mountX + armLen
                    WallSide.RIGHT -> mountX - armLen
                    else           -> mountX
                }
                val headY = when (side) {
                    WallSide.BOTTOM -> mountY + armLen
                    WallSide.TOP    -> mountY - armLen
                    else            -> mountY
                }
                val light = PointLight(rayHandler, 48, Color(1f, 0.55f, 0.15f, 1f), 7f, headX, headY)
                light.isSoft = true
                light.setContactFilter(0x0004, 0, 0x0001)
                wallTorches += WallTorchData(mountX, mountY, headX, headY, side, MathUtils.random(MathUtils.PI2), light)
            }
        }

        // Spiders
        rooms.filter { it.depth >= 3 && it.type != RoomType.CORRIDOR && it.type != RoomType.BEND }
            .forEach { room -> if (MathUtils.randomBoolean(0.6f)) spiders += Spider(world, rayHandler, room) }

        // Player
        playerBody = world.createBody(BodyDef().apply {
            type = BodyDef.BodyType.DynamicBody
            position.set(SPAWN_X, 1.5f)
            fixedRotation = true
        })
        val circle = CircleShape().apply { radius = 0.3f }
        playerBody.createFixture(circle, 1f).also {
            it.filterData = Filter().apply { categoryBits = 0x0008; maskBits = 0x0001 }
        }
        circle.dispose()

        // Faint innate glow around the player
        val playerGlow = PointLight(rayHandler, 16, Color(0.6f, 0.55f, 0.5f, 0.25f), 1.8f, SPAWN_X, 1.5f)
        playerGlow.attachToBody(playerBody)
        playerGlow.setContactFilter(0x0004, 0, 0x0001)

        // Candle item light — same as table candle, positioned at player's left hand each frame
        candlePlayerLight = PointLight(rayHandler, 64, Color(1f, 0.6f, 0.2f, 1f), 7f, SPAWN_X, 1.5f)
        candlePlayerLight.isSoft = true
        candlePlayerLight.setContactFilter(0x0004, 0, 0x0001)

        // Torch cone light — originates from torch tip, updated each frame
        torch = ConeLight(rayHandler, 128, Color(1f, 0.85f, 0.6f, 1f), 16f, 0f, 0f, 0f, 25f)
        torch.isSoft = true
        torch.setContactFilter(0x0004, 0, 0x0001)

        // Table
        val tableBody = world.createBody(BodyDef().apply {
            type = BodyDef.BodyType.StaticBody
            position.set(tableX + tableW / 2f, tableY + tableH / 2f)
        })
        val tableShape = PolygonShape().apply { setAsBox(tableW / 2f, tableH / 2f) }
        tableBody.createFixture(tableShape, 0f).also {
            it.filterData = Filter().apply { categoryBits = 0x0002; maskBits = 0x0001 }
        }
        tableShape.dispose()

        // Candle
        candleLight = PointLight(rayHandler, 64, Color(1f, 0.6f, 0.2f, 1f), 5f, candleX, candleY)
        candleLight.isSoft = true
        candleLight.setContactFilter(0x0004, 0, 0x0001)
    }

    private fun createCircleWall(worldX: Float, worldY: Float, c: CircleWall) {
        val body = world.createBody(BodyDef().apply { type = BodyDef.BodyType.StaticBody })
        val segCount = 48
        val gapHalf  = RoomBuilder.DOOR_W / (2f * c.innerRadius) + 0.05f
        val startAngle = c.doorAngle + gapHalf
        val arcLen     = MathUtils.PI2 - gapHalf * 2f
        val verts = FloatArray((segCount + 1) * 2)
        for (i in 0..segCount) {
            val a = startAngle + arcLen * i.toFloat() / segCount
            verts[i * 2]     = worldX + c.cx + c.innerRadius * MathUtils.cos(a)
            verts[i * 2 + 1] = worldY + c.cy + c.innerRadius * MathUtils.sin(a)
        }
        val chain = ChainShape()
        chain.createChain(verts)
        body.createFixture(chain, 0f).also {
            it.filterData = Filter().apply { categoryBits = 0x0001 }
        }
        chain.dispose()
    }

    private fun createBendWall(worldX: Float, worldY: Float, b: BendData) {
        createArcChain(worldX + b.cx, worldY + b.cy, b.innerRadius, b.startAngleDeg, b.sweepDeg)
        createArcChain(worldX + b.cx, worldY + b.cy, b.outerRadius, b.startAngleDeg, b.sweepDeg)
    }

    private fun createArcChain(cx: Float, cy: Float, radius: Float, startDeg: Float, sweepDeg: Float) {
        val body = world.createBody(BodyDef().apply { type = BodyDef.BodyType.StaticBody })
        val segCount = 20
        val startRad = startDeg * MathUtils.degreesToRadians
        val sweepRad = sweepDeg * MathUtils.degreesToRadians
        val verts = FloatArray((segCount + 1) * 2)
        for (i in 0..segCount) {
            val a = startRad + sweepRad * i.toFloat() / segCount
            verts[i * 2]     = cx + radius * MathUtils.cos(a)
            verts[i * 2 + 1] = cy + radius * MathUtils.sin(a)
        }
        val chain = ChainShape()
        chain.createChain(verts)
        body.createFixture(chain, 0f).also {
            it.filterData = Filter().apply { categoryBits = 0x0001 }
        }
        chain.dispose()
    }

    private fun createWall(x: Float, y: Float, w: Float, h: Float) {
        val body = world.createBody(BodyDef().apply {
            type = BodyDef.BodyType.StaticBody
            position.set(x + w / 2f, y + h / 2f)
        })
        val shape = PolygonShape().apply { setAsBox(w / 2f, h / 2f) }
        body.createFixture(shape, 0f).also {
            it.filterData = Filter().apply { categoryBits = 0x0001 }
        }
        shape.dispose()
    }

    override fun render() {
        val dt = Gdx.graphics.deltaTime
        flickerTimer += dt

        // Movement
        val vel = Vector2(0f, 0f)
        if (Gdx.input.isKeyPressed(Keys.W)) vel.y += playerSpeed
        if (Gdx.input.isKeyPressed(Keys.S)) vel.y -= playerSpeed
        if (Gdx.input.isKeyPressed(Keys.A)) vel.x -= playerSpeed
        if (Gdx.input.isKeyPressed(Keys.D)) vel.x += playerSpeed
        playerBody.linearVelocity = vel

        // Body faces mouse instantly
        val mouseVec = camera.unproject(Vector3(Gdx.input.x.toFloat(), Gdx.input.y.toFloat(), 0f))
        playerAngle = MathUtils.atan2(
            mouseVec.y - playerBody.position.y,
            mouseVec.x - playerBody.position.x
        )

        // Torch lags behind body angle
        var diff = playerAngle - torchLagAngle
        while (diff >  MathUtils.PI) diff -= MathUtils.PI2
        while (diff < -MathUtils.PI) diff += MathUtils.PI2
        torchLagAngle += diff * minOf(1f, 7f * dt)

        // Torch tip world position (local offset: x=0.55, y=0.15 at torchLagAngle)
        val cosL = MathUtils.cos(torchLagAngle)
        val sinL = MathUtils.sin(torchLagAngle)
        val tipX = playerBody.position.x + cosL * 0.55f - sinL * 0.15f
        val tipY = playerBody.position.y + sinL * 0.55f + cosL * 0.15f

        val lightX = playerBody.position.x + cosL * 0.25f - sinL * 0.15f
        val lightY = playerBody.position.y + sinL * 0.25f + cosL * 0.15f

        // Derive active light state from activeLightSlot
        torch.isActive = (inventory[activeLightSlot.coerceAtLeast(0)] == ItemType.TORCH && activeLightSlot >= 0)
        val candleSlot = (0 until INV_SIZE).firstOrNull { inventory[it] == ItemType.CANDLE } ?: -1
        candlePlayerLight.isActive = (activeLightSlot == candleSlot && candleSlot >= 0)

        torch.setPosition(lightX, lightY)
        torch.setDirection(torchLagAngle * MathUtils.radiansToDegrees)

        // Candle left hand world position: worldL(0.15f, -0.22f)
        val candleHandX = playerBody.position.x + cosL * 0.15f - sinL * 0.22f
        val candleHandY = playerBody.position.y + sinL * 0.15f + cosL * 0.22f
        if (candlePlayerLight.isActive) candlePlayerLight.setPosition(candleHandX, candleHandY)

        // Candle flicker
        val flicker = 14f + MathUtils.sin(flickerTimer * 9f) * 1.5f + MathUtils.random(-0.7f, 0.7f)
        candleLight.setDistance(flicker)
        if (candlePlayerLight.isActive) {
            val pf = 7f + MathUtils.sin(flickerTimer * 11f) * 0.75f + MathUtils.random(-0.35f, 0.35f)
            candlePlayerLight.setDistance(pf)
        }

        // Wall torch flicker (each has a unique phase offset)
        wallTorches.forEach { wt ->
            val wf = 7f + MathUtils.sin(flickerTimer * 8f + wt.flickerOffset) * 0.8f + MathUtils.random(-0.4f, 0.4f)
            wt.light.setDistance(wf)
            wt.light.setPosition(wt.headX, wt.headY)
        }

        world.step(dt, 6, 2)

        // Spider update
        spiders.forEach { it.update(dt, playerBody.position) }

        val px = playerBody.position.x
        val py = playerBody.position.y

        // Tick drop cooldowns
        droppedItems.filter { !it.pickedUp }.forEach { it.cooldown -= dt }

        // Inventory touch input
        if (Gdx.input.justTouched()) {
            val tx = Gdx.input.x.toFloat()
            val ty = (Gdx.graphics.height - Gdx.input.y).toFloat()
            val totalW = INV_SIZE * SLOT_PX + (INV_SIZE - 1) * SLOT_GAP
            val barX = (Gdx.graphics.width - totalW) / 2f
            val barY = 12f

            val dropBtnCx  = DROP_BTN_R + 12f
            val dropBtnCy  = DROP_BTN_R + 12f
            val pickBtnCx  = dropBtnCx + DROP_BTN_R * 2f + 10f
            val pickBtnCy  = dropBtnCy
            val pickupRange = 1.2f

            // Drop button (bottom-left)
            val ddx = tx - dropBtnCx; val ddy = ty - dropBtnCy
            if (ddx * ddx + ddy * ddy <= DROP_BTN_R * DROP_BTN_R && inventory[selectedSlot] != null) {
                val item = inventory[selectedSlot]!!
                inventory[selectedSlot] = null
                if (activeLightSlot == selectedSlot) activeLightSlot = -1
                droppedItems += DroppedItem(playerBody.position.x, playerBody.position.y, item)
            }
            // Pickup button (bottom-left, right of drop)
            else {
                val pdx = tx - pickBtnCx; val pdy = ty - pickBtnCy
                if (pdx * pdx + pdy * pdy <= DROP_BTN_R * DROP_BTN_R) {
                    val freeSlot = (0 until INV_SIZE).firstOrNull { inventory[it] == null }
                    if (freeSlot != null) {
                        // Try dropped items first (with cooldown elapsed)
                        val nearDropped = droppedItems.filter { !it.pickedUp && it.cooldown <= 0f }
                            .minByOrNull { (it.x - px) * (it.x - px) + (it.y - py) * (it.y - py) }
                            ?.takeIf { (it.x - px) * (it.x - px) + (it.y - py) * (it.y - py) < pickupRange * pickupRange }
                        val nearLoot = lootItems.filter { !it.collected }
                            .minByOrNull { (it.x - px) * (it.x - px) + (it.y - py) * (it.y - py) }
                            ?.takeIf { (it.x - px) * (it.x - px) + (it.y - py) * (it.y - py) < pickupRange * pickupRange }

                        if (nearDropped != null) {
                            inventory[freeSlot] = nearDropped.type
                            nearDropped.pickedUp = true
                        } else if (nearLoot != null) {
                            inventory[freeSlot] = when (nearLoot.type) {
                                LootType.SILVER  -> ItemType.SILVER
                                LootType.GOLD    -> ItemType.GOLD
                                LootType.DIAMOND -> ItemType.DIAMOND
                            }
                            nearLoot.collected = true
                        }
                    }
                } else {
                    for (i in 0 until INV_SIZE) {
                        val sx = barX + i * (SLOT_PX + SLOT_GAP)
                        if (tx >= sx && tx <= sx + SLOT_PX && ty >= barY && ty <= barY + SLOT_PX) {
                            val item = inventory[i]
                            if (item != null && item.isLight)
                                activeLightSlot = if (activeLightSlot == i) -1 else i
                            selectedSlot = i
                        }
                    }
                }
            }
        }

        camera.position.set(playerBody.position.x, playerBody.position.y, 0f)
        camera.update()

        ScreenUtils.clear(0.05f, 0.05f, 0.05f, 1f)

        shapeRenderer.projectionMatrix = camera.combined
        shapeRenderer.begin(ShapeRenderer.ShapeType.Filled)

        // Walls
        val wallColor  = Color(0.25f, 0.22f, 0.2f, 1f)
        val voidColor  = Color(0.05f, 0.05f, 0.05f, 1f)
        rooms.forEach { room ->
            // Rect walls
            shapeRenderer.color = wallColor
            room.walls.forEach { seg ->
                shapeRenderer.rect(room.worldX + seg.x, room.worldY + seg.y, seg.w, seg.h)
            }
            // Circle rooms: outer arc (with door gap) + inner void circle
            room.circle?.let { c ->
                val wx       = room.worldX + c.cx
                val wy       = room.worldY + c.cy
                val outerR   = c.innerRadius + RoomBuilder.WALL_T
                // Angular half-gap at the outer radius so the opening matches DOOR_W
                val gapHalf  = MathUtils.asin((RoomBuilder.DOOR_W / 2f) / outerR)
                val startRad = c.doorAngle + gapHalf
                val arcDeg   = (MathUtils.PI2 - gapHalf * 2f) * MathUtils.radiansToDegrees
                shapeRenderer.color = wallColor
                shapeRenderer.arc(wx, wy, outerR, startRad * MathUtils.radiansToDegrees, arcDeg, 64)
                shapeRenderer.color = voidColor
                shapeRenderer.circle(wx, wy, c.innerRadius, 64)
            }
            // Bend rooms: 3-layer arc draw — outer wall, restore corridor, fill inner corner
            room.bend?.let { b ->
                val wx = room.worldX + b.cx
                val wy = room.worldY + b.cy
                shapeRenderer.color = wallColor
                shapeRenderer.arc(wx, wy, b.outerRadius + RoomBuilder.WALL_T, b.startAngleDeg, b.sweepDeg, 32)
                shapeRenderer.color = voidColor
                shapeRenderer.arc(wx, wy, b.outerRadius, b.startAngleDeg, b.sweepDeg, 32)
                shapeRenderer.color = wallColor
                shapeRenderer.arc(wx, wy, b.innerRadius, b.startAngleDeg, b.sweepDeg, 32)
            }
        }

        // Wall torches (visual)
        wallTorches.forEach { wt ->
            val mx = wt.mountX; val my = wt.mountY
            val hx = wt.headX;  val hy = wt.headY
            // Bracket arm from wall to cup
            shapeRenderer.color = Color(0.22f, 0.15f, 0.08f, 1f)
            when (wt.side) {
                WallSide.TOP, WallSide.BOTTOM -> shapeRenderer.rect(mx - 0.04f, minOf(my, hy), 0.08f, Math.abs(my - hy))
                WallSide.LEFT, WallSide.RIGHT -> shapeRenderer.rect(minOf(mx, hx), my - 0.04f, Math.abs(mx - hx), 0.08f)
            }
            // Cup at head
            shapeRenderer.color = Color(0.30f, 0.20f, 0.10f, 1f)
            shapeRenderer.circle(hx, hy, 0.09f, 10)
            // Flame (always floats upward from the cup)
            val wFlame = MathUtils.sin(flickerTimer * 11f + wt.flickerOffset) * 0.025f
            shapeRenderer.color = Color(1f, 0.40f, 0.05f, 1f)
            shapeRenderer.circle(hx + wFlame, hy + 0.11f, 0.08f, 10)
            shapeRenderer.color = Color(1f, 0.82f, 0.18f, 1f)
            shapeRenderer.circle(hx + wFlame * 0.5f, hy + 0.09f, 0.045f, 8)
        }

        // Table
        shapeRenderer.color = Color(0.45f, 0.28f, 0.12f, 1f)
        shapeRenderer.rect(tableX, tableY, tableW, tableH)
        shapeRenderer.color = Color(0.38f, 0.23f, 0.09f, 1f)
        shapeRenderer.rect(tableX + 0.3f,  tableY, 0.05f, tableH)
        shapeRenderer.rect(tableX + 0.9f,  tableY, 0.05f, tableH)
        shapeRenderer.rect(tableX + 1.3f,  tableY, 0.05f, tableH)

        // Loot
        lootItems.filter { !it.collected }.forEach { loot ->
            val lx = loot.x; val ly = loot.y
            when (loot.type) {
                LootType.SILVER -> {
                    // Dark rim
                    shapeRenderer.color = Color(0.35f, 0.35f, 0.40f, 1f)
                    shapeRenderer.circle(lx, ly, 0.20f, 20)
                    // Coin face
                    shapeRenderer.color = Color(0.72f, 0.72f, 0.80f, 1f)
                    shapeRenderer.circle(lx, ly, 0.17f, 20)
                    // Raised centre
                    shapeRenderer.color = Color(0.88f, 0.88f, 0.95f, 1f)
                    shapeRenderer.circle(lx, ly, 0.09f, 16)
                    // Specular highlight (top-left)
                    shapeRenderer.color = Color(1f, 1f, 1f, 1f)
                    shapeRenderer.circle(lx - 0.06f, ly + 0.07f, 0.03f, 8)
                    // Shadow crescent (bottom-right)
                    shapeRenderer.color = Color(0.25f, 0.25f, 0.30f, 1f)
                    shapeRenderer.circle(lx + 0.05f, ly - 0.05f, 0.05f, 10)
                }
                LootType.GOLD -> {
                    // Dark amber rim
                    shapeRenderer.color = Color(0.55f, 0.30f, 0.02f, 1f)
                    shapeRenderer.circle(lx, ly, 0.20f, 20)
                    // Coin face
                    shapeRenderer.color = Color(0.95f, 0.70f, 0.08f, 1f)
                    shapeRenderer.circle(lx, ly, 0.17f, 20)
                    // Raised centre
                    shapeRenderer.color = Color(1f, 0.90f, 0.40f, 1f)
                    shapeRenderer.circle(lx, ly, 0.09f, 16)
                    // Specular highlight
                    shapeRenderer.color = Color(1f, 1f, 0.85f, 1f)
                    shapeRenderer.circle(lx - 0.06f, ly + 0.07f, 0.035f, 8)
                    // Shadow crescent
                    shapeRenderer.color = Color(0.40f, 0.20f, 0.01f, 1f)
                    shapeRenderer.circle(lx + 0.05f, ly - 0.05f, 0.05f, 10)
                }
                LootType.DIAMOND -> {
                    val o = 0.13f  // half-size for origin offset
                    // Dark outer gem shadow
                    shapeRenderer.color = Color(0.05f, 0.35f, 0.50f, 1f)
                    shapeRenderer.rect(lx - o - 0.02f, ly - o - 0.02f, o + 0.02f, o + 0.02f, (o + 0.02f) * 2f, (o + 0.02f) * 2f, 1f, 1f, 45f)
                    // Main gem body
                    shapeRenderer.color = Color(0.35f, 0.88f, 1f, 1f)
                    shapeRenderer.rect(lx - o, ly - o, o, o, o * 2f, o * 2f, 1f, 1f, 45f)
                    // Upper facet (lighter top half — triangle implied by smaller rotated rect)
                    shapeRenderer.color = Color(0.70f, 0.97f, 1f, 1f)
                    shapeRenderer.rect(lx - 0.07f, ly - 0.07f, 0.07f, 0.07f, 0.14f, 0.14f, 1f, 1f, 45f)
                    // Inner facet
                    shapeRenderer.color = Color(0.15f, 0.60f, 0.80f, 1f)
                    shapeRenderer.rect(lx - 0.04f, ly - 0.04f, 0.04f, 0.04f, 0.08f, 0.08f, 1f, 1f, 20f)
                    // Sparkle centre
                    shapeRenderer.color = Color(1f, 1f, 1f, 1f)
                    shapeRenderer.circle(lx - 0.04f, ly + 0.04f, 0.025f, 6)
                }
            }
        }

        // Dropped items (world space)
        droppedItems.filter { !it.pickedUp }.forEach { d ->
            val lx = d.x; val ly = d.y
            when (d.type) {
                ItemType.TORCH -> {
                    shapeRenderer.color = Color(0.30f, 0.20f, 0.10f, 1f)
                    shapeRenderer.rect(lx - 0.04f, ly - 0.18f, 0.08f, 0.22f)
                    shapeRenderer.color = Color(1f, 0.45f, 0.1f, 1f)
                    shapeRenderer.circle(lx, ly + 0.10f, 0.07f, 10)
                }
                ItemType.CANDLE -> {
                    shapeRenderer.color = Color(0.9f, 0.88f, 0.82f, 1f)
                    shapeRenderer.rect(lx - 0.05f, ly - 0.12f, 0.10f, 0.16f)
                    shapeRenderer.color = Color(1f, 0.45f, 0.1f, 1f)
                    shapeRenderer.circle(lx, ly + 0.08f, 0.06f, 10)
                }
                ItemType.SILVER -> {
                    shapeRenderer.color = Color(0.35f, 0.35f, 0.40f, 1f); shapeRenderer.circle(lx, ly, 0.20f, 20)
                    shapeRenderer.color = Color(0.72f, 0.72f, 0.80f, 1f); shapeRenderer.circle(lx, ly, 0.17f, 20)
                    shapeRenderer.color = Color(0.88f, 0.88f, 0.95f, 1f); shapeRenderer.circle(lx, ly, 0.09f, 16)
                    shapeRenderer.color = Color(1f, 1f, 1f, 1f);          shapeRenderer.circle(lx - 0.06f, ly + 0.07f, 0.03f, 8)
                }
                ItemType.GOLD -> {
                    shapeRenderer.color = Color(0.40f, 0.20f, 0.01f, 1f); shapeRenderer.circle(lx, ly, 0.20f, 20)
                    shapeRenderer.color = Color(0.95f, 0.70f, 0.08f, 1f); shapeRenderer.circle(lx, ly, 0.17f, 20)
                    shapeRenderer.color = Color(1f, 0.90f, 0.40f, 1f);    shapeRenderer.circle(lx, ly, 0.09f, 16)
                    shapeRenderer.color = Color(1f, 1f, 0.85f, 1f);       shapeRenderer.circle(lx - 0.06f, ly + 0.07f, 0.03f, 8)
                }
                ItemType.DIAMOND -> {
                    val o = 0.13f
                    shapeRenderer.color = Color(0.05f, 0.35f, 0.50f, 1f)
                    shapeRenderer.rect(lx - o - 0.02f, ly - o - 0.02f, o + 0.02f, o + 0.02f, (o + 0.02f) * 2f, (o + 0.02f) * 2f, 1f, 1f, 45f)
                    shapeRenderer.color = Color(0.35f, 0.88f, 1f, 1f)
                    shapeRenderer.rect(lx - o, ly - o, o, o, o * 2f, o * 2f, 1f, 1f, 45f)
                    shapeRenderer.color = Color(1f, 1f, 1f, 1f); shapeRenderer.circle(lx - 0.04f, ly + 0.04f, 0.025f, 6)
                }
            }
        }

        // Spiders
        spiders.forEach { it.draw(shapeRenderer) }

        // Player model
        drawPlayer(playerBody.position.x, playerBody.position.y)

        // Candle flame
        val flameOffset = MathUtils.sin(flickerTimer * 13f) * 0.04f
        shapeRenderer.color = Color(0.9f, 0.88f, 0.82f, 1f)
        shapeRenderer.rect(candleX - 0.08f, candleY - 0.18f, 0.16f, 0.18f)
        shapeRenderer.color = Color(1f, 0.45f, 0.1f, 1f)
        shapeRenderer.circle(candleX + flameOffset, candleY + 0.11f, 0.11f, 12)
        shapeRenderer.color = Color(1f, 0.85f, 0.2f, 1f)
        shapeRenderer.circle(candleX + flameOffset * 0.5f, candleY + 0.08f, 0.06f, 12)
        shapeRenderer.color = Color(1f, 1f, 0.95f, 1f)
        shapeRenderer.circle(candleX, candleY + 0.06f, 0.03f, 8)

        shapeRenderer.end()

        rayHandler.setCombinedMatrix(camera)
        rayHandler.updateAndRender()

        // Inventory bar
        val totalW = INV_SIZE * SLOT_PX + (INV_SIZE - 1) * SLOT_GAP
        val barX = (Gdx.graphics.width - totalW) / 2f
        val barY = 12f

        uiCamera.update()
        shapeRenderer.projectionMatrix = uiCamera.combined
        shapeRenderer.begin(ShapeRenderer.ShapeType.Filled)

        for (i in 0 until INV_SIZE) {
            val item = inventory[i]
            val sx = barX + i * (SLOT_PX + SLOT_GAP)
            val sy = barY
            val cx = sx + SLOT_PX / 2f
            val cy = sy + SLOT_PX / 2f + 4f

            // Selected highlight
            if (i == selectedSlot) {
                shapeRenderer.color = Color(0.90f, 0.75f, 0.20f, 1f)
                shapeRenderer.rect(sx - 3f, sy - 3f, SLOT_PX + 6f, SLOT_PX + 6f)
            }
            // Slot background — dimmer when empty
            shapeRenderer.color = if (item == null) Color(0.06f, 0.06f, 0.07f, 0.92f) else Color(0.10f, 0.10f, 0.12f, 0.92f)
            shapeRenderer.rect(sx, sy, SLOT_PX, SLOT_PX)

            // Item icon — only drawn when slot is filled
            when (item) {
                ItemType.TORCH -> {
                    val dim = if (activeLightSlot == i) 1f else 0.35f
                    shapeRenderer.color = Color(0.18f * dim, 0.18f * dim, 0.20f * dim, 1f)
                    shapeRenderer.rect(cx - 5f, cy - 20f, 10f, 18f)
                    shapeRenderer.color = Color(0.10f * dim, 0.10f * dim, 0.12f * dim, 1f)
                    shapeRenderer.rect(cx - 5f, cy - 16f, 10f, 2f)
                    shapeRenderer.rect(cx - 5f, cy - 11f, 10f, 2f)
                    shapeRenderer.rect(cx - 5f, cy - 6f,  10f, 2f)
                    shapeRenderer.color = Color(0.30f * dim, 0.30f * dim, 0.32f * dim, 1f)
                    shapeRenderer.rect(cx - 7f, cy - 2f, 14f, 12f)
                    shapeRenderer.rect(cx - 10f, cy + 10f, 20f, 7f)
                    shapeRenderer.color = Color(1f * dim, 0.95f * dim, 0.70f * dim, 1f)
                    shapeRenderer.circle(cx, cy + 13f, 7f, 16)
                    shapeRenderer.color = Color(1f * dim, 1f * dim, 1f * dim, 1f)
                    shapeRenderer.circle(cx - 2f, cy + 15f, 2.5f, 8)
                }
                ItemType.CANDLE -> {
                    val dim = if (activeLightSlot == i) 1f else 0.35f
                    // Candle stick
                    shapeRenderer.color = Color(0.9f * dim, 0.88f * dim, 0.82f * dim, 1f)
                    shapeRenderer.rect(cx - 5f, cy - 18f, 10f, 22f)
                    // Wax drips
                    shapeRenderer.color = Color(0.75f * dim, 0.73f * dim, 0.68f * dim, 1f)
                    shapeRenderer.rect(cx - 5f, cy + 2f, 4f, 3f)
                    shapeRenderer.rect(cx + 2f, cy - 1f, 3f, 4f)
                    // Wick
                    shapeRenderer.color = Color(0.15f, 0.12f, 0.10f, 1f)
                    shapeRenderer.rect(cx - 1f, cy + 4f, 2f, 5f)
                    // Flame outer
                    shapeRenderer.color = Color(1f * dim, 0.40f * dim, 0.05f * dim, 1f)
                    shapeRenderer.circle(cx, cy + 14f, 7f, 12)
                    // Flame inner
                    shapeRenderer.color = Color(1f * dim, 0.85f * dim, 0.20f * dim, 1f)
                    shapeRenderer.circle(cx, cy + 12f, 4f, 10)
                    // Flame core
                    shapeRenderer.color = Color(1f * dim, 1f * dim, 0.90f * dim, 1f)
                    shapeRenderer.circle(cx, cy + 11f, 2f, 8)
                }
                ItemType.SILVER -> {
                    shapeRenderer.color = Color(0.35f, 0.35f, 0.40f, 1f)
                    shapeRenderer.circle(cx, cy, 17f, 20)
                    shapeRenderer.color = Color(0.72f, 0.72f, 0.80f, 1f)
                    shapeRenderer.circle(cx, cy, 14f, 20)
                    shapeRenderer.color = Color(0.90f, 0.90f, 0.96f, 1f)
                    shapeRenderer.circle(cx, cy, 7f, 16)
                    shapeRenderer.color = Color(1f, 1f, 1f, 1f)
                    shapeRenderer.circle(cx - 5f, cy + 6f, 3f, 8)
                }
                ItemType.GOLD -> {
                    shapeRenderer.color = Color(0.55f, 0.30f, 0.02f, 1f)
                    shapeRenderer.circle(cx, cy, 17f, 20)
                    shapeRenderer.color = Color(0.95f, 0.70f, 0.08f, 1f)
                    shapeRenderer.circle(cx, cy, 14f, 20)
                    shapeRenderer.color = Color(1f, 0.90f, 0.40f, 1f)
                    shapeRenderer.circle(cx, cy, 7f, 16)
                    shapeRenderer.color = Color(1f, 1f, 0.85f, 1f)
                    shapeRenderer.circle(cx - 5f, cy + 6f, 3f, 8)
                }
                ItemType.DIAMOND -> {
                    val o = 13f
                    shapeRenderer.color = Color(0.05f, 0.35f, 0.50f, 1f)
                    shapeRenderer.rect(cx - o - 2f, cy - o - 2f, o + 2f, o + 2f, (o + 2f) * 2f, (o + 2f) * 2f, 1f, 1f, 45f)
                    shapeRenderer.color = Color(0.35f, 0.88f, 1f, 1f)
                    shapeRenderer.rect(cx - o, cy - o, o, o, o * 2f, o * 2f, 1f, 1f, 45f)
                    shapeRenderer.color = Color(0.70f, 0.97f, 1f, 1f)
                    shapeRenderer.rect(cx - 7f, cy - 7f, 7f, 7f, 14f, 14f, 1f, 1f, 45f)
                    shapeRenderer.color = Color(1f, 1f, 1f, 1f)
                    shapeRenderer.circle(cx - 4f, cy + 4f, 2.5f, 6)
                }
                null -> {}
            }
        }

        val dropBtnCx  = DROP_BTN_R + 12f
        val dropBtnCy  = DROP_BTN_R + 12f
        val pickBtnCx  = dropBtnCx + DROP_BTN_R * 2f + 10f
        val pickBtnCy  = dropBtnCy
        val pickupRange = 1.2f

        // Drop button (bottom-left) — dimmed when nothing to drop
        val hasItem = inventory[selectedSlot] != null
        shapeRenderer.color = if (hasItem) Color(0.65f, 0.12f, 0.08f, 0.95f) else Color(0.20f, 0.10f, 0.10f, 0.60f)
        shapeRenderer.circle(dropBtnCx, dropBtnCy, DROP_BTN_R, 20)
        val arm = DROP_BTN_R * 0.42f
        shapeRenderer.color = if (hasItem) Color(1f, 1f, 1f, 1f) else Color(0.5f, 0.4f, 0.4f, 0.6f)
        shapeRenderer.rectLine(dropBtnCx - arm, dropBtnCy - arm, dropBtnCx + arm, dropBtnCy + arm, 2.5f)
        shapeRenderer.rectLine(dropBtnCx + arm, dropBtnCy - arm, dropBtnCx - arm, dropBtnCy + arm, 2.5f)

        // Pickup button — lit when a pickable item is nearby and inventory has space
        val hasFreeSlot = (0 until INV_SIZE).any { inventory[it] == null }
        val nearbyPickup = hasFreeSlot && (
            droppedItems.any { !it.pickedUp && it.cooldown <= 0f && (it.x - px) * (it.x - px) + (it.y - py) * (it.y - py) < pickupRange * pickupRange } ||
            lootItems.any   { !it.collected && (it.x - px) * (it.x - px) + (it.y - py) * (it.y - py) < pickupRange * pickupRange }
        )
        shapeRenderer.color = if (nearbyPickup) Color(0.15f, 0.55f, 0.20f, 0.95f) else Color(0.10f, 0.20f, 0.12f, 0.60f)
        shapeRenderer.circle(pickBtnCx, pickBtnCy, DROP_BTN_R, 20)
        // Up-arrow icon
        val ar = DROP_BTN_R * 0.45f
        shapeRenderer.color = if (nearbyPickup) Color(1f, 1f, 1f, 1f) else Color(0.4f, 0.5f, 0.4f, 0.6f)
        shapeRenderer.triangle(
            pickBtnCx,       pickBtnCy + ar,
            pickBtnCx - ar,  pickBtnCy - ar * 0.4f,
            pickBtnCx + ar,  pickBtnCy - ar * 0.4f
        )
        shapeRenderer.rect(pickBtnCx - ar * 0.28f, pickBtnCy - ar, ar * 0.56f, ar * 0.7f)

        shapeRenderer.end()

    }

    private fun drawPlayer(px: Float, py: Float) {
        val cosB = MathUtils.cos(playerAngle)
        val sinB = MathUtils.sin(playerAngle)
        val cosL = MathUtils.cos(torchLagAngle)
        val sinL = MathUtils.sin(torchLagAngle)

        // Transform local offset to world using the given angle
        fun worldB(lx: Float, ly: Float) = Vector2(px + cosB * lx - sinB * ly, py + sinB * lx + cosB * ly)
        fun worldL(lx: Float, ly: Float) = Vector2(px + cosL * lx - sinL * ly, py + sinL * lx + cosL * ly)

        val lagDeg = torchLagAngle * MathUtils.radiansToDegrees
        val bodyDeg = playerAngle * MathUtils.radiansToDegrees

        // Left arm — always drawn behind body
        val leftArm = worldL(0.1f, 0.22f)
        shapeRenderer.color = Color(0.78f, 0.56f, 0.42f, 1f)
        shapeRenderer.ellipse(leftArm.x - 0.09f, leftArm.y - 0.06f, 0.18f, 0.12f, lagDeg)

        // Candle in left hand
        if (candlePlayerLight.isActive) {
            val hand = worldL(0.15f, 0.22f)
            // Wax stick
            shapeRenderer.color = Color(0.9f, 0.88f, 0.82f, 1f)
            shapeRenderer.rect(hand.x - 0.03f, hand.y - 0.08f, 0.03f, 0.03f, 0.06f, 0.10f, 1f, 1f, lagDeg)
            // Flame (flickers in screen x, floats upward)
            val flameOff = MathUtils.sin(flickerTimer * 13f) * 0.015f
            shapeRenderer.color = Color(1f, 0.45f, 0.1f, 1f)
            shapeRenderer.circle(hand.x + flameOff, hand.y + 0.09f, 0.07f, 10)
            shapeRenderer.color = Color(1f, 0.85f, 0.2f, 1f)
            shapeRenderer.circle(hand.x + flameOff * 0.5f, hand.y + 0.07f, 0.04f, 8)
            shapeRenderer.color = Color(1f, 1f, 0.95f, 1f)
            shapeRenderer.circle(hand.x, hand.y + 0.06f, 0.02f, 6)
        }

        // Right arm
        val arm = worldL(0.1f, -0.18f)
        shapeRenderer.color = Color(0.78f, 0.56f, 0.42f, 1f)
        shapeRenderer.ellipse(arm.x - 0.09f, arm.y - 0.06f, 0.18f, 0.12f, lagDeg)

        // Torch in left hand — hidden only when candle is the active light
        if (!candlePlayerLight.isActive) {
            val torchHand = worldL(0.15f, 0.22f)
            // Grip
            shapeRenderer.color = Color(0.18f, 0.14f, 0.1f, 1f)
            shapeRenderer.rect(torchHand.x - 0.04f, torchHand.y - 0.04f, 0.04f, 0.04f, 0.22f, 0.08f, 1f, 1f, lagDeg)
            // Barrel (wider)
            shapeRenderer.color = Color(0.25f, 0.22f, 0.18f, 1f)
            shapeRenderer.rect(torchHand.x + 0.10f, torchHand.y - 0.04f, 0.04f, 0.04f, 0.12f, 0.09f, 1f, 1f, lagDeg)
            // Lens
            val torchTip = worldL(0.28f, 0.22f)
            shapeRenderer.color = if (torch.isActive) Color(1f, 0.95f, 0.70f, 1f) else Color(0.2f, 0.2f, 0.18f, 1f)
            shapeRenderer.circle(torchTip.x, torchTip.y, 0.05f, 8)
        }

        // Body (at playerAngle)
        shapeRenderer.color = Color(0.35f, 0.25f, 0.18f, 1f)
        shapeRenderer.ellipse(px - 0.15f, py - 0.2f, 0.3f, 0.4f, bodyDeg)

        // Head
        val head = worldB(0.15f, 0f)
        shapeRenderer.color = Color(0.78f, 0.56f, 0.42f, 1f)
        shapeRenderer.circle(head.x, head.y, 0.11f, 16)

    }

    override fun resize(width: Int, height: Int) {
        camera.setToOrtho(false, width / PPM, height / PPM)
        uiCamera.setToOrtho(false, width.toFloat(), height.toFloat())
    }

    override fun dispose() {
        music.dispose()
        shapeRenderer.dispose()
        uiBatch.dispose()
        font.dispose()
        spiders.forEach { it.dispose() }
        rayHandler.dispose()
        world.dispose()
    }
}
