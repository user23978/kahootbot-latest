import Kahoot from "kahoot.js-latest";
import { probe2FA, crack2FA } from "./twoFactorCracker.js";
import { generateRandomName } from "./names.js";

// ── State ──
let bots = [];
let running = false;
let currentSequence = null;
let globalGamePin = null;
let globalJoinDelay = 200;
let resolvedNames = [];
let joinedCount = 0;
let failedCount = 0;
let totalCount = 0;
let swarmActive = false;
let _io = null;
let _answerMode = "random";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Public API ──

export function getState() {
  return {
    running,
    botCount: bots.length,
    bots: bots.map((b, i) => ({
      index: i,
      name: b._botName || `bot_${i}`,
      status: b._status || "unknown"
    })),
    currentSequence
  };
}

export async function stopBots(io) {
  running = false;
  swarmActive = false;

  for (const bot of bots) {
    try { if (typeof bot.leave === "function") bot.leave(); } catch { }
  }

  const count = bots.length;
  bots = [];
  currentSequence = null;
  joinedCount = 0;
  failedCount = 0;
  totalCount = 0;

  io.emit("log", { type: "success", msg: `${count} Bots getrennt.` });
  io.emit("state", getState());
}

export async function toggleSwarm(io) {
  if (!running || !globalGamePin) return;

  // If already active, stop it
  if (swarmActive) {
    swarmActive = false;
    io.emit("log", { type: "info", msg: "[i] Swarm cracking stopped." });
    return;
  }

  // Start swarm cracking loop
  swarmActive = true;
  io.emit("log", { type: "info", msg: "[i] Swarm cracking started..." });

  while (swarmActive && running && !currentSequence) {
    const seq = await crack2FA(globalGamePin, io);
    if (seq && running) {
      forceSetSequence(seq, io);
      swarmActive = false;
      break;
    }
    if (!swarmActive || !running) break;
    // Wait before next attempt
    io.emit("log", { type: "warn", msg: "[i] Retrying swarm crack in 3s..." });
    await delay(3000);
  }

  if (!currentSequence && swarmActive) {
    io.emit("log", { type: "warn", msg: "[i] Swarm stopped without obtaining a code." });
  }
  swarmActive = false;
}

export async function forceRecrack(io) {
  if (!running || !globalGamePin) return;
  io.emit("log", { type: "warn", msg: "[!] Single crack attempt..." });
  const seq = await crack2FA(globalGamePin, io);
  if (seq && running) {
    forceSetSequence(seq, io);
  } else {
    io.emit("log", { type: "error", msg: "[-] Crack failed or timed out." });
  }
}

export function forceSetSequence(seq, io) {
  if (!running) return;
  currentSequence = seq;
  io.emit("log", { type: "success", msg: `[+] 2FA code set: [${seq}] — Distributing to waiting bots...` });

  // Distribute to all bots waiting for 2FA
  let pushed = 0;
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    if (bot && bot._waitingFor2FA) {
      // Stagger the answers to avoid rate limiting
      const staggerDelay = pushed * 200;
      setTimeout(() => {
        if (running && bot._waitingFor2FA) {
          bot.answerTwoFactorAuth(seq).catch(() => { });
        }
      }, staggerDelay);
      pushed++;
    }
  }
  io.emit("log", { type: "info", msg: `[i] Sending 2FA to ${pushed} waiting bots...` });
}

export async function startBots(config, io) {
  const { gamePin, botCount, botPrefix, joinDelay, answerMode, nameMode } = config;

  if (!gamePin || botCount <= 0) {
    io.emit("log", { type: "error", msg: "Missing or invalid settings." });
    return;
  }
  if (running) {
    io.emit("log", { type: "warn", msg: "Bots already running! Stop first." });
    return;
  }

  running = true;
  bots = [];
  currentSequence = null;
  globalGamePin = gamePin;
  globalJoinDelay = Math.max(joinDelay || 200, 150);
  joinedCount = 0;
  failedCount = 0;
  totalCount = botCount;
  swarmActive = false;
  _io = io;
  _answerMode = answerMode;

  io.emit("state", getState());

  // ── Step 1: Probe for 2FA ──
  let has2FA = false;
  try {
    const probeResult = await probe2FA(gamePin, io);
    has2FA = probeResult.twoFactorAuth;
    if (has2FA) {
      io.emit("log", { type: "info", msg: "[i] 2FA detected. Use the shape buttons or Swarm to crack it." });
    }
  } catch (err) {
    io.emit("log", { type: "error", msg: `[-] 2FA probe failed: ${err.message || err}` });
    if (!running) return;
    io.emit("log", { type: "warn", msg: "Continuing without 2FA check..." });
  }

  if (!running) return;

  // Wait for probe to fully disconnect before spawning bots
  await delay(1500);
  if (!running) return;

  // ── Resolve names ──
  resolvedNames = [];
  for (let i = 0; i < botCount; i++) {
    if (nameMode === "random") {
      resolvedNames.push(generateRandomName());
    } else {
      resolvedNames.push(`${botPrefix || "Bot"}_${i + 1}`);
    }
  }

  // Pre-fill placeholder bots for the UI
  for (let i = 0; i < botCount; i++) {
    bots.push({
      _botName: resolvedNames[i],
      _status: "waiting",
      _waitingFor2FA: false,
      _isPlaceholder: true,
      leave: () => { }
    });
  }

  io.emit("log", { type: "info", msg: `[i] Spawning ${botCount} bots with ${globalJoinDelay}ms delay...` });

  // ── Spawn loop ──
  for (let i = 0; i < botCount; i++) {
    if (!running) break;
    spawnBot(i);
    // Strictly wait between each bot spawn
    await delay(globalJoinDelay);
  }

  io.emit("log", { type: "info", msg: `[+] All ${botCount} spawn commands sent.` });
}

