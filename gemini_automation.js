// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — Google Gemini (gemini.google.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  console.log('[ZHunter Gemini] Automation script active on', location.href);

  // Floating Toast HUD on Gemini page
  function showGeminiHUD(text, type = 'info') {
    let hud = document.getElementById('__zhunter_gemini_hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = '__zhunter_gemini_hud';
      hud.style.cssText = `
        position: fixed;
        bottom: 90px;
        right: 28px;
        z-index: 999999;
        background: #1e1f20;
        color: #e3e3e3;
        border: 1px solid #444746;
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
    hud.style.borderColor = type === 'ok' ? '#38bdf8' : type === 'warn' ? '#f59e0b' : '#444746';
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
      console.warn('[ZHunter Gemini] dataUrlToFile error:', e);
      return null;
    }
  }

  // Main injection logic
  async function injectImage(imgBase64) {
    if (!imgBase64 || window.__zhGeminiImgInProgress) return;
    window.__zhGeminiImgInProgress = true;
    setTimeout(() => { window.__zhGeminiImgInProgress = false; }, 6000);

    showGeminiHUD('ZHunter: Product image attach ho rahi he...', 'info');

    const file = dataUrlToFile(imgBase64, 'zhunter_product.png');
    if (!file) {
      showGeminiHUD('Image convert nahi ho saki', 'warn');
      return;
    }

    // Copy to clipboard in Gemini tab if document is focused
    if (document.hasFocus?.()) {
      try {
        const blob = file.slice(0, file.size, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        console.log('[ZHunter Gemini] Image written to clipboard');
      } catch (_) {}
    }

    // Wait for Gemini's editor to be ready
    const editor = await waitForEl('.ql-editor[role="textbox"], .ql-editor, div[contenteditable="true"]', 12000);

    // Allow Angular SPA to complete hydration & attach uploader dropzone
    await new Promise(r => setTimeout(r, 800));

    const dt = new DataTransfer();
    dt.items.add(file);

    // METHOD 1: Check for existing file input (Attach once and return)
    const inp = document.querySelector('input[type="file"]');
    if (inp) {
      try {
        inp.files = dt.files;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[ZHunter Gemini] Attached 1 image via file input');
        showGeminiHUD('✓ 1 Image attached to Gemini!', 'ok');
        return;
      } catch (_) {}
    }

    // METHOD 2: If no file input or not triggered, click the '+' upload button to reveal input
    const plusBtn = document.querySelector('button[aria-label*="Upload"], button[aria-label*="tool"], .simplified-input-menu button');
    if (plusBtn) {
      try {
        plusBtn.click();
        await new Promise(r => setTimeout(r, 250));
        const newFileInput = document.querySelector('input[type="file"]');
        if (newFileInput) {
          newFileInput.files = dt.files;
          newFileInput.dispatchEvent(new Event('input', { bubbles: true }));
          newFileInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[ZHunter Gemini] Attached 1 image via opened file input');
          showGeminiHUD('✓ 1 Image attached to Gemini!', 'ok');
          return;
        }
      } catch (_) {}
    }

    // METHOD 3: Fallback Drag & Drop Event on dropzone & editor (only if above failed)
    try {
      const dropTarget = document.querySelector('.xap-uploader-dropzone') || document.querySelector('file-drop-indicator') || editor;
      if (dropTarget) {
        const dropOpts = {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: Math.floor(window.innerWidth / 2),
          clientY: Math.floor(window.innerHeight / 2)
        };
        dropTarget.dispatchEvent(new DragEvent('dragenter', dropOpts));
        dropTarget.dispatchEvent(new DragEvent('dragover', dropOpts));
        await new Promise(r => setTimeout(r, 40));
        dropTarget.dispatchEvent(new DragEvent('drop', dropOpts));
        console.log('[ZHunter Gemini] Dispatched 1 Drag & Drop');
        showGeminiHUD('✓ 1 Image attached to Gemini!', 'ok');
        return;
      }
    } catch (_) {}

    showGeminiHUD('✓ Image ready! Agar zaroorat ho to Ctrl+V se paste karein.', 'ok');
  }

  // Check and process pending action from storage
  function checkPendingAction() {
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(['pendingGeminiAction'], (res) => {
        if (chrome.runtime.lastError) return;
        const act = res?.pendingGeminiAction;
        if (!act || act.processed) return;

        // Valid within last 2 minutes
        if (Date.now() - (act.timestamp || 0) < 120000 && act.imgBase64) {
          chrome.storage.local.set({
            pendingGeminiAction: { ...act, processed: true }
          });
          injectImage(act.imgBase64);
        }
      });
    } catch (e) {
      console.warn('[ZHunter Gemini] Storage error:', e);
    }
  }

  window.__zhunterGeminiExecute = checkPendingAction;

  try {
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.action === 'TRIGGER_GEMINI_IMAGE') {
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
