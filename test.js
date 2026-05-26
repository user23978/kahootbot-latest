import Kahoot from "kahoot.js-latest";
import readline from "readline";

// Replace with a valid Game PIN that has 2-Step Join enabled
const GAME_PIN = "1568989";
const name = "test" + Math.floor(Math.random() * 10000);

async function test2FA() {
  const bot = new Kahoot();
  bot.loggingMode = true;

  console.log(`[+] Attempting to join game ${GAME_PIN}...`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '2FA> '
  });

  // Mapping for numbers, colors, and shapes
  const codeMap = {
    '0': 0, 'r': 0, 't': 0, // 0 = Red (Triangle)
    '1': 1, 'b': 1, 'd': 1, // 1 = Blue (Diamond)
    '2': 2, 'y': 2, 'c': 2, // 2 = Yellow (Circle)
    '3': 3, 'g': 3, 's': 3  // 3 = Green (Square)
  };

  try {
    // Attach listeners BEFORE joining so we don't miss the initial events!
    bot.on("Joined", (settings) => {
      console.log(`[EVENT] Joined`);
      console.log(`- Two-Factor Auth Required:`, settings.twoFactorAuth);
      if (settings.twoFactorAuth) {
        console.log(`\n>>> Type the 2FA code (e.g. rbyg) and press ENTER to guess. You can try multiple times. <<<`);
        rl.prompt();
      }
    });

    bot.on("TwoFactorReset", () => {
      console.log(`\n[EVENT] TwoFactorReset - Timer reset, code shuffled! Enter new one.`);
      rl.prompt();
    });

    bot.on("TwoFactorWrong", () => {
      console.log(`\n[EVENT] TwoFactorWrong - Incorrect code!`);
      rl.prompt();
    });

    bot.on("TwoFactorCorrect", () => {
      console.log(`\n[EVENT] TwoFactorCorrect - Success! Bot is fully in the lobby.`);
      if (global.lastGuess) {
        console.log(`[+] The correct sequence was: ${global.lastGuess}`);
      }
      rl.close();
    });

    bot.on("Disconnect", (reason) => {
      console.log(`\n[EVENT] Disconnect - Reason:`, reason);
      process.exit(0);
    });

    // Listen for console input at any time
    rl.on('line', (line) => {
      const text = line.trim().toLowerCase();
      
      if (text === 'auto') {
        console.log(`\n[+] Brute-forcing 2FA with 200ms delay to bypass spam filter...`);
        const perms = [
          [0,1,2,3], [0,1,3,2], [0,2,1,3], [0,2,3,1], [0,3,1,2], [0,3,2,1],
          [1,0,2,3], [1,0,3,2], [1,2,0,3], [1,2,3,0], [1,3,0,2], [1,3,2,0],
          [2,0,1,3], [2,0,3,1], [2,1,0,3], [2,1,3,0], [2,3,0,1], [2,3,1,0],
          [3,0,1,2], [3,0,2,1], [3,1,0,2], [3,1,2,0], [3,2,0,1], [3,2,1,0]
        ];
        
        let i = 0;
        const interval = setInterval(() => {
          if (i >= perms.length) {
            clearInterval(interval);
            console.log(`[+] Finished sending all 24 combinations!`);
            rl.prompt();
            return;
          }
          global.lastGuess = perms[i];
          bot.answerTwoFactorAuth(perms[i]).catch(()=>{});
          i++;
        }, 200);
        return;
      }

      const twoFactorCode = text
        .replace(/[^0-3rbygtdcs]/g, '') // Remove spaces and invalid characters
        .split('')
        .map(char => codeMap[char]);

      if (twoFactorCode.length === 4) {
        console.log(`\n[+] Sending 2FA guess: [${twoFactorCode.join(", ")}]`);
        bot.answerTwoFactorAuth(twoFactorCode).catch(e => {
          console.error(`\n[-] Error sending 2FA guess:`, e);
        });
      } else {
        if (line.trim() !== '') {
          console.log(`\n[-] Please enter exactly 4 valid characters (e.g. 'rbyg')`);
        }
      }
      rl.prompt();
    });

    await bot.join(GAME_PIN, name);
    console.log(`[+] Join promise resolved!\n`);

  } catch (error) {
    console.error(`[-] Failed to connect:`, error);
    process.exit(1);
  }
}

test2FA();
