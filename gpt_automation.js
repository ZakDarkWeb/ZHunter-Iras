// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — ChatGPT (chatgpt.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  console.log('[ZHunter GPT] Automation script active on', location.href);

  // Floating Toast HUD on ChatGPT page
  function showGptHUD(text, type = 'info') {
    let hud = document.getElementById('__zhunter_gpt_hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = '__zhunter_gpt_hud';
      hud.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 28px;
        z-index: 999999;
        background: #202123;
        color: #ececf1;
        border: 1px solid #4d4d4f;
        border-radius: 12px;
        padding: 12px 18px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        gap: 10px;
        transition: all 0.3s ease;
      `;
      document.body.appendChild(hud);
    }
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '⚠️' : '⚡';
    hud.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
    hud.style.borderColor = type === 'ok' ? '#10a37f' : type === 'warn' ? '#f59e0b' : '#4d4d4f';
    setTimeout(() => {
      if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    }, 6000);
  }

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
      console.warn('[ZHunter GPT] dataUrlToFile error:', e);
      return null;
    }
  }

  // Main injection logic
  async function injectImage(imgBase64) {
    if (!imgBase64 || window.__zhGptImgInProgress) return;
    window.__zhGptImgInProgress = true;
    setTimeout(() => { window.__zhGptImgInProgress = false; }, 6000);

    showGptHUD('ZHunter: Attaching product image...', 'info');

    const file = dataUrlToFile(imgBase64, 'zhunter_product.png');
    if (!file) {
      showGptHUD('Image could not be converted', 'warn');
      return;
    }

    // Copy to clipboard in ChatGPT tab if document is focused
    if (document.hasFocus?.()) {
      try {
        const blob = file.slice(0, file.size, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        console.log('[ZHunter GPT] Image written to clipboard');
      } catch (_) {}
    }

    // Wait for ChatGPT's composer to appear
    const composer = await waitForEl('form[data-type="unified-composer"], [data-composer-surface="true"], #prompt-textarea', 12000);

    // Allow React / ProseMirror to complete hydration & attach event listeners
    await new Promise(r => setTimeout(r, 1200));

    // Focus editor
    const textarea = document.querySelector('#prompt-textarea') || composer;
    try { textarea?.focus(); } catch (_) {}

    const dt = new DataTransfer();
    dt.items.add(file);

    // Dispatch exactly ONE Drag & Drop event to composer
    const dropTarget = document.querySelector('form[data-type="unified-composer"]') ||
                       document.querySelector('[data-composer-surface="true"]') ||
                       composer;

    if (dropTarget) {
      try {
        const dropOpts = {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: Math.floor(window.innerWidth / 2),
          clientY: Math.floor(window.innerHeight / 2)
        };
        dropTarget.dispatchEvent(new DragEvent('dragenter', dropOpts));
        dropTarget.dispatchEvent(new DragEvent('dragover', dropOpts));
        await new Promise(r => setTimeout(r, 80));
        dropTarget.dispatchEvent(new DragEvent('drop', dropOpts));
        console.log('[ZHunter GPT] Clean 1-drop dispatched to:', dropTarget.tagName);
        showGptHUD('✓ Image attached to ChatGPT!', 'ok');
        return;
      } catch (_) {}
    }

    showGptHUD('✓ Image ready! Paste with Ctrl+V if needed.', 'ok');
  }

  // Check and process pending action from storage
  function checkPendingAction() {
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(['pendingGptAction'], (res) => {
        if (chrome.runtime.lastError) return;
        const act = res?.pendingGptAction;
        if (!act || act.processed) return;

        // Valid within last 2 minutes
        if (Date.now() - (act.timestamp || 0) < 120000 && act.imgBase64) {
          chrome.storage.local.set({
            pendingGptAction: { ...act, processed: true }
          });
          injectImage(act.imgBase64);
        }
      });
    } catch (e) {
      console.warn('[ZHunter GPT] Storage error:', e);
    }
  }

  window.__zhunterGptExecute = checkPendingAction;

  try {
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.action === 'TRIGGER_GPT_IMAGE') {
        checkPendingAction();
      }
    });
  } catch (_) {}

  // Run immediately
  checkPendingAction();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingAction);
  }
})();
