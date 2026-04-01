package com.futureminers

import com.badlogic.gdx.math.MathUtils

object RoomManager {

    val startW = 10f
    val startH = 7.5f
    private const val MAX_DEPTH     = 8
    private const val BRANCH_CHANCE = 0.80f

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
        return rooms
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

        rooms += buildRoom(nextWorldX, nextWorldY, nextType, nextEntry, successfulExits)
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

    private fun randomType(): RoomType = when (MathUtils.random(2)) {
        0    -> RoomType.SQUARE
        1    -> RoomType.CORRIDOR
        else -> RoomType.CIRCLE
    }

    private fun buildRoom(worldX: Float, worldY: Float, type: RoomType, entry: WallSide, exits: Set<WallSide>): RoomData =
        when (type) {
            RoomType.SQUARE   -> RoomBuilder.buildSquareRoom(worldX, worldY, entry, exits)
            RoomType.CORRIDOR -> RoomBuilder.buildCorridorRoom(worldX, worldY, entry, exits)
            RoomType.CIRCLE   -> RoomBuilder.buildCircleRoom(worldX, worldY, entry)
        }
}
