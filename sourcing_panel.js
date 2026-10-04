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
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.zhSourcingBatches || changes.zhSourcingConnection)) refresh().catch(() => {}); });
  refresh().catch(() => { label.textContent = 'Connection status unavailable'; });
})();
