// ─── Config ───────────────────────────────
let SERVER_URL = '';
let currentTask = null;
let signupTabId = null;
let signupWinId = null;
let verifyTabId = null;
let verifyWinId = null;

async function loadConfig() {
  const data = await chrome.storage.local.get(['serverUrl', 'currentTask', 'signupTabId', 'signupWinId', 'verifyTabId', 'verifyWinId']);
  SERVER_URL   = data.serverUrl   || '';
  currentTask  = data.currentTask || null;
  signupTabId  = data.signupTabId || null;
  signupWinId  = data.signupWinId || null;
  verifyTabId  = data.verifyTabId || null;
  verifyWinId  = data.verifyWinId || null;
}

async function saveState() {
  await chrome.storage.local.set({ currentTask, signupTabId, signupWinId, verifyTabId, verifyWinId });
}

// ─── Startup ──────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create('poll', { periodInMinutes: 0.2 });
});

chrome.runtime.onStartup.addListener(async () => {
  await loadConfig();
  await chrome.alarms.create('poll', { periodInMinutes: 0.2 });
});

// ─── Poll Loop ────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'poll') return;
  await loadConfig();
  if (!SERVER_URL) return;
  if (currentTask) return; // Task chal raha hai

  try {
    const res = await fetch(`${SERVER_URL}/task/next`);
    const data = await res.json();
    if (data.task) {
      currentTask = { ...data.task, status: 'assigned' };
      await saveState();
      console.log('[BG] Task mila:', currentTask.id, currentTask.email);
      await clearElevenLabsData();
      await openSignupPage();
    }
  } catch (e) {
    console.error('[BG] Poll error:', e.message);
  }
});

// ─── ElevenLabs Data Clear ────────────────
async function clearElevenLabsData() {
  console.log('[BG] ElevenLabs cookies clear kar raha hun...');
  const cookies = await chrome.cookies.getAll({ domain: '.elevenlabs.io' });
  for (const c of cookies) {
    const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
    await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
  }
  // elevenlabs.io cookies bhi
  const cookies2 = await chrome.cookies.getAll({ domain: 'elevenlabs.io' });
  for (const c of cookies2) {
    await chrome.cookies.remove({ url: `https://elevenlabs.io${c.path}`, name: c.name }).catch(() => {});
  }
  console.log(`[BG] ${cookies.length + cookies2.length} cookies clear kiye`);
}

// ─── Signup Window Open (Incognito) ───────
async function openSignupPage() {
  console.log('[BG] Incognito window mein signup page khol raha hun...');

  let win;
  try {
    win = await chrome.windows.create({
      url: 'https://elevenlabs.io/app/sign-up',
      incognito: true,
      focused: true,
      width: 1280,
      height: 800,
    });
  } catch (e) {
    // Incognito allowed nahi — normal window fallback
    console.warn('[BG] Incognito nahi mila, normal window use kar raha hun');
    win = await chrome.windows.create({
      url: 'https://elevenlabs.io/app/sign-up',
      focused: true,
      width: 1280,
      height: 800,
    });
  }

  signupWinId = win.id;
  signupTabId = win.tabs[0].id;
  await saveState();

  // Tab load hone ka wait phir message bhejo
  chrome.tabs.onUpdated.addListener(async function listener(tabId, changeInfo) {
    if (tabId !== signupTabId || changeInfo.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    await new Promise(r => setTimeout(r, 2500));
    console.log('[BG] Signup tab ready, task bhej raha hun...');
    try {
      await chrome.tabs.sendMessage(signupTabId, { type: 'START_SIGNUP', task: currentTask });
    } catch (e) {
      console.error('[BG] Message error:', e.message);
    }
  });
}

// ─── Verify Link Polling ──────────────────
async function pollForVerifyLink() {
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res  = await fetch(`${SERVER_URL}/task/${currentTask.id}/verify-link`);
      const data = await res.json();
      if (data.error) {
        console.error('[BG] Verify error:', data.error);
        await resetTask();
        return;
      }
      if (data.verifyLink) {
        console.log('[BG] Verify link mila!');
        await openVerifyLink(data.verifyLink);
        return;
      }
      console.log('[BG] Verify link abhi nahi...', (i + 1) * 5, 's');
    } catch (e) {
      console.error('[BG] Verify poll error:', e.message);
    }
  }
  console.error('[BG] Verify link timeout');
  await resetTask();
}

