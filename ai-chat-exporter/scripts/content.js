(function() {
  'use strict';

  // ============================================================================
  // Robust Markdown Extraction (Recursive & Whitespace-Aware)
  // ============================================================================
  function extractMarkdownFromElement(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tagName = node.tagName.toLowerCase();
    
    // Filter noise
    if (node.classList.contains('sr-only') || node.hasAttribute('aria-hidden') || 
        ['script', 'style', 'nav', 'header', 'footer', 'button'].includes(tagName)) return '';

    // Code blocks (High Priority)
    if (tagName === 'pre') {
      const code = node.querySelector('code');
      const lang = code?.className.match(/language-(\w+)/)?.[1] || '';
      return `\n\`\`\`${lang}\n${(code || node).textContent}\n\`\`\`\n\n`;
    }

    // Inline
    if (tagName === 'code') return ` \`${node.textContent}\` `;
    if (tagName === 'strong' || tagName === 'b') return `**${getChildrenMarkdown(node)}**`;
    if (tagName === 'em' || tagName === 'i') return `*${getChildrenMarkdown(node)}*`;
    if (tagName === 'a') return `[${node.textContent.trim()}](${node.getAttribute('href') || ''})`;

    // Lists
    if (tagName === 'ul' || tagName === 'ol') {
      let result = '\n';
      Array.from(node.children).forEach((li, i) => {
        if (li.tagName.toLowerCase() === 'li') {
          const p = tagName === 'ol' ? `${i + 1}. ` : '- ';
          result += `${p}${extractMarkdownFromElement(li).trim()}\n`;
        }
      });
      return result + '\n';
    }

    // Paragraphs
    if (tagName === 'p') return `${getChildrenMarkdown(node).trim()}\n\n`;
    if (tagName === 'br') return '\n';

    return getChildrenMarkdown(node);
  }

  function getChildrenMarkdown(node) {
    return Array.from(node.childNodes).map(child => extractMarkdownFromElement(child)).join('');
  }

  // ============================================================================
  // Shadow DOM Traversal
  // ============================================================================
  function getDeepElements(root = document) {
    let all = Array.from(root.querySelectorAll('*'));
    all.forEach(el => {
      if (el.shadowRoot) all = all.concat(getDeepElements(el.shadowRoot));
    });
    return all;
  }

  // ============================================================================
  // Hybrid Role Detection (Visual + Attribute)
  // ============================================================================
  function detectRole(el, index) {
    // 1. Tags (Gemini / Standard)
    if (el.tagName.toLowerCase() === 'user-query' || el.closest('user-query')) return 'User';
    if (el.tagName.toLowerCase() === 'model-response' || el.closest('model-response')) return 'Assistant';

    // 2. Attributes (ChatGPT / Generic)
    const roleAttr = el.getAttribute('data-message-author-role') || el.getAttribute('data-role');
    if (roleAttr) return roleAttr === 'user' ? 'User' : 'Assistant';

    // 3. Multi-language Keywords
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const text = el.innerText.toLowerCase().substring(0, 50);
    if (/you|user|你|用户|提问/.test(aria) || /you|user|你/.test(text)) return 'User';
    if (/gemini|assistant|ai|模型|助手|回答/.test(aria) || /gemini|assistant|ai/.test(text)) return 'Assistant';

    // 4. Visual Heuristic (Alignment)
    try {
      const rect = el.getBoundingClientRect();
      if (rect.left > window.innerWidth * 0.5) return 'User';
    } catch (e) {}

    // 5. Alternating Fallback (DeepSeek/Generic)
    return index % 2 === 0 ? 'User' : 'Assistant';
  }

  // ============================================================================
  // Provider Detection & Metadata Extraction
  // ============================================================================
  function detectProvider(hostname) {
    if (hostname.includes('chatgpt.com') || hostname.includes('openai.com')) return 'chatgpt';
    if (hostname.includes('claude.ai')) return 'claude';
    if (hostname.includes('gemini.google.com')) return 'gemini';
    if (hostname.includes('deepseek.com')) return 'deepseek';
    return 'unknown';
  }

  function extractConversationId(url, provider) {
    try {
      switch (provider) {
        case 'chatgpt':
          return /chatgpt\.com\/c\/([a-z0-9-]+)/i.exec(url)?.[1] || '';
        case 'claude':
          return /claude\.ai\/chat\/([a-z0-9-]+)/i.exec(url)?.[1] || '';
        case 'gemini':
          return window.location.hash.substring(1) || '';
        case 'deepseek':
          return /deepseek\.com\/chat\/([a-z0-9-]+)/i.exec(url)?.[1] || '';
        default:
          return '';
      }
    } catch (error) {
      console.error('[AI Chat Exporter] Failed to extract conversation ID:', error);
      return '';
    }
  }

  // ============================================================================
  // Main
  // ============================================================================
  window.exportChatToMarkdown = function() {
    console.log('[AI Chat Exporter] Deep Scanning...');
    const host = window.location.hostname;
    const url = window.location.href;
    const provider = detectProvider(host);
    const conversationId = extractConversationId(url, provider);
    let messages = [];
    
    console.log(`[AI Chat Exporter] Provider: ${provider}, ConversationId: ${conversationId}`);
    
    // 1. Title Extraction
    const getTitle = () => {
      const selectors = ['nav .bg-token-surface-active', '.ds-sidebar-item--active', '.selected[data-test-id="conversation"]', 'h1', 'title'];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el?.innerText.trim()) return el.innerText.trim().split('\n')[0];
      }
      return document.title;
    };
    const title = getTitle().replace(/ - (ChatGPT|Claude|DeepSeek|Gemini|AI)$/i, '').replace(/[\/\?%*:|"<>]/g, '_').substring(0, 50);

    // 2. Universal Block Discovery
    const all = getDeepElements();
    console.log(`[AI Chat Exporter] Total DOM elements (incl. Shadow): ${all.length}`);
    
    const blocks = all.filter(el => {
      const tag = el.tagName.toLowerCase();
      const testid = el.getAttribute('data-testid') || '';
      const cls = el.className || '';
      
      // Comprehensive selectors for all platforms
      return tag === 'message-content' ||      // Gemini
             tag === 'user-query' ||            // Gemini user
             tag === 'model-response' ||        // Gemini AI
             testid.startsWith('conversation-turn-') || // ChatGPT
             cls.includes('ds-message') ||      // DeepSeek
             cls.includes('message') ||         // Generic
             cls.includes('chat-turn') ||       // Potential Gemini
             cls.includes('conversation-turn') || // Potential alternative
             el.hasAttribute('data-test-render-count') || // Claude
             el.hasAttribute('data-message-author-role');  // ChatGPT
    });
    
    console.log(`[AI Chat Exporter] Found ${blocks.length} potential message blocks`);

    // 3. Process
    blocks.forEach((el, i) => {
      const role = detectRole(el, i);
      const contentEl = el.querySelector('.markdown, .prose, .ds-markdown, .query-content, .model-response-text, [class*="message-content"]') || el;
      const content = extractMarkdownFromElement(contentEl).trim();
      
      console.log(`[Block ${i}] Tag: ${el.tagName}, Role: ${role}, Content length: ${content.length}`);
      
      if (content && content.length > 2) {
        messages.push({ role, content });
        console.log(`  ✓ Added: ${content.substring(0, 50)}...`);
      }
    });
    
    console.log(`[AI Chat Exporter] Total messages captured: ${messages.length}`);

    // 4. Emergency Fallback (Generic Text Blocks)
    if (messages.length === 0) {
      console.log('[AI Chat Exporter] Structural scan failed, using visual fallback...');
      all.filter(el => el.classList.contains('markdown') || el.classList.contains('prose') || el.classList.contains('ds-markdown'))
         .forEach(ai => {
            let userText = '';
            let prev = ai.parentElement;
            while (prev && prev.innerText.length < 5) prev = prev.previousElementSibling;
            if (prev) userText = prev.innerText.trim();
            if (userText) messages.push({ role: 'User', content: userText });
            messages.push({ role: 'Assistant', content: extractMarkdownFromElement(ai).trim() });
         });
    }

    // 5. Deduplicate & Return
    const final = [];
    const seen = new Set();
    messages.forEach(m => {
      const key = `${m.role}:${m.content.substring(0, 100)}`;
      if (!seen.has(key)) { final.push(m); seen.add(key); }
    });

    if (final.length === 0) {
      console.error('[AI Chat Exporter] FAILED. Platform:', host, 'DOM Size:', all.length);
      return null;
    }

    // Generate Markdown content
    let md = `# ${title}\n\n`;
    md += `> Source: [${host}](${url})\n\n---\n\n`;
    final.forEach(m => md += `### ${m.role}\n\n${m.content}\n\n---\n\n`);

    // Return both structured data and formatted content
    return { 
      // For immediate export
      filename: `${title.toLowerCase().replace(/\s+/g, '_')}.md`, 
      content: md, 
      count: final.length,
      
      // Structured data for storage
      data: {
        title: title,
        provider: provider,
        url: url,
        conversationId: conversationId,
        messageCount: final.length,
        messages: final,
        timestamp: Date.now()
      }
    };
  };

  // Export as JSON
  window.exportChatToJSON = function() {
    const result = window.exportChatToMarkdown();
    if (!result || !result.data) return null;
    
    const jsonData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      ...result.data
    };
    
    const filename = `${result.data.title.toLowerCase().replace(/\s+/g, '_')}.json`;
    const content = JSON.stringify(jsonData, null, 2);
    
    return { filename, content, data: jsonData };
  };

})();

