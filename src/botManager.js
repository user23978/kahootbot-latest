import Kahoot from "kahoot.js-latest";
import { probe2FA, crack2FA } from "./twoFactorCracker.js";
import { generateRandomName } from "./names.js";

let bots = [];
let running = false;
let currentSequence = null;
let globalGamePin = null;
let globalJoinDelay = 200;
let resolvedNames = [];
let joinedCount = 0;
let failedCount = 0;
let totalCount = 0;

// ── Retry queue ──
const retryQueue = [];
let retryProcessing = false;
let swarmActive = false;
async function enqueueRetry(i, retries) {
  retryQueue.push({ i, retries });
  if (!retryProcessing) processRetryQueue();
}

async function processRetryQueue() {
  retryProcessing = true;
  while (retryQueue.length > 0 && running) {
    const { i, retries } = retryQueue.shift();
    await delay(globalJoinDelay); // Strictly respect user delay
    spawnBot(i, retries);
  }
  retryProcessing = false;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
  retryQueue.length = 0;

  for (const bot of bots) {
    try { bot.leave(); } catch { }
  }

  const count = bots.length;
  bots = [];
  currentSequence = null;

  io.emit("log", { type: "success", msg: `${count} Bots getrennt.` });
  io.emit("state", getState());
}

export async function toggleSwarm(io) {
  if (!running) return;
  // If already active, stop it
  if (swarmActive) {
    swarmActive = false;
    io.emit("log", { type: "info", msg: "[i] Swarm cracking stopped by user." });
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
    // wait a bit before next attempt to avoid hammering server
    await delay(2000);
  }
  if (!currentSequence) {
    io.emit("log", { type: "warn", msg: "[i] Swarm stopped without obtaining a code." });
  }
}

export async function forceRecrack(io) {
  // Alias for backward compatibility – instantly attempt one crack
  if (!running || !globalGamePin) return;
  io.emit("log", { type: "warn", msg: "[!] Swarm single crack initiated..." });
  const seq = await crack2FA(globalGamePin, io);
  if (seq && running) {
    forceSetSequence(seq, io);
  } else {
    io.emit("log", { type: "error", msg: "[-] Swarm single crack failed or timed out." });
  }
}

export function forceSetSequence(seq, io) {
  if (!running) return;
  currentSequence = seq;
  io.emit("log", { type: "success", msg: `[+] 2FA gesetzt: [${seq}] — Verteile an wartende Bots...` });
  let pushed = 0;
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    if (bot && bot._waitingFor2FA) {
      const stagger = pushed * Math.max(globalJoinDelay, 150);
      setTimeout(() => {
        if (running && bot._waitingFor2FA) {
          bot.answerTwoFactorAuth(seq).catch(() => { });
        }
      }, stagger);
      pushed++;
    }
  }
}

export async function startBots(config, io) {
  const { gamePin, botCount, botNames, botPrefix, joinDelay, answerMode, nameMode } = config;

  if (!gamePin || botCount <= 0) {
    io.emit("log", { type: "error", msg: "Fehlende oder ungültige Einstellungen." });
    return;
  }
  if (running) {
    io.emit("log", { type: "warn", msg: "Bots laufen bereits! Erst stoppen." });
    return;
  }

  running = true;
  bots = [];
  currentSequence = null;
  globalGamePin = gamePin;
  globalJoinDelay = Math.max(joinDelay || 200, 150); // Use minimum 150ms to prevent instant shadowbans
  joinedCount = 0;
  failedCount = 0;
  totalCount = botCount;
  retryQueue.length = 0;

  io.emit("state", getState());

  // ── Step 1: Probe for 2FA ──
  try {
    const probeResult = await probe2FA(gamePin, io);
    if (probeResult.twoFactorAuth) {
      io.emit("log", { type: "info", msg: "[i] 2FA erkannt. Warte auf manuelle Eingabe oder Bypass-Klick..." });
    }
  } catch (err) {
    io.emit("log", { type: "error", msg: `[-] 2FA-Prüfung fehlgeschlagen: ${err.message}` });
    if (!running) return;
    io.emit("log", { type: "warn", msg: "Versuche ohne 2FA fortzufahren..." });
  }

  if (!running) return;

  // ── Resolve names ──
  resolvedNames = [];
  for (let i = 0; i < botCount; i++) {
    if (nameMode === "random") {
      resolvedNames.push(generateRandomName());
    } else if (botNames && botNames.length > 0) {
      resolvedNames.push(botNames[i % botNames.length] || generateRandomName());
    } else {
      resolvedNames.push(`${botPrefix || "Bot"}_${i + 1}`);
    }
  }

  // Pre-fill placeholder bots
  for (let i = 0; i < botCount; i++) {
    bots.push({ _botName: resolvedNames[i], _status: "waiting", _waitingFor2FA: false, leave: () => { } });
  }

  io.emit("log", { type: "info", msg: `[i] Spawne ${botCount} Bots mit striktem ${globalJoinDelay}ms Delay...` });

  // Save io+answerMode for retry queue
  _io = io;
  _answerMode = answerMode;

  // ── Spawn loop ── Strictly awaits joinDelay between every single bot
  for (let i = 0; i < botCount; i++) {
    if (!running) break;
    spawnBot(i, 0, io, answerMode);
    await delay(globalJoinDelay); // This guarantees bots spawn evenly paced
  }

  io.emit("log", { type: "info", msg: `[+] Alle ${botCount} Spawn-Befehle gesendet.` });
}

