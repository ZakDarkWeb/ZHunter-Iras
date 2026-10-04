# Connect the sourcing workbook once

The destination workbook is configured privately in the extension and Script Properties. No workbook ID or key is stored in this repository.

The extension records uploads locally even before this setup. It sends all attempted products, including Temu errors, with the exact exported title and original supplier link. It does not claim they were successfully listed. Source prices come from the source product, not Temu's multiplied base price. Missing prices stay blank.

1. Open your selected sourcing workbook in your own signed-in Chrome. Select **Extensions → Apps Script**. Paste `Code.gs` from this folder into the script editor and save.
2. In **Temu Export → Settings → Sourcing records**, click **Create connection key**. Copy the key privately. In Apps Script **Project Settings → Script Properties**, add `ZHUNTER_SYNC_KEY` with that key and `ZHUNTER_SPREADSHEET_ID` with the workbook ID (the part between `/d/` and `/edit` in its URL). Never put the key in code, GitHub, screenshots or chat.
3. Deploy → New deployment → Web app. Set **Execute as: Me**, **Who has access: Anyone**. This exposes the connector endpoint; every request still requires the private key and only appends to the fixed workbook. The workbook itself does not need public sharing. Review and authorize the Google permissions in your account; only deploy if you accept this access model. Revoke by deleting the deployment/key.
4. Paste your **Sourcing spreadsheet URL** and the deployment **Web app URL** ending in `/exec` in the extension and click **Connect**. The extension verifies the key and destination without creating rows. Click **Retry pending** to send already saved uploads.

New store tabs get six visible columns: Product Name, Sourcing Platform, Sourcing Link, Sourcing Price, List Price, Date. Teal/white header, cyan platform cells, frozen header, currency formatting and alternating rows follow the supplied screenshot. One hidden `_ZH Batch` column prevents duplicates after network failures; do not delete it. Existing nonempty tabs with incompatible headers are left untouched and show an error. The extension opens the exact store tab after successful sync. Background retries run every five minutes without stealing focus.

If an imported Temu XLSX contains no supplier links, re-hunt the products first. The extension will never invent a source link or substitute a Temu URL. Completed batches retain a local snapshot. A repeated sync of the same batch does not append duplicates; a new export is a new upload batch.

Deployment reference: [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web).
