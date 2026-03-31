package com.futureminers

import box2dLight.ConeLight
import box2dLight.PointLight
import box2dLight.RayHandler
import com.badlogic.gdx.ApplicationAdapter
import com.badlogic.gdx.Gdx
import com.badlogic.gdx.Input.Keys
import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.OrthographicCamera
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector2
import com.badlogic.gdx.physics.box2d.*
import com.badlogic.gdx.utils.ScreenUtils

class Main : ApplicationAdapter() {

    private val PPM = 32f

    private lateinit var camera: OrthographicCamera
    private lateinit var shapeRenderer: ShapeRenderer
    private lateinit var world: World
    private lateinit var rayHandler: RayHandler
    private lateinit var playerBody: Body
    private lateinit var torch: ConeLight

    private val playerSpeed = 5f
    private lateinit var candleLight: PointLight
    private val candleX = 8f
    private val candleY = 8f
    private var flickerTimer = 0f

    // Wall layout: each entry is x, y, width, height in metres
    private val wallLayout = listOf(
        floatArrayOf(0f,    0f,   20f,  0.5f),  // bottom boundary
        floatArrayOf(0f,   14.5f, 20f,  0.5f),  // top boundary
        floatArrayOf(0f,    0f,   0.5f, 15f),   // left boundary
        floatArrayOf(19.5f, 0f,   0.5f, 15f),   // right boundary
        floatArrayOf(4f,    2f,   4f,   0.5f),  // interior wall A
        floatArrayOf(10f,   6f,   0.5f, 4f),    // interior wall B
        floatArrayOf(3f,    9f,   5f,   0.5f),  // interior wall C
        floatArrayOf(13f,   2f,   0.5f, 3f),    // interior wall D
    )

    override fun create() {
        camera = OrthographicCamera()
        camera.setToOrtho(false, Gdx.graphics.width / PPM, Gdx.graphics.height / PPM)

        shapeRenderer = ShapeRenderer()

        world = World(Vector2(0f, 0f), true)

        RayHandler.setGammaCorrection(true)
        RayHandler.useDiffuseLight(true)
        rayHandler = RayHandler(world)
        rayHandler.setAmbientLight(0f, 0f, 0f, 0.03f) // near pitch black

        // Player
        val bodyDef = BodyDef().apply {
            type = BodyDef.BodyType.DynamicBody
            position.set(5f, 5f)
            fixedRotation = true
        }
        playerBody = world.createBody(bodyDef)
        val circle = CircleShape().apply { radius = 0.3f }
        playerBody.createFixture(circle, 1f)
        circle.dispose()

        // Torch cone light attached to player
        torch = ConeLight(rayHandler, 128, Color(1f, 0.85f, 0.6f, 1f), 16f, 0f, 0f, 90f, 25f)
        torch.isSoft = true

        // Candle
        candleLight = PointLight(rayHandler, 64, Color(1f, 0.6f, 0.2f, 1f), 5f, candleX, candleY)
        candleLight.isSoft = true

        // Build walls
        wallLayout.forEach { (x, y, w, h) -> createWall(x, y, w, h) }
    }

    private fun createWall(x: Float, y: Float, w: Float, h: Float) {
        val body = world.createBody(BodyDef().apply {
            type = BodyDef.BodyType.StaticBody
            position.set(x + w / 2f, y + h / 2f)
        })
        val shape = PolygonShape().apply { setAsBox(w / 2f, h / 2f) }
        body.createFixture(shape, 0f)
        shape.dispose()
    }

    override fun render() {
        val dt = Gdx.graphics.deltaTime

        // Movement
        val vel = Vector2(0f, 0f)
        if (Gdx.input.isKeyPressed(Keys.W)) vel.y += playerSpeed
        if (Gdx.input.isKeyPressed(Keys.S)) vel.y -= playerSpeed
        if (Gdx.input.isKeyPressed(Keys.A)) vel.x -= playerSpeed
        if (Gdx.input.isKeyPressed(Keys.D)) vel.x += playerSpeed
        playerBody.linearVelocity = vel

        // Torch faces the mouse — unproject screen coords to world coords
        val mouseVec = camera.unproject(
            com.badlogic.gdx.math.Vector3(Gdx.input.x.toFloat(), Gdx.input.y.toFloat(), 0f)
        )
        val angle = MathUtils.atan2(
            mouseVec.y - playerBody.position.y,
            mouseVec.x - playerBody.position.x
        ) * MathUtils.radiansToDegrees
        torch.setPosition(playerBody.position.x, playerBody.position.y)
        torch.setDirection(angle)

        // Candle flicker
        flickerTimer += dt
        val flicker = 8f + MathUtils.sin(flickerTimer * 9f) * 1f + MathUtils.random(-0.5f, 0.5f)
        candleLight.setDistance(flicker)

        world.step(dt, 6, 2)

        camera.position.set(playerBody.position.x, playerBody.position.y, 0f)
        camera.update()

        ScreenUtils.clear(0.05f, 0.05f, 0.05f, 1f)

        // Draw walls and player
        shapeRenderer.projectionMatrix = camera.combined
        shapeRenderer.begin(ShapeRenderer.ShapeType.Filled)

        // Walls
        shapeRenderer.color = Color(0.25f, 0.22f, 0.2f, 1f)
        wallLayout.forEach { (x, y, w, h) ->
            shapeRenderer.rect(x, y, w, h)
        }

        // Player dot
        shapeRenderer.color = Color(0.8f, 0.75f, 0.7f, 1f)
        shapeRenderer.circle(playerBody.position.x, playerBody.position.y, 0.3f, 16)

        // Candle — wax stub
        shapeRenderer.color = Color(0.9f, 0.88f, 0.82f, 1f)
        shapeRenderer.rect(candleX - 0.1f, candleY - 0.25f, 0.2f, 0.25f)

        // Flame flicker offset
        val flameOffset = MathUtils.sin(flickerTimer * 13f) * 0.04f

        // Outer flame (orange)
        shapeRenderer.color = Color(1f, 0.45f, 0.1f, 1f)
        shapeRenderer.circle(candleX + flameOffset, candleY + 0.13f, 0.13f, 12)

        // Inner flame (yellow)
        shapeRenderer.color = Color(1f, 0.85f, 0.2f, 1f)
        shapeRenderer.circle(candleX + flameOffset * 0.5f, candleY + 0.1f, 0.07f, 12)

        // Hot centre (white)
        shapeRenderer.color = Color(1f, 1f, 0.95f, 1f)
        shapeRenderer.circle(candleX, candleY + 0.07f, 0.03f, 8)

        shapeRenderer.end()

        // Lighting
        rayHandler.setCombinedMatrix(camera)
        rayHandler.updateAndRender()
    }

    override fun resize(width: Int, height: Int) {
        camera.setToOrtho(false, width / PPM, height / PPM)
    }

    override fun dispose() {
        shapeRenderer.dispose()
        rayHandler.dispose()
        world.dispose()
        candleLight.dispose()
    }
}