let _io = null;
let _answerMode = "random";

function spawnBot(i, retries, io = _io, answerMode = _answerMode) {
  if (!running || !io) return;

  // Clean up old instance
  try { if (bots[i] && typeof bots[i].leave === "function") bots[i].leave(); } catch { }

  const bot = new Kahoot();
  bot.loggingMode = false;
  bot._botName = resolvedNames[i];
  bot._status = "joining";
  bot._waitingFor2FA = false;
  bots[i] = bot;

  io.emit("botUpdate", { index: i, name: bot._botName, status: "joining" });

  // ── 5s watchdog ──
  const joinWatchdog = setTimeout(() => {
    if (bot._status === "joining" && running) {
      try { bot.leave(); } catch { }
      setBotStatus(i, "retry", io);
      if (retries < 15) {
        enqueueRetry(i, retries + 1);
      } else {
        setBotStatus(i, "error", io);
        failedCount++;
        io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
      }
    }
  }, 5000);

  bot.join(globalGamePin, bot._botName).catch(() => {
    clearTimeout(joinWatchdog);
    if (bot._status === "joining" && running) {
      setBotStatus(i, "retry", io);
      if (retries < 15) enqueueRetry(i, retries + 1);
      else {
        setBotStatus(i, "error", io);
        failedCount++;
        io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
      }
    }
  });

  bot.on("Joined", async (settings) => {
    clearTimeout(joinWatchdog);
    if (!running) return;

    if (settings.twoFactorAuth) {
      bot._waitingFor2FA = true;
      bot._status = "2fa";
      io.emit("botUpdate", { index: i, name: bot._botName, status: "2fa" });

      if (currentSequence) {
        // Human-like delay before initial answer so Kahoot doesn't flag them
        setTimeout(() => {
          if (running && bot._waitingFor2FA) {
            bot.answerTwoFactorAuth(currentSequence).catch(() => { });
          }
        }, 1000 + Math.random() * 1000);
      }
    } else {
      bot._status = "ingame";
      joinedCount++;
      io.emit("botUpdate", { index: i, name: bot._botName, status: "ingame" });
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }
  });

  bot.on("TwoFactorCorrect", () => {
    if (!running) return;
    bot._waitingFor2FA = false;
    bot._status = "ingame";
    joinedCount++;
    io.emit("botUpdate", { index: i, name: bot._botName, status: "ingame" });
    io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
  });

  bot.on("TwoFactorReset", () => {
    if (!running) return;
    // Sequence is wrong. Waiting for manual input or swarm crack.
    // No automatic re-crack triggered.
  });

  bot.on("QuestionStart", (question) => {
    if (!running) return;
    let answerIndex;
    if (answerMode === "correct" && typeof question.correctAnswer === "number") {
      answerIndex = question.correctAnswer;
    } else {
      answerIndex = Math.floor(Math.random() * question.answerCount);
    }
    setTimeout(() => {
      if (running) bot.answer(answerIndex);
    }, Math.random() * 2000);
  });

  bot.on("Disconnect", () => {
    clearTimeout(joinWatchdog);
    if (!running) return;

    if (bot._status === "ingame") {
      joinedCount = Math.max(0, joinedCount - 1);
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }

    bot._waitingFor2FA = false;
    setBotStatus(i, "retry", io);

    if (retries < 15) enqueueRetry(i, retries + 1);
    else {
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
