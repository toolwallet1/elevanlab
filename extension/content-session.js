console.log('[CONTENT-SESSION] Loaded:', window.location.href);

// ─── Auto detect page type ────────────────
(async () => {
  const url = window.location.href;

  // Onboarding page — seedha session extract karo (no message needed)
  if (url.includes('onboarding') || url.includes('/app/') && !url.includes('sign')) {
    await sleep(3000);
    console.log('[CONTENT-SESSION] Onboarding/App page — auto session extract');
    extractAndSend();
    return;
  }

  // Sign-in page — popup handle karo phir wait for message
  if (url.includes('sign-in') || url.includes('sign-up')) {
    await handlePopups();
  }
})();

// ─── Message listener ─────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'DO_SIGNIN') {
    await handlePopups(); // pehle popups clear karo
    await doSignin(msg.email, msg.password);
  }
  if (msg.type === 'EXTRACT_SESSION') {
    extractAndSend();
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Popup handler — poll karo 15 sec tak ─
async function handlePopups() {
  for (let i = 0; i < 30; i++) {
    await sleep(500);

    // Cookiebot banner
    const cookieBtn = document.getElementById('CybotCookiebotDialogBodyButtonAccept');
    if (cookieBtn && cookieBtn.offsetParent !== null) {
      cookieBtn.click();
      console.log('[CONTENT-SESSION] Cookie banner dismiss kiya');
      await sleep(800);
      continue;
    }

    // Email Verification "Continue" popup
    const btns = [...document.querySelectorAll('button')];
    const continueBtn = btns.find(b =>
      b.offsetParent !== null && b.innerText.trim() === 'Continue'
    );
    if (continueBtn) {
      console.log('[CONTENT-SESSION] Email Verification Continue click kiya');
      continueBtn.click();
      await sleep(1500);
      return; // popup handled
    }
  }
}

// ─── Sign In ──────────────────────────────
async function doSignin(email, password) {
  console.log('[CONTENT-SESSION] Sign-in kar raha hun...');
  await sleep(1000);

  const emailInput = document.querySelector('[data-testid="sign-in-email-input"]');
  const pwdInput   = document.querySelector('[data-testid="sign-in-password-input"]');

  if (!emailInput || !pwdInput) {
    console.error('[CONTENT-SESSION] Sign-in inputs nahi mile');
    return;
  }

  emailInput.focus();
  emailInput.value = '';
  for (const char of email) {
    emailInput.value += char;
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(40);
  }
  await sleep(400);

  pwdInput.focus();
  pwdInput.value = '';
  for (const char of password) {
    pwdInput.value += char;
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(40);
  }
  await sleep(600);

  const submitBtn = document.querySelector('[data-testid="sign-in-submit-button"]')
    || [...document.querySelectorAll('button')].find(b =>
        b.innerText.includes('Sign in') || b.innerText.includes('Continue'));

  if (submitBtn) {
    submitBtn.click();
    console.log('[CONTENT-SESSION] Sign-in submit kiya');
  }
}

// ─── Session Extract ──────────────────────
function extractAndSend() {
  const local = {}, session = {};

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    local[k] = localStorage.getItem(k);
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    session[k] = sessionStorage.getItem(k);
  }

  console.log('[CONTENT-SESSION] Session extract kiya — localStorage:', Object.keys(local).length, '| sessionStorage:', Object.keys(session).length);

  chrome.runtime.sendMessage({
    type: 'SESSION_DATA',
    localStorage: local,
    sessionStorage: session,
    url: window.location.href,
  });
}
