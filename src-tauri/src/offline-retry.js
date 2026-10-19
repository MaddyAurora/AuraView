// The native navigation handler intercepts this request before it loads a page.
const nativeRetryUrl = 'https://auraview.invalid/retry-local-server';
const retryDelay = 10000;
let retryTimer;
let countdownTimer;
let requestTimeout;
let isChecking = false;
let stopped = false;

function setStatus(text) {
  const status = document.getElementById('status-text');
  if (status) status.innerText = text;
}

function scheduleRetry() {
  if (stopped) return;
  const retryAt = Date.now() + retryDelay;
  function updateCountdown() {
    const remaining = retryAt - Date.now();
    if (remaining <= 0) return;
    const seconds = Math.ceil(remaining / 1000);
    setStatus(`Server offline. Checking again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}...`);
    countdownTimer = setTimeout(updateCountdown, Math.min(1000, remaining));
  }
  retryTimer = setTimeout(checkServer, retryDelay);
  updateCountdown();
}

function checkServer() {
  if (stopped || isChecking) return;
  clearTimeout(retryTimer);
  clearTimeout(countdownTimer);
  setStatus('Checking server...');
  isChecking = true;
  requestTimeout = setTimeout(() => window.onNativeRetryResult(false), 2000);
  try {
    window.location.assign(nativeRetryUrl);
  } catch {
    window.onNativeRetryResult(false);
  }
}

window.onNativeRetryResult = (online) => {
  if (stopped || !isChecking) return;
  clearTimeout(requestTimeout);
  isChecking = false;
  if (online) {
    stopped = true;
    setStatus('Server online. Connecting...');
  } else {
    scheduleRetry();
  }
};

function retryNow() {
  return checkServer();
}

window.addEventListener('pagehide', () => {
  stopped = true;
  clearTimeout(retryTimer);
  clearTimeout(countdownTimer);
  clearTimeout(requestTimeout);
});

scheduleRetry();
