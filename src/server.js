import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  startBots, stopBots, getState, forceRecrack, forceSetSequence,
  toggleSwarm, clearSequence, setGlobalPin, disconnectAll, addMoreBots
} from "./botManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Serve static files from public/
app.use(express.static(join(__dirname, "..", "public")));

// ── Socket.IO ──
io.on("connection", (socket) => {
  console.log("[WS] Client connected");

  // Send current state on connect
  socket.emit("state", getState());

  socket.on("start", (config) => {
    startBots(config, io);
  });

  socket.on("connectScout", (config) => {
    clearSequence();
    setGlobalPin(config.gamePin);
    import("./twoFactorCracker.js").then(({ probe2FA }) => {
      probe2FA(config.gamePin, io).catch(() => {});
    });
  });

  socket.on("stop", () => {
    stopBots(io);
  });

  socket.on("disconnectAll", () => {
    disconnectAll(io);
  });

  socket.on("forceRecrack", () => {
    forceRecrack(io);
  });

  socket.on("toggleSwarm", () => {
    toggleSwarm(io);
  });

  socket.on("addMoreBots", (config) => {
    addMoreBots(config, io);
  });

  socket.on("manual2FA", (seq) => {
    forceSetSequence(seq, io);
  });

  socket.on("disconnect", () => {
    console.log("[WS] Client disconnected");
  });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🎮 Kahoot Bot Control Panel`);
  console.log(`  ➜ http://localhost:${PORT}\n`);
});
