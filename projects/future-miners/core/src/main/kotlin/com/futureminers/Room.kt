package com.futureminers

import com.badlogic.gdx.math.MathUtils

data class WallSegment(val x: Float, val y: Float, val w: Float, val h: Float)

enum class RoomType { SQUARE, CORRIDOR, CIRCLE }
enum class WallSide { TOP, BOTTOM, LEFT, RIGHT }

data class CircleWall(val cx: Float, val cy: Float, val innerRadius: Float, val doorAngle: Float)

data class RoomData(
    val worldX: Float,
    val worldY: Float,
    val width: Float,
    val height: Float,
    val type: RoomType,
    val walls: List<WallSegment>,
    val circle: CircleWall? = null
)

object RoomBuilder {

    const val WALL_T   = 0.5f
    const val DOOR_W   = 1.8f
    const val CONN_LEN = 2f

    fun dimensions(type: RoomType, entry: WallSide): Pair<Float, Float> = when (type) {
        RoomType.SQUARE   -> Pair(8f, 8f)
        RoomType.CORRIDOR -> when (entry) {
            WallSide.LEFT, WallSide.RIGHT  -> Pair(8f, 3.5f)
            WallSide.TOP,  WallSide.BOTTOM -> Pair(3.5f, 8f)
        }
        RoomType.CIRCLE   -> Pair(9f, 9f)
    }

    fun buildStartRoom(roomW: Float, roomH: Float): RoomData {
        val half = DOOR_W / 2f
        val walls = mutableListOf<WallSegment>()

        walls += WallSegment(0f, 0f, roomW, WALL_T)  // bottom solid

        walls += WallSegment(0f, roomH - WALL_T, roomW / 2f - half, WALL_T)
        walls += WallSegment(roomW / 2f + half, roomH - WALL_T, roomW / 2f - half, WALL_T)

        walls += WallSegment(0f, 0f, WALL_T, roomH / 2f - half)
        walls += WallSegment(0f, roomH / 2f + half, WALL_T, roomH / 2f - half)

        walls += WallSegment(roomW - WALL_T, 0f, WALL_T, roomH / 2f - half)
        walls += WallSegment(roomW - WALL_T, roomH / 2f + half, WALL_T, roomH / 2f - half)

        return RoomData(0f, 0f, roomW, roomH, RoomType.SQUARE, walls)
    }

    fun buildSquareRoom(worldX: Float, worldY: Float, entry: WallSide): RoomData =
        buildRectRoom(worldX, worldY, 8f, 8f, entry, RoomType.SQUARE)

    fun buildCorridorRoom(worldX: Float, worldY: Float, entry: WallSide): RoomData {
        val (w, h) = dimensions(RoomType.CORRIDOR, entry)
        return buildRectRoom(worldX, worldY, w, h, entry, RoomType.CORRIDOR)
    }

    fun buildCircleRoom(worldX: Float, worldY: Float, entry: WallSide): RoomData {
        val radius   = 4f
        val roomSize = radius * 2f + 1f  // 9f
        val cxBase   = roomSize / 2f
        val cyBase   = roomSize / 2f

        // Shift the circle inward on the entry axis so the stub fits in front of it
        val cx = if (entry == WallSide.LEFT)   cxBase + CONN_LEN else cxBase
        val cy = if (entry == WallSide.BOTTOM) cyBase + CONN_LEN else cyBase

        val doorAngle = when (entry) {
            WallSide.LEFT   -> MathUtils.PI
            WallSide.RIGHT  -> 0f
            WallSide.BOTTOM -> -MathUtils.PI / 2f
            WallSide.TOP    ->  MathUtils.PI / 2f
        }

        val half  = DOOR_W / 2f
        val walls = mutableListOf<WallSegment>()

        // Stub cap walls on either side of the door opening
        when (entry) {
            WallSide.LEFT -> {
                val len = cx - radius
                walls += WallSegment(0f, cy - half - WALL_T, len, WALL_T)
                walls += WallSegment(0f, cy + half,          len, WALL_T)
            }
            WallSide.RIGHT -> {
                val start = cx + radius
                val len   = (roomSize - start) + CONN_LEN
                walls += WallSegment(start, cy - half - WALL_T, len, WALL_T)
                walls += WallSegment(start, cy + half,          len, WALL_T)
            }
            WallSide.BOTTOM -> {
                val len = cy - radius
                walls += WallSegment(cx - half - WALL_T, 0f, WALL_T, len)
                walls += WallSegment(cx + half,          0f, WALL_T, len)
            }
            WallSide.TOP -> {
                val start = cy + radius
                val len   = (roomSize - start) + CONN_LEN
                walls += WallSegment(cx - half - WALL_T, start, WALL_T, len)
                walls += WallSegment(cx + half,          start, WALL_T, len)
            }
        }

        return RoomData(worldX, worldY, roomSize, roomSize, RoomType.CIRCLE, walls,
            CircleWall(cx, cy, radius, doorAngle))
    }

