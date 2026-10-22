/* Native collapsible settings; fold preferences are independent of store values. */
(async function () {
  const folds = [...document.querySelectorAll('#temuModal [data-settings-fold]')];
  let preferences = {};
  try { preferences = (await chrome.storage.local.get('zhTemuSettingsFolds')).zhTemuSettingsFolds || {}; } catch (_) { typeof zhQuiet === 'function' && zhQuiet(_); }
  for (const fold of folds) {
    // no saved choice yet → keep the HTML default (v9.17: "Price & stock" starts open)
    fold.open = fold.dataset.settingsFold in preferences ? !!preferences[fold.dataset.settingsFold] : fold.hasAttribute('open');
    fold.addEventListener('toggle', () => {
      preferences[fold.dataset.settingsFold] = fold.open;
      chrome.storage.local.set({ zhTemuSettingsFolds: { ...preferences } }).catch(_zq => { typeof zhQuiet === 'function' && zhQuiet(_zq); });
    });
  }
})();
