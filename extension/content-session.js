// ElevenLabs session extract + sign-in content script
console.log('[CONTENT-SESSION] Loaded on:', window.location.href);

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'DO_SIGNIN') {
    await doSignin(msg.email, msg.password);
  }
  if (msg.type === 'EXTRACT_SESSION') {
    extractAndSend();
  }
});

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function doSignin(email, password) {
  console.log('[CONTENT-SESSION] Sign-in kar raha hun...');
  await wait(1500);

  const emailInput = document.querySelector('[data-testid="sign-in-email-input"]');
  const pwdInput   = document.querySelector('[data-testid="sign-in-password-input"]');

  if (!emailInput || !pwdInput) {
    console.error('[CONTENT-SESSION] Sign-in inputs nahi mile');
    return;
  }

  // Email fill
  emailInput.focus();
  emailInput.value = '';
  for (const char of email) {
    emailInput.value += char;
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50);
  }

  await wait(500);

  // Password fill
  pwdInput.focus();
  pwdInput.value = '';
  for (const char of password) {
    pwdInput.value += char;
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50);
  }

  await wait(800);

  const submitBtn = document.querySelector('[data-testid="sign-in-submit-button"]')
    || [...document.querySelectorAll('button')].find(b => b.innerText.includes('Sign in') || b.innerText.includes('Continue'));

  if (submitBtn) {
    submitBtn.click();
    console.log('[CONTENT-SESSION] Sign-in submit click kiya');
  }
}

function extractAndSend() {
  console.log('[CONTENT-SESSION] Session extract kar raha hun...');

  const local = {};
  const session = {};

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    local[k] = localStorage.getItem(k);
  }

  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    session[k] = sessionStorage.getItem(k);
  }

  console.log('[CONTENT-SESSION] localStorage keys:', Object.keys(local).length);
  console.log('[CONTENT-SESSION] sessionStorage keys:', Object.keys(session).length);

  chrome.runtime.sendMessage({
    type: 'SESSION_DATA',
    localStorage: local,
    sessionStorage: session,
    url: window.location.href,
  });
}
