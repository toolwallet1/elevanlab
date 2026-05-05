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
const SITE2_URL  = process.env.SITE2_URL  || 'https://elevenlabs.io/app/sign-up';
// ============================================

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

// mail.tm se temp email banao
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
  if (!tokenJson.token) throw new Error('mail.tm token nahi mila');
  return { email: address, token: tokenJson.token };
}

// mail.tm inbox poll karo
async function waitForVerificationEmail(token, maxWaitMs = 120000) {
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
    const mail = messages.find(m =>
      m.from?.address?.includes('elevenlabs') ||
      m.subject?.toLowerCase().includes('verify') ||
      m.subject?.toLowerCase().includes('confirm')
    );
    if (mail) {
      console.log('[STEP 3] Email mila! (' + waited / 1000 + 's) Subject:', mail.subject);
      const msgRes = await httpRequest('GET', `https://api.mail.tm/messages/${mail.id}`, null, {
        Authorization: `Bearer ${token}`,
      });
      return JSON.parse(msgRes.body);
    }
    console.log('[STEP 3] Email abhi nahi aaya... (' + waited / 1000 + 's)');
  }
  throw new Error('Verification email 2 minute mein nahi aaya');
}

async function run() {
  // STEP 1 — Temp email banao
  console.log('\n[STEP 1] Temp email bana raha hun...');
  const { email: tempEmail, token: mailToken } = await createTempEmail();
  console.log('[STEP 1] Email:', tempEmail);

  // Browser launch — PC pe non-headless (real window)
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  // STEP 2 — ElevenLabs signup
  console.log('\n[STEP 2] ElevenLabs signup page khol raha hun...');
  const page = await context.newPage();
  await page.goto(SITE2_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Cookie banner dismiss
  await page.waitForTimeout(2000);
  try {
    const cookieBtn = await page.$('button:has-text("REJECT ALL"), button:has-text("Reject All"), button:has-text("Accept All")');
    if (cookieBtn) {
      await cookieBtn.click();
      console.log('[STEP 2] Cookie banner dismiss kiya');
      await page.waitForTimeout(1500);
    }
  } catch (e) {}

  // Form fill karo
  await page.waitForSelector('[data-testid="sign-up-email-input"]', { timeout: 15000 });
  await page.click('[data-testid="sign-up-email-input"]');
  await page.type('[data-testid="sign-up-email-input"]', tempEmail, { delay: 80 });
  console.log('[STEP 2] Email fill kiya:', tempEmail);

  await page.waitForTimeout(800);

  const password = 'Pass@' + Math.floor(Math.random() * 9000 + 1000);
  await page.click('[data-testid="sign-up-password-input"]');
  await page.type('[data-testid="sign-up-password-input"]', password, { delay: 80 });
  console.log('[STEP 2] Password fill kiya:', password);

  await page.waitForTimeout(1500);

  // Sign up button click
  await page.click('button[style*="view-transition-name: submit"]');
  console.log('[STEP 2] Sign up button click kiya — captcha solve ho raha hai...');

  // Captcha solve hone tak wait
  await page.waitForTimeout(15000);

  const afterUrl = page.url();
  console.log('[STEP 2] Signup ke baad URL:', afterUrl);

  // STEP 3 — Verification email
  console.log('\n[STEP 3] Verification email ka wait kar raha hun...');
  const emailMsg = await waitForVerificationEmail(mailToken);

  // STEP 4 — Verify link nikalo
  console.log('\n[STEP 4] Verify link dhundh raha hun...');
  const htmlBody = emailMsg.html?.[0] || emailMsg.text || '';
  const match = htmlBody.match(/href="(https:\/\/[^"]*mode=verifyEmail[^"]*)"/i)
    || htmlBody.match(/(https:\/\/[^\s<>"]*mode=verifyEmail[^\s<>"]*)/i);
  if (!match) throw new Error('Verify link nahi mila email mein');
  const verifyHref = match[1].replace(/&amp;/g, '&');
  console.log('[STEP 4] Verify link mila');

  // STEP 5 — Verify link open karo
  console.log('\n[STEP 5] Verify link visit kar raha hun...');
  const verifyPage = await context.newPage();
  await verifyPage.goto(verifyHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await verifyPage.waitForTimeout(5000);
  console.log('[STEP 5] URL:', verifyPage.url());

  // Agar sign-in page aaye
  if (verifyPage.url().includes('sign-in')) {
    console.log('[STEP 5] Sign-in page aaya, login kar raha hun...');
    await verifyPage.waitForSelector('[data-testid="sign-in-email-input"]', { timeout: 15000 });
    await verifyPage.type('[data-testid="sign-in-email-input"]', tempEmail, { delay: 60 });
    await verifyPage.type('[data-testid="sign-in-password-input"]', password, { delay: 60 });
    await verifyPage.click('[data-testid="sign-in-submit-button"]');
    await verifyPage.waitForTimeout(8000);
    console.log('[STEP 5] Login ke baad URL:', verifyPage.url());
  }

  // Onboarding tak wait karo
  await verifyPage.waitForURL('**/onboarding**', { timeout: 25000 }).catch(() => {
    console.log('[STEP 5] Onboarding nahi aaya, URL:', verifyPage.url());
  });

  // STEP 6 — Session extract karo
  console.log('\n[STEP 6] Session data extract kar raha hun...');
  const cookies = await context.cookies();
  console.log('[STEP 6] Cookies:', cookies.length);

  const storageData = await verifyPage.evaluate(() => {
    const s = {}, l = {};
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); s[k] = sessionStorage.getItem(k); }
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); l[k] = localStorage.getItem(k); }
    return { sessionStorage: s, localStorage: l };
  });
  console.log('[STEP 6] localStorage keys:', Object.keys(storageData.localStorage).length);

  // STEP 7 — API call
  console.log('\n[STEP 7] API hit kar raha hun...');
  try {
    const result = await postData(API_URL, {
      email: tempEmail,
      cookies,
      sessionStorage: storageData.sessionStorage,
      localStorage: storageData.localStorage,
      timestamp: new Date().toISOString(),
    }, API_SECRET);
    console.log('[STEP 7] Status:', result.status);
    console.log('[STEP 7] Body:', result.body);
  } catch (err) {
    console.error('[STEP 7] API Error:', err.message);
  }

  console.log('\n✅ DONE! Email:', tempEmail, '| Password:', password);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
