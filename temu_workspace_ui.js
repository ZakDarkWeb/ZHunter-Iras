/* Native collapsible settings; fold preferences are independent of store values. */
(async function () {
  const folds = [...document.querySelectorAll('#temuModal [data-settings-fold]')];
  let preferences = {};
  try { preferences = (await chrome.storage.local.get('zhTemuSettingsFolds')).zhTemuSettingsFolds || {}; } catch (_) {}
  for (const fold of folds) {
    fold.open = !!preferences[fold.dataset.settingsFold];
    fold.addEventListener('toggle', () => {
      preferences[fold.dataset.settingsFold] = fold.open;
      chrome.storage.local.set({ zhTemuSettingsFolds: { ...preferences } }).catch(() => {});
    });
  }
})();
