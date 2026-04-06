package com.futureminers

import com.badlogic.gdx.math.MathUtils

object RoomManager {

    val startW = 10f
    val startH = 7.5f
    private const val MAX_DEPTH       = 8
    private const val BRANCH_CHANCE   = 0.80f
    private const val MAX_SHORTCUT_GAP = 8f    // max world-unit gap between facing wall outer faces
    private const val SHORTCUT_CHANCE  = 0.50f // probability of adding a shortcut when eligible
    private val MIN_OVERLAP = RoomBuilder.DOOR_W + RoomBuilder.WALL_T * 4f // min shared edge for a doorway

    fun generate(): List<RoomData> {
        val rooms    = mutableListOf<RoomData>()
        val occupied = mutableListOf(Rect(0f, 0f, startW, startH))

        // Spawn children of the start room first so we know which exits actually placed
        val successfulExits = mutableSetOf<WallSide>()
        for (exit in rollExits(skip = WallSide.BOTTOM, depth = MAX_DEPTH)) {
            if (spawnNeighbour(rooms, occupied, 0f, 0f, startW, startH, exit, MAX_DEPTH - 1)) {
                successfulExits += exit
            }
        }

        // Build start room with only the doorways that have real rooms behind them
        rooms += buildStartRoom(startW, startH, successfulExits)
        return addShortcuts(rooms)
    }

    /**
     * Try to place a room on [exit] side of the current body.
     * Children are spawned before the room is built, so the room is only given
     * doorways for exits that actually succeeded — no open doorways to nowhere.
     * Returns true if the room was placed.
     */
    private fun spawnNeighbour(
        rooms: MutableList<RoomData>,
        occupied: MutableList<Rect>,
        bodyX: Float, bodyY: Float,
        bodyW: Float, bodyH: Float,
        exit: WallSide,
        depth: Int
    ): Boolean {
        val conn      = RoomBuilder.CONN_LEN
        val nextEntry = opposite(exit)
        val nextType  = randomType()
        val (nextW, nextH) = RoomBuilder.dimensions(nextType, nextEntry)

        // Corridor rooms have no stub so they sit flush with no gap
        val sl = if (nextType == RoomType.CORRIDOR) 0f else conn

        val nextWorldX: Float
        val nextWorldY: Float
        when (exit) {
            WallSide.RIGHT  -> { nextWorldX = bodyX + bodyW;                    nextWorldY = bodyY + bodyH / 2f - nextH / 2f }
            WallSide.LEFT   -> { nextWorldX = bodyX - nextW - sl;               nextWorldY = bodyY + bodyH / 2f - nextH / 2f }
            WallSide.TOP    -> { nextWorldX = bodyX + bodyW / 2f - nextW / 2f; nextWorldY = bodyY + bodyH }
            WallSide.BOTTOM -> { nextWorldX = bodyX + bodyW / 2f - nextW / 2f; nextWorldY = bodyY - nextH - sl }
        }

        val nextOx = if (nextEntry == WallSide.LEFT   && nextType != RoomType.CORRIDOR) conn else 0f
        val nextOy = if (nextEntry == WallSide.BOTTOM && nextType != RoomType.CORRIDOR) conn else 0f
        val candidate = Rect(nextWorldX + nextOx, nextWorldY + nextOy, nextW, nextH)

        if (occupied.any { it.overlaps(candidate) }) return false
        occupied += candidate

        // Spawn children first — only exits with successful placements become doorways
        val successfulExits = mutableSetOf<WallSide>()
        if (nextType != RoomType.CIRCLE) {
            for (nextExit in rollExits(skip = nextEntry, depth = depth)) {
                if (spawnNeighbour(rooms, occupied, candidate.x, candidate.y, nextW, nextH, nextExit, depth - 1)) {
                    successfulExits += nextExit
                }
            }
        }

        rooms += buildRoom(nextWorldX, nextWorldY, nextType, nextEntry, successfulExits, MAX_DEPTH - depth)
        return true
    }

