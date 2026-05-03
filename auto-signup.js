const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ============================================
// Local ke liye: niche hardcode karo
// GitHub Actions ke liye: Secrets mein add karo
// ============================================
const SITE1_URL  = process.env.SITE1_URL  || 'https://temp-mail.org/en/';
const SITE2_URL  = process.env.SITE2_URL  || 'https://elevenlabs.io/app/sign-up';
const SIGNIN_URL = 'https://elevenlabs.io/app/sign-in';
const API_URL    = process.env.API_URL    || 'https://localhost:8080/api/admin/public/cookies/sync';
const API_SECRET = process.env.API_SECRET || 'TV-Sync-$3cr3t-K3y-2024-cookies!';
// ============================================

// POST helper (supports http + https with self-signed cert)
function postData(url, payload, secret) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      rejectUnauthorized: false,   // allow self-signed localhost cert
      headers: {
        'Content-Type': 'application/json',
        'Authorization': secret,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  // CI (GitHub Actions) mein headless:true, local mein headless:false
  const isCI = process.env.CI === 'true';
  const browser = await chromium.launch({ headless: isCI });
  const context = await browser.newContext();

  // ─────────────────────────────────────────
  // STEP 1 — Tab 1: Temp Mail open karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 1] Tab 1 open kar raha hun — Temp Mail');
  const tab1 = await context.newPage();
  await tab1.goto(SITE1_URL, { waitUntil: 'domcontentloaded' });

  console.log('[STEP 1] Email load hone ka wait kar raha hun...');
  await tab1.waitForSelector('input#mail', { timeout: 30000 });

  // Jab tak value "Loading" na hata ho aur valid email na aaye
  await tab1.waitForFunction(() => {
    const el = document.querySelector('input#mail');
    return el && el.value && el.value !== 'Loading' && el.value.includes('@');
  }, { timeout: 40000 });

  const tempEmail = await tab1.$eval('input#mail', el => el.value);
  console.log('[STEP 1] Temp email mila:', tempEmail);

  // ─────────────────────────────────────────
  // STEP 2 — Tab 2: ElevenLabs Signup
  // ─────────────────────────────────────────
  console.log('\n[STEP 2] Tab 2 open kar raha hun — ElevenLabs Signup');
  const tab2 = await context.newPage();
  await tab2.goto(SITE2_URL, { waitUntil: 'domcontentloaded' });

  await tab2.waitForSelector('[data-testid="sign-up-email-input"]', { timeout: 15000 });

  await tab2.fill('[data-testid="sign-up-email-input"]', tempEmail);
  console.log('[STEP 2] Email fill kiya:', tempEmail);

  await tab2.fill('[data-testid="sign-up-password-input"]', tempEmail);
  console.log('[STEP 2] Password fill kiya (same as email)');

  await tab2.click('button[style*="view-transition-name: submit"]');
  console.log('[STEP 2] Sign up button click kiya');

  // ─────────────────────────────────────────
  // STEP 3 — Tab 1: Verification email aane ka wait
  // ─────────────────────────────────────────
  console.log('\n[STEP 3] Tab 1 par wapas ja raha hun — email aane ka wait...');
  await tab1.bringToFront();

  // ElevenLabs ka email inbox mein dhundo (max 60 sec wait)
  let emailLink = null;
  const maxWait = 60000;
  const interval = 5000;
  let waited = 0;

  while (waited < maxWait) {
    await tab1.waitForTimeout(interval);
    waited += interval;

    emailLink = await tab1.$('a.viewLink[href*="elevenlabs"], a.viewLink[href*="temp-mail"]');

    // Sender name se bhi check karo
    const senderFound = await tab1.$$eval('span.inboxSenderName', spans =>
      spans.some(s => s.textContent.toLowerCase().includes('elevenlabs'))
    );

    if (senderFound) {
      console.log('[STEP 3] ElevenLabs email mila! (' + waited / 1000 + 's mein)');
      break;
    }

    console.log('[STEP 3] Email abhi nahi aaya, wait kar raha hun... (' + waited / 1000 + 's)');

    // Page refresh karke check karo agar auto-refresh nahi hai
    if (waited % 15000 === 0) {
      await tab1.reload({ waitUntil: 'domcontentloaded' });
    }
  }

  // ElevenLabs email wali li dhundo aur click karo
  const emailRow = await tab1.$('li:has(span.inboxSenderName)');
  if (!emailRow) throw new Error('ElevenLabs email inbox mein nahi mila!');

  const viewLink = await emailRow.$('a.viewLink');
  if (!viewLink) throw new Error('viewLink nahi mila email row mein!');

  await viewLink.click();
  console.log('[STEP 3] Email open kiya');

  // ─────────────────────────────────────────
  // STEP 4 — Email body mein "Verify email" link click karo
  // ─────────────────────────────────────────
  console.log('\n[STEP 4] "Verify email" link dhundh raha hun...');

  // Email content load hone ka wait
  await tab1.waitForTimeout(3000);

  // Main verify link — href mein mode=verifyEmail hona chahiye
  const verifyLink = await tab1.$('a[href*="mode=verifyEmail"]');
  if (!verifyLink) throw new Error('"Verify email" link nahi mila email body mein!');

  const verifyHref = await verifyLink.getAttribute('href');
  console.log('[STEP 4] Verify link mila:', verifyHref);

  // New tab mein khulega — handle karo
  const [verifyTab] = await Promise.all([
    context.waitForEvent('page'),
    verifyLink.click(),
  ]);

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

    await verifyTab.fill('[data-testid="sign-in-password-input"]', tempEmail);
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

  await browser.waitForEvent('close').catch(() => {});
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Script Error:', err);
  process.exit(1);
});
