// ─── Config ───────────────────────────────
let SERVER_URL = '';
let currentTask = null;
let signupTabId = null;
let verifyTabId = null;
let pollInterval = null;

// Storage se config lo
async function loadConfig() {
  const data = await chrome.storage.local.get(['serverUrl', 'currentTask', 'signupTabId', 'verifyTabId']);
  SERVER_URL = data.serverUrl || '';
  currentTask = data.currentTask || null;
  signupTabId = data.signupTabId || null;
  verifyTabId = data.verifyTabId || null;
}

async function saveState() {
  await chrome.storage.local.set({
    currentTask,
    signupTabId,
    verifyTabId,
  });
}

// ─── Startup ──────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[BG] Extension installed');
  await chrome.alarms.create('poll', { periodInMinutes: 0.2 }); // har 12 sec
});

chrome.runtime.onStartup.addListener(async () => {
  await loadConfig();
  await chrome.alarms.create('poll', { periodInMinutes: 0.2 });
});

// ─── Main Poll Loop ───────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'poll') return;
  await loadConfig();
  if (!SERVER_URL) return; // Server URL set nahi hua

  // Agar koi task chal raha hai toh naya mat lo
  if (currentTask) {
    console.log('[BG] Task chal raha hai:', currentTask.id, '| Status:', currentTask.status);
    return;
  }

  // Server se naya task lo
  try {
    const res = await fetch(`${SERVER_URL}/task/next`);
    const data = await res.json();

    if (data.task) {
      currentTask = { ...data.task, status: 'assigned' };
      await saveState();
      console.log('[BG] Naya task mila:', currentTask.id, '| Email:', currentTask.email);
      await openSignupPage();
    }
  } catch (e) {
    console.error('[BG] Server poll error:', e.message);
  }
});

// ─── Signup Page Open ─────────────────────
async function openSignupPage() {
  console.log('[BG] ElevenLabs signup page khol raha hun...');
  const tab = await chrome.tabs.create({
    url: 'https://elevenlabs.io/app/sign-up',
    active: true,
  });
  signupTabId = tab.id;
  await saveState();

  // Tab load hone ka wait, phir content script ko task bhejo
  chrome.tabs.onUpdated.addListener(async function listener(tabId, changeInfo) {
    if (tabId !== signupTabId || changeInfo.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);

    // Thoda wait karo — page settle ho jaye
    await new Promise(r => setTimeout(r, 2000));

    console.log('[BG] Signup tab load hua, task bhej raha hun...');
    try {
      await chrome.tabs.sendMessage(signupTabId, {
        type: 'START_SIGNUP',
        task: currentTask,
      });
    } catch (e) {
      console.error('[BG] Content script message error:', e.message);
    }
  });
}

// ─── Verify Link Polling ──────────────────
async function pollForVerifyLink() {
  if (!currentTask) return;

  for (let i = 0; i < 36; i++) { // max 3 min
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await fetch(`${SERVER_URL}/task/${currentTask.id}/verify-link`);
      const data = await res.json();

      if (data.error) {
        console.error('[BG] Verify link error:', data.error);
        currentTask = null;
        await saveState();
        return;
      }

      if (data.verifyLink) {
        console.log('[BG] Verify link mila! Tab khol raha hun...');
        await openVerifyLink(data.verifyLink);
        return;
      }
      console.log('[BG] Verify link abhi nahi aaya...', (i + 1) * 5, 's');
    } catch (e) {
      console.error('[BG] Verify link poll error:', e.message);
    }
  }

  console.error('[BG] Verify link timeout');
  currentTask = null;
  await saveState();
}

// ─── Verify Link Tab Open ─────────────────
async function openVerifyLink(verifyLink) {
  // Signup tab close karo
  if (signupTabId) {
    try { await chrome.tabs.remove(signupTabId); } catch (e) {}
    signupTabId = null;
  }

  const tab = await chrome.tabs.create({ url: verifyLink, active: true });
  verifyTabId = tab.id;
  await saveState();
  console.log('[BG] Verify tab opened:', tab.id);

  // Tab load hone ka wait
  chrome.tabs.onUpdated.addListener(async function listener(tabId, changeInfo, tabInfo) {
    if (tabId !== verifyTabId || changeInfo.status !== 'complete') return;

    const url = tabInfo.url || '';

    // Sign-in page aaye toh login karo
    if (url.includes('sign-in')) {
      chrome.tabs.onUpdated.removeListener(listener);
      await new Promise(r => setTimeout(r, 2000));
      console.log('[BG] Sign-in page aaya, login kar raha hun...');
      try {
        await chrome.tabs.sendMessage(verifyTabId, {
          type: 'DO_SIGNIN',
          email: currentTask.email,
          password: currentTask.password,
        });
      } catch (e) {
        console.error('[BG] Sign-in message error:', e.message);
      }
    }

    // Onboarding ya app page aaye toh session extract karo
    if (url.includes('onboarding') || (url.includes('elevenlabs.io/app') && !url.includes('sign'))) {
      chrome.tabs.onUpdated.removeListener(listener);
      await new Promise(r => setTimeout(r, 3000));
      console.log('[BG] App page aaya, session extract kar raha hun...');
      try {
        await chrome.tabs.sendMessage(verifyTabId, { type: 'EXTRACT_SESSION' });
      } catch (e) {
        console.error('[BG] Extract session message error:', e.message);
        // Retry after 2 sec
        await new Promise(r => setTimeout(r, 2000));
        try { await chrome.tabs.sendMessage(verifyTabId, { type: 'EXTRACT_SESSION' }); } catch (e2) {}
      }
    }
  });
}

// ─── Messages from Content Scripts ────────
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  console.log('[BG] Message:', msg.type);

  if (msg.type === 'FORM_SUBMITTED') {
    console.log('[BG] Form submit hua, server ko bata raha hun...');
    currentTask.status = 'submitted';
    await saveState();
    try {
      await fetch(`${SERVER_URL}/task/${currentTask.id}/submitted`, { method: 'POST' });
    } catch (e) {
      console.error('[BG] Submitted notify error:', e.message);
    }
    pollForVerifyLink(); // async
  }

  if (msg.type === 'SESSION_DATA') {
    console.log('[BG] Session data mila, server ko bhej raha hun...');
    const cookies = await chrome.cookies.getAll({ domain: '.elevenlabs.io' });
    const payload = {
      cookies,
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
      console.error('[BG] Complete send error:', e.message);
    }

    // Cleanup
    if (verifyTabId) {
      try { await chrome.tabs.remove(verifyTabId); } catch (e) {}
    }
    currentTask = null;
    signupTabId = null;
    verifyTabId = null;
    await saveState();
  }

  if (msg.type === 'SIGNUP_ERROR') {
    console.error('[BG] Signup error:', msg.error);
    currentTask = null;
    signupTabId = null;
    await saveState();
  }
});