    private fun buildStartRoom(w: Float, h: Float, exits: Set<WallSide>): RoomData {
        val half  = RoomBuilder.DOOR_W / 2f
        val wallT = RoomBuilder.WALL_T
        val walls = mutableListOf<WallSegment>()

        walls += WallSegment(0f, 0f, w, wallT)  // bottom always solid (cave entrance)

        if (WallSide.TOP in exits) {
            walls += WallSegment(0f, h - wallT, w / 2f - half, wallT)
            walls += WallSegment(w / 2f + half, h - wallT, w / 2f - half, wallT)
        } else walls += WallSegment(0f, h - wallT, w, wallT)

        if (WallSide.LEFT in exits) {
            walls += WallSegment(0f, 0f, wallT, h / 2f - half)
            walls += WallSegment(0f, h / 2f + half, wallT, h / 2f - half)
        } else walls += WallSegment(0f, 0f, wallT, h)

        if (WallSide.RIGHT in exits) {
            walls += WallSegment(w - wallT, 0f, wallT, h / 2f - half)
            walls += WallSegment(w - wallT, h / 2f + half, wallT, h / 2f - half)
        } else walls += WallSegment(w - wallT, 0f, wallT, h)

        return RoomData(0f, 0f, w, h, RoomType.SQUARE, walls)
    }

    private data class Rect(val x: Float, val y: Float, val w: Float, val h: Float) {
        fun overlaps(other: Rect, margin: Float = 0f) =
            x - margin < other.x + other.w &&
            x + w + margin > other.x       &&
            y - margin < other.y + other.h &&
            y + h + margin > other.y
    }

    private fun rollExits(skip: WallSide, depth: Int): Set<WallSide> {
        if (depth == 0) return emptySet()
        val chance = 0.60f + (BRANCH_CHANCE - 0.60f) * depth.toFloat() / MAX_DEPTH
        return WallSide.entries
            .filter { it != skip && MathUtils.randomBoolean(chance) }
            .toSet()
    }

    private fun opposite(side: WallSide) = when (side) {
        WallSide.LEFT   -> WallSide.RIGHT
        WallSide.RIGHT  -> WallSide.LEFT
        WallSide.TOP    -> WallSide.BOTTOM
        WallSide.BOTTOM -> WallSide.TOP
    }

    private fun randomType(): RoomType = when (MathUtils.random(8)) {
        0, 1, 2 -> RoomType.SQUARE
        3, 4    -> RoomType.CORRIDOR
        5       -> RoomType.CIRCLE
        6       -> RoomType.LARGE
        else    -> RoomType.SQUARE
    }

    private fun buildRoom(worldX: Float, worldY: Float, type: RoomType, entry: WallSide, exits: Set<WallSide>, depth: Int = 0): RoomData =
        when (type) {
            RoomType.SQUARE   -> RoomBuilder.buildSquareRoom(worldX, worldY, entry, exits)
            RoomType.CORRIDOR -> RoomBuilder.buildCorridorRoom(worldX, worldY, entry, exits)
            RoomType.CIRCLE   -> RoomBuilder.buildCircleRoom(worldX, worldY, entry)
            RoomType.LARGE    -> RoomBuilder.buildLargeRoom(worldX, worldY, entry, exits)
        }.copy(depth = depth)

    // ── Shortcut corridor detection ───────────────────────────────────────────

