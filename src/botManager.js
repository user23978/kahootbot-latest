import Kahoot from "kahoot.js-latest";
import { probe2FA, crack2FA, abortSwarm, killScout } from "./twoFactorCracker.js";
import { generateRandomName } from "./names.js";

// ── State ──
let bots = [];
let running = false;
let currentSequence = null;
let globalGamePin = null;
let globalJoinDelay = 2000;
let resolvedNames = [];
let joinedCount = 0;
let failedCount = 0;
let totalCount = 0;
let swarmActive = false;
let swarmLoopId = null;
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
    currentSequence,
    swarmActive
  };
}

export async function stopBots(io) {
  running = false;
  // ONLY stop deployed bots! Leave scout and swarm running.

  const toKill = bots;
  bots = [];
  for (const bot of toKill) {
    try { if (typeof bot.leave === "function") bot.leave(); } catch {}
  }
  // Safety timeout to force-close sockets after leave packet sends
  setTimeout(() => {
    for (const bot of toKill) {
      try { if (bot.socket) bot.socket.close(); } catch {}
    }
  }, 1000);

  joinedCount = 0;
  failedCount = 0;
  totalCount = 0;

  io.emit("log", { type: "success", msg: `${toKill.length} bots disconnected.` });
  io.emit("state", getState());
}

export async function disconnectAll(io) {
  // Stop everything: scout, swarm, deployed bots
  running = false;
  swarmActive = false;
  swarmLoopId = null;
  abortSwarm();
  killScout();

  const toKill = bots;
  bots = [];
  for (const bot of toKill) {
    try { if (typeof bot.leave === "function") bot.leave(); } catch {}
  }
  // Safety: force-close any lingering sockets after 1s
  setTimeout(() => {
    for (const bot of toKill) {
      try { if (bot.socket) bot.socket.close(); } catch {}
    }
  }, 1000);

  currentSequence = null;
  joinedCount = 0;
  failedCount = 0;
  totalCount = 0;
  globalGamePin = null;

  io.emit("log", { type: "success", msg: `Disconnected everything (${toKill.length} bots + scout).` });
  io.emit("state", getState());
  io.emit("tfaStatus", { phase: "idle" });
  io.emit("botUpdate", { index: "scout", name: "Scout", status: "remove" });
}

/**
 * Toggle the swarm cracking loop on/off.
 */
