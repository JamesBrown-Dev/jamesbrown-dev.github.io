package com.futureminers

import com.badlogic.gdx.math.MathUtils

data class WallSegment(val x: Float, val y: Float, val w: Float, val h: Float)

enum class RoomType { SQUARE, CORRIDOR, CIRCLE, LARGE, BEND }
enum class WallSide { TOP, BOTTOM, LEFT, RIGHT }

data class CircleWall(val cx: Float, val cy: Float, val innerRadius: Float, val doorAngle: Float)

/** Quarter-circle (90°) corridor bend.  [cx,cy] is the centre of curvature in room-local coords.
 *  [startAngleDeg] + 90° sweep (CCW) traces from the entry opening to the exit opening. */
data class BendData(
    val cx: Float,
    val cy: Float,
    val innerRadius: Float,   // inner corridor wall
    val outerRadius: Float,   // outer corridor wall
    val startAngleDeg: Float, // libGDX arc start angle (CCW), sweep is always 90°
    val sweepDeg: Float = 90f
)

data class RoomData(
    val worldX: Float,
    val worldY: Float,
    val width: Float,
    val height: Float,
    val type: RoomType,
    val walls: List<WallSegment>,
    val circle: CircleWall? = null,
    val bend: BendData? = null,
    val depth: Int = 0,
    val bodyOffsetX: Float = 0f,
    val bodyOffsetY: Float = 0f,
    val openSides: Set<WallSide> = emptySet()
)

enum class LootType { SILVER, GOLD, DIAMOND }
data class LootItem(val x: Float, val y: Float, val type: LootType, var collected: Boolean = false)

object RoomBuilder {

    const val WALL_T   = 0.5f
    const val DOOR_W   = 2.5f
    const val CONN_LEN = 2f

    const val BEND_S = 7f   // side length of the square bounding box for a bend room