    /**
     * Post-generation pass: find pairs of SQUARE/LARGE rooms whose facing walls are
     * within [MAX_SHORTCUT_GAP] of each other with enough overlap, then punch a doorway
     * in both walls and add connector side-wall segments to close the passage sides.
     */
    private fun addShortcuts(rooms: List<RoomData>): List<RoomData> {
        val result     = rooms.toMutableList()
        val connectors = mutableListOf<RoomData>()
        val usedIdx    = mutableSetOf<Int>()   // result indices already given a shortcut

        data class Bounds(val idx: Int, val x1: Float, val y1: Float, val x2: Float, val y2: Float)

        // Only rect-style rooms that haven't already filled every side
        val eligible = result.mapIndexedNotNull { i, r ->
            if (r.type == RoomType.CIRCLE || r.type == RoomType.CORRIDOR) null
            else {
                val x1 = r.worldX + r.bodyOffsetX
                val y1 = r.worldY + r.bodyOffsetY
                Bounds(i, x1, y1, x1 + r.width, y1 + r.height)
            }
        }

        val wallT  = RoomBuilder.WALL_T
        val doorW  = RoomBuilder.DOOR_W
        val margin = doorW / 2f + wallT * 2f

        // Local helper — tries one orientation, returns true and records the shortcut on success
        fun tryConnect(
            a: Bounds, b: Bounds,
            sideA: WallSide, sideB: WallSide,
            gap: Float,
            oLow: Float, oHigh: Float,       // overlap range along the shared axis (world coords)
            isHorizontal: Boolean,            // true = left/right passage, false = up/down
            connStartX: Float, connStartY: Float
        ): Boolean {
            if (gap !in 0f..MAX_SHORTCUT_GAP) return false
            if (oHigh - oLow < MIN_OVERLAP) return false

            val center = MathUtils.random(oLow + margin, oHigh - margin)
            val lo = center - doorW / 2f
            val hi = center + doorW / 2f

            // Reject if any other room body (±stub margin) intersects the corridor rect
            val corrX1 = if (isHorizontal) minOf(a.x2, b.x1) else lo - wallT
            val corrY1 = if (isHorizontal) lo - wallT           else minOf(a.y2, b.y2)
            val corrX2 = if (isHorizontal) maxOf(a.x2, b.x1) + gap else hi + wallT
            val corrY2 = if (isHorizontal) hi + wallT              else maxOf(a.y2, b.y2) + gap
            val stub   = RoomBuilder.CONN_LEN
            val obstructed = eligible.any { c ->
                c.idx != a.idx && c.idx != b.idx &&
                corrX1 < c.x2 + stub && corrX2 > c.x1 - stub &&
                corrY1 < c.y2 + stub && corrY2 > c.y1 - stub
            }
            if (obstructed) return false

            val ra = result[a.idx]; val rb = result[b.idx]
            val newRa = cutWall(ra, sideA, lo, hi) ?: return false
            val newRb = cutWall(rb, sideB, lo, hi) ?: return false

            result[a.idx] = newRa
            result[b.idx] = newRb

            if (gap > 0.05f) {
                val walls = if (isHorizontal) listOf(
                    WallSegment(connStartX, lo - wallT, gap, wallT),  // bottom side of passage
                    WallSegment(connStartX, hi,         gap, wallT)   // top side of passage
                ) else listOf(
                    WallSegment(lo - wallT, connStartY, wallT, gap),  // left side of passage
                    WallSegment(hi,         connStartY, wallT, gap)   // right side of passage
                )
                val connW = if (isHorizontal) gap  else doorW
                val connH = if (isHorizontal) doorW else gap
                connectors += RoomData(0f, 0f, connW, connH, RoomType.CORRIDOR, walls)
            }

            usedIdx += a.idx
            usedIdx += b.idx
            println("[Shortcut] ${sideA.name} of room ${a.idx} ↔ ${sideB.name} of room ${b.idx}, gap=${gap}, connector=${if (gap > 0.05f) "yes" else "none (flush)"}")
            return true
        }

        for (ai in eligible.indices) {
            for (bi in ai + 1 until eligible.size) {
                val a = eligible[ai]; val b = eligible[bi]
                if (a.idx in usedIdx || b.idx in usedIdx) continue
                if (!MathUtils.randomBoolean(SHORTCUT_CHANCE)) continue

                val oY1 = maxOf(a.y1, b.y1); val oY2 = minOf(a.y2, b.y2)
                val oX1 = maxOf(a.x1, b.x1); val oX2 = minOf(a.x2, b.x2)

                // RIGHT(A) ↔ LEFT(B) — B sits to the right of A
                if (tryConnect(a, b, WallSide.RIGHT, WallSide.LEFT,  b.x1 - a.x2, oY1, oY2, true,  a.x2, 0f  )) continue
                // LEFT(A) ↔ RIGHT(B) — B sits to the left of A
                if (tryConnect(a, b, WallSide.LEFT,  WallSide.RIGHT, a.x1 - b.x2, oY1, oY2, true,  b.x2, 0f  )) continue
                // TOP(A) ↔ BOTTOM(B) — B sits above A
                if (tryConnect(a, b, WallSide.TOP,   WallSide.BOTTOM, b.y1 - a.y2, oX1, oX2, false, 0f,   a.y2)) continue
                // BOTTOM(A) ↔ TOP(B) — B sits below A
                if (tryConnect(a, b, WallSide.BOTTOM, WallSide.TOP,   a.y1 - b.y2, oX1, oX2, false, 0f,   b.y2)) continue
            }
        }

        println("[Shortcuts] ${connectors.size} shortcut corridor(s) added this run (${usedIdx.size / 2} pairs)")
        return result + connectors
    }

