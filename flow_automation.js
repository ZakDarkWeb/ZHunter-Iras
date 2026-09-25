// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — Google Flow (flow.google.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  if (window.__zhunterFlowLoaded) return;
  window.__zhunterFlowLoaded = true;

  console.log('[ZHunter Flow] Automation script initialized on', location.href);

  // Helper: wait for element
  function waitForEl(selector, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeoutMs);
    });
  }

  // Helper: convert base64 dataUrl to File
  function dataUrlToFile(dataUrl, filename = 'zhunter_product.png') {
    try {
      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      return new File([u8arr], filename, { type: mime });
    } catch (e) {
      console.warn('[ZHunter Flow] dataUrlToFile error:', e);
      return null;
    }
  }

  // Show sleek ZHunter notification in Flow page
  function showFlowToast(msg, type = 'ok') {
    let t = document.getElementById('zh-flow-banner');
    if (!t) {
      t = document.createElement('div');
      t.id = 'zh-flow-banner';
      t.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: linear-gradient(135deg, #020617, #0B192C);
        border: 1px solid #00E5FF;
        box-shadow: 0 12px 36px rgba(0,0,0,0.8), 0 0 20px rgba(0,229,255,0.3);
        border-radius: 12px;
        padding: 12px 18px;
        color: #F8FAFC;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: auto;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        transform: translateY(20px);
        opacity: 0;
      `;
      document.body.appendChild(t);
    }

    t.innerHTML = `
      <span style="font-size:16px;">✨</span>
      <span>${msg}</span>
    `;
    requestAnimationFrame(() => {
      t.style.transform = 'translateY(0)';
      t.style.opacity = '1';
    });

    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(20px)';
      setTimeout(() => t.remove(), 400);
    }, 4500);
  }

  // Main flow executor
  async function handlePendingFlowAction() {
    chrome.storage.local.get(['pendingFlowAction'], async (data) => {
      const act = data?.pendingFlowAction;
      if (!act || act.processed) return;

      // Ignore actions older than 5 minutes
      if (Date.now() - (act.timestamp || 0) > 300000) {
        chrome.storage.local.remove('pendingFlowAction');
        return;
      }

      console.log('[ZHunter Flow] Processing action for:', act.productTitle);

      const isInsideProject = /\/project\/[a-zA-Z0-9_-]+/i.test(location.pathname);

      // STEP 1: If on home/projects list page, click "New project"
      if (!isInsideProject) {
        showFlowToast('Creating new project for: ' + (act.productTitle || 'Product') + '…');
        const newProjBtn = await waitForEl('button.new-project-button, button[aria-label*="New project"]', 8000);
        if (newProjBtn) {
          newProjBtn.click();
          // After clicking, Flow will navigate to /project/...
          return;
        } else {
          console.warn('[ZHunter Flow] New project button not found yet');
        }
      }

      // STEP 2: We are inside /project/...
      if (isInsideProject) {
        // Wait for prompt box or editable-text-input to load
        await new Promise(r => setTimeout(r, 600));

        // 1. Set Project Name
        try {
          const titleInput = await waitForEl('input.editable-text-input', 5000);
          if (titleInput) {
            const cur = (titleInput.value || '').trim();
            // Only rename if it's default date-like or starts with Sep/Oct/etc.
            const isDefault = !cur || /^[A-Z][a-z]{2}\s+\d+/i.test(cur) || cur.includes('Sep') || cur.includes('Oct');
            if (isDefault) {
              const dStr = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
              const cleanPTitle = (act.productTitle || 'Product').slice(0, 36);
              const newTitle = `ZHunter · ${cleanPTitle} · ${dStr}`;
              titleInput.value = newTitle;
              titleInput.dispatchEvent(new Event('input', { bubbles: true }));
              titleInput.dispatchEvent(new Event('change', { bubbles: true }));
              titleInput.blur();
            }
          }
        } catch (e) {
          console.warn('[ZHunter Flow] Rename error:', e);
        }

        // 2. Paste Image into editor
        let imagePasted = false;
        if (act.imgBase64) {
          try {
            const file = dataUrlToFile(act.imgBase64, 'zhunter_edit.png');
            if (file) {
              const editor = await waitForEl('.ProseMirror, .prosemirror-editor', 5000);
              if (editor) {
                editor.focus();
                const dt = new DataTransfer();
                dt.items.add(file);

                const pasteEv = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: dt
                });
                editor.dispatchEvent(pasteEv);
                imagePasted = true;
              }
            }
          } catch (e) {
            console.warn('[ZHunter Flow] Image paste error:', e);
          }
        }

        // 3. Insert Prompt
        try {
          const editor = await waitForEl('.ProseMirror, .prosemirror-editor', 5000);
          if (editor) {
            editor.focus();
            await new Promise(r => setTimeout(r, 200));

            // Try execCommand first (best for ProseMirror)
            const promptText = act.prompt || '';
            const success = document.execCommand('insertText', false, promptText);

            if (!success || !editor.textContent.includes(promptText.slice(0, 20))) {
              let p = editor.querySelector('p');
              if (!p) {
                p = document.createElement('p');
                editor.appendChild(p);
              }
              p.textContent = promptText;
              editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        } catch (e) {
          console.warn('[ZHunter Flow] Prompt insertion error:', e);
        }

        // 4. Mark action processed
        chrome.storage.local.set({
          pendingFlowAction: { ...act, processed: true }
        });

        showFlowToast(
          `✓ Image & Prompt ready in Flow! ${imagePasted ? '(Image attached)' : '(Ctrl+V to paste)'}`
        );
      }
    });
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handlePendingFlowAction);
  } else {
    handlePendingFlowAction();
  }

  // Also listen for SPA URL navigation inside Flow (e.g. / -> /project/...)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handlePendingFlowAction();
    }
  }, 1000);

  // Listen for storage changes from ZHunter sidepanel
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pendingFlowAction?.newValue) {
      if (!changes.pendingFlowAction.newValue.processed) {
        handlePendingFlowAction();
      }
    }
  });

  // Listen for runtime messages
  chrome.runtime.onMessage?.addListener((msg) => {
    if (msg?.action === 'ZH_FLOW_EXECUTE') {
      handlePendingFlowAction();
    }
  });
})();
