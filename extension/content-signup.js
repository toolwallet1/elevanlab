// ElevenLabs sign-up page content script
console.log('[CONTENT-SIGNUP] Loaded');

// Background se message aane ka wait karo
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type !== 'START_SIGNUP') return;

  const { email, password } = msg.task;
  console.log('[CONTENT-SIGNUP] Task mila:', email);

  try {
    await doSignup(email, password);
  } catch (e) {
    console.error('[CONTENT-SIGNUP] Error:', e.message);
    chrome.runtime.sendMessage({ type: 'SIGNUP_ERROR', error: e.message });
  }
});

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function doSignup(email, password) {
  // Cookie banner dismiss karo — 5 baar retry
  for (let i = 0; i < 5; i++) {
    await wait(1000);
    try {
      const btns = [...document.querySelectorAll('button')];
      const cookieBtn = btns.find(b => {
        const t = b.innerText.trim().toUpperCase();
        return t.includes('REJECT') || t.includes('ACCEPT');
      });
      if (cookieBtn) {
        cookieBtn.click();
        console.log('[CONTENT-SIGNUP] Cookie banner dismiss kiya');
        await wait(1000);
        break;
      }
    } catch (e) {}
  }

  // Email field
  const emailInput = document.querySelector('[data-testid="sign-up-email-input"]');
  if (!emailInput) throw new Error('Email input nahi mila');

  emailInput.focus();
  await wait(300);
  for (const char of email) {
    emailInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    emailInput.value += char;
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await wait(60 + Math.random() * 40);
  }
  console.log('[CONTENT-SIGNUP] Email fill kiya');
  await wait(800);

  // Password field
  const pwdInput = document.querySelector('[data-testid="sign-up-password-input"]');
  if (!pwdInput) throw new Error('Password input nahi mila');

  pwdInput.focus();
  await wait(300);
  for (const char of password) {
    pwdInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    pwdInput.value += char;
    pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwdInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await wait(60 + Math.random() * 40);
  }
  console.log('[CONTENT-SIGNUP] Password fill kiya');
  await wait(1500);

  // Submit button
  const submitBtn = document.querySelector('button[style*="view-transition-name: submit"]')
    || [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Sign up');

  if (!submitBtn) throw new Error('Submit button nahi mila');

  submitBtn.click();
  console.log('[CONTENT-SIGNUP] Submit click kiya — captcha solve ho raha hai...');

  // Captcha solve hone ka wait (15 sec)
  await wait(15000);

  // Background ko batao
  chrome.runtime.sendMessage({ type: 'FORM_SUBMITTED' });
  console.log('[CONTENT-SIGNUP] Background ko notify kiya');
}
