import puppeteer from 'puppeteer';

const pin = process.argv[2];
if (!pin) {
  console.log("Provide PIN");
  process.exit(1);
}

(async () => {
  console.log(`[+] Launching puppeteer for PIN ${pin}...`);
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Inject WebSocket interceptor
  await page.evaluateOnNewDocument(() => {
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (typeof data === 'string' && data.includes('/service/controller')) {
        console.log("WS_SEND: " + data);
      }
      return origSend.call(this, data);
    };
  });

  page.on('console', msg => {
    if (msg.text().startsWith('WS_SEND:')) {
      console.log(msg.text());
    }
  });

  await page.goto('https://kahoot.it');
  
  // Wait for PIN input and enter it
  await page.waitForSelector('input[name="gameId"]');
  await page.type('input[name="gameId"]', pin);
  await page.click('button[type="submit"]');

  console.log("[+] Entered PIN.");

  // Wait for nickname input and enter it
  await page.waitForSelector('input[name="nickname"]');
  await page.type('input[name="nickname"]', `PTest_${Math.floor(Math.random()*1000)}`);
  await page.click('button[type="submit"]');

  console.log("[+] Entered Nickname.");

  // Now the browser is in the 2FA screen.
  // Click 4 random buttons. The button elements are usually colors.
  console.log("[+] Waiting for 2FA buttons...");
  try {
    await page.waitForSelector('button[data-functional-selector="two-factor-cards__triangle-button"]', { timeout: 10000 });
    
    console.log("[+] Found 2FA buttons. Clicking 4 of them...");
    await page.click('button[data-functional-selector="two-factor-cards__triangle-button"]');
    await page.click('button[data-functional-selector="two-factor-cards__diamond-button"]');
    await page.click('button[data-functional-selector="two-factor-cards__circle-button"]');
    await page.click('button[data-functional-selector="two-factor-cards__square-button"]');

    console.log("[+] Clicked buttons. Waiting to see what was sent over WebSocket...");
    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.log("Could not find 2FA buttons. Did we get disconnected or is 2FA disabled?");
  }

  await browser.close();
})();
