// Socket.io server - Run this separately
import { Server } from "socket.io"
import { createServer } from "http"

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? [process.env.VERCEL_URL, process.env.NEXT_PUBLIC_VERCEL_URL].filter(Boolean)
        : ["http://localhost:3000", "http://http://192.168.1.171:3000/"],
    methods: ["GET", "POST"],
  },
})

const rooms = new Map()
const messageHistory = new Map()
const typingUsers = new Map() // Track typing users per room

io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId)
    socket.data.username = username
    socket.data.roomId = roomId

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set())
    }
    rooms.get(roomId).add(username)

    // Initialize message history and typing users for room
    if (!messageHistory.has(roomId)) {
      messageHistory.set(roomId, new Set())
    }
    if (!typingUsers.has(roomId)) {
      typingUsers.set(roomId, new Set())
    }

    // Notify room about updated user list
    const users = Array.from(rooms.get(roomId) || [])
    io.to(roomId).emit("users-updated", users)

    console.log(`${username} joined room ${roomId}`)
  })

  socket.on("send-message", ({ roomId, message }) => {
    // Check for duplicate messages
    const roomMessages = messageHistory.get(roomId) || new Set()

    if (!roomMessages.has(message.id)) {
      roomMessages.add(message.id)
      messageHistory.set(roomId, roomMessages)

      // Broadcast to all users in the room except sender
      socket.to(roomId).emit("message", message)

      // Clean up old message IDs (keep only last 100)
      if (roomMessages.size > 100) {
        const messagesArray = Array.from(roomMessages)
        const newSet = new Set(messagesArray.slice(-50))
        messageHistory.set(roomId, newSet)
      }
    }
  })

  socket.on("ai-message", ({ roomId, message }) => {
    // Check for duplicate AI messages
    const roomMessages = messageHistory.get(roomId) || new Set()

    if (!roomMessages.has(message.id)) {
      roomMessages.add(message.id)
      messageHistory.set(roomId, roomMessages)

      // Broadcast AI message to all users in the room
      io.to(roomId).emit("ai-response", message)
    }
  })

  // Typing indicators
  socket.on("typing", ({ roomId, username }) => {
    const roomTypingUsers = typingUsers.get(roomId) || new Set()
    roomTypingUsers.add(username)
    typingUsers.set(roomId, roomTypingUsers)

    // Broadcast to other users in the room
    socket.to(roomId).emit("user-typing", { username })
  })

  socket.on("stopped-typing", ({ roomId, username }) => {
    const roomTypingUsers = typingUsers.get(roomId) || new Set()
    roomTypingUsers.delete(username)
    typingUsers.set(roomId, roomTypingUsers)

    // Broadcast to other users in the room
    socket.to(roomId).emit("user-stopped-typing", { username })
  })

  socket.on("disconnect", () => {
    const { username, roomId } = socket.data
    if (roomId && username) {
      // Remove from rooms
      rooms.get(roomId)?.delete(username)

      // Remove from typing users
      const roomTypingUsers = typingUsers.get(roomId) || new Set()
      roomTypingUsers.delete(username)
      typingUsers.set(roomId, roomTypingUsers)

      // Broadcast stopped typing
      socket.to(roomId).emit("user-stopped-typing", { username })

      if (rooms.get(roomId)?.size === 0) {
        rooms.delete(roomId)
        messageHistory.delete(roomId)
        typingUsers.delete(roomId)
      } else {
        const users = Array.from(rooms.get(roomId) || [])
        io.to(roomId).emit("users-updated", users)
      }
    }
    console.log("User disconnected:", socket.id)
  })
})

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`)
})
