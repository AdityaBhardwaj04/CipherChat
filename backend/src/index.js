import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

// ── Express setup ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: CLIENT_ORIGIN, methods: ['GET'] }));
app.use(express.json({ limit: '10kb' })); // guard against large-body attacks

// Health check — no sensitive data exposed
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all for unknown HTTP routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── HTTP + Socket.IO setup ─────────────────────────────────────────────────────
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  // Reject payloads larger than 64 KB to prevent abuse
  maxHttpBufferSize: 64 * 1024,
});

// ── In-memory online users: userId → socketId ─────────────────────────────────
// NOTE: single-instance only; replace with Redis adapter for horizontal scaling
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log(`[socket] connected  ${socket.id}`);

  // Client registers with its userId (Firebase UID)
  socket.on('register', (userId) => {
    if (typeof userId !== 'string' || userId.length > 128) {
      socket.emit('error', { message: 'Invalid userId' });
      return;
    }
    onlineUsers.set(userId, socket.id);
    console.log(`[socket] registered  user=${userId}`);
  });

  // Relay an encrypted message to a recipient — server NEVER reads payload
  // Expected shape: { to: string, payload: { iv, encryptedKey, ciphertext } }
  socket.on('message', (data) => {
    if (!data?.to || !data?.payload) {
      socket.emit('error', { message: 'Malformed message' });
      return;
    }

    const recipientSocketId = onlineUsers.get(data.to);
    if (!recipientSocketId) {
      socket.emit('error', { message: 'Recipient not online' });
      return;
    }

    // Forward the opaque encrypted payload — contents are never inspected
    io.to(recipientSocketId).emit('message', {
      from: data.from ?? 'unknown',
      payload: data.payload,
    });
  });

  socket.on('disconnect', () => {
    // Clean up registration on disconnect
    for (const [userId, sid] of onlineUsers.entries()) {
      if (sid === socket.id) {
        onlineUsers.delete(userId);
        console.log(`[socket] unregistered  user=${userId}`);
        break;
      }
    }
    console.log(`[socket] disconnected  ${socket.id}`);
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[server] CipherChat backend running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  httpServer.close(() => {
    console.log('[server] shutdown complete');
    process.exit(0);
  });
});
