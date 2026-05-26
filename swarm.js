import Kahoot from 'kahoot.js-latest';

const GAME_PIN = process.argv[2];

if (!GAME_PIN) {
  console.error("Usage: node swarm.js <PIN>");
  process.exit(1);
}

const perms = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
  [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
  [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0]
];

console.log(`[+] Launching 24 bots to game ${GAME_PIN} (staggered by 500ms to avoid rate-limits)...`);

let successFound = false;

async function launchBots() {
  for (let i = 0; i < perms.length; i++) {
    const perm = perms[i];
    const bot = new Kahoot();
    bot.loggingMode = false;

    const botName = `Sniffer_${Math.floor(Math.random() * 10000)}_${i}`;

    bot.join(GAME_PIN, botName).catch(e => {
      console.log(`[-] Bot ${i} failed to join: ${e.message || e}`);
    });

    bot.on("Joined", (settings) => {
      console.log(`[+] Bot ${i} (${botName}) joined successfully! Waiting for 2FA prompt...`);
      if (settings.twoFactorAuth && !successFound) {
        bot.answerTwoFactorAuth(perm).catch(() => { });
      }
    });

    bot.on("TwoFactorReset", () => {
      if (!successFound) {
        console.log(`[*] Bot ${i} is sending guess: [${perm}]`);
        bot.answerTwoFactorAuth(perm).catch(e => {
          console.log(`[-] Bot ${i} failed to send guess: ${e}`);
        });
      }
    });

    bot.on("TwoFactorCorrect", () => {
      successFound = true;
      console.log(`\n======================================================`);
      console.log(`[SUCCESS] Bot ${i} successfully bypassed 2FA!`);
      console.log(`[SUCCESS] The correct color mapping sequence is: [${perm}]`);
      console.log(`======================================================\n`);
      console.log(`You can now press Ctrl+C to exit.`);
    });

    bot.on("Disconnect", (reason) => {
      if (reason !== "Session ended by user") {
        console.log(`[-] Bot ${i} disconnected: ${reason}`);
      }
    });

    // Wait 500ms before launching the next bot to avoid triggering Kahoot's API rate limits
    await new Promise(r => setTimeout(r, 100));
  }
}

launchBots();
