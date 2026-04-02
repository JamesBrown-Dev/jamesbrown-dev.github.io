package com.futureminers

import box2dLight.PointLight
import box2dLight.RayHandler
import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector2
import com.badlogic.gdx.physics.box2d.*

enum class SpiderState { PATROL, CHASE, SEARCH }

class Spider(
    private val world: World,
    rayHandler: RayHandler,
    private val room: RoomData
) {
    companion object {
        private const val PATROL_SPEED    = 1.2f
        private const val CHASE_SPEED     = 3.5f
        private const val DETECT_RADIUS   = 12f
        private const val LOSE_RADIUS     = 16f
        private const val BODY_RADIUS     = 0.35f
        private const val ARRIVE_DIST     = 0.3f
        private const val STUCK_TIME      = 1.2f
        private const val EYE_OFFSET_X   = 0.10f
        private const val EYE_OFFSET_Y   = 0.12f
    }

    val body: Body
    private var state        = SpiderState.PATROL
    private var patrolTarget = Vector2()
    private var facingAngle  = MathUtils.random(0f, MathUtils.PI2)
    private var targetAngle  = facingAngle
    private var legTimer     = MathUtils.random(0f, MathUtils.PI2)
    private var stuckTimer   = 0f
    private var noLosTimer   = 0f
    private var lastSeenPos  = Vector2()
    private val leftEye:  PointLight
    private val rightEye: PointLight

    init {
        val bx = room.worldX + room.bodyOffsetX + room.width  / 2f
        val by = room.worldY + room.bodyOffsetY + room.height / 2f

        body = world.createBody(BodyDef().apply {
            type = BodyDef.BodyType.DynamicBody
            position.set(bx, by)
            fixedRotation = true
            linearDamping = 8f
        })
        val shape = CircleShape().apply { radius = BODY_RADIUS }
        body.createFixture(shape, 0f).also {
            it.filterData = Filter().apply { categoryBits = 0x0002; maskBits = 0x0001 }
        }
        shape.dispose()

        leftEye  = PointLight(rayHandler, 16, Color(1f, 0f, 0f, 1f), 2f, bx - EYE_OFFSET_X, by + EYE_OFFSET_Y)
        rightEye = PointLight(rayHandler, 16, Color(1f, 0f, 0f, 1f), 2f, bx + EYE_OFFSET_X, by + EYE_OFFSET_Y)
        leftEye.isSoft  = true; rightEye.isSoft  = true
        leftEye.setContactFilter(0x0004, 0, 0x0001)
        rightEye.setContactFilter(0x0004, 0, 0x0001)

        pickPatrolPoint()
    }

    fun update(dt: Float, playerPos: Vector2) {
        val pos = body.position
        val dx  = playerPos.x - pos.x
        val dy  = playerPos.y - pos.y
        val distSq = dx * dx + dy * dy

        when (state) {
            SpiderState.PATROL -> {
                if (distSq < DETECT_RADIUS * DETECT_RADIUS && hasLineOfSight(playerPos)) {
                    state = SpiderState.CHASE
                } else {
                    val tdx = patrolTarget.x - pos.x
                    val tdy = patrolTarget.y - pos.y
                    if (tdx * tdx + tdy * tdy < ARRIVE_DIST * ARRIVE_DIST) {
                        pickPatrolPoint()
                        stuckTimer = 0f
                    } else {
                        val speed = PATROL_SPEED
                        val len   = Math.sqrt((tdx * tdx + tdy * tdy).toDouble()).toFloat()
                        val vx    = tdx / len * speed
                        val vy    = tdy / len * speed
                        body.linearVelocity = Vector2(vx, vy)
                        targetAngle = MathUtils.atan2(vy, vx)

                        // Stuck detection — no significant movement
                        val spd = body.linearVelocity.len()
                        if (spd < 0.1f) {
                            stuckTimer += dt
                            if (stuckTimer > STUCK_TIME) { pickPatrolPoint(); stuckTimer = 0f }
                        } else {
                            stuckTimer = 0f
                        }
                    }
                }
            }
            SpiderState.CHASE -> {
                if (distSq > LOSE_RADIUS * LOSE_RADIUS) {
                    state = SpiderState.PATROL
                    pickPatrolPoint()
                } else if (hasLineOfSight(playerPos)) {
                    lastSeenPos.set(playerPos)
                    noLosTimer = 0f
                    val len = Math.sqrt(distSq.toDouble()).toFloat()
                    val vx  = dx / len * CHASE_SPEED
                    val vy  = dy / len * CHASE_SPEED
                    body.linearVelocity = Vector2(vx, vy)
                    targetAngle = MathUtils.atan2(vy, vx)
                } else {
                    // Lost sight — move to last seen position
                    state = SpiderState.SEARCH
                    noLosTimer = 0f
                }
            }
            SpiderState.SEARCH -> {
                // Re-acquire if player comes back into view
                if (distSq < DETECT_RADIUS * DETECT_RADIUS && hasLineOfSight(playerPos)) {
                    state = SpiderState.CHASE
                    noLosTimer = 0f
                    return
                }
                val tdx = lastSeenPos.x - pos.x
                val tdy = lastSeenPos.y - pos.y
                val distToLastSeen = Math.sqrt((tdx * tdx + tdy * tdy).toDouble()).toFloat()
                if (distToLastSeen > ARRIVE_DIST) {
                    // Still moving toward last seen position
                    val vx = tdx / distToLastSeen * PATROL_SPEED
                    val vy = tdy / distToLastSeen * PATROL_SPEED
                    body.linearVelocity = Vector2(vx, vy)
                    targetAngle = MathUtils.atan2(vy, vx)
                } else {
                    // Arrived — wait 2 seconds then give up
                    body.linearVelocity = Vector2.Zero
                    noLosTimer += dt
                    if (noLosTimer >= 2f) {
                        state = SpiderState.PATROL
                        noLosTimer = 0f
                        pickPatrolPoint()
                    }
                }
            }
        }

        // Smoothly rotate facing toward target angle
        var diff = targetAngle - facingAngle
        while (diff >  MathUtils.PI) diff -= MathUtils.PI2
        while (diff < -MathUtils.PI) diff += MathUtils.PI2
        facingAngle += diff * minOf(1f, 4f * dt)

        // Advance leg timer proportional to speed so legs only move when walking
        val speed = body.linearVelocity.len()
        legTimer += dt * speed * 3f

        // Sync eye lights — fade with distance to player
        val px = body.position.x; val py = body.position.y
        val dist      = Math.sqrt(distSq.toDouble()).toFloat()
        val eyeDist   = (2f * (1f - (dist / 30f).coerceIn(0f, 1f))).coerceAtLeast(0.1f)
        leftEye.setDistance(eyeDist)
        rightEye.setDistance(eyeDist)
        leftEye.setPosition (px - EYE_OFFSET_X, py + EYE_OFFSET_Y)
        rightEye.setPosition(px + EYE_OFFSET_X, py + EYE_OFFSET_Y)
    }

    fun draw(sr: ShapeRenderer) {
        val px = body.position.x
        val py = body.position.y
        val cos = MathUtils.cos(facingAngle)
        val sin = MathUtils.sin(facingAngle)

        fun world(lx: Float, ly: Float) = Vector2(px + cos * lx - sin * ly, py + sin * lx + cos * ly)

        // Leg angles (degrees from forward), 4 pairs
        val legAngles = floatArrayOf(40f, 65f, 90f, 115f)
        val legLen    = 0.38f
        val legW      = 0.05f

        sr.color = Color(0.12f, 0.10f, 0.10f, 1f)
        for (i in legAngles.indices) {
            // Alternate pairs: 0&2 in phase, 1&3 out of phase — gives a walking gait
            val phase  = if (i % 2 == 0) 0f else MathUtils.PI
            val anim   = MathUtils.sin(legTimer * 6f + phase) * 8f
            val angL   =  legAngles[i] + anim
            val angR   = -legAngles[i] - anim
            val baseL  = world(BODY_RADIUS * MathUtils.cos(angL * MathUtils.degreesToRadians),
                                BODY_RADIUS * MathUtils.sin(angL * MathUtils.degreesToRadians))
            val baseR  = world(BODY_RADIUS * MathUtils.cos(angR * MathUtils.degreesToRadians),
                                BODY_RADIUS * MathUtils.sin(angR * MathUtils.degreesToRadians))
            val worldAngL = facingAngle + angL * MathUtils.degreesToRadians
            val worldAngR = facingAngle + angR * MathUtils.degreesToRadians
            sr.rect(baseL.x, baseL.y - legW / 2f, 0f, legW / 2f, legLen, legW, 1f, 1f,
                worldAngL * MathUtils.radiansToDegrees)
            sr.rect(baseR.x, baseR.y - legW / 2f, 0f, legW / 2f, legLen, legW, 1f, 1f,
                worldAngR * MathUtils.radiansToDegrees)
        }

        // Body — dark ellipse
        sr.color = Color(0.10f, 0.08f, 0.08f, 1f)
        sr.ellipse(px - 0.35f, py - 0.28f, 0.70f, 0.56f, facingAngle * MathUtils.radiansToDegrees)

        // Abdomen (rounder, slightly lighter)
        val abd = world(-0.25f, 0f)
        sr.color = Color(0.14f, 0.11f, 0.11f, 1f)
        sr.circle(abd.x, abd.y, 0.22f, 14)

        // Glowing red eyes
        sr.color = Color(0.9f, 0f, 0f, 1f)
        val eyeL = world(0.18f,  EYE_OFFSET_X)
        val eyeR = world(0.18f, -EYE_OFFSET_X)
        sr.circle(eyeL.x, eyeL.y, 0.045f, 8)
        sr.circle(eyeR.x, eyeR.y, 0.045f, 8)
        // Inner highlight
        sr.color = Color(1f, 0.3f, 0.3f, 1f)
        sr.circle(eyeL.x + 0.01f, eyeL.y + 0.01f, 0.018f, 6)
        sr.circle(eyeR.x + 0.01f, eyeR.y + 0.01f, 0.018f, 6)
    }

    fun dispose() {
        leftEye.dispose()
        rightEye.dispose()
        world.destroyBody(body)
    }

    private fun pickPatrolPoint() {
        val inset = RoomBuilder.WALL_T + BODY_RADIUS + 0.2f
        val bx = room.worldX + room.bodyOffsetX
        val by = room.worldY + room.bodyOffsetY
        patrolTarget = Vector2(
            MathUtils.random(bx + inset, bx + room.width  - inset),
            MathUtils.random(by + inset, by + room.height - inset)
        )
    }

    private fun hasLineOfSight(target: Vector2): Boolean {
        var hit = false
        world.rayCast({ fixture, _, _, _ ->
            if (fixture.filterData.categoryBits == 0x0001.toShort()) {
                hit = true
                0f
            } else {
                -1f
            }
        }, body.position, target)
        return !hit
    }
}
