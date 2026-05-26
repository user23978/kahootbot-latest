import Kahoot from "kahoot.js-latest";

const ALL_PERMS = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
  [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
  [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0]
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Probes a game to check if 2FA is enabled using a single throwaway bot.
 */
export async function probe2FA(gamePin, io) {
  io.emit("log", { type: "info", msg: `[i] Prüfe Spiel ${gamePin} auf 2FA...` });
  io.emit("tfaStatus", { phase: "probing" });

  const scout = new Kahoot();
  scout.loggingMode = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { scout.leave(); } catch { }
      io.emit("log", { type: "error", msg: "[-] Probe timed out after 15s" });
      io.emit("tfaStatus", { phase: "error" });
      reject(new Error("Probe timed out"));
    }, 15000);

    scout.join(gamePin, `Scout_${Math.floor(Math.random() * 10000)}`).catch(reject);

    scout.on("Joined", (settings) => {
      clearTimeout(timeout);
      const has2FA = !!settings.twoFactorAuth;
      try { scout.leave(); } catch { }

      if (has2FA) {
        io.emit("log", { type: "warn", msg: "[!] 2FA ist aktiviert!" });
      } else {
        io.emit("log", { type: "success", msg: "[+] Kein 2FA. Bots können direkt joinen." });
      }
      io.emit("tfaStatus", { phase: "probed", has2FA });
      resolve({ twoFactorAuth: has2FA });
    });
  });
}

/**
 * Launches a 24-bot swarm to brute-force the 2FA sequence.
 * Returns the correct sequence array, or null on timeout (NEVER rejects).
 */
export async function crack2FA(gamePin, io) {
  io.emit("log", { type: "warn", msg: "[!] Starte 2FA Brute-Force Swarm (24 Bots)..." });
  io.emit("tfaStatus", { phase: "cracking", progress: 0, total: 24 });

  const swarmBots = [];
  let cracked = false;
  let timedOut = false;

  return new Promise((resolve) => {
    // ── Safety timeout — resolves null, NEVER rejects to prevent server crash ──
    const timeout = setTimeout(() => {
      if (cracked) return;
      timedOut = true;
      cleanupSwarm(swarmBots);
      io.emit("log", { type: "error", msg: "[-] 2FA Swarm Timeout (60s). Kein Code gefunden." });
      io.emit("tfaStatus", { phase: "error" });
      resolve(null); // safe — callers handle null
    }, 60000);

    // ── Spawn all 24 swarm bots asynchronously ──
    (async () => {
      for (let i = 0; i < ALL_PERMS.length; i++) {
        if (cracked || timedOut) break;

        const perm = ALL_PERMS[i];
        const bot = new Kahoot();
        bot.loggingMode = false;
        swarmBots.push(bot);

        const botName = `Crack_${Math.floor(Math.random() * 10000)}_${i}`;
        bot.join(gamePin, botName).catch(() => { });

        bot.on("Joined", (settings) => {
          io.emit("tfaStatus", { phase: "cracking", progress: swarmBots.length, total: 24 });
          if (settings.twoFactorAuth && !cracked && !timedOut) {
            // Human-like delay before answering
            setTimeout(() => {
              if (!cracked && !timedOut) {
                bot.answerTwoFactorAuth(perm).catch(() => { });
              }
            }, 1000 + Math.random() * 1000);
          }
        });

        bot.on("TwoFactorReset", () => {
          if (!cracked && !timedOut) {
            setTimeout(() => {
              if (!cracked && !timedOut) {
                bot.answerTwoFactorAuth(perm).catch(() => { });
              }
            }, 1000 + Math.random() * 1000);
          }
        });

        bot.on("TwoFactorCorrect", () => {
          if (cracked) return;
          cracked = true;
          clearTimeout(timeout);

          io.emit("log", { type: "success", msg: `[+] 2FA GEKNACKT! Sequenz: [${perm}]` });
          io.emit("tfaStatus", { phase: "cracked", sequence: perm });

          cleanupSwarm(swarmBots);
          resolve(perm);
        });

        await delay(200);
      }
    })().catch((err) => {
      // Inner async loop should never throw, but if it does — resolve safely
      if (!cracked && !timedOut) {
        io.emit("log", { type: "error", msg: `[-] Interner Swarm-Fehler: ${err.message}` });
        resolve(null);
      }
    });
  });
}

function cleanupSwarm(bots) {
  for (const bot of bots) {
    try { bot.leave(); } catch { }
  }
}
