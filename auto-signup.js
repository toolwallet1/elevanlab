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
const API_URL    = process.env.API_URL    || 'https://localhost:8080/api/admin/public/cookies/sync';
const API_SECRET = process.env.API_SECRET || 'TV-Sync-$3cr3t-K3y-2024-cookies!';
const FIREBASE_KEY = 'AIzaSyBSsRE_1Os04-bxpd5JTLIniy3UK4OqKys';
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
// mail.tm API se temp email banao
// ─────────────────────────────────────────
async function createTempEmail() {
  const domainsRes = await httpRequest('GET', 'https://api.mail.tm/domains?page=1');
  const domainsJson = JSON.parse(domainsRes.body);
  const domain = domainsJson['hydra:member'][0].domain;

  const rand = Math.random().toString(36).substring(2, 10);
  const address = `${rand}@${domain}`;
  const password = rand + 'Aa1!';

  const createRes = await httpRequest('POST', 'https://api.mail.tm/accounts', { address, password });
  if (createRes.status !== 201) throw new Error('mail.tm account create failed: ' + createRes.body);

  const tokenRes = await httpRequest('POST', 'https://api.mail.tm/token', { address, password });
  const tokenJson = JSON.parse(tokenRes.body);
  if (!tokenJson.token) throw new Error('mail.tm token nahi mila: ' + tokenRes.body);

  return { email: address, password, token: tokenJson.token };
}

// ─────────────────────────────────────────
// Firebase REST API se ElevenLabs account banao (no browser, no captcha)
// ─────────────────────────────────────────
async function firebaseSignup(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`;
  const res = await httpRequest('POST', url, {
    email,
    password,
    returnSecureToken: true,
  });
  const json = JSON.parse(res.body);
  if (json.error) throw new Error('Firebase signup error: ' + json.error.message);
  console.log('[STEP 2] Firebase signup success! UID:', json.localId);

  // Verification email bhejo
  const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_KEY}`;
  const verifyRes = await httpRequest('POST', verifyUrl, {
    requestType: 'VERIFY_EMAIL',
    idToken: json.idToken,
  });
  const verifyJson = JSON.parse(verifyRes.body);
  if (verifyJson.error) throw new Error('Verification email error: ' + verifyJson.error.message);
  console.log('[STEP 2] Verification email bhej diya:', verifyJson.email);

  return { idToken: json.idToken, localId: json.localId };
}

// ─────────────────────────────────────────
// mail.tm inbox mein ElevenLabs email dhundho
// ─────────────────────────────────────────
async function waitForElevenLabsEmail(token, maxWaitMs = 120000) {
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
      m.from?.address?.includes('firebase') ||
      m.from?.address?.includes('noreply') ||
      m.subject?.toLowerCase().includes('verify') ||
      m.subject?.toLowerCase().includes('confirm')
    );
    if (elMail) {
      console.log('[STEP 3] Email mila! (' + waited / 1000 + 's mein) Subject:', elMail.subject);
      const msgRes = await httpRequest('GET', `https://api.mail.tm/messages/${elMail.id}`, null, {
        Authorization: `Bearer ${token}`,
      });
      return JSON.parse(msgRes.body);
    }
    console.log('[STEP 3] Email abhi nahi aaya... (' + waited / 1000 + 's)');
  }
  throw new Error('Verification email nahi aaya 2 minute mein');
}

