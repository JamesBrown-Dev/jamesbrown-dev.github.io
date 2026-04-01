package com.futureminers

import com.badlogic.gdx.math.MathUtils

object RoomManager {

    val startW = 10f
    val startH = 7.5f

    fun generate(): List<RoomData> {
        val rooms = mutableListOf<RoomData>()

        rooms += RoomBuilder.buildStartRoom(startW, startH)

        val conn = RoomBuilder.CONN_LEN

        // Right neighbour: local x=0 placed at start room's right wall; stub fills x=0..conn
        val rightType = randomType()
        val (_, rightH) = RoomBuilder.dimensions(rightType, WallSide.LEFT)
        rooms += buildRoom(startW, startH / 2f - rightH / 2f, rightType, WallSide.LEFT)

        // Left neighbour: stub's far end lands at x=0 (start room's left wall)
        val leftType = randomType()
        val (leftW, leftH) = RoomBuilder.dimensions(leftType, WallSide.RIGHT)
        rooms += buildRoom(-leftW - conn, startH / 2f - leftH / 2f, leftType, WallSide.RIGHT)

        // Top neighbour: local y=0 placed at start room's top wall; stub fills y=0..conn
        val topType = randomType()
        val (topW, _) = RoomBuilder.dimensions(topType, WallSide.BOTTOM)
        rooms += buildRoom(startW / 2f - topW / 2f, startH, topType, WallSide.BOTTOM)

        return rooms
    }

    private fun randomType(): RoomType = when (MathUtils.random(2)) {
        0    -> RoomType.SQUARE
        1    -> RoomType.CORRIDOR
        else -> RoomType.CIRCLE
    }

    private fun buildRoom(worldX: Float, worldY: Float, type: RoomType, entry: WallSide): RoomData =
        when (type) {
            RoomType.SQUARE   -> RoomBuilder.buildSquareRoom(worldX, worldY, entry)
            RoomType.CORRIDOR -> RoomBuilder.buildCorridorRoom(worldX, worldY, entry)
            RoomType.CIRCLE   -> RoomBuilder.buildCircleRoom(worldX, worldY, entry)
        }
}
