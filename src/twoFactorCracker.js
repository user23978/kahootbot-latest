import Kahoot from "kahoot.js-latest";
import { handleCodeRotation } from "./botManager.js";

const ALL_PERMS = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
  [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
  [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0]
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Scout state ──
let scout = null;
let scoutReconnectTimer = null;
let currentScoutPin = null;
let _scoutIo = null;
let scoutKilled = false; // Flag to prevent reconnect after intentional kill

// ── Crack cooldown: prevents scout from re-triggering swarm right after a crack ──
let lastCrackTime = 0;

export function killScout() {
  scoutKilled = true;
  clearTimeout(scoutReconnectTimer);
  scoutReconnectTimer = null;
  if (scout) {
    try { scout.leave(); } catch {}
    scout = null;
  }
  currentScoutPin = null;
}

// ── Swarm state ──
let swarmResolve = null;
let swarmBots = [];
let swarmDone = false;

export function abortSwarm() {
  swarmDone = true;
  cleanupSwarm();
  if (swarmResolve) {
    const r = swarmResolve;
    swarmResolve = null;
    r(null);
  }
}

// ── Scout ──

export async function probe2FA(gamePin, io) {
  currentScoutPin = gamePin;
  _scoutIo = io;
  scoutKilled = false;
  io.emit("log", { type: "info", msg: `[i] Scout connecting to room ${gamePin}...` });
  io.emit("tfaStatus", { phase: "probing" });

  killScout();
  scoutKilled = false; // Reset after kill so reconnect can work
  currentScoutPin = gamePin; // Restore after kill cleared it

  scout = new Kahoot();
  scout.loggingMode = false;
  let has2FA = false;
  let resolved = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        killScout();
        io.emit("tfaStatus", { phase: "error" });
        reject(new Error("Scout timeout"));
      }
    }, 10000);

    const botName = `Scout_${Math.floor(Math.random() * 9000) + 1000}`;
    io.emit("botUpdate", { index: "scout", name: botName, status: "joining" });

    scout.join(gamePin, botName).catch((err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        killScout();
        io.emit("log", { type: "error", msg: `[-] Scout failed: ${err.message}` });
        io.emit("tfaStatus", { phase: "error" });
        io.emit("botUpdate", { index: "scout", name: botName, status: "error" });
        reject(err);
      }
    });

    scout.on("Joined", (settings) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      has2FA = settings.twoFactorAuth;
      io.emit("botUpdate", { index: "scout", name: botName, status: "ingame" });

      if (has2FA) {
        io.emit("log", { type: "warn", msg: "[!] 2FA detected! Scout monitoring." });
        io.emit("tfaStatus", { phase: "probed", has2FA: true });
        resolve({ twoFactorAuth: true });
      } else {
        io.emit("log", { type: "success", msg: "[+] No 2FA detected. Scout monitoring." });
        io.emit("tfaStatus", { phase: "probed", has2FA: false });
        resolve({ twoFactorAuth: false });
      }
    });

    scout.on("TwoFactorReset", () => {
      // ── COOLDOWN: If we JUST cracked within the last 5s, ignore this reset ──
      // Kahoot fires TwoFactorCorrect and TwoFactorReset at the same time
      // (end of the 10s cycle). Without this guard, the scout would clear
      // the freshly-cracked code and start a brand new swarm unnecessarily.
      if (Date.now() - lastCrackTime < 5000) {
        io.emit("log", { type: "info", msg: "[i] Scout: ignoring reset (just cracked)." });
        return;
      }

      if (!has2FA) {
        has2FA = true;
        io.emit("log", { type: "warn", msg: "[!] 2FA suddenly activated!" });
        io.emit("tfaStatus", { phase: "probed", has2FA: true });
      } else {
        io.emit("log", { type: "warn", msg: "[!] Scout: 2FA Code Rotation!" });
      }
      handleCodeRotation(io);
    });

    const reconnect = (reason) => {
      if (scoutKilled) return; // Don't reconnect if we intentionally killed
      io.emit("log", { type: "warn", msg: `[!] Scout disconnected (${reason || "unknown"}). Reconnecting in 3s...` });
      io.emit("tfaStatus", { phase: "reconnecting" });
      io.emit("botUpdate", { index: "scout", name: botName, status: "retry" });
      scout = null;
      clearTimeout(scoutReconnectTimer);
      scoutReconnectTimer = setTimeout(() => {
        if (!scoutKilled && currentScoutPin) {
          probe2FA(currentScoutPin, _scoutIo || io).catch(() => { });
        }
      }, 3000);
    };

    scout.on("Disconnect", reconnect);
    scout.on("Kicked", reconnect);
  });
}

