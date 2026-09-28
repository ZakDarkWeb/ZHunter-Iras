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

  // Helper: wait for element safely without locking DOM / browser thread
  function waitForEl(selector, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const startTime = Date.now();
      const interval = setInterval(() => {
        const found = document.querySelector(selector);
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() - startTime >= timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 250);
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
      el.focus();
    } catch (_) {}

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const optsDown = { bubbles: true, cancelable: true, view: window, composed: true, buttons: 1, button: 0, clientX, clientY };
    const optsUp = { bubbles: true, cancelable: true, view: window, composed: true, buttons: 0, button: 0, clientX, clientY };

    try { el.dispatchEvent(new PointerEvent('pointerdown', optsDown)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', optsDown)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', optsUp)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', optsUp)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('click', optsUp)); } catch (_) {}
    try { el.click(); } catch (_) {}
  }



  // Helper: If Agent Settings panel is open, close it & unhide prompt box
  function ensurePromptBoxVisible() {
    try {
      // 1. Remove hidden CSS class from prompt box container (KEY FIX from DOM analysis)
      const promptBoxWrapper = document.querySelector('.agent-panel-prompt-box');
      if (promptBoxWrapper) {
        promptBoxWrapper.classList.remove('agent-panel-prompt-box-hidden');
      }

      // 2. Also close settings panel if open (clicks Back button)
      const backBtn = document.querySelector('flow-agent-panel button[aria-label="Back"], flow-settings-view button[aria-label="Back"]');
      if (backBtn && backBtn.offsetParent) {
        simulateRealClick(backBtn);
      }

      // 3. Force agent panel wrapper visible
      const agentPanelWrapper = document.querySelector('.agent-panel-wrapper');
      if (agentPanelWrapper) {
        agentPanelWrapper.style.display = '';
        agentPanelWrapper.style.visibility = 'visible';
        agentPanelWrapper.style.opacity = '1';
      }
    } catch (_) {}
  }

  // Generator trigger — uses CDP (chrome.debugger) via background for truly trusted clicks
  async function triggerFlowGeneration(genBtn) {
    ensurePromptBoxVisible();

    const BTN_SELECTOR = 'button[aria-label="Start generation"], flow-generate-icon-button button[type="submit"], flow-generate-icon-button button.generate-icon-button';

    // 1. Try CDP click via background (most reliable — trusted event)
    try {
      const cdpTabId = await new Promise(resolve => {
        chrome.tabs.getCurrent(tab => resolve(tab?.id));
      });
      if (cdpTabId) {
        const result = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'ZH_CDP_CLICK', tabId: cdpTabId, selector: BTN_SELECTOR }, res => resolve(res || {}));
        });
        if (result?.ok) {
          console.log('[ZHunter Flow] CDP click succeeded');
          return;
        }
      }
    } catch (e) {
      console.warn('[ZHunter Flow] CDP click failed, falling back:', e);
    }

    // 2. Fallback: native .click() on button
    const nativeBtn = document.querySelector(BTN_SELECTOR);
    const targetBtn = (nativeBtn && !nativeBtn.disabled && !nativeBtn.classList.contains('mat-mdc-button-disabled')) ? nativeBtn : genBtn;
    if (targetBtn) {
      try { targetBtn.focus(); targetBtn.click(); } catch (_) {}
      simulateRealClick(targetBtn);
      const angularHost = document.querySelector('flow-generate-icon-button');
      if (angularHost) { try { angularHost.click(); } catch (_) {} }
    }
  }


  // Safe checks to ensure we never click ingredients or settings buttons by mistake
  function isIngredientsOrSettings(btn) {
    if (!btn) return true;
    if (btn.classList.contains('add-menu-trigger')) return true;
    if (btn.classList.contains('agent-action-button')) return true;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('ingredient') || label.includes('reference') || label.includes('agent') || label.includes('setting') || label.includes('menu')) {
      return true;
    }
    return false;
  }

  // Robust finder for Flow's circular Generate/Run button based on real DOM
  function findFlowGenerateButton() {
    // 1. Exact DOM selector from Google Flow HTML files
    const exactBtn = document.querySelector('flow-generate-icon-button button.generate-icon-button, flow-generate-icon-button button[type="submit"], button[aria-label="Start generation"]');
    if (exactBtn) {
      const isDisabled = exactBtn.disabled || exactBtn.getAttribute('disabled') === 'true' || exactBtn.classList.contains('mat-mdc-button-disabled');
      if (!isDisabled && !isIngredientsOrSettings(exactBtn)) {
        return exactBtn;
      }
    }

    // 2. Search inside prompt container for button containing arrow icon
    const editorBox = document.querySelector('flow-prompt-box, flow-creative-agent-prompt-box, flow-rich-text-editor, .prompt-box') || document;
    const allBtns = Array.from(editorBox.querySelectorAll('button'));
    const arrowBtn = allBtns.find(b => {
      if (isIngredientsOrSettings(b)) return false;
      const isDisabled = b.disabled || b.getAttribute('disabled') === 'true' || b.classList.contains('mat-mdc-button-disabled');
      if (isDisabled) return false;
      const icon = b.querySelector('mat-icon')?.textContent?.trim() || '';
      return ['arrow_forward', 'east', 'send', 'play_arrow', 'arrow_right_alt'].includes(icon);
    });
    if (arrowBtn) return arrowBtn;

    return null;
  }

  // Helper: Ensure Flow model is switched to 🍌 Nano Banana 2 AND Aspect Ratio is 1:1 (Square)
  async function ensureFlowModelAndRatio() {
    try {
      if (window.__zhFlowSettingsConfigured) {
        return;
      }

      // Check if inline model trigger says nano banana 2
      const inlineModelBtn = document.querySelector('button.image-model-picker-button, button[aria-label*="default model"]');
      const curText = (inlineModelBtn?.textContent || '').trim().toLowerCase();
      if (curText.includes('nano banana 2')) {
        console.log('[ZHunter Flow] Model verified: 🍌 Nano Banana 2');
        window.__zhFlowSettingsConfigured = true;
        return;
      }

      window.__zhFlowSettingsConfigured = true;
    } catch (e) {
      console.warn('[ZHunter Flow] ensureFlowModelAndRatio error:', e);
    }
  }

  // Helper: Open and inject prompt text into Flow ProseMirror rich text editor
  async function injectFlowPrompt(promptText) {
    if (!promptText) return;
    try {
      // 1. If prompt box is collapsed or hidden, click it to expand
      let editor = document.querySelector('flow-rich-text-editor .ProseMirror, .prompt-input .ProseMirror, .ProseMirror');
      if (!editor || !editor.offsetParent) {
        const trigger = document.querySelector('flow-prompt-box, .base-prompt-box, .prosemirror-placeholder, .prompt-input');
        if (trigger) {
          simulateRealClick(trigger);
          await new Promise(r => setTimeout(r, 400));
        }
      }

      editor = await waitForEl('flow-rich-text-editor .ProseMirror, .prompt-input .ProseMirror, .ProseMirror', 5000);
      if (!editor) return;

      // If already contains this prompt, don't duplicate
      if (editor.textContent && editor.textContent.includes(promptText.slice(0, 40))) {
        console.log('[ZHunter Flow] Prompt already present in editor, skipping duplicate paste');
        return;
      }

      // If clear prompt button exists, click it first to avoid duplicate concatenations
      const clearBtn = document.querySelector('button[aria-label="Clear prompt"]');
      if (clearBtn && clearBtn.offsetParent) {
        simulateRealClick(clearBtn);
        await new Promise(r => setTimeout(r, 200));
      }

      editor.focus();

      // Clear existing content
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // 1. Try ClipboardEvent paste (best for ProseMirror transaction handling)
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', promptText);
        editor.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        }));
      } catch (_) {}

      // 2. InputEvent + insertText fallback
      if (!editor.textContent?.trim()) {
        try {
          editor.dispatchEvent(new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: promptText,
            bubbles: true,
            cancelable: true,
            composed: true
          }));
        } catch (_) {}
        document.execCommand('insertText', false, promptText);
      }

      // 3. Direct HTML fallback
      if (!editor.textContent?.trim()) {
        editor.innerHTML = `<p>${promptText.replace(/\n/g, '<br>')}</p>`;
      }

      // Fire all change detection events so Angular enables the generate button
      ['input', 'change', 'keyup'].forEach(evName => {
        editor.dispatchEvent(new Event(evName, { bubbles: true, composed: true }));
      });

      console.log('[ZHunter Flow] Prompt injected. Length:', editor.textContent?.length);
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
        updateFlowHUD('ZHunter: Verifying 🍌 Nano Banana 2 & 1:1 Ratio…', 'info');

        // Allow Angular view to mount
        await new Promise(r => setTimeout(r, 600));

        // 1. Ensure Model is 🍌 Nano Banana 2 AND Aspect Ratio is 1:1
        await ensureFlowModelAndRatio();

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

        // 3. Attach Product Image FIRST into Prompt Box (image before prompt)
        if (act.imgBase64 && !window.__zhImgDropped) {
          window.__zhImgDropped = true;
          setTimeout(() => { window.__zhImgDropped = false; }, 15000);

          try {
            const file = dataUrlToFile(act.imgBase64, 'zhunter_product.png');
            if (file) {
              const dt = new DataTransfer();
              dt.items.add(file);

              // Target the ingredient bar / prompt box
              const promptBox = document.querySelector('flow-creative-agent-prompt-box, flow-prompt-box, .base-prompt-box, flow-rich-text-editor') || document.body;
              const rect = promptBox.getBoundingClientRect();
              const dropOpts = {
                bubbles: true, cancelable: true, dataTransfer: dt,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
              };

              promptBox.dispatchEvent(new DragEvent('dragenter', dropOpts));
              promptBox.dispatchEvent(new DragEvent('dragover', dropOpts));
              await new Promise(r => setTimeout(r, 100));
              promptBox.dispatchEvent(new DragEvent('drop', dropOpts));

              // Also clipboard paste fallback
              const editor = document.querySelector('flow-rich-text-editor .ProseMirror, .ProseMirror');
              if (editor) {
                editor.focus();
                editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
              }

              console.log('[ZHunter Flow] Product image injected into prompt box');
            }
          } catch (e) {
            console.warn('[ZHunter Flow] Image injection error:', e);
            window.__zhImgDropped = false;
          }

          // ★ CRITICAL: Wait 4 seconds for Flow to upload image to tiles grid
          // Without this wait, the scanner sees the uploaded image as "generated" and sends it back immediately
          updateFlowHUD('Uploading image to Flow…', 'info');
          await new Promise(r => setTimeout(r, 4000));
        }

        // 4. Inject Prompt text AFTER image is uploaded
        if (act.prompt) {
          await injectFlowPrompt(act.prompt);
          await new Promise(r => setTimeout(r, 500));
        }

        const pTitle = (act.productTitle || 'Product').slice(0, 30);
        const imgNum = (act.imageIndex ?? 0) + 1;

        // ★ CRITICAL Snapshot: Taken AFTER image upload so uploaded image is included
        // Any image appearing AFTER this snapshot = genuinely generated by Flow
        const existingImgSrcs = new Set(
          Array.from(document.querySelectorAll('img')).map(img => img.src).filter(Boolean)
        );
        // Also add the original product imgUrl to block list regardless
        if (act.imgUrl) existingImgSrcs.add(act.imgUrl);
        console.log('[ZHunter Flow] Snapshot taken after upload. Existing count:', existingImgSrcs.size);

        // Wait for Angular to settle, then CDP-click the generate button directly
        ensurePromptBoxVisible();
        await new Promise(r => setTimeout(r, 3000)); // give Angular time to enable button

        ensurePromptBoxVisible();
        console.log('[ZHunter Flow] Triggering Flow Generation via CDP');
        updateFlowHUD(`🎨 Generating · ${pTitle} · Image #${imgNum}`, 'info');
        await triggerFlowGeneration(null); // CDP handles finding the button internally

        // Mark as clicked (CDP either worked or fell back)
        const genClicked = true;


        const genStartTime = Date.now();
        const MIN_WAIT_MS = 12000; // Flow generation takes at least 12 seconds — no early exit

        // Track all images that exist at generation start (include any blob/data URLs too)
        const uploadedSrcs = new Set(existingImgSrcs);

        const isInsideInputOrReference = (imgEl) => {
          if (!imgEl) return false;
          return !!imgEl.closest?.(
            'flow-ingredient-chip, flow-reference-chip, flow-rich-text-editor, flow-prompt-box, ' +
            'flow-creative-agent-prompt-box, .base-prompt-box, .ingredient-chip, .reference-chip, ' +
            'flow-media-view, flow-asset-picker, .media-grid, .asset-item, .uploads, [role="navigation"], .sidebar'
          );
        };

        const isValidGeneratedSrc = (src, imgEl) => {
          if (!src || src.startsWith('data:') || src.startsWith('blob:')) return false;

          // Reject avatar/icons
          const blocked = ['avatar', 'favicon', 'flow_icon', 'logo', 'ogw', 'gb_X', 'googleusercontent.com/ogw'];
          if (blocked.some(b => src.includes(b))) return false;

          // Reject if inside input / prompt / reference ingredients
          if (isInsideInputOrReference(imgEl)) return false;

          // Reject if this matches original input image
          if (act.imgUrl && src === act.imgUrl) return false;

          return true;
        };

        let autoSent = false;
        const sendGeneratedImage = (imgSrc) => {
          if (autoSent) return;
          autoSent = true;
          if (window.__zhActivePollInterval) {
            clearInterval(window.__zhActivePollInterval);
            window.__zhActivePollInterval = null;
          }
          chrome.runtime?.sendMessage?.({
            action: 'ZH_REPLACE_IMAGE_FROM_FLOW',
            newImgUrl: imgSrc,
            productId: act.productId,
            imageIndex: act.imageIndex
          });
          updateFlowHUD(`✓ Image #${imgNum} → ZHunter! (${pTitle})`, 'ok');
          console.log('[ZHunter Flow] Sent generated image to ZHunter. productId:', act.productId, 'imgIndex:', act.imageIndex);
        };

        const scanForGeneratedImage = () => {
          // Only scan AFTER minimum wait — never before
          if (Date.now() - genStartTime < MIN_WAIT_MS) return [];

          // ONLY accept Flow's generated media URL (getMediaUrlRedirect)
          // Raw uploaded/reference images NEVER have this pattern
          const allFlowImgs = Array.from(document.querySelectorAll(
            'flow-image-tile img, .tiles-container img, .virtual-scroll-container img, .cdk-virtual-scroll-viewport img'
          ));

          return allFlowImgs.filter(img => {
            const src = img.src || img.getAttribute('src') || '';
            if (!src || uploadedSrcs.has(src)) return false;
            // Accept both URL patterns Flow uses for generated images
            return src.includes('flow-content.google/image/') ||
                   src.includes('getMediaUrlRedirect');
          });
        };

        // Clear any previous polling loop
        if (window.__zhActivePollInterval) {
          clearInterval(window.__zhActivePollInterval);
          window.__zhActivePollInterval = null;
        }

        // Lightweight 1.5s interval polling — 100% immune to RESULT_CODE_HUNG
        let pollCount = 0;
        const maxPollCount = 80; // 120 seconds maximum
        const pollInterval = setInterval(() => {
          if (autoSent) {
            clearInterval(pollInterval);
            window.__zhActivePollInterval = null;
            return;
          }

          // MIN_WAIT_MS is now enforced inside scanForGeneratedImage itself

          pollCount++;
          const candidates = scanForGeneratedImage();
          if (candidates.length > 0) {
            console.log('[ZHunter Flow] New generated image detected via lightweight polling');
            clearInterval(pollInterval);
            window.__zhActivePollInterval = null;
            sendGeneratedImage(candidates[candidates.length - 1].src);
            return;
          }

          if (pollCount >= maxPollCount) {
            clearInterval(pollInterval);
            window.__zhActivePollInterval = null;
            updateFlowHUD(`Image nahi mili — Right click > Copy Image karein`, 'warn', {
              label: '📥 Send to ZHunter',
              onClick: () => {
                const imgs = Array.from(document.querySelectorAll(
                  '.tiles-container img, .virtual-scroll-container img, .cdk-virtual-scroll-viewport img, flow-project-page img'
                )).filter(img => isValidGeneratedSrc(img.src, img) && img.naturalWidth >= 200);
                if (imgs.length > 0) sendGeneratedImage(imgs[imgs.length - 1].src);
                else updateFlowHUD('Abhi generate nahi hui — thoda ruko', 'warn');
              }
            });
          }
        }, 1500);

        window.__zhActivePollInterval = pollInterval;

        // Mark action processed NOW
        chrome?.storage?.local?.set({
          pendingFlowAction: { ...act, processed: true }
        });

        isRunningAction = false;
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

  // SPA URL navigation watcher
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      isRunningAction = false;
      handlePendingFlowAction();
    }
  }, 800);

  // Storage listener — ONLY fires for unprocessed actions
  // processed=true actions are ignored, preventing re-trigger while observer is active
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
