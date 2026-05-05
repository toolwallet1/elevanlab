const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Sessions folder banao
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

// .env support
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

const API_URL       = process.env.API_URL       || '';
const API_SECRET    = process.env.API_SECRET    || '';
const PORT          = process.env.PORT          || 3000;
const SERVER_SECRET = process.env.SERVER_SECRET || 'elevan-secret-2024';

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS — extension se requests aane ke liye
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// In-memory task store
const tasks = new Map();
let taskQueue = [];

// ─── HTTP Helper ─────────────────────────
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
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── mail.tm ─────────────────────────────
async function createTempEmail() {
  const domainsRes = await httpRequest('GET', 'https://api.mail.tm/domains?page=1');
  const domainsJson = JSON.parse(domainsRes.body);
  const domain = domainsJson['hydra:member'][0].domain;
  const rand = Math.random().toString(36).substring(2, 10);
  const address = `${rand}@${domain}`;
  const mailPwd = rand + 'Aa1!';
  const createRes = await httpRequest('POST', 'https://api.mail.tm/accounts', { address, password: mailPwd });
  if (createRes.status !== 201) throw new Error('mail.tm create failed: ' + createRes.body);
  const tokenRes = await httpRequest('POST', 'https://api.mail.tm/token', { address, password: mailPwd });
  const tokenJson = JSON.parse(tokenRes.body);
  if (!tokenJson.token) throw new Error('mail.tm token failed');
  return { email: address, token: tokenJson.token };
}

// ─── Verification email polling ───────────
async function pollVerificationEmail(task) {
  const maxWait = 180000;
  const interval = 5000;
  let waited = 0;
  console.log(`[Task ${task.id}] Verification email wait kar raha hun...`);

  while (waited < maxWait) {
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
    try {
      const res = await httpRequest('GET', 'https://api.mail.tm/messages?page=1', null, {
        Authorization: `Bearer ${task.mailToken}`,
      });
      const json = JSON.parse(res.body);
      const messages = json['hydra:member'] || [];
      const mail = messages.find(m =>
        m.from?.address?.includes('elevenlabs') ||
        m.subject?.toLowerCase().includes('verify') ||
        m.subject?.toLowerCase().includes('confirm')
      );

      if (mail) {
        const msgRes = await httpRequest('GET', `https://api.mail.tm/messages/${mail.id}`, null, {
          Authorization: `Bearer ${task.mailToken}`,
        });
        const emailMsg = JSON.parse(msgRes.body);
        const htmlBody = emailMsg.html?.[0] || emailMsg.text || '';
        const match = htmlBody.match(/href="(https:\/\/[^"]*mode=verifyEmail[^"]*)"/i)
          || htmlBody.match(/(https:\/\/[^\s<>"]*mode=verifyEmail[^\s<>"]*)/i);

        if (match) {
          task.verifyLink = match[1].replace(/&amp;/g, '&');
          task.status = 'verifying';
          console.log(`[Task ${task.id}] ✅ Verify link mila!`);
          return;
        }
      }
      console.log(`[Task ${task.id}] Email abhi nahi aaya (${waited / 1000}s)`);
    } catch (e) {
      console.error('[mail.tm error]', e.message);
    }
  }

  task.status = 'failed';
  task.error = 'Verification email timeout';
  console.log(`[Task ${task.id}] ❌ Email timeout`);
}

// ─── Task create ──────────────────────────
async function createTask(customId = null) {
  console.log('\n[SERVER] Naya task bana raha hun...');
  const { email, token } = await createTempEmail();
  const password = 'Pass@' + Math.floor(Math.random() * 9000 + 1000);
  const taskId = Date.now().toString();

  tasks.set(taskId, {
    id: taskId,
    customId,           // BE ka ID — wapas bheja jayega
    email,
    password,
    mailToken: token,
    status: 'pending',
    verifyLink: null,
    createdAt: new Date().toISOString(),
  });

  taskQueue.push(taskId);
  console.log(`[SERVER] Task ready → ${taskId} | ${email}`);
  return taskId;
}

