const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const https = require('https');
const http = require('http');
const path = require('path');

// .env file support
try {
  const fs = require('fs');
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const [key, ...val] = line.trim().split('=');
      if (key && val.length) process.env[key] = val.join('=');
    });
  }
} catch (e) {}

// ============================================
// Local ke liye: niche hardcode karo
// GitHub Actions ke liye: Secrets mein add karo
// ============================================
const SITE2_URL  = process.env.SITE2_URL  || 'https://elevenlabs.io/app/sign-up';
const SIGNIN_URL = 'https://elevenlabs.io/app/sign-in';
const API_URL    = process.env.API_URL    || 'https://localhost:8080/api/admin/public/cookies/sync';
const API_SECRET = process.env.API_SECRET || 'TV-Sync-$3cr3t-K3y-2024-cookies!';
// ============================================

// Generic HTTP/HTTPS request helper
function httpRequest(method, url, payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...extraHeaders,
      },
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postData(url, payload, secret) {
  return httpRequest('POST', url, payload, { 'Authorization': secret });
}

// ─────────────────────────────────────────
// mail.tm API se temp email banao (no browser needed)
// ─────────────────────────────────────────
async function createTempEmail() {
  // Step 1: available domains lo
  const domainsRes = await httpRequest('GET', 'https://api.mail.tm/domains?page=1');
  const domainsJson = JSON.parse(domainsRes.body);
  const domain = domainsJson['hydra:member'][0].domain;

  // Step 2: random address banao
  const rand = Math.random().toString(36).substring(2, 10);
  const address = `${rand}@${domain}`;
  const password = rand + 'Aa1!';

  // Step 3: account create karo
  const createRes = await httpRequest('POST', 'https://api.mail.tm/accounts', { address, password });
  if (createRes.status !== 201) throw new Error('mail.tm account create failed: ' + createRes.body);

  // Step 4: token lo
  const tokenRes = await httpRequest('POST', 'https://api.mail.tm/token', { address, password });
  const tokenJson = JSON.parse(tokenRes.body);
  if (!tokenJson.token) throw new Error('mail.tm token nahi mila: ' + tokenRes.body);

  return { email: address, password, token: tokenJson.token };
}

// mail.tm inbox check karo ElevenLabs ka email aane tak
async function waitForElevenLabsEmail(token, maxWaitMs = 60000) {
  const interval = 5000;
  let waited = 0;
  while (waited < maxWaitMs) {
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
    const res = await httpRequest('GET', 'https://api.mail.tm/messages?page=1', null, {
      Authorization: `Bearer ${token}`,
    });
    const json = JSON.parse(res.body);
    const messages = json['hydra:member'] || [];
    const elMail = messages.find(m =>
      m.from?.address?.includes('elevenlabs') ||
      m.subject?.toLowerCase().includes('elevenlabs') ||
      m.subject?.toLowerCase().includes('verify')
    );
    if (elMail) {
      console.log('[STEP 3] ElevenLabs email mila! (' + waited / 1000 + 's mein)');
      // Full message lo (intro mein link nahi hoti)
      const msgRes = await httpRequest('GET', `https://api.mail.tm/messages/${elMail.id}`, null, {
        Authorization: `Bearer ${token}`,
      });
      return JSON.parse(msgRes.body);
    }
    console.log('[STEP 3] Email abhi nahi aaya... (' + waited / 1000 + 's)');
  }
  throw new Error('ElevenLabs ka verification email nahi aaya 2 minute mein');
}