    fun dimensions(type: RoomType, entry: WallSide): Pair<Float, Float> = when (type) {
        RoomType.SQUARE   -> Pair(8f, 8f)
        RoomType.CORRIDOR -> when (entry) {
            WallSide.LEFT, WallSide.RIGHT  -> Pair(8f, 3.5f)
            WallSide.TOP,  WallSide.BOTTOM -> Pair(3.5f, 8f)
        }
        RoomType.CIRCLE   -> Pair(9f, 9f)
        RoomType.LARGE    -> Pair(14f, 14f)
        RoomType.BEND     -> Pair(BEND_S, BEND_S)
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

    fun buildSquareRoom(worldX: Float, worldY: Float, entry: WallSide, exits: Set<WallSide> = emptySet()): RoomData =
        buildRectRoom(worldX, worldY, 8f, 8f, entry, RoomType.SQUARE, exits)

    fun buildLargeRoom(worldX: Float, worldY: Float, entry: WallSide, exits: Set<WallSide> = emptySet()): RoomData {
        val base = buildRectRoom(worldX, worldY, 14f, 14f, entry, RoomType.LARGE, exits)
        val ox = base.bodyOffsetX
        val oy = base.bodyOffsetY
        // Solid 3×3 pillar centred in the room body
        val pillar = WallSegment(ox + 3.5f, oy + 3.5f, 7f, 7f)
        return base.copy(walls = base.walls + pillar)
    }

    fun buildCorridorRoom(worldX: Float, worldY: Float, entry: WallSide, exits: Set<WallSide> = emptySet()): RoomData {
        val (w, h) = dimensions(RoomType.CORRIDOR, entry)
        return buildRectRoom(worldX, worldY, w, h, entry, RoomType.CORRIDOR, exits, stub = false)
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

    /**
     * Build a quarter-circle bend corridor.  [entry] and [exit] must be perpendicular.
     * The room is a BEND_S × BEND_S square; the arc is centred at whichever corner
     * corresponds to the turn direction so the openings are centred on their walls.
     */
    fun buildBendRoom(worldX: Float, worldY: Float, entry: WallSide, exit: WallSide): RoomData {
        val S    = BEND_S
        val half = DOOR_W / 2f
        val r    = S / 2f        // centerline radius
        val rIn  = r - half      // inner wall of corridor
        val rOut = r + half      // outer wall of corridor
        val walls = mutableListOf<WallSegment>()

        // Choose corner (arc centre) and libGDX arc start angle (90° CCW sweep)
        val isLT = (entry == WallSide.LEFT  && exit == WallSide.TOP)    || (entry == WallSide.TOP    && exit == WallSide.LEFT)
        val isLB = (entry == WallSide.LEFT  && exit == WallSide.BOTTOM) || (entry == WallSide.BOTTOM && exit == WallSide.LEFT)
        val isRT = (entry == WallSide.RIGHT && exit == WallSide.TOP)    || (entry == WallSide.TOP    && exit == WallSide.RIGHT)
        // else RIGHT+BOTTOM

        val (cx, cy, startDeg) = when {
            isLT -> Triple(0f, S, 270f)
            isLB -> Triple(0f, 0f, 0f)
            isRT -> Triple(S, S, 180f)
            else -> Triple(S, 0f, 90f)
        }

        when {
            isLT -> { // arc centre = top-left; entry=left wall, exit=top wall
                walls += WallSegment(0f,         0f,         S,        WALL_T)   // bottom full
                walls += WallSegment(S - WALL_T, 0f,         WALL_T,   S)        // right full
                walls += WallSegment(0f,         0f,         WALL_T,   r - half) // left below entry
                walls += WallSegment(0f,         r + half,   WALL_T,   r - half) // left above entry (inner corner)
                walls += WallSegment(0f,         S - WALL_T, r - half, WALL_T)   // top left cap (inner corner)
                walls += WallSegment(r + half,   S - WALL_T, r - half, WALL_T)   // top right of exit
            }
            isLB -> { // arc centre = bottom-left; entry=left wall, exit=bottom wall
                walls += WallSegment(0f,         S - WALL_T, S,        WALL_T)   // top full
                walls += WallSegment(S - WALL_T, 0f,         WALL_T,   S)        // right full
                walls += WallSegment(0f,         r + half,   WALL_T,   r - half) // left above entry
                walls += WallSegment(0f,         0f,         WALL_T,   r - half) // left below entry (inner corner)
                walls += WallSegment(0f,         0f,         r - half, WALL_T)   // bottom left cap (inner corner)
                walls += WallSegment(r + half,   0f,         r - half, WALL_T)   // bottom right of exit
            }
            isRT -> { // arc centre = top-right; entry=right wall, exit=top wall
                walls += WallSegment(0f,         0f,         S,        WALL_T)   // bottom full
                walls += WallSegment(0f,         0f,         WALL_T,   S)        // left full
                walls += WallSegment(S - WALL_T, 0f,         WALL_T,   r - half) // right below entry
                walls += WallSegment(S - WALL_T, r + half,   WALL_T,   r - half) // right above entry (inner corner)
                walls += WallSegment(r + half,   S - WALL_T, r - half, WALL_T)   // top right cap (inner corner)
                walls += WallSegment(0f,         S - WALL_T, r - half, WALL_T)   // top left of exit
            }
            else -> { // arc centre = bottom-right; entry=right wall, exit=bottom wall
                walls += WallSegment(0f,         S - WALL_T, S,        WALL_T)   // top full
                walls += WallSegment(0f,         0f,         WALL_T,   S)        // left full
                walls += WallSegment(S - WALL_T, r + half,   WALL_T,   r - half) // right above entry
                walls += WallSegment(S - WALL_T, 0f,         WALL_T,   r - half) // right below entry (inner corner)
                walls += WallSegment(r + half,   0f,         r - half, WALL_T)   // bottom right cap (inner corner)
                walls += WallSegment(0f,         0f,         r - half, WALL_T)   // bottom left of exit
            }
        }

        val bend = BendData(cx, cy, rIn, rOut, startDeg)
        return RoomData(worldX, worldY, S, S, RoomType.BEND, walls, bend = bend,
            openSides = setOf(entry, exit))
    }

    private fun buildRectRoom(
        worldX: Float, worldY: Float,
        w: Float, h: Float,
        entry: WallSide,
        type: RoomType,
        exits: Set<WallSide> = emptySet(),
        stub: Boolean = true
    ): RoomData {
        val half = DOOR_W / 2f
        val open = exits + entry   // all sides that need a doorway gap
        val walls = mutableListOf<WallSegment>()

        // Stub on the entry side (skipped for rooms that are already corridor-shaped)
        if (stub) when (entry) {
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

        // Body offset by CONN_LEN on the entry axis (only when there is a stub)
        val ox = if (stub && entry == WallSide.LEFT)   CONN_LEN else 0f
        val oy = if (stub && entry == WallSide.BOTTOM) CONN_LEN else 0f

        // Each wall is split into a doorway if that side is in `open`, otherwise solid
        if (WallSide.BOTTOM in open) {
            walls += WallSegment(ox,                 oy, w / 2f - half, WALL_T)
            walls += WallSegment(ox + w / 2f + half, oy, w / 2f - half, WALL_T)
        } else walls += WallSegment(ox, oy, w, WALL_T)

        if (WallSide.TOP in open) {
            walls += WallSegment(ox,                 oy + h - WALL_T, w / 2f - half, WALL_T)
            walls += WallSegment(ox + w / 2f + half, oy + h - WALL_T, w / 2f - half, WALL_T)
        } else walls += WallSegment(ox, oy + h - WALL_T, w, WALL_T)

        if (WallSide.LEFT in open) {
            walls += WallSegment(ox, oy,                  WALL_T, h / 2f - half)
            walls += WallSegment(ox, oy + h / 2f + half,  WALL_T, h / 2f - half)
        } else walls += WallSegment(ox, oy, WALL_T, h)

        if (WallSide.RIGHT in open) {
            walls += WallSegment(ox + w - WALL_T, oy,                 WALL_T, h / 2f - half)
            walls += WallSegment(ox + w - WALL_T, oy + h / 2f + half, WALL_T, h / 2f - half)
        } else walls += WallSegment(ox + w - WALL_T, oy, WALL_T, h)

        return RoomData(worldX, worldY, w, h, type, walls, bodyOffsetX = ox, bodyOffsetY = oy, openSides = open)
    }
}