export async function toggleSwarm(io) {
  if (!globalGamePin) return;

  // If already active, stop it
  if (swarmActive) {
    swarmActive = false;
    const oldId = swarmLoopId;
    swarmLoopId = null;
    abortSwarm();
    io.emit("log", { type: "info", msg: "[i] Swarm stopped." });
    io.emit("tfaStatus", { phase: "probed", has2FA: true }); // Back to "ready to crack" state
    io.emit("state", getState());
    return;
  }

  // Start swarm cracking loop
  swarmActive = true;
  const myLoopId = Symbol();
  swarmLoopId = myLoopId;
  io.emit("log", { type: "info", msg: "[i] Swarm cracking started..." });
  io.emit("state", getState());

  while (swarmActive && swarmLoopId === myLoopId && !currentSequence) {
    const seq = await crack2FA(globalGamePin, io);

    // Check if we were cancelled while cracking
    if (swarmLoopId !== myLoopId) break;

    if (seq) {
      currentSequence = seq;
      io.emit("log", { type: "success", msg: `[+] 2FA code: [${seq}] — Ready for deployment!` });
      swarmActive = false;
      io.emit("state", getState());

      // Auto-resume paused deployment
      if (running === "paused") {
        resumeDeployment(io).catch(() => { });
      }
      break;
    }

    if (!swarmActive || swarmLoopId !== myLoopId) break;

    io.emit("log", { type: "warn", msg: "[i] Retrying swarm in 3s..." });
    await delay(3000);
  }

  if (swarmLoopId === myLoopId) {
    swarmActive = false;
    io.emit("state", getState());
  }
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

export function setGlobalPin(pin) {
  globalGamePin = pin;
}

export function clearSequence() {
  currentSequence = null;
}

// ── Dynamic 2FA Handling ──

export async function handleCodeRotation(io) {
  if (!globalGamePin) return;

  io.emit("log", { type: "warn", msg: "[-] 2FA Code Rotated! Auto-cracking new code..." });

  // Clear the outdated sequence
  currentSequence = null;

  const wasRunning = running === true;

  if (wasRunning) {
    running = "paused";
    io.emit("state", getState());
  }

  // If swarm is not already running, start it
  if (!swarmActive) {
    await toggleSwarm(io);
  }
  // If swarm IS running, the existing swarm bots will receive TwoFactorReset
  // from the Kahoot server and automatically re-guess their permutation.
  // The swarm loop in toggleSwarm will pick up the result.
}

async function resumeDeployment(io) {
  io.emit("log", { type: "info", msg: "[+] Resuming deployment with new code..." });
  running = true;
  io.emit("state", getState());

  // Distribute code to all bots waiting at 2FA screen
  for (let i = 0; i < totalCount; i++) {
    const bot = bots[i];
    if (bot && bot._waitingFor2FA) {
      bot.answerTwoFactorAuth(currentSequence).catch(() => { });
    }
  }

  // Spawn any unspawned placeholder bots
  for (let i = 0; i < totalCount; i++) {
    if (!running || running === "paused") break;
    if (bots[i] && bots[i]._isPlaceholder) {
      spawnBot(i);
      await delay(globalJoinDelay);
    }
  }

  if (running === true) {
    io.emit("log", { type: "info", msg: "[+] All spawn commands sent (resumed)." });
  }
}

export function forceSetSequence(seq, io) {
  if (!running) return;
  currentSequence = seq;
  io.emit("log", { type: "success", msg: `[+] 2FA code set: [${seq}]` });

  let pushed = 0;
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    if (bot && bot._waitingFor2FA) {
      const d = pushed * 200;
      setTimeout(() => {
        if (running && bot._waitingFor2FA) {
          bot.answerTwoFactorAuth(seq).catch(() => { });
        }
      }, d);
      pushed++;
    }
  }
  io.emit("log", { type: "info", msg: `[i] Sending 2FA to ${pushed} waiting bots...` });
}

/**
 * Deploy additional bots to an already-running session.
 */
export async function addMoreBots(config, io) {
  if (!running || !globalGamePin) {
    io.emit("log", { type: "error", msg: "Deploy bots first before adding more." });
    return;
  }

  const { botCount, botPrefix, nameMode } = config;
  const addCount = Math.max(botCount || 0, 1);
  const oldTotal = totalCount;
  totalCount += addCount;
  _io = io;

  io.emit("log", { type: "info", msg: `[i] Adding ${addCount} more bots...` });

  // Generate names for the new bots
  for (let i = oldTotal; i < totalCount; i++) {
    if (nameMode === "random") {
      resolvedNames.push(generateRandomName());
    } else {
      resolvedNames.push(`${botPrefix || "Bot"}_${i + 1}`);
    }
    bots.push({
      _botName: resolvedNames[i],
      _status: "waiting",
      _waitingFor2FA: false,
      _isPlaceholder: true,
      leave: () => { }
    });
  }

  // Spawn them
  for (let i = oldTotal; i < totalCount; i++) {
    if (!running || running === "paused") break;
    spawnBot(i);
    await delay(globalJoinDelay);
  }

  io.emit("log", { type: "info", msg: `[+] ${addCount} additional bots deployed.` });
  io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
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
  globalGamePin = gamePin;
  globalJoinDelay = Math.max(joinDelay || 200, 150);
  joinedCount = 0;
  failedCount = 0;
  totalCount = botCount;
  _io = io;
  _answerMode = answerMode;

  io.emit("state", getState());

  // Resolve names
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

  // Spawn loop
  for (let i = 0; i < botCount; i++) {
    if (!running) break;
    if (running === "paused") {
      io.emit("log", { type: "warn", msg: "[!] Deployment paused (2FA reset)..." });
      return;
    }
    spawnBot(i);
    await delay(globalJoinDelay);
  }

  if (running === true) {
    io.emit("log", { type: "info", msg: `[+] All ${botCount} spawn commands sent.` });
  }
}

// ── Internal ──

