/** ZHunter sourcing connector. Fixed destination; authenticated append-only API. */
// Destination is stored privately in Script Properties, never in repository code.
// Filled automatically by the extension's "Copy script" button (kept empty in the repository).
const ZH_DEFAULT_SHEET_ID = '';
const ZH_DEFAULT_KEY = '';
const ZH_HEADERS = ['Product Name', 'Sourcing Platform', 'Sourcing Link', 'Sourcing Price', 'List Price', 'Date'];

function doPost(e) {
  const json = value => ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  let lock;
  try {
    const request = JSON.parse(e.postData.contents);
    const ZH_SHEET_ID = (PropertiesService.getScriptProperties().getProperty('ZHUNTER_SPREADSHEET_ID') || ZH_DEFAULT_SHEET_ID);
    if (!ZH_SHEET_ID || !/^[A-Za-z0-9_-]{20,}$/.test(ZH_SHEET_ID)) throw new Error('Set ZHUNTER_SPREADSHEET_ID in Script Properties.');
    const token = (PropertiesService.getScriptProperties().getProperty('ZHUNTER_SYNC_KEY') || ZH_DEFAULT_KEY);
    if (!token || !/^[a-f0-9]{64}$/i.test(token) || request.token !== token) throw new Error('Invalid connection key.');
    if (request.spreadsheetId !== ZH_SHEET_ID) throw new Error('Wrong spreadsheet.');
    const book = SpreadsheetApp.openById(ZH_SHEET_ID);
    if (request.action === 'ping') return json({ ok: true, spreadsheetId: ZH_SHEET_ID, title: book.getName() });
    if (request.action !== 'append') throw new Error('Unsupported action.');
    const batch = request.batch;
    if (!batch || !/^[a-zA-Z0-9_-]{1,100}$/.test(batch.id) || !Array.isArray(batch.items) || !batch.items.length || batch.items.length > 10000) throw new Error('Invalid upload batch.');
    const name = String(batch.store || '').trim();
    if (!name || name.length > 100 || /[\\/?*\[\]:]/.test(name)) throw new Error('Store name cannot be used as a Google tab name. Rename the store before syncing.');
    const text = value => { const s = String(value || ''); return /^\s*[=+@-]/.test(s) ? "'" + s : s; };
    const price = value => value === '' || value == null ? '' : (typeof value === 'number' && isFinite(value) && value >= 0 ? value : (() => { throw new Error('Invalid price.'); })());
    const date = new Date(batch.t);
    if (isNaN(date.getTime())) throw new Error('Invalid upload date.');
    const day = Utilities.formatDate(date, book.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const rows = batch.items.map(item => {
      if (!item.title || !/^https?:\/\//i.test(item.url || '') || /^https?:\/\/(?:[^/]+\.)?temu\.com(?:\/|$)/i.test(item.url)) throw new Error('Source title/link missing or invalid.');
      return [text(item.title), text(item.platform), text(item.url), price(item.sourcingPrice), price(item.listPrice), day, batch.id];
    });
    lock = LockService.getScriptLock(); lock.waitLock(25000);
    let sheet = book.getSheetByName(name);
    if (!sheet) sheet = book.insertSheet(name);
    if (sheet.getLastRow() === 0) zhFormatSourcingSheet(sheet);
    if (sheet.getMaxColumns() < 7) sheet.insertColumnsAfter(sheet.getMaxColumns(), 7 - sheet.getMaxColumns());
    const headers = sheet.getRange(1, 1, 1, 7).getValues()[0];
    if (!ZH_HEADERS.every((header, i) => String(headers[i]).trim() === header)) throw new Error('Store tab has a different format. Use an empty store tab or the ZHunter six-column template.');
    if (!headers[6] && sheet.getRange(1, 7, Math.max(sheet.getLastRow(), 1), 1).getValues().every(row => !row[0])) {
      sheet.getRange(1, 7).setValues([['_ZH Batch']]); sheet.hideColumns(7);
    } else if (headers[6] !== '_ZH Batch') throw new Error('Column G already contains data; sourcing sync left the tab unchanged.');
    const last = sheet.getLastRow();
    const count = last > 1 ? sheet.getRange(2, 7, last - 1, 1).getValues().filter(row => row[0] === batch.id).length : 0;
    if (count && count !== rows.length) throw new Error('Partial batch detected; check store tab before retrying.');
    if (!count) {
      const start = last + 1;
      if (start + rows.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), start + rows.length - 1 - sheet.getMaxRows());
      // All data and retry keys share one setValues operation; no clear/overwrite.
      sheet.getRange(start, 1, rows.length, 7).setValues(rows);
      sheet.getRange(start, 1, rows.length, 6).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
      sheet.getRange(start, 2, rows.length, 1).setBackground('#42eff1');
      sheet.getRange(start, 3, rows.length, 1).setFontColor('#1155cc');
      sheet.getRange(start, 4, rows.length, 2).setNumberFormat('$0.00');
      sheet.setRowHeights(start, rows.length, 22);
      SpreadsheetApp.flush();
    }
    return json({ ok: true, spreadsheetId: ZH_SHEET_ID, batchId: batch.id, count: rows.length, gid: sheet.getSheetId(), duplicate: !!count });
  } catch (error) { return json({ ok: false, error: error.message }); }
  finally { if (lock) lock.releaseLock(); }
}

function zhFormatSourcingSheet(sheet) {
  if (sheet.getMaxColumns() < 7) sheet.insertColumnsAfter(sheet.getMaxColumns(), 7 - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, 7).setValues([[...ZH_HEADERS, '_ZH Batch']]);
  sheet.getRange(1, 1, 1, 6).setBackground('#006b66').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center');
  sheet.setRowHeight(1, 30); sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 385); sheet.setColumnWidth(2, 185); sheet.setColumnWidth(3, 320);
  sheet.setColumnWidths(4, 2, 105); sheet.setColumnWidth(6, 110);
  sheet.getRange(1, 1, sheet.getMaxRows(), 6).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  sheet.getRange(1, 1, 1, 6).setBackground('#006b66').setFontColor('#ffffff');
  sheet.hideColumns(7); // Private retry marker; six visible columns, no Status/Temu URL.
}