    private fun buildRectRoom(
        worldX: Float, worldY: Float,
        w: Float, h: Float,
        entry: WallSide,
        type: RoomType
    ): RoomData {
        val half  = DOOR_W / 2f
        val walls = mutableListOf<WallSegment>()

        // Stub: the room's local origin is placed flush against the previous room's wall.
        // Two cap segments run alongside the door opening for CONN_LEN, then the room body begins.
        when (entry) {
            WallSide.LEFT -> {
                walls += WallSegment(0f, h / 2f - half - WALL_T, CONN_LEN, WALL_T)
                walls += WallSegment(0f, h / 2f + half,          CONN_LEN, WALL_T)
            }
            WallSide.RIGHT -> {
                walls += WallSegment(w, h / 2f - half - WALL_T, CONN_LEN, WALL_T)
                walls += WallSegment(w, h / 2f + half,          CONN_LEN, WALL_T)
            }
            WallSide.BOTTOM -> {
                walls += WallSegment(w / 2f - half - WALL_T, 0f, WALL_T, CONN_LEN)
                walls += WallSegment(w / 2f + half,          0f, WALL_T, CONN_LEN)
            }
            WallSide.TOP -> {
                walls += WallSegment(w / 2f - half - WALL_T, h, WALL_T, CONN_LEN)
                walls += WallSegment(w / 2f + half,          h, WALL_T, CONN_LEN)
            }
        }

        // Room body is offset by CONN_LEN on the entry axis
        val ox = if (entry == WallSide.LEFT)   CONN_LEN else 0f
        val oy = if (entry == WallSide.BOTTOM) CONN_LEN else 0f

        if (entry == WallSide.BOTTOM) {
            walls += WallSegment(ox,                 oy, w / 2f - half, WALL_T)
            walls += WallSegment(ox + w / 2f + half, oy, w / 2f - half, WALL_T)
        } else walls += WallSegment(ox, oy, w, WALL_T)

        if (entry == WallSide.TOP) {
            walls += WallSegment(ox,                 oy + h - WALL_T, w / 2f - half, WALL_T)
            walls += WallSegment(ox + w / 2f + half, oy + h - WALL_T, w / 2f - half, WALL_T)
        } else walls += WallSegment(ox, oy + h - WALL_T, w, WALL_T)

        if (entry == WallSide.LEFT) {
            walls += WallSegment(ox, oy,                  WALL_T, h / 2f - half)
            walls += WallSegment(ox, oy + h / 2f + half,  WALL_T, h / 2f - half)
        } else walls += WallSegment(ox, oy, WALL_T, h)

        if (entry == WallSide.RIGHT) {
            walls += WallSegment(ox + w - WALL_T, oy,                 WALL_T, h / 2f - half)
            walls += WallSegment(ox + w - WALL_T, oy + h / 2f + half, WALL_T, h / 2f - half)
        } else walls += WallSegment(ox + w - WALL_T, oy, WALL_T, h)

        return RoomData(worldX, worldY, w, h, type, walls)
    }
}