function spawnBot(i, retries = 0) {
  if (!running || !_io) return;
  const io = _io;
  const answerMode = _answerMode;

  // Clean up old instance
  if (bots[i] && !bots[i]._isPlaceholder) {
    try { bots[i].leave(); } catch { }
  }

  const bot = new Kahoot();
  bot.loggingMode = false;
  bot._botName = resolvedNames[i];
  bot._status = "joining";
  bot._waitingFor2FA = false;
  bot._isPlaceholder = false;
  bot._joined = false;
  bots[i] = bot;

  io.emit("botUpdate", { index: i, name: bot._botName, status: "joining" });

  // 10s watchdog
  const joinWatchdog = setTimeout(() => {
    if (bot._status === "joining" && running) {
      try { bot.leave(); } catch { }
      try { if (bot.socket) bot.socket.close(); } catch {}
      if (retries < 3) {
        setBotStatus(i, "retry", io);
        setTimeout(() => { if (running) spawnBot(i, retries + 1); }, globalJoinDelay);
      } else {
        setBotStatus(i, "error", io);
        failedCount++;
        io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
      }
    }
  }, 10000);

  bot.join(globalGamePin, bot._botName).catch(() => {
    clearTimeout(joinWatchdog);
    if (!running) {
      try { if (bot.socket) bot.socket.close(); } catch {}
      return;
    }
    if (bot._status !== "ingame" && running) {
      if (retries < 3) {
        setBotStatus(i, "retry", io);
        setTimeout(() => { if (running) spawnBot(i, retries + 1); }, globalJoinDelay);
      } else {
        setBotStatus(i, "error", io);
        failedCount++;
        io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
      }
    }
  });

  bot.on("Joined", (settings) => {
    clearTimeout(joinWatchdog);
    if (!running) {
      try { bot.leave(); } catch {}
      try { if (bot.socket) bot.socket.close(); } catch {}
      return;
    }

    if (settings.twoFactorAuth) {
      bot._waitingFor2FA = true;
      bot._status = "2fa";
      io.emit("botUpdate", { index: i, name: bot._botName, status: "2fa" });

      if (currentSequence) {
        bot.answerTwoFactorAuth(currentSequence).catch(() => { });
      }
    } else {
      bot._status = "ingame";
      bot._joined = true;
      joinedCount++;
      io.emit("botUpdate", { index: i, name: bot._botName, status: "ingame" });
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }
  });

  bot.on("TwoFactorCorrect", () => {
    if (!running) return;
    bot._waitingFor2FA = false;
    bot._status = "ingame";
    bot._joined = true;
    joinedCount++;
    io.emit("botUpdate", { index: i, name: bot._botName, status: "ingame" });
    io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
  });

  bot.on("TwoFactorReset", () => {
    if (!running) return;

    if (!bot._waitingFor2FA && bot._status !== "ingame") {
      bot._waitingFor2FA = true;
      bot._status = "2fa";
      io.emit("botUpdate", { index: i, name: bot._botName, status: "2fa" });
    }

    if (currentSequence && bot._waitingFor2FA) {
      bot.answerTwoFactorAuth(currentSequence).catch(() => { });
    }
  });

  bot.on("TwoFactorWrong", () => {
    // Wait for correct code
  });

  bot.on("QuestionStart", (question) => {
    if (!running) return;
    let answerIndex;
    if (answerMode === "correct" && typeof question.correctAnswer === "number") {
      answerIndex = question.correctAnswer;
    } else {
      answerIndex = Math.floor(Math.random() * (question.answerCount || 4));
    }
    setTimeout(() => {
      if (running) bot.answer(answerIndex);
    }, 500 + Math.random() * 2000);
  });

  bot.on("Disconnect", (reason) => {
    clearTimeout(joinWatchdog);
    if (!running) return;

    if (bot._joined) {
      joinedCount = Math.max(0, joinedCount - 1);
      bot._joined = false;
      io.emit("stats", { joined: joinedCount, failed: failedCount, total: totalCount });
    }

    bot._waitingFor2FA = false;

    if (retries < 3) {
      setBotStatus(i, "retry", io);
      setTimeout(() => {
        if (running) spawnBot(i, retries + 1);
      }, globalJoinDelay * 2);
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