// ─── Routes ──────────────────────────────

// Extension: next task lo
app.get('/task/next', (req, res) => {
  const taskId = taskQueue.shift();
  if (!taskId) return res.json({ task: null });
  const task = tasks.get(taskId);
  task.status = 'assigned';
  console.log(`[Task ${taskId}] Extension ne pick kiya`);
  res.json({ task: { id: task.id, email: task.email, password: task.password } });
});

// Extension: form submit ho gaya
app.post('/task/:id/submitted', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.status = 'submitted';
  console.log(`[Task ${req.params.id}] Form submit hua`);
  res.json({ ok: true });
  pollVerificationEmail(task); // async - background mein chalta hai
});

// Extension: verify link lo
app.get('/task/:id/verify-link', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'failed') return res.json({ error: task.error });
  res.json({ verifyLink: task.verifyLink || null });
});

// Extension: task complete — cookies + storage bhejo
app.post('/task/:id/complete', async (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.status = 'complete';
  task.completedAt = new Date().toISOString();
  task.result = req.body;
  res.json({ ok: true });

  // Session file save karo
  const sessionFile = path.join(SESSIONS_DIR, `session-${task.id}.json`);
  fs.writeFileSync(sessionFile, JSON.stringify({
    taskId: task.id,
    customId: task.customId,
    email: task.email,
    password: task.password,
    completedAt: task.completedAt,
    ...req.body,
  }, null, 2));
  console.log(`[Task ${req.params.id}] Session file saved: ${sessionFile}`);

  console.log(`[Task ${req.params.id}] ✅ Complete! Cookies: ${req.body.cookies?.length}`);

  if (API_URL) {
    try {
      const result = await httpRequest('POST', API_URL, {
        customId: task.customId,   // BE ka ID wapas
        email: task.email,
        ...req.body,
        timestamp: new Date().toISOString(),
      }, { 'Authorization': API_SECRET, 'Content-Type': 'application/json' });
      console.log(`[Task ${req.params.id}] Final API: ${result.status}`);
    } catch (e) {
      console.error(`[Task ${req.params.id}] Final API Error:`, e.message);
    }
  }
});

// Manual trigger — BE se customId pass karo
app.post('/trigger', async (req, res) => {
  const secret = req.headers['x-secret'] || req.query.secret;
  if (secret !== SERVER_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const customId = req.body?.customId || null; // BE ka apna ID
    const taskId = await createTask(customId);
    res.json({ ok: true, taskId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// BE polls this — task ka result lo
app.get('/task/:id/result', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.status === 'complete') {
    return res.json({
      ready: true,
      email: task.email,
      password: task.password,
      data: task.result,
    });
  }

  if (task.status === 'failed') {
    return res.json({ ready: false, error: task.error });
  }

  res.json({ ready: false, status: task.status });
});

// Stuck tasks cleanup — assigned mein 10 min se zyada = pending mein wapas
app.post('/cleanup', (req, res) => {
  const secret = req.headers['x-secret'] || req.query.secret;
  if (secret !== SERVER_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  let count = 0;
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (task.status === 'assigned' && (now - new Date(task.createdAt).getTime()) > 10 * 60 * 1000) {
      task.status = 'pending';
      taskQueue.unshift(id); // queue ke aage daalo
      count++;
    }
  }
  console.log(`[SERVER] Cleanup: ${count} stuck tasks reset`);
  res.json({ ok: true, reset: count });
});

// Status check
app.get('/status', (req, res) => {
  const allTasks = [...tasks.values()].map(t => ({
    id: t.id, email: t.email, status: t.status,
    createdAt: t.createdAt, completedAt: t.completedAt || null,
  }));
  res.json({ queue: taskQueue.length, total: tasks.size, tasks: allTasks });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📋 Status: http://YOUR-AWS-IP:${PORT}/status`);
  console.log(`🔑 Secret: ${SERVER_SECRET}`);
});