    /**
     * Find the single solid wall segment on [side] of [room] and split it to leave a
     * gap from [cutLow] to [cutHigh] (world coordinates along the split axis).
     * Returns null if the expected solid segment is not found (already open / not rect).
     */
    private fun cutWall(room: RoomData, side: WallSide, cutLow: Float, cutHigh: Float): RoomData? {
        val ox = room.bodyOffsetX; val oy = room.bodyOffsetY
        val w  = room.width;       val h  = room.height
        val wallT = RoomBuilder.WALL_T

        val expX: Float; val expY: Float; val expW: Float; val expH: Float
        when (side) {
            WallSide.RIGHT  -> { expX = ox + w - wallT; expY = oy;             expW = wallT; expH = h     }
            WallSide.LEFT   -> { expX = ox;             expY = oy;             expW = wallT; expH = h     }
            WallSide.TOP    -> { expX = ox;             expY = oy + h - wallT; expW = w;     expH = wallT }
            WallSide.BOTTOM -> { expX = ox;             expY = oy;             expW = w;     expH = wallT }
        }

        val seg = room.walls.find {
            Math.abs(it.x - expX) < 0.05f && Math.abs(it.y - expY) < 0.05f &&
            Math.abs(it.w - expW) < 0.05f && Math.abs(it.h - expH) < 0.05f
        } ?: return null

        val newWalls = room.walls.toMutableList()
        newWalls.remove(seg)

        if (side == WallSide.LEFT || side == WallSide.RIGHT) {
            // Vertical wall — split in Y (cutLow/cutHigh are world Y)
            val lo = cutLow  - room.worldY
            val hi = cutHigh - room.worldY
            if (lo - seg.y         > 0.05f) newWalls += WallSegment(seg.x, seg.y, seg.w, lo - seg.y)
            if (seg.y + seg.h - hi > 0.05f) newWalls += WallSegment(seg.x, hi,    seg.w, seg.y + seg.h - hi)
        } else {
            // Horizontal wall — split in X (cutLow/cutHigh are world X)
            val lo = cutLow  - room.worldX
            val hi = cutHigh - room.worldX
            if (lo - seg.x         > 0.05f) newWalls += WallSegment(seg.x, seg.y, lo - seg.x, seg.h)
            if (seg.x + seg.w - hi > 0.05f) newWalls += WallSegment(hi,    seg.y, seg.x + seg.w - hi, seg.h)
        }

        return room.copy(walls = newWalls, openSides = room.openSides + side)
    }
}
