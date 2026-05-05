const serverUrlInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');

// Saved config load karo
chrome.storage.local.get(['serverUrl', 'currentTask'], (data) => {
  if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  if (data.currentTask) {
    statusDiv.innerHTML = `<b>Task chal raha hai:</b><br>Email: ${data.currentTask.email}<br>Status: ${data.currentTask.status}`;
  } else {
    statusDiv.textContent = 'Koi task nahi — server se next task aane ka wait kar raha hun...';
  }
});

saveBtn.addEventListener('click', async () => {
  const url = serverUrlInput.value.trim().replace(/\/$/, '');
  if (!url) return alert('Server URL daalo!');

  await chrome.storage.local.set({ serverUrl: url });
  statusDiv.innerHTML = '<span class="saved">✅ Saved! Extension server se connect ho gaya.</span>';

  // Alarm set karo agar nahi hai
  chrome.alarms.create('poll', { periodInMinutes: 0.2 });
});
