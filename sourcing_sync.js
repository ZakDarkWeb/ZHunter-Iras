/* Durable sourcing upload records. Loaded only by the service worker. */
'use strict';
function zhSourcingSheetId(value) {
  const match = String(value || '').match(/^[A-Za-z0-9_-]{20,}$/) || String(value || '').match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (!match) throw new Error('Paste your sourcing Google Spreadsheet URL.');
  return match[1] || match[0];
}
let zhSourcingLock = Promise.resolve();
function zhSourcingSerial(work) {
  const result = zhSourcingLock.then(work);
  zhSourcingLock = result.catch(() => {});
  return result;
}
function zhSourcingPrice(value) {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[$£€,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : '';
}
function zhSourcingLink(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !/(^|\.)temu\.com$/i.test(u.hostname) ? u.href : ''; } catch (_) { return ''; }
}
function zhSourcingPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/(^|\.)walmart\.com$/.test(host)) return 'Walmart';
    if (/(^|\.)amazon\.[a-z.]+$/.test(host)) return 'Amazon';
    if (/(^|\.)samsclub\.com$/.test(host)) return "Sam's Club";
    if (/(^|\.)aliexpress\.com$/.test(host)) return 'AliExpress';
    if (/(^|\.)alibaba\.com$/.test(host)) return 'Alibaba';
    return host;
  } catch (_) { return ''; }
}
function zhSourcingBatch(snapshot) {
  const store = String(snapshot?.store || '').trim();
  if (!store) throw new Error('Store name missing; sourcing record cannot choose a tab.');
  if (!snapshot.id || !Array.isArray(snapshot.items) || !snapshot.items.length || snapshot.items.length > 10000) throw new Error('Invalid sourcing batch.');
  const items = snapshot.items.map(it => {
    const url = zhSourcingLink(it.url);
    return { title: String(it.title || ''), url, platform: zhSourcingPlatform(url), sourcingPrice: zhSourcingPrice(it.sourcingPrice), listPrice: zhSourcingPrice(it.list) };
  });
  if (items.some(it => !it.url || !it.title)) throw new Error('Source links/titles missing; re-hunt imported products before syncing.');
  return { id: String(snapshot.id), store, t: Number(snapshot.t) || Date.now(), items, state: 'pending', attempts: 0 };
}
async function zhSourcingQueue(snapshot) {
  return zhSourcingSerial(async () => {
    const batch = zhSourcingBatch(snapshot);
    const saved = await chrome.storage.local.get('zhSourcingBatches');
    const batches = saved.zhSourcingBatches || [];
    if (!batches.some(b => b.id === batch.id)) {
      batches.push(batch);
      await chrome.storage.local.set({ zhSourcingBatches: batches });
    }
    await chrome.alarms.create('zh-sourcing-retry', { periodInMinutes: 5 });
    return { success: true, id: batch.id };
  });
}
function zhSourcingEndpoint(value) {
  const u = new URL(value);
  if (u.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) || u.search || u.hash) throw new Error('Paste a Google Apps Script Web App URL ending in /exec.');
  return u.href;
}
async function zhSourcingPost(config, body) {
  const endpoint = zhSourcingEndpoint(config.endpoint);
  const sheetId = zhSourcingSheetId(config.spreadsheetId);
  if (!/^[a-f0-9]{64}$/i.test(config.token || '')) throw new Error('Connection key must contain 64 hexadecimal characters.');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: config.token, spreadsheetId: sheetId }), signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Google connector returned HTTP ${response.status}.`);
  let data; try { data = await response.json(); } catch (_) { throw new Error('Connector needs deployment access or Google authorization; response was not JSON.'); }
  if (!data.ok || data.spreadsheetId !== sheetId) throw new Error(data.error || 'Connector is not linked to the selected spreadsheet.');
  return data;
}
async function zhSourcingConnect(config) {
  return zhSourcingSerial(async () => {
    config = { ...config, spreadsheetId: zhSourcingSheetId(config.spreadsheetId) };
    const previous = (await chrome.storage.local.get('zhSourcingConnection')).zhSourcingConnection;
    if (previous && previous.spreadsheetId !== config.spreadsheetId) throw new Error('This extension is already linked to a different sourcing workbook.');
    const data = await zhSourcingPost(config, { action: 'ping' });
    await chrome.storage.local.set({ zhSourcingConnection: { endpoint: zhSourcingEndpoint(config.endpoint), token: config.token, spreadsheetId: config.spreadsheetId } });
    return { success: true, title: data.title };
  });
}
async function zhSourcingStatus() {
  const saved = await chrome.storage.local.get(['zhSourcingConnection', 'zhSourcingBatches']);
  const batches = saved.zhSourcingBatches || [];
  return { success: true, connected: !!saved.zhSourcingConnection, pending: batches.filter(b => b.state !== 'synced').length, error: batches.filter(b => b.error).at(-1)?.error || '', endpoint: saved.zhSourcingConnection?.endpoint || '', spreadsheetId: saved.zhSourcingConnection?.spreadsheetId || '', sheetUrl: saved.zhSourcingConnection ? `https://docs.google.com/spreadsheets/d/${saved.zhSourcingConnection.spreadsheetId}/edit` : '' };
}
async function zhSourcingOpen(url) {
  const config = (await chrome.storage.local.get('zhSourcingConnection')).zhSourcingConnection;
  if (!config) throw new Error('Connect your sourcing workbook first.');
  const sheetId = zhSourcingSheetId(config.spreadsheetId);
  url = url || `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  const tabs = await chrome.tabs.query({ url: `https://docs.google.com/spreadsheets/d/${sheetId}/*` });
  if (tabs.length) await chrome.tabs.update(tabs[0].id, { url, active: true });
  else await chrome.tabs.create({ url, active: true });
}
async function zhSourcingRetry(open = false, targetId = '', force = false) {
  return zhSourcingSerial(async () => {
    const saved = await chrome.storage.local.get(['zhSourcingConnection', 'zhSourcingBatches']);
    const config = saved.zhSourcingConnection, batches = saved.zhSourcingBatches || [];
    if (!config) return { success: false, pending: batches.filter(b => b.state !== 'synced').length, error: 'Sourcing records saved locally. Connect Google Sheet in Temu Settings.' };
    const sheetId = zhSourcingSheetId(config.spreadsheetId);
    let lastUrl = '', synced = 0;
    for (const batch of batches.filter(b => b.state !== 'synced' && (open || force || !b.nextRetryAt || b.nextRetryAt <= Date.now()))) {
      try {
        const data = await zhSourcingPost(config, { action: 'append', batch });
        if (data.batchId !== batch.id || data.count !== batch.items.length || !Number.isInteger(data.gid)) throw new Error('Google append verification incomplete.');
        batch.state = 'synced'; batch.error = ''; batch.syncedAt = Date.now(); batch.gid = data.gid; synced++;
        lastUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${data.gid}`;
      } catch (e) { batch.error = e.message; batch.attempts++; batch.nextRetryAt = Date.now() + Math.min(3600000, 300000 * Math.pow(2, Math.min(batch.attempts - 1, 4))); }
      await chrome.storage.local.set({ zhSourcingBatches: batches });
      // One failed store must not hold unrelated stores behind it.
    }
    const done = batches.filter(b => b.state === 'synced').sort((a,b) => b.syncedAt - a.syncedAt);
    const retain = new Set(done.slice(0, 300).map(b => b.id));
    await chrome.storage.local.set({ zhSourcingBatches: batches.filter(b => b.state !== 'synced' || retain.has(b.id)) });
    const target = targetId && batches.find(b => b.id === targetId && b.state === 'synced');
    if (target) lastUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${target.gid}`;
    if (open && lastUrl) await zhSourcingOpen(lastUrl);
    const pending = batches.filter(b => b.state !== 'synced').length;
    return { success: pending === 0, synced, pending, error: batches.filter(b => b.state !== 'synced' && b.error).at(-1)?.error || '' };
  });
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'zh-sourcing-retry') zhSourcingRetry().catch(() => {}); });