// ── Swarm ──

export async function crack2FA(gamePin, io) {
  abortSwarm();

  io.emit("log", { type: "warn", msg: "[!] Starting 2FA Swarm (24 bots)..." });
  io.emit("tfaStatus", { phase: "cracking", progress: 0, total: 24 });

  swarmBots = [];
  swarmDone = false;
  let joinedSoFar = 0;

  return new Promise((resolve) => {
    swarmResolve = resolve;

    const timeout = setTimeout(() => {
      if (swarmDone) return;
      swarmDone = true;
      cleanupSwarm();
      io.emit("log", { type: "error", msg: "[-] 2FA Swarm Timeout (60s)." });
      io.emit("tfaStatus", { phase: "error" });
      swarmResolve = null;
      resolve(null);
    }, 60000);

    const onCracked = (perm) => {
      if (swarmDone) return;
      swarmDone = true;
      clearTimeout(timeout);

      // Set cooldown so scout doesn't immediately re-trigger on the simultaneous TwoFactorReset
      lastCrackTime = Date.now();

      io.emit("log", { type: "success", msg: `[+] 2FA CRACKED! Sequence: [${perm}]` });
      io.emit("tfaStatus", { phase: "cracked", sequence: perm });

      cleanupSwarm();
      swarmResolve = null;
      resolve(perm);
    };

    (async () => {
      for (let i = 0; i < ALL_PERMS.length; i++) {
        if (swarmDone) break;

        const perm = ALL_PERMS[i];
        const bot = new Kahoot();
        bot.loggingMode = false;
        bot._swarmAborted = false;
        swarmBots.push(bot);

        const botName = `Crack_${Math.floor(Math.random() * 90000) + 10000}`;
        bot.join(gamePin, botName).then(() => {
          if (bot._swarmAborted || swarmDone) {
            try { bot.leave(); } catch {}
            return;
          }
          // The Promise resolves when the bot is FULLY joined and accepted by the server.
          // We wait a small delay to ensure the server is ready to process 2FA guesses.
          setTimeout(() => {
            if (bot._swarmAborted || swarmDone) return;
            io.emit("log", { type: "info", msg: `[*] Bot ${i} is sending guess: [${perm}]` });
            bot.answerTwoFactorAuth(perm).catch(() => {});
          }, 300);
        }).catch(() => {});

        bot.on("Joined", (settings) => {
          if (bot._swarmAborted || swarmDone) return;
          joinedSoFar++;
          io.emit("tfaStatus", { phase: "cracking", progress: joinedSoFar, total: 24 });
        });

        // We DO NOT guess on TwoFactorReset! If the code rotates, the scout
        // will abort this swarm and spawn a fresh one.
        bot.on("TwoFactorReset", () => {});

        bot.on("TwoFactorCorrect", () => {
          onCracked(perm);
        });

        bot.on("TwoFactorWrong", () => {
          bot._swarmAborted = true;
          try { bot.leave(); } catch {}
          try { if (bot.socket) bot.socket.close(); } catch {}
        });

        await delay(300);
      }
    })().catch((err) => {
      if (!swarmDone) {
        io.emit("log", { type: "error", msg: `[-] Swarm error: ${err.message}` });
        swarmDone = true;
        cleanupSwarm();
        swarmResolve = null;
        resolve(null);
      }
    });
  });
}

function cleanupSwarm() {
  const toClean = swarmBots;
  swarmBots = [];
  for (const bot of toClean) {
    bot._swarmAborted = true;
    try { bot.leave(); } catch {}
  }
  // Force close any remaining sockets after 1s so the leave packet has time to send
  setTimeout(() => {
    for (const bot of toClean) {
      try { if (bot.socket) bot.socket.close(); } catch {}
    }
  }, 1000);
}
