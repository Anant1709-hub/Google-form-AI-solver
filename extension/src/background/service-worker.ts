console.log('[Form Solver] Service worker initialized');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'SOLVE_FORM') {
    return;
  }

  console.log(
    '[Form Solver] Received form from content script########################################',
  );

  const url = 'http://localhost:8000/solve';

  console.log('[Service Worker] Calling:', url);
  console.log('[Service Worker] Body:', message.formData);

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message.formData),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    })
    .then((data) => {
      console.log('[Form Solver] Server response:', data);
      sendResponse(data);
    })
    .catch((error) => {
      console.error('[Form Solver] LLM request failed:', error);

      sendResponse({
        error: error.message,
      });
    });

  return true;
});