async function run() {
  // ─────────────────────────────────────────
  // STEP 1 — mail.tm se temp email banao
  // ─────────────────────────────────────────
  console.log('\n[STEP 1] mail.tm se temp email bana raha hun...');
  const { email: tempEmail, password: mailPass, token: mailToken } = await createTempEmail();
  console.log('[STEP 1] Temp email mila:', tempEmail);

  // ─────────────────────────────────────────
  // STEP 2 — Firebase API se account banao (NO BROWSER, NO CAPTCHA)
  // ─────────────────────────────────────────
  console.log('\n[STEP 2] Firebase API se ElevenLabs account bana raha hun...');
  const password = 'Pass@' + Math.floor(Math.random() * 9000 + 1000);
  await firebaseSignup(tempEmail, password);

  // ─────────────────────────────────────────
  // STEP 3 — Verification email aane ka wait
  // ─────────────────────────────────────────
  console.log('\n[STEP 3] Verification email aane ka wait kar raha hun...');
  const emailMessage = await waitForElevenLabsEmail(mailToken);

  // ─────────────────────────────────────────
  // STEP 4 — Verify link nikalo
  // ─────────────────────────────────────────
  console.log('\n[STEP 4] Verify link dhundh raha hun...');
  const htmlBody = emailMessage.html?.[0] || emailMessage.text || '';
  const verifyMatch = htmlBody.match(/href="(https:\/\/[^"]*mode=verifyEmail[^"]*)"/i)
    || htmlBody.match(/(https:\/\/[^\s<>"]*mode=verifyEmail[^\s<>"]*)/i)
    || htmlBody.match(/href="(https:\/\/[^"]*verif[^"]*)"/i);

  if (!verifyMatch) throw new Error('Verify link nahi mila email mein!');
  const verifyHref = verifyMatch[1].replace(/&amp;/g, '&');
  console.log('[STEP 4] Verify link mila:', verifyHref.substring(0, 80) + '...');

  // ─────────────────────────────────────────
  // STEP 5 — Browser se verify link open karo + session lo
  // ─────────────────────────────────────────
  console.log('\n[STEP 5] Browser se verify link open kar raha hun...');

  const possibleChromePaths = [
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  const fs = require('fs');
  const executablePath = possibleChromePaths.find(p => fs.existsSync(p)) || undefined;
  if (executablePath) console.log('[INFO] System Chromium:', executablePath);

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const verifyTab = await context.newPage();
  await verifyTab.goto(verifyHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('[STEP 5] Verify URL:', verifyTab.url());

  // Sign-in page ya onboarding tak wait karo
  await verifyTab.waitForTimeout(5000);

  const currentUrl = verifyTab.url();
  console.log('[STEP 5] Current URL:', currentUrl);

  // Agar sign-in page aaye to login karo
  if (currentUrl.includes('sign-in')) {
    console.log('[STEP 5] Sign-in page mila, login kar raha hun...');
    await verifyTab.waitForSelector('[data-testid="sign-in-email-input"]', { timeout: 15000 });
    await verifyTab.type('[data-testid="sign-in-email-input"]', tempEmail, { delay: 50 });
    await verifyTab.type('[data-testid="sign-in-password-input"]', password, { delay: 50 });
    await verifyTab.click('[data-testid="sign-in-submit-button"]');
    await verifyTab.waitForTimeout(5000);
    console.log('[STEP 5] Login ke baad URL:', verifyTab.url());
  }

  // Onboarding tak wait karo
  await verifyTab.waitForURL('**/onboarding**', { timeout: 20000 }).catch(() => {
    console.log('[STEP 5] Onboarding nahi aaya, current URL:', verifyTab.url());
  });

  // ─────────────────────────────────────────
  // STEP 6 — Cookies + Storage extract karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 6] Session data extract kar raha hun...');

  const cookies = await context.cookies();
  console.log('[STEP 6] Cookies:', cookies.length);

  const storageData = await verifyTab.evaluate(() => {
    const session = {}, local = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      session[k] = sessionStorage.getItem(k);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      local[k] = localStorage.getItem(k);
    }
    return { sessionStorage: session, localStorage: local };
  });

  console.log('[STEP 6] localStorage keys:', Object.keys(storageData.localStorage).length);

  // ─────────────────────────────────────────
  // STEP 7 — API ko data bhejo
  // ─────────────────────────────────────────
  console.log('\n[STEP 7] API hit kar raha hun:', API_URL);

  const payload = {
    email: tempEmail,
    cookies,
    sessionStorage: storageData.sessionStorage,
    localStorage: storageData.localStorage,
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await postData(API_URL, payload, API_SECRET);
    console.log('[STEP 7] API Status:', result.status);
    console.log('[STEP 7] API Body:', result.body);
  } catch (err) {
    console.error('[STEP 7] API Error:', err.message);
  }

  console.log('\n✅ DONE! Email:', tempEmail);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Script Error:', err);
  process.exit(1);
});
