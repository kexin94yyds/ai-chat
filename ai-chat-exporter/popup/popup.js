// Import storage functions
const storageScript = chrome.runtime.getURL('scripts/storage-manager.js');

// Helper: Download file
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Helper: Update status
function updateStatus(message, type = 'info') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = type; // success, error, info
}

// Export as Markdown
document.getElementById('exportMarkdownBtn').addEventListener('click', async () => {
  updateStatus('Exporting as Markdown...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.exportChatToMarkdown === 'function') {
          return window.exportChatToMarkdown();
        }
        return null;
      }
    });

    if (results && results[0].result) {
      const { filename, content, count } = results[0].result;
      downloadFile(filename, content, 'text/markdown');
      updateStatus(`✓ Exported ${count} messages to Markdown`, 'success');
    } else {
      updateStatus('Capture failed. Please refresh the page.', 'error');
    }
  } catch (error) {
    updateStatus('Error: ' + error.message, 'error');
    console.error(error);
  }
});

// Export as JSON
document.getElementById('exportJsonBtn').addEventListener('click', async () => {
  updateStatus('Exporting as JSON...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.exportChatToJSON === 'function') {
          return window.exportChatToJSON();
        }
        return null;
      }
    });

    if (results && results[0].result) {
      const { filename, content, data } = results[0].result;
      downloadFile(filename, content, 'application/json');
      updateStatus(`✓ Exported ${data.messageCount} messages to JSON`, 'success');
    } else {
      updateStatus('Capture failed. Please refresh the page.', 'error');
    }
  } catch (error) {
    updateStatus('Error: ' + error.message, 'error');
    console.error(error);
  }
});

// Save to History and Export
document.getElementById('saveAndExportBtn').addEventListener('click', async () => {
  updateStatus('Saving to history...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Extract conversation data
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.exportChatToMarkdown === 'function') {
          return window.exportChatToMarkdown();
        }
        return null;
      }
    });

    if (!results || !results[0].result) {
      updateStatus('Capture failed. Please refresh the page.', 'error');
      return;
    }

    const { filename, content, count, data } = results[0].result;

    // Inject and execute storage script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scripts/storage-manager.js']
    });

    // Check for duplicate
    const checkDuplicate = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (conversationId) => {
        if (typeof findDuplicate === 'function' && conversationId) {
          return await findDuplicate(conversationId);
        }
        return null;
      },
      args: [data.conversationId]
    });

    const duplicate = checkDuplicate[0].result;
    
    if (duplicate) {
      const shouldUpdate = confirm(
        `This conversation already exists in history:\n"${duplicate.title}"\n\nDo you want to update it?`
      );
      
      if (!shouldUpdate) {
        updateStatus('Save cancelled.', 'info');
        return;
      }
    }

    // Save to storage
    const saveResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (conversationData) => {
        if (typeof saveConversation === 'function') {
          const fullData = {
            ...conversationData,
            content: document.querySelector('.markdown, .prose, [class*="message"]')?.innerHTML || conversationData.content
          };
          return await saveConversation(fullData);
        }
        return null;
      },
      args: [data]
    });

    if (saveResult[0].result) {
      // Also download the file
      downloadFile(filename, content, 'text/markdown');
      updateStatus(`✓ Saved and exported ${count} messages`, 'success');
      
      // Update history count
      loadHistoryCount();
    } else {
      updateStatus('Failed to save to history.', 'error');
    }
  } catch (error) {
    updateStatus('Error: ' + error.message, 'error');
    console.error(error);
  }
});

// View History
document.getElementById('viewHistoryBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
});

// Load and display history count
async function loadHistoryCount() {
  try {
    const result = await chrome.storage.local.get('ai_chat_conversations');
    const conversations = result.ai_chat_conversations || [];
    const countElement = document.getElementById('historyCount');
    if (countElement) {
      countElement.textContent = conversations.length;
    }
  } catch (error) {
    console.error('Failed to load history count:', error);
  }
}

// Initialize
loadHistoryCount();
