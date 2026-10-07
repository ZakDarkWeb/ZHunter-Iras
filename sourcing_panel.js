/* Sourcing connection UI. Credentials stay in local extension storage. */
(function () {
  const label = $('zhSourcingStatus');
  if (!label) return;
  async function refresh() {
    const status = await msg({ action: 'SOURCING_STATUS' });
    if (status?.connected) { if (!$('zhSourcingWorkbook').value) $('zhSourcingWorkbook').value = status.sheetUrl; if (!$('zhSourcingEndpoint').value) $('zhSourcingEndpoint').value = status.endpoint; }
    const summary = $('zhSourcingSummaryStatus');
    if (summary) summary.textContent = status?.success ? (status.connected ? 'Connected' : 'Setup required') : 'Connection';
    label.textContent = status?.success ? `${status.connected ? 'Connected' : 'Setup required'} · ${status.pending} uploads pending${status.error ? ' · ' + status.error : ''}` : 'Connection status unavailable';
  }
  async function run(button, work) {
    button.disabled = true;
    try { await work(); } catch (error) { label.textContent = error.message; }
    finally { button.disabled = false; }
  }
  $('zhSourcingOpen').addEventListener('click', e => run(e.currentTarget, async () => { const result = await msg({ action: 'SOURCING_OPEN' }); if (!result?.success) throw new Error(result?.error || 'Connect your workbook first'); }));
  const disconnect = document.createElement('button'); disconnect.type = 'button'; disconnect.className = 'btn btn-secondary btn-xs'; disconnect.textContent = 'Disconnect';
  $('zhSourcingRetry').after(disconnect);
  disconnect.addEventListener('click', e => run(e.currentTarget, async () => { if (!confirm('Disconnect sourcing workbook? Pending records stay saved locally.')) return; const result = await msg({ action: 'SOURCING_DISCONNECT' }); if (!result?.success) throw new Error(result?.error || 'Disconnect failed'); $('zhSourcingWorkbook').value = ''; $('zhSourcingEndpoint').value = ''; await refresh(); }));
  $('zhSourcingNewKey').addEventListener('click', () => {
    $('zhSourcingKey').value = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    // Reveal only on deliberate creation so the user can copy into Script Properties.
    $('zhSourcingKey').type = 'text';
    label.textContent = 'Copy this private key into Apps Script property ZHUNTER_SYNC_KEY, then Connect.';
  });
  $('zhSourcingConnect').addEventListener('click', e => run(e.currentTarget, async () => {
    const result = await msg({ action: 'SOURCING_CONNECT', config: { spreadsheetId: $('zhSourcingWorkbook').value.trim(), endpoint: $('zhSourcingEndpoint').value.trim(), token: $('zhSourcingKey').value.trim() } });
    if (!result?.success) throw new Error(result?.error || 'Connection failed');
    $('zhSourcingKey').value = ''; $('zhSourcingKey').type = 'password';
    await refresh();
  }));
  $('zhSourcingRetry').addEventListener('click', e => run(e.currentTarget, async () => {
    label.textContent = 'Syncing sourcing records…';
    const result = await msg({ action: 'SOURCING_RETRY' });
    if (!result?.success && result?.error) throw new Error(result.error);
    await refresh();
  }));
  // ── Quick setup (v9.15): sheet auto-detected, key + sheet id baked into a ready script, one URL paste connects ──
  const qInfo = $('zhQuickSheetInfo');
  const randKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  $('zhQuickSheetBtn')?.addEventListener('click', e => run(e.currentTarget, async () => {
    const typed = ($('zhQuickSheetUrl')?.value || '').trim();
    const tm = typed.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
    if (tm) { $('zhSourcingWorkbook').value = 'https://docs.google.com/spreadsheets/d/' + tm[1] + '/edit'; qInfo.textContent = 'Sheet chosen (from your link).'; return; }
    if (typed) throw new Error('That is not a Google Sheets link.');
    const tabs = await chrome.tabs.query({ url: 'https://docs.google.com/spreadsheets/d/*' });
    const tab = tabs.find(t => t.active) || tabs[0];
    if (!tab) { await chrome.tabs.create({ url: 'https://sheets.new', active: true }); qInfo.textContent = 'A new Google Sheet was opened. Name it (e.g. "Sourcing"), then press this button again.'; return; }
    const m = (tab.url || '').match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
    if (!m) throw new Error('Open your sourcing sheet first.');
    $('zhSourcingWorkbook').value = 'https://docs.google.com/spreadsheets/d/' + m[1] + '/edit';
    qInfo.textContent = 'Sheet chosen: ' + (tab.title || 'Google Sheet').replace(/ - Google Sheets$/, '');
  }));
  $('zhQuickCopyBtn')?.addEventListener('click', e => run(e.currentTarget, async () => {
    const sheetUrl = $('zhSourcingWorkbook').value.trim();
    const m = sheetUrl.match(/\/d\/([A-Za-z0-9_-]{20,})/) || sheetUrl.match(/^([A-Za-z0-9_-]{20,})$/);
    if (!m) throw new Error('Do step 1 first (choose your Google Sheet).');
    let key = $('zhSourcingKey').value.trim();
    if (!/^[a-f0-9]{64}$/i.test(key)) { key = randKey(); $('zhSourcingKey').value = key; }
    await chrome.storage.local.set({ zhSourcingPendingKey: key });
    let code = await (await fetch(chrome.runtime.getURL('integrations/google_sourcing/Code.gs'))).text();
    code = code.replace("const ZH_DEFAULT_SHEET_ID = '';", "const ZH_DEFAULT_SHEET_ID = '" + m[1] + "';").replace("const ZH_DEFAULT_KEY = '';", "const ZH_DEFAULT_KEY = '" + key + "';");
    await navigator.clipboard.writeText(code);
    await chrome.tabs.create({ url: 'https://script.google.com/home/projects/create', active: true });
    label.textContent = 'Script copied (private key inside — do not share it). Paste it in Apps Script, deploy as Web app, then paste the URL in step 3.';
  }));
  // ── Same sheet in every Chrome: one connection code (Web app URL + sheet + private key) ──
  $('zhConnCopyBtn')?.addEventListener('click', e => run(e.currentTarget, async () => {
    const c = (await chrome.storage.local.get('zhSourcingConnection')).zhSourcingConnection;
    if (!c) throw new Error('This Chrome is not connected yet — finish the Quick setup first.');
    await navigator.clipboard.writeText('ZHSRC1.' + btoa(JSON.stringify({ u: c.endpoint, s: c.spreadsheetId, k: c.token })));
    label.textContent = 'Connection code copied. It contains your private key — paste it only in your own Chrome profiles.';
  }));
  $('zhConnCode')?.addEventListener('change', e => run(e.currentTarget, async () => {
    const raw = e.currentTarget.value.trim(); if (!raw) return;
    let d; try { d = JSON.parse(atob(raw.replace(/^ZHSRC1\./, ''))); } catch (_) { throw new Error('That connection code is not valid.'); }
    if (!d?.u || !d?.s || !d?.k) throw new Error('That connection code is incomplete.');
    label.textContent = 'Connecting…';
    const result = await msg({ action: 'SOURCING_CONNECT', config: { spreadsheetId: d.s, endpoint: d.u, token: d.k } });
    if (!result?.success) throw new Error(result?.error || 'Connection failed');
    e.currentTarget.value = ''; await refresh();
  }));
  const quickUrl = $('zhQuickUrl');
  const quickConnect = () => run(quickUrl, async () => {
    const url = quickUrl.value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) { if (url) label.textContent = 'That is not a Web app URL ending in /exec.'; return; }
    $('zhSourcingEndpoint').value = url;
    if (!/^[a-f0-9]{64}$/i.test($('zhSourcingKey').value.trim())) { const k = (await chrome.storage.local.get('zhSourcingPendingKey')).zhSourcingPendingKey; if (k) $('zhSourcingKey').value = k; }
    label.textContent = 'Connecting…';
    $('zhSourcingConnect').click();
    setTimeout(() => { chrome.storage.local.remove('zhSourcingPendingKey').catch(() => {}); quickUrl.value = ''; }, 4000);
  });
  quickUrl?.addEventListener('change', quickConnect);
  quickUrl?.addEventListener('paste', () => setTimeout(quickConnect, 50));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.zhSourcingBatches || changes.zhSourcingConnection)) refresh().catch(() => {}); });
  refresh().catch(() => { label.textContent = 'Connection status unavailable'; });
})();