// ── Internal ──

function spawnBot(i, retries = 0) {
  if (!running || !_io) return;
  const io = _io;
  const answerMode = _answerMode;

  // Clean up old instance if it exists and is a real bot
  if (bots[i] && !bots[i]._isPlaceholder) {
    try { bots[i].leave(); } catch { }
  }

  const bot = new Kahoot();
  bot.loggingMode = false;
  bot._botName = resolvedNames[i];
  bot._status = "joining";
  bot._waitingFor2FA = false;
  bot._isPlaceholder = false;
  bot._joined = false;  // Track if this bot ever successfully got ingame
  bots[i] = bot;

  io.emit("botUpdate", { index: i, name: bot._botName, status: "joining" });

  // ── 10s watchdog — if bot hasn't joined in 10s, retry ──
  const joinWatchdog = setTimeout(() => {
    if (bot._status === "joining" && running) {
      try { bot.leave(); } catch { }
      if (retries < 10) {
        setBotStatus(i, "retry", io);
        // Wait before retry to avoid hammering
        setTimeout(() => {
          if (running) spawnBot(i, retries + 1);
        }, globalJoinDelay);
      } else {
        setBotStatus(i, "error", io);
        failedCount++;
        io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
      }
    }
  }, 10000);

  // ── Join ──
  bot.join(globalGamePin, bot._botName).catch((err) => {
    clearTimeout(joinWatchdog);
    if (bot._status !== "ingame" && running) {
      if (retries < 10) {
        setBotStatus(i, "retry", io);
        setTimeout(() => {
          if (running) spawnBot(i, retries + 1);
        }, globalJoinDelay);
      } else {
        setBotStatus(i, "error", io);
        failedCount++;
        io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
      }
    }
  });

  // ── Joined event ──
  bot.on("Joined", (settings) => {
    clearTimeout(joinWatchdog);
    if (!running) return;

    if (settings.twoFactorAuth) {
      bot._waitingFor2FA = true;
      bot._status = "2fa";
      io.emit("botUpdate", { index: i, name: bot._botName, status: "2fa" });

      if (currentSequence) {
        // We already have the code — answer immediately
        // (the library has its own 250ms built-in cooldown)
        bot.answerTwoFactorAuth(currentSequence).catch(() => { });
      }
      // If no currentSequence yet, bot waits. forceSetSequence() will
      // distribute the code to all waiting bots when it arrives.
    } else {
      // No 2FA — bot is in game!
      bot._status = "ingame";
      bot._joined = true;
      joinedCount++;
      io.emit("botUpdate", { index: i, name: bot._botName, status: "ingame" });
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }
  });

  // ── 2FA correct ──
  bot.on("TwoFactorCorrect", () => {
    if (!running) return;
    bot._waitingFor2FA = false;
    bot._status = "ingame";
    bot._joined = true;
    joinedCount++;
    io.emit("botUpdate", { index: i, name: bot._botName, status: "ingame" });
    io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
  });

  // ── 2FA reset (code changed) ──
  bot.on("TwoFactorReset", () => {
    if (!running) return;
    // If we have a currentSequence, try it again — it might still be correct
    // (TwoFactorReset fires as part of the normal flow too)
    if (currentSequence && bot._waitingFor2FA) {
      bot.answerTwoFactorAuth(currentSequence).catch(() => { });
    }
  });

  // ── 2FA wrong ──
  bot.on("TwoFactorWrong", () => {
    if (!running) return;
    // Wrong code — the user/swarm needs to find the right one
    // Don't retry, just wait
  });

  // ── Question answering ──
  bot.on("QuestionStart", (question) => {
    if (!running) return;
    let answerIndex;
    if (answerMode === "correct" && typeof question.correctAnswer === "number") {
      answerIndex = question.correctAnswer;
    } else {
      answerIndex = Math.floor(Math.random() * (question.answerCount || 4));
    }
    // Random human-like delay before answering
    setTimeout(() => {
      if (running) bot.answer(answerIndex);
    }, 500 + Math.random() * 2000);
  });

  // ── Disconnect ──
  bot.on("Disconnect", (reason) => {
    clearTimeout(joinWatchdog);
    if (!running) return;

    // Only decrement joinedCount if this bot was actually ingame
    if (bot._joined) {
      joinedCount = Math.max(0, joinedCount - 1);
      bot._joined = false;
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }

    bot._waitingFor2FA = false;

    // Retry if under the limit
    if (retries < 10) {
      setBotStatus(i, "retry", io);
      setTimeout(() => {
        if (running) spawnBot(i, retries + 1);
      }, globalJoinDelay * 2); // Double delay on disconnect retry
    } else {
      setBotStatus(i, "error", io);
      failedCount++;
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }
  });
}

function setBotStatus(i, status, io) {
  if (bots[i]) {
    bots[i]._status = status;
    io.emit("botUpdate", { index: i, name: resolvedNames[i] || `bot_${i}`, status });
  }
}