async function run() {
  // ─────────────────────────────────────────
  // STEP 1 — API se Temp Email banao
  // ─────────────────────────────────────────
  console.log('\n[STEP 1] mail.tm API se temp email bana raha hun...');
  const { email: tempEmail, token: mailToken } = await createTempEmail();
  console.log('[STEP 1] Temp email mila:', tempEmail);

  const PROXY_SERVER   = process.env.PROXY_SERVER   || '';  // e.g. http://proxy.webshare.io:80
  const PROXY_USERNAME = process.env.PROXY_USERNAME || '';
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD || '';

  // System Chromium path (Ubuntu 26.04 par Playwright ka browser kaam nahi karta)
  const possibleChromePaths = [
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  const fs = require('fs');
  const executablePath = possibleChromePaths.find(p => fs.existsSync(p)) || undefined;
  if (executablePath) console.log('[INFO] System Chromium use ho raha hai:', executablePath);

  const launchOptions = {
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  if (PROXY_SERVER) launchOptions.proxy = { server: PROXY_SERVER };

  const browser = await chromium.launch(launchOptions);

  const contextOptions = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (PROXY_SERVER && PROXY_USERNAME) {
    contextOptions.httpCredentials = { username: PROXY_USERNAME, password: PROXY_PASSWORD };
  }

  const context = await browser.newContext(contextOptions);
  if (PROXY_SERVER) {
    console.log('[INFO] Residential proxy use ho raha hai:', PROXY_SERVER);
  } else {
    console.log('[INFO] Proxy set nahi — direct connection');
  }

  // ─────────────────────────────────────────
  // STEP 2 — Tab 2: ElevenLabs Signup
  // ─────────────────────────────────────────
  console.log('\n[STEP 2] Tab 2 open kar raha hun — ElevenLabs Signup');
  const tab2 = await context.newPage();
  await tab2.goto(SITE2_URL, { waitUntil: 'domcontentloaded' });

  // Cookie banner dismiss karo (pehle)
  try {
    await tab2.waitForSelector('button', { timeout: 5000 });
    const cookieBtn = await tab2.$('button:has-text("REJECT ALL"), button:has-text("Reject All"), button:has-text("Accept All"), button:has-text("Accept all")');
    if (cookieBtn) {
      await cookieBtn.click();
      console.log('[STEP 2] Cookie banner dismiss kiya');
      await tab2.waitForTimeout(1500);
    }
  } catch (e) {
    console.log('[STEP 2] Cookie banner nahi mila, continue...');
  }

  await tab2.waitForSelector('[data-testid="sign-up-email-input"]', { timeout: 15000 });

  // Human-like: type character by character
  await tab2.click('[data-testid="sign-up-email-input"]');
  await tab2.type('[data-testid="sign-up-email-input"]', tempEmail, { delay: 60 });
  console.log('[STEP 2] Email fill kiya:', tempEmail);

  await tab2.waitForTimeout(800);

  // Password: 8+ chars, 1 number, 1 special char
  const password = 'Pass@' + Math.floor(Math.random() * 9000 + 1000);
  await tab2.click('[data-testid="sign-up-password-input"]');
  await tab2.type('[data-testid="sign-up-password-input"]', password, { delay: 60 });
  console.log('[STEP 2] Password fill kiya:', password);

  await tab2.waitForTimeout(1200);

  // Sign up button click karo
  await tab2.click('button[style*="view-transition-name: submit"]');
  console.log('[STEP 2] Sign up button click kiya');

  // 8 sec wait — hCaptcha + redirect ke liye
  await tab2.waitForTimeout(8000);

  // Error check karo (invalid email / domain blocked)
  const errorText = await tab2.$eval(
    '[data-testid="sign-up-email-error"], [role="alert"], .error-message, [class*="error"]',
    el => el.innerText.trim()
  ).catch(() => null);

  if (errorText) {
    console.log('[STEP 2] ❌ Signup error mila:', errorText);
    await browser.close();
    throw new Error('ElevenLabs signup failed: ' + errorText);
  }

  // Current URL log karo — redirect hua ya nahi
  const afterSignupUrl = tab2.url();
  console.log('[STEP 2] Signup ke baad URL:', afterSignupUrl);

  // Page title ya heading se confirm karo
  const pageContent = await tab2.$eval('body', el => el.innerText.substring(0, 300)).catch(() => '');
  console.log('[STEP 2] Page content (first 300 chars):\n', pageContent);

  // ─────────────────────────────────────────
  // STEP 3 — mail.tm API se verification email wait karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 3] mail.tm API se ElevenLabs verification email wait kar raha hun...');
  const emailMessage = await waitForElevenLabsEmail(mailToken);

  // ─────────────────────────────────────────
  // STEP 4 — Email body se verify link nikalo
  // ─────────────────────────────────────────
  console.log('\n[STEP 4] "Verify email" link dhundh raha hun...');

  // HTML body se verify link extract karo
  const htmlBody = emailMessage.html?.[0] || emailMessage.text || '';
  const verifyMatch = htmlBody.match(/href="(https:\/\/[^"]*mode=verifyEmail[^"]*)"/i)
    || htmlBody.match(/(https:\/\/[^\s<>"]*mode=verifyEmail[^\s<>"]*)/i);

  if (!verifyMatch) throw new Error('"Verify email" link nahi mila email body mein!');
  const verifyHref = verifyMatch[1].replace(/&amp;/g, '&');
  console.log('[STEP 4] Verify link mila:', verifyHref);

  // New tab mein verify link kholo
  const verifyTab = await context.newPage();
  await verifyTab.goto(verifyHref, { waitUntil: 'domcontentloaded' });

  await verifyTab.waitForLoadState('domcontentloaded');
  console.log('[STEP 4] Verify tab URL:', verifyTab.url());

  // ─────────────────────────────────────────
  // STEP 5 — Sign In page par email + password fill karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 5] Sign In page par redirect ho raha hun...');

  // Sign-in page aane tak wait karo
  await verifyTab.waitForURL('**/sign-in**', { timeout: 20000 }).catch(() => {
    // Kabhi kabhi direct onboarding par bhi ja sakta hai
    console.log('[STEP 5] sign-in URL nahi aaya, current URL:', verifyTab.url());
  });

  const currentUrl = verifyTab.url();
  console.log('[STEP 5] Current URL:', currentUrl);

  if (currentUrl.includes('sign-in')) {
    await verifyTab.waitForSelector('[data-testid="sign-in-email-input"]', { timeout: 15000 });

    await verifyTab.fill('[data-testid="sign-in-email-input"]', tempEmail);
    console.log('[STEP 5] Sign-in email fill kiya');

    await verifyTab.fill('[data-testid="sign-in-password-input"]', password);
    console.log('[STEP 5] Sign-in password fill kiya');

    await verifyTab.click('[data-testid="sign-in-submit-button"]');
    console.log('[STEP 5] Sign in button click kiya');
  } else {
    console.log('[STEP 5] Direct onboarding par gaye, sign-in skip...');
  }

  // ─────────────────────────────────────────
  // STEP 6 — Onboarding page: cookies + storage extract karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 6] Onboarding page aane ka wait kar raha hun...');

  await verifyTab.waitForURL('**/onboarding**', { timeout: 30000 }).catch(() => {
    console.log('[STEP 6] onboarding URL timeout, current URL:', verifyTab.url());
  });

  console.log('[STEP 6] Onboarding URL:', verifyTab.url());

  // Cookies extract karo
  const cookies = await context.cookies();
  console.log('[STEP 6] Cookies extract kiye:', cookies.length, 'cookies');

  // Session Storage + Local Storage extract karo
  const storageData = await verifyTab.evaluate(() => {
    const session = {};
    const local = {};

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      session[key] = sessionStorage.getItem(key);
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      local[key] = localStorage.getItem(key);
    }

    return { sessionStorage: session, localStorage: local };
  });

  console.log('[STEP 6] Session Storage keys:', Object.keys(storageData.sessionStorage).length);
  console.log('[STEP 6] Local Storage keys:', Object.keys(storageData.localStorage).length);

  // ─────────────────────────────────────────
  // STEP 7 — Apni API ko hit karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 7] API hit kar raha hun:', API_URL);

  const payload = {
    email: tempEmail,
    cookies: cookies,
    sessionStorage: storageData.sessionStorage,
    localStorage: storageData.localStorage,
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await postData(API_URL, payload, API_SECRET);
    console.log('[STEP 7] API Response Status:', result.status);
    console.log('[STEP 7] API Response Body:', result.body);
  } catch (err) {
    console.error('[STEP 7] API Error:', err.message);
  }

  // ─────────────────────────────────────────
  // Done
  // ─────────────────────────────────────────
  console.log('\n✅ DONE! Email:', tempEmail);

  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Script Error:', err);
  process.exit(1);
});
