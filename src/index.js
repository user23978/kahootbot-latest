import prompts from "prompts";
import chalk from "chalk";
import { generateRandomName } from "./names.js";
import { startBots, exitBots } from "./botManager.js";

let config = {
  gamePin: "",
  botCount: 100,
  botNames: [],
  botPrefix: "Bot",
  customNames: false,
  joinDelay: 2000,
  answerMode: "random"
};

async function setGamePin() {
  const response = await prompts({
    type: 'text',
    name: 'pin',
    message: 'Neuen Game PIN eingeben:',
    validate: value => /^\d{6,8}$/.test(value) ? true : 'Ungültiger PIN. Muss 6, 7 oder 8 Ziffern haben.'
  });
  if (response.pin) {
    config.gamePin = response.pin;
    console.log(chalk.green("Angewendet!"));
  }
}

async function setBotCount() {
  const response = await prompts({
    type: 'number',
    name: 'count',
    message: 'Anzahl der Bots eingeben:',
    validate: value => value > 0 ? true : 'Muss eine positive Zahl sein.'
  });
  if (response.count) {
    config.botCount = response.count;
    console.log(chalk.green("Angewendet!"));
  }
}

async function setBotNamesMenu() {
  const response = await prompts({
    type: 'select',
    name: 'choice',
    message: 'Namen auswählen',
    choices: [
      { title: 'Standardnamen verwenden', value: 'default' },
      { title: 'Zufällige Namen generieren', value: 'random' },
      { title: 'Eigene Namen eingeben', value: 'custom' }
    ]
  });

  if (response.choice === 'default') {
    config.botNames = [];
    config.customNames = false;
    const prefixRes = await prompts({
      type: 'text',
      name: 'prefix',
      message: 'Präfix eingeben (z.B. Bot):',
      initial: 'Bot'
    });
    if (prefixRes.prefix) {
      config.botPrefix = prefixRes.prefix;
      console.log(chalk.green("Angewendet!"));
    }
  } else if (response.choice === 'random') {
    config.botNames = [];
    config.customNames = false;
    for (let i = 0; i < config.botCount; i++) {
      config.botNames.push(generateRandomName());
    }
    console.log(chalk.green("Zufällige Namen wurden generiert."));
  } else if (response.choice === 'custom') {
    config.customNames = true;
    config.botNames = [];

    const countRes = await prompts({
      type: 'number',
      name: 'numCustom',
      message: 'Wie viele eigene Namen möchtest du eingeben?',
      validate: value => (value >= 0 && value <= config.botCount) ? true : 'Ungültige Anzahl.'
    });

    if (countRes.numCustom !== undefined) {
      for (let i = 0; i < countRes.numCustom; i++) {
        const nameRes = await prompts({
          type: 'text',
          name: 'name',
          message: `Name für Bot ${i + 1}:`
        });
        config.botNames.push(nameRes.name ? nameRes.name.trim() : generateRandomName());
      }
      for (let i = countRes.numCustom; i < config.botCount; i++) {
        config.botNames.push(generateRandomName());
      }
      console.log(chalk.green("Eigene Namen angewendet, der Rest wurde zufällig generiert."));
    }
  }
}

async function setJoinDelay() {
  const response = await prompts({
    type: 'number',
    name: 'delay',
    message: 'Delay zwischen dem Beitritt (in ms):',
    validate: value => value >= 0 ? true : 'Zahl muss ≥ 0 sein.'
  });
  if (response.delay !== undefined) {
    config.joinDelay = response.delay;
    console.log(chalk.green("Angewendet!"));
  }
}

async function toggleAnswerMode() {
  config.answerMode = config.answerMode === "random" ? "correct" : "random";
  console.log(chalk.green(`Antwort Modus geändert zu: ${config.answerMode === "random" ? "Random" : "Korrekt"}`));
}

async function showMenu() {
  let running = true;
  while (running) {
    console.clear();
    console.log(chalk.blue(`==========( KAHOOT BOT 3.0 - by Leo )===========`));

    const nameStatus = config.customNames ? "Eigene" : config.botNames.length > 0 ? "Random" : "Default";
    const answerStatus = config.answerMode === "random" ? "Random" : "Korrekt";

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'Menü Option auswählen',
      choices: [
        { title: `Set Game PIN (Aktuell: ${config.gamePin || 'Nicht gesetzt'})`, value: 'pin' },
        { title: `Set Bot Count (Aktuell: ${config.botCount})`, value: 'count' },
        { title: `Set Bot Names (Aktuell: ${nameStatus})`, value: 'names' },
        { title: `Set Join Delay (Aktuell: ${config.joinDelay} ms)`, value: 'delay' },
        { title: `Set Bot Answers (Aktuell: ${answerStatus})`, value: 'answers' },
        { title: `Start Bots`, value: 'start' },
        { title: `Exit`, value: 'exit' }
      ]
    });

    switch (response.action) {
      case 'pin':
        await setGamePin();
        break;
      case 'count':
        await setBotCount();
        break;
      case 'names':
        await setBotNamesMenu();
        break;
      case 'delay':
        await setJoinDelay();
        break;
      case 'answers':
        await toggleAnswerMode();
        break;
      case 'start':
        await startBots(config);

        // Wait for user to decide what to do after starting
        const afterStart = await prompts({
          type: 'confirm',
          name: 'menu',
          message: 'Zurück ins Menü (behält Bots online)?',
          initial: true
        });
        if (!afterStart.menu) {
          await exitBots();
          running = false;
        }
        break;
      case 'exit':
      case undefined:
        await exitBots();
        running = false;
        break;
    }
  }
}

process.title = "Kahoot Bot";
showMenu();
