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

    override fun create() {
        camera = OrthographicCamera()
        camera.setToOrtho(false, Gdx.graphics.width / PPM, Gdx.graphics.height / PPM)

        shapeRenderer = ShapeRenderer()
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
        }

        // Player
        playerBody = world.createBody(BodyDef().apply {
            type = BodyDef.BodyType.DynamicBody
            position.set(SPAWN_X, 1.5f)
            fixedRotation = true
        })
        val circle = CircleShape().apply { radius = 0.3f }
        playerBody.createFixture(circle, 1f)
        circle.dispose()

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

        torch.setPosition(tipX, tipY)
        torch.setDirection(torchLagAngle * MathUtils.radiansToDegrees)

        // Candle flicker
        val flicker = 14f + MathUtils.sin(flickerTimer * 9f) * 1.5f + MathUtils.random(-0.7f, 0.7f)
        candleLight.setDistance(flicker)

        world.step(dt, 6, 2)

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
            // Circle rooms: outer ring + inner void + door cutout
            room.circle?.let { c ->
                val wx = room.worldX + c.cx
                val wy = room.worldY + c.cy
                shapeRenderer.color = wallColor
                shapeRenderer.circle(wx, wy, c.innerRadius + RoomBuilder.WALL_T, 64)
                shapeRenderer.color = voidColor
                shapeRenderer.circle(wx, wy, c.innerRadius, 64)
                // Cut the doorway: rect oriented radially at doorAngle
                val rectW = RoomBuilder.WALL_T + 0.2f   // radial extent
                val rectH = RoomBuilder.DOOR_W           // tangential extent
                val dcx   = wx + MathUtils.cos(c.doorAngle) * (c.innerRadius + RoomBuilder.WALL_T / 2f)
                val dcy   = wy + MathUtils.sin(c.doorAngle) * (c.innerRadius + RoomBuilder.WALL_T / 2f)
                shapeRenderer.rect(
                    dcx - rectW / 2f, dcy - rectH / 2f,
                    rectW / 2f, rectH / 2f,
                    rectW, rectH,
                    1f, 1f,
                    c.doorAngle * MathUtils.radiansToDegrees
                )
            }
        }

        // Table
        shapeRenderer.color = Color(0.45f, 0.28f, 0.12f, 1f)
        shapeRenderer.rect(tableX, tableY, tableW, tableH)
        shapeRenderer.color = Color(0.38f, 0.23f, 0.09f, 1f)
        shapeRenderer.rect(tableX + 0.3f,  tableY, 0.05f, tableH)
        shapeRenderer.rect(tableX + 0.9f,  tableY, 0.05f, tableH)
        shapeRenderer.rect(tableX + 1.3f,  tableY, 0.05f, tableH)

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

        // Arm (at torchLagAngle, drawn behind body)
        val arm = worldL(0.1f, 0.18f)
        shapeRenderer.color = Color(0.78f, 0.56f, 0.42f, 1f)
        shapeRenderer.ellipse(arm.x - 0.09f, arm.y - 0.06f, 0.18f, 0.12f, lagDeg)

        // Torch body
        val torchStart = worldL(0.2f, 0.13f)
        shapeRenderer.color = Color(0.18f, 0.14f, 0.1f, 1f)
        shapeRenderer.rect(torchStart.x, torchStart.y - 0.04f, 0.38f, 0.08f, 0f, 0.04f, 1f, 1f, lagDeg)

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
    }

    override fun dispose() {
        music.dispose()
        shapeRenderer.dispose()
        rayHandler.dispose()
        world.dispose()
    }
}