// ─── Verify Link Window ───────────────────
async function openVerifyLink(verifyLink) {
  // Signup window close karo
  if (signupWinId) {
    try { await chrome.windows.remove(signupWinId); } catch (e) {}
    signupWinId = null; signupTabId = null;
  }

  let win;
  try {
    win = await chrome.windows.create({
      url: verifyLink,
      incognito: true,
      focused: true,
      width: 1280,
      height: 800,
    });
  } catch (e) {
    win = await chrome.windows.create({ url: verifyLink, focused: true, width: 1280, height: 800 });
  }

  verifyWinId = win.id;
  verifyTabId = win.tabs[0].id;
  await saveState();
  console.log('[BG] Verify tab opened:', verifyTabId);

  chrome.tabs.onUpdated.addListener(async function listener(tabId, changeInfo, tabInfo) {
    if (tabId !== verifyTabId || changeInfo.status !== 'complete') return;
    const url = tabInfo.url || '';
    console.log('[BG] Verify tab URL:', url);

    // Sign-in page
    if (url.includes('sign-in')) {
      chrome.tabs.onUpdated.removeListener(listener);
      await new Promise(r => setTimeout(r, 2000));
      try {
        await chrome.tabs.sendMessage(verifyTabId, {
          type: 'DO_SIGNIN',
          email: currentTask.email,
          password: currentTask.password,
        });
      } catch (e) { console.error('[BG] Signin msg error:', e.message); }
    }

    // Onboarding / app page
    if (url.includes('onboarding') || (url.includes('elevenlabs.io/app') && !url.includes('sign'))) {
      chrome.tabs.onUpdated.removeListener(listener);
      await new Promise(r => setTimeout(r, 3000));
      try {
        await chrome.tabs.sendMessage(verifyTabId, { type: 'EXTRACT_SESSION' });
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
        try { await chrome.tabs.sendMessage(verifyTabId, { type: 'EXTRACT_SESSION' }); } catch (e2) {}
      }
    }
  });
}

// ─── Messages ────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {
  console.log('[BG] Message:', msg.type);

  if (msg.type === 'FORM_SUBMITTED') {
    currentTask.status = 'submitted';
    await saveState();
    try { await fetch(`${SERVER_URL}/task/${currentTask.id}/submitted`, { method: 'POST' }); } catch (e) {}
    pollForVerifyLink();
  }

  if (msg.type === 'SESSION_DATA') {
    console.log('[BG] Session data mila!');
    // Cookies — incognito cookies bhi lo
    const cookies = await chrome.cookies.getAll({ domain: '.elevenlabs.io' });
    const cookies2 = await chrome.cookies.getAll({ domain: 'elevenlabs.io' });
    const allCookies = [...cookies, ...cookies2];

    const payload = {
      cookies: allCookies,
      localStorage: msg.localStorage,
      sessionStorage: msg.sessionStorage,
      url: msg.url,
    };

    try {
      await fetch(`${SERVER_URL}/task/${currentTask.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('[BG] ✅ Task complete!');
    } catch (e) {
      console.error('[BG] Complete error:', e.message);
    }

    await resetTask();
  }

  if (msg.type === 'SIGNUP_ERROR') {
    console.error('[BG] Signup error:', msg.error);
    await resetTask();
  }
});

async function resetTask() {
  if (signupWinId) { try { await chrome.windows.remove(signupWinId); } catch (e) {} }
  if (verifyWinId) { try { await chrome.windows.remove(verifyWinId); } catch (e) {} }
  currentTask = null; signupTabId = null; signupWinId = null; verifyTabId = null; verifyWinId = null;
  await saveState();
}
