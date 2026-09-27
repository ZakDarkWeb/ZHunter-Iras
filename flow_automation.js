// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — Google Flow (flow.google.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  if (window.__zhunterFlowLoaded) {
    // Already loaded, just check for pending actions
    window.__zhunterFlowExecute?.();
    return;
  }
  window.__zhunterFlowLoaded = true;

  console.log('[ZHunter Flow] Automation script initialized on', location.href);

  // Helper: wait for element
  function waitForEl(selector, timeoutMs = 10000) {
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

  // Helper: Robust multi-event clicker for Angular Material & modern SPAs
  function simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    } catch (_) {}

    const evNames = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    evNames.forEach((name) => {
      try {
        const ev = new MouseEvent(name, {
          bubbles: true,
          cancelable: true,
          view: window,
          composed: true,
          buttons: 1
        });
        el.dispatchEvent(ev);
      } catch (_) {}
    });

    // Also trigger on inner touch targets or labels if present
    const inner = el.querySelector?.('.mat-mdc-button-touch-target, .mdc-button__label, mat-icon');
    if (inner) {
      evNames.forEach((name) => {
        try {
          inner.dispatchEvent(new MouseEvent(name, {
            bubbles: true,
            cancelable: true,
            view: window,
            composed: true,
            buttons: 1
          }));
        } catch (_) {}
      });
    }

    try { el.click(); } catch (_) {}
  }

  // Helper: Ensure Flow model is switched to 🍌 Nano Banana 2
  async function ensureNanoBananaModel() {
    try {
      const modelTrigger = document.querySelector('button.image-model-picker-button, button[aria-label*="default model"]');
      const labelEl = modelTrigger?.querySelector('.model-select-trigger-label') || modelTrigger;
      const curText = (labelEl?.textContent || '').trim();
      if (!curText.toLowerCase().includes('nano banana 2')) {
        console.log('[ZHunter Flow] Current model is:', curText, 'Switching to 🍌 Nano Banana 2…');
        if (modelTrigger) {
          simulateRealClick(modelTrigger);
          await new Promise(r => setTimeout(r, 450));
          const menuItems = Array.from(document.querySelectorAll('.mat-mdc-menu-panel [role="menuitem"], .cdk-overlay-pane [role="menuitem"], button.mat-mdc-menu-item, mat-dialog-container button'));
          const targetItem = menuItems.find(el => el.textContent?.toLowerCase().includes('nano banana 2'));
          if (targetItem) {
            simulateRealClick(targetItem);
            console.log('[ZHunter Flow] Successfully selected 🍌 Nano Banana 2');
          } else {
            document.body.click();
          }
        }
      } else {
        console.log('[ZHunter Flow] Model already verified: 🍌 Nano Banana 2');
      }
    } catch (e) {
      console.warn('[ZHunter Flow] Model switch error:', e);
    }
  }

  // Helper: Inject prompt text into Flow ProseMirror rich text editor
  async function injectFlowPrompt(promptText) {
    if (!promptText) return;
    try {
      const editor = await waitForEl('flow-rich-text-editor .ProseMirror, .prompt-input .ProseMirror, .ProseMirror', 4000);
      if (editor) {
        editor.focus();
        editor.innerHTML = `<p>${promptText.replace(/\n/g, '<br>')}</p>`;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[ZHunter Flow] Prompt injected into ProseMirror');
      }
    } catch (e) {
      console.warn('[ZHunter Flow] Prompt injection error:', e);
    }
  }

  // Top HUD Status Banner on Flow Page
  function updateFlowHUD(msg, type = 'info', actionBtn = null) {
    let hud = document.getElementById('zh-flow-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'zh-flow-hud';
      hud.style.cssText = `
        position: fixed;
        top: 14px;
        right: 18px;
        z-index: 2147483647;
        background: linear-gradient(135deg, rgba(2, 6, 23, 0.96), rgba(11, 25, 44, 0.94));
        border: 1px solid #00E5FF;
        box-shadow: 0 10px 30px rgba(0,0,0,0.85), 0 0 20px rgba(0,229,255,0.35);
        border-radius: 12px;
        padding: 10px 16px;
        color: #F8FAFC;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 12px;
        backdrop-filter: blur(8px);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      `;
      document.body.appendChild(hud);
    }

    const icon = type === 'ok' ? '✓' : type === 'warn' ? '⚠️' : '⚡';
    const iconColor = type === 'ok' ? '#10B981' : type === 'warn' ? '#F59E0B' : '#00E5FF';

    hud.innerHTML = `
      <span style="color:${iconColor}; font-size:15px; display:inline-flex; align-items:center;">${icon}</span>
      <span style="letter-spacing: 0.2px;">${msg}</span>
    `;

    if (actionBtn) {
      const btn = document.createElement('button');
      btn.innerText = actionBtn.label;
      btn.style.cssText = `
        background: #00E5FF;
        color: #020617;
        border: none;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        margin-left: 6px;
      `;
      btn.onclick = actionBtn.onClick;
      hud.appendChild(btn);
    }

    if (type === 'ok') {
      setTimeout(() => {
        hud.style.opacity = '0';
        hud.style.transform = 'translateY(-10px)';
        setTimeout(() => hud.remove(), 400);
      }, 5000);
    }
  }

  let isRunningAction = false;

  // Main flow executor
  async function handlePendingFlowAction() {
    if (isRunningAction) return;
    if (!chrome?.storage?.local) return;

    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(['pendingFlowAction'], async (data) => {
        if (chrome.runtime?.lastError) return;
        const act = data?.pendingFlowAction;
        if (!act || act.processed) return;

        // Ignore actions older than 5 minutes
        if (Date.now() - (act.timestamp || 0) > 300000) {
          try { chrome?.storage?.local?.remove('pendingFlowAction'); } catch (_) {}
          return;
        }

      isRunningAction = true;
      console.log('[ZHunter Flow] Processing action for:', act.productTitle);

      const isInsideProject = /\/project\/[a-zA-Z0-9_-]+/i.test(location.pathname);

      // STEP 1: If on home / projects list page, trigger "New project"
      if (!isInsideProject) {
        updateFlowHUD(`ZHunter: Creating new project for ${act.productTitle || 'Product'}…`, 'info');

        // Look for the New Project button
        const findButton = () => {
          return document.querySelector('button.new-project-button') ||
                 document.querySelector('button[aria-label*="New project"]') ||
                 Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('New project'));
        };

        let newProjBtn = findButton();
        if (!newProjBtn) {
          newProjBtn = await waitForEl('button.new-project-button, button[aria-label*="New project"]', 6000);
        }

        if (newProjBtn) {
          console.log('[ZHunter Flow] Found New Project button, dispatching click…');
          simulateRealClick(newProjBtn);

          // Retry loop in case Angular Material delayed click
          let attempts = 0;
          const retryTimer = setInterval(() => {
            attempts++;
            if (/\/project\/[a-zA-Z0-9_-]+/i.test(location.pathname)) {
              clearInterval(retryTimer);
              isRunningAction = false;
              handlePendingFlowAction();
              return;
            }

            if (attempts > 4) {
              clearInterval(retryTimer);
              isRunningAction = false;
              updateFlowHUD(`Click '+ New project' to continue`, 'warn', {
                label: '+ Create Project',
                onClick: () => {
                  const b = findButton();
                  if (b) simulateRealClick(b);
                }
              });
              return;
            }

            const btn = findButton();
            if (btn) {
              console.log(`[ZHunter Flow] Re-attempting click (${attempts}/4)…`);
              simulateRealClick(btn);
            }
          }, 1200);
          return;
        } else {
          console.warn('[ZHunter Flow] New project button not found yet');
          isRunningAction = false;
          updateFlowHUD(`Click '+ New project' button below`, 'warn');
          return;
        }
      }

      // STEP 2: We are inside /project/...
      if (isInsideProject) {
        updateFlowHUD('ZHunter: Project open! Verifying 🍌 Nano Banana 2 & adding image…', 'info');

        // Allow Angular view to mount
        await new Promise(r => setTimeout(r, 600));

        // 1. Ensure Model is 🍌 Nano Banana 2
        await ensureNanoBananaModel();

        // 2. Set Project Name
        try {
          const titleInput = await waitForEl('input.editable-text-input', 4000);
          if (titleInput) {
            const cur = (titleInput.value || '').trim();
            // Only rename if it's default date format
            const isDefault = !cur || /^[A-Z][a-z]{2}\s+\d+/i.test(cur) || cur.includes('Sep') || cur.includes('Oct') || cur.includes('Nov') || cur.includes('Dec');
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

        // 3. Inject Image — exactly once using a global dispatch lock
        if (act.imgBase64 && !window.__zhImgDropped) {
          window.__zhImgDropped = true;
          // Auto-release lock after 10s so future actions can run
          setTimeout(() => { window.__zhImgDropped = false; }, 10000);

          try {
            const file = dataUrlToFile(act.imgBase64, 'zhunter_product.png');
            if (file) {
              const dt = new DataTransfer();
              dt.items.add(file);

              const dropTarget = document.querySelector('.content-container') || document.body;
              const dropOpts = {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
                clientX: Math.floor(window.innerWidth / 3),
                clientY: Math.floor(window.innerHeight / 2)
              };

              dropTarget.dispatchEvent(new DragEvent('dragenter', dropOpts));
              dropTarget.dispatchEvent(new DragEvent('dragover', dropOpts));
              await new Promise(r => setTimeout(r, 60));
              dropTarget.dispatchEvent(new DragEvent('drop', dropOpts));

              console.log('[ZHunter Flow] Image drop dispatched (once) to:', dropTarget.tagName);
            }
          } catch (e) {
            console.warn('[ZHunter Flow] Image injection error:', e);
            window.__zhImgDropped = false;
          }
        }

        // 4. Inject Prompt into ProseMirror
        if (act.prompt) {
          await injectFlowPrompt(act.prompt);
        }

        // Mark action processed
        chrome?.storage?.local?.set({
          pendingFlowAction: { ...act, processed: true }
        });

        isRunningAction = false;
        const pTitle = (act.productTitle || 'Product').slice(0, 30);
        const imgNum = (act.imageIndex ?? 0) + 1;
        updateFlowHUD(
          `📦 ${pTitle} · Image #${imgNum}`,
          'info',
          {
            label: '📥 Send to ZHunter',
            onClick: () => {
              const imgs = Array.from(document.querySelectorAll('flow-project-page img, .tiles-container img, .cdk-virtual-scroll-viewport img'));
              const valid = imgs.filter(img => img.src && !img.src.includes('avatar') && !img.src.includes('favicon') && !img.src.includes('flow_icon') && !img.src.includes('logo') && !img.src.includes('ogw') && !img.src.includes('gstatic'));
              if (valid.length > 0) {
                const latestImg = valid[valid.length - 1];
                chrome.runtime?.sendMessage?.({
                  action: 'ZH_REPLACE_IMAGE_FROM_FLOW',
                  newImgUrl: latestImg.src,
                  productId: act.productId,
                  imageIndex: act.imageIndex
                });
                updateFlowHUD(`✓ Sent Image #${imgNum} to ZHunter!`, 'ok');
              } else {
                updateFlowHUD('Right-click edited image → "Copy Image", then click 📋 in ZHunter!', 'warn');
              }
            }
          }
        );
      }
    });
  } catch (err) {
    isRunningAction = false;
    console.warn('[ZHunter Flow] Action error:', err);
  }
}

  window.__zhunterFlowExecute = handlePendingFlowAction;

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
      isRunningAction = false;
      handlePendingFlowAction();
    }
  }, 800);

  // Listen for storage changes from ZHunter sidepanel
  try {
    chrome?.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.pendingFlowAction?.newValue) {
        if (!changes.pendingFlowAction.newValue.processed) {
          isRunningAction = false;
          handlePendingFlowAction();
        }
      }
    });
  } catch (_) {}

  // Listen for runtime messages
  chrome.runtime.onMessage?.addListener((msg) => {
    if (msg?.action === 'ZH_FLOW_EXECUTE') {
      isRunningAction = false;
      handlePendingFlowAction();
    }
  });
})();
