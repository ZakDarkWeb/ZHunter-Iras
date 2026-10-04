/* Background-only Library commits and portable non-secret backups. */
'use strict';
const ZH_BACKUP_KEYS = ['zhunterMasterSheet', 'zhunterMasterBatches', 'zhunterBulkQueue', 'temuUploadHistory', 'temuLastMarked', 'temuDailyTarget', 'zhImgEdits', 'zhTextEdits', 'zhTemuSettingsFolds', 'zhSourcingBatches'];
const zhSameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function zhMasterCommit({ baseline, rows }) {
  if (!Array.isArray(baseline) || !Array.isArray(rows) || rows.some(r => !r?.id || !/^https?:\/\//i.test(r.url || ''))) throw new Error('Invalid Library commit');
  const before = new Map(baseline.map(r => [r.id, r]));
  const desired = new Map(rows.map(r => [r.id, r]));
  if (desired.size !== rows.length) throw new Error('Duplicate Library product IDs');
  const current = (await chrome.storage.local.get('zhunterMasterSheet')).zhunterMasterSheet || [];
  for (const row of current) if (before.has(row.id) && !desired.has(row.id) && !zhSameValue(row, before.get(row.id))) throw new Error('Product changed before deletion; reload Library');
  const next = current.filter(r => !before.has(r.id) || desired.has(r.id));
  for (const row of rows) {
    const old = before.get(row.id), latest = next.find(r => r.id === row.id);
    if (!old) {
      if (!latest && !next.some(r => r.url === row.url)) next.push(row);
      continue;
    }
    // A concurrently deleted product must not be resurrected by a stale editor.
    if (!latest) throw new Error('Product was deleted elsewhere; reload Library');
    for (const key of new Set([...Object.keys(old), ...Object.keys(row)])) {
      if (key === 'id' || zhSameValue(old[key], row[key])) continue;
      if (!zhSameValue(latest[key], old[key]) && !zhSameValue(latest[key], row[key])) throw new Error('Product changed elsewhere: ' + key + '. Reload and retry');
      if (Object.prototype.hasOwnProperty.call(row, key)) latest[key] = row[key];
      else delete latest[key];
    }
  }
  await chrome.storage.local.set({ zhunterMasterSheet: next });
  return { success: true, count: next.length };
}
async function zhBackupExport() {
  const values = await chrome.storage.local.get(ZH_BACKUP_KEYS);
  const data = await getData();
  const media = {};
  for (const link of data.links || []) media[link.id] = await getImagesFromIndexedDB(link.id);
  return { success: true, backup: { format: 'zhunter-backup', version: 2, exportedAt: new Date().toISOString(), values, media, data: { ...data, settings: getPublicSettings(data.settings) } } };
}
async function zhBackupRestore(backup) {
  if (backup?.format !== 'zhunter-backup' || backup.version !== 2 || !backup.values || !backup.data) throw new Error('Unsupported backup');
  const values = {};
  for (const key of ZH_BACKUP_KEYS) if (Object.prototype.hasOwnProperty.call(backup.values, key)) values[key] = backup.values[key];
  for (const key of ['zhunterMasterSheet','zhunterMasterBatches','zhunterBulkQueue','temuUploadHistory']) if (values[key] && !Array.isArray(values[key])) throw new Error('Invalid backup: ' + key);
  const data = await getData();
  data.links = Array.isArray(backup.data.links) ? backup.data.links : [];
  data.folders = Array.isArray(backup.data.folders) ? backup.data.folders : data.folders;
  data.tags = Array.isArray(backup.data.tags) ? backup.data.tags : data.tags;
  data.history = Array.isArray(backup.data.history) ? backup.data.history : [];
  data.settings = { ...data.settings, ...sanitizeSettingsPatch(backup.data.settings) };
  for (const [id, images] of Object.entries(backup.media || {})) {
    if (!Array.isArray(images) || !await saveImagesToIndexedDB(id, images)) throw new Error('Media restore failed; current products were not replaced');
  }
  // One atomic storage set; private Groq/connector keys remain profile-local.
  values[STORAGE_KEY] = data;
  await chrome.storage.local.set(values);
  return { success: true };
}
async function zhMasterReset(wipe = false) {
  if (wipe) {
    await chrome.storage.local.remove([...ZH_BACKUP_KEYS, 'zhTemuUploadJob', 'zhunterHuntState', 'zhunterPendingHunt', 'zhunterPendingImageHunt', 'pendingBulkHunt', 'pendingFlowAction', 'pendingGptAction', 'pendingGeminiAction']);
    const data = await getData(); data.links = []; data.history = []; data.settings.temuListed = {};
    if (!await saveData(data)) throw new Error('Reset storage failed');
    await clearIndexedDBImages();
  } else {
    await chrome.storage.local.remove(['zhunterMasterSheet','zhunterMasterBatches','zhImgEdits','zhTextEdits']);
  }
  return { success: true };
}
