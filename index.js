const fs = require('fs');
const colors = require('colors');
const cron = require('cron');
const {
  sendSol,
  generateRandomAddresses,
  getKeypairFromPrivateKey,
  PublicKey,
  connection,
  LAMPORTS_PER_SOL,
  delay,
} = require('./src/solanaUtils');

const { displayHeader, getNetworkTypeFromUser } = require('./src/displayUtils');

const captchaKey = '2captcha_api_key';

const twocaptcha_turnstile = (sitekey, pageurl) => new Promise(async (resolve) => {
    console.log("Requesting captcha token...");
    try {
        const getToken = await fetch(`https://2captcha.com/in.php?key=${captchaKey}&method=turnstile&sitekey=${sitekey}&pageurl=${pageurl}&json=1`, {
            method: 'GET',
        })
        .then(res => res.text())
        .then(res => {
            console.log("Received token response from 2captcha:", res);
            if (res == 'ERROR_WRONG_USER_KEY' || res == 'ERROR_ZERO_BALANCE') {
                return resolve(res);
            } else {
                return res.split('|');
            }
        });

        if (getToken[0] != 'OK') {
            console.log("Failed to get token from 2captcha");
            resolve('FAILED_GETTING_TOKEN');
        }

        const task = getToken[1];
        console.log("Captcha task started, task ID:", task);

        for (let i = 0; i < 60; i++) {
            console.log("Waiting for captcha token...");
            const token = await fetch(
                `https://2captcha.com/res.php?key=${captchaKey}&action=get&id=${task}&json=1`
            ).then(res => res.json());
            
            if (token.status == 1) {
                console.log("Captcha token received successfully");
                resolve(token);
                break;
            }
            await delay(2000);
        }
    } catch (error) {
        console.log("Error getting captcha token:", error);
        resolve('FAILED_GETTING_TOKEN');
    }
});

const claimFaucet = (address) => new Promise(async (resolve) => {
    console.log("Attempting to claim faucet for address:", address);
    let success = false;
    
    while (!success) {
        const bearer = await twocaptcha_turnstile('0x4AAAAAAAc6HG1RMG_8EHSC', 'https://faucet.sonic.game/#/');
        console.log("Captcha bearer result:", bearer);

        if (bearer == 'ERROR_WRONG_USER_KEY' || bearer == 'ERROR_ZERO_BALANCE' || bearer == 'FAILED_GETTING_TOKEN' ) {
            success = true;
            resolve(`Failed claim, ${bearer}`);
            return;
        }

        try {
            console.log("Sending claim request to faucet...");
            const res = await fetch(`https://faucet-api.sonic.game/airdrop/${address}/0.5/${bearer.request}`, {
                headers: {
                    "Accept": "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
                    "Dnt": "1",
                    "Origin": "https://faucet.sonic.game",
                    "Priority": "u=1, i",
                    "Referer": "https://faucet.sonic.game/",
                    "User-Agent": bearer.useragent,
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "Windows",
                }
            }).then(res => res.json());

            console.log("Received response from faucet:", res);

            if (res.status === 'ok') {
                success = true;
                resolve(`Successfully claimed faucet 0.5 SOL!`);
            } else if (res.message && res.message.includes('distributes 0.5 Test SOL every 8 hours')) {
                console.log(colors.yellow("Already claimed faucet within 8 hours. Skipping claim..."));
                success = true;
                resolve("Already claimed within 8 hours, skipping claim.");
            } else {
                console.log("Faucet claim failed with status:", res.status);
            }
        } catch (error) {
            console.log("Error during faucet claim:", error);
        }
    }
});

async function transferSol(
  privateKeys,
  addressCount,
  amountToSend,
  delayBetweenTx
) {
  for (const [index, privateKey] of privateKeys.entries()) {
    const fromKeypair = getKeypairFromPrivateKey(privateKey);
    console.log(colors.yellow(`Processing account ${index + 1}: ${fromKeypair.publicKey.toString()}`));

    // Claim faucet for each private key
    await claimFaucet(fromKeypair.publicKey.toString());

    const randomAddresses = generateRandomAddresses(addressCount);

    for (const address of randomAddresses) {
      const toPublicKey = new PublicKey(address);
      try {
        await sendSol(fromKeypair, toPublicKey, amountToSend);
        console.log(colors.green(`Successfully sent ${amountToSend} SOL to ${address}`));
      } catch (error) {
        console.error(colors.red(`Failed to send SOL to ${address}:`), error);
      }
      await delay(delayBetweenTx);
    }

    console.log();
  }
}

function setupCronJob(
  privateKeys,
  addressCount,
  amountToSend,
  delayBetweenTx
) {
  console.log(colors.green('Setting up cron job to run every 24 hours...'));

  const cronJob = new cron.CronJob('0 0 * * *', async () => {
    console.log(colors.blue('Running scheduled transfer...'));
    await transferSol(
      privateKeys,
      addressCount,
      amountToSend,
      delayBetweenTx
    );
  });

  cronJob.start();
  console.log(colors.green('Cron job scheduled successfully!'));
  console.log();
}

(async () => {
  displayHeader();
  const networkType = getNetworkTypeFromUser();
  console.log();

  const privateKeys = JSON.parse(fs.readFileSync('privateKeys.json', 'utf-8'));
  if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
    throw new Error(colors.red('privateKeys.json is not set correctly or is empty'));
  }

  const addressCount = 100;
  const amountToSend = 0.001;
  const delayBetweenTx = 1000;

  console.log(colors.yellow('Running first-time transfer and setting up auto mode...'));
  await transferSol(privateKeys, addressCount, amountToSend, delayBetweenTx);
  setupCronJob(privateKeys, addressCount, amountToSend, delayBetweenTx);
})();
