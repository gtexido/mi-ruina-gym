/**
 * Webhook para Mi Rutina App.
 * 1) Abrí Google Sheets > Extensiones > Apps Script.
 * 2) Pegá este código.
 * 3) Implementar > Nueva implementación > Aplicación web.
 * 4) Ejecutar como: Tú. Acceso: Cualquier persona con el enlace.
 * 5) Copiá la URL y pegala en la app cuando toques "Guardar Sheet".
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const changes = body.changes || [];

    changes.forEach(c => {
      if (!c.sheet || !c.row || !c.col) return;
      const sh = ss.getSheetByName(c.sheet);
      if (!sh) return;
      sh.getRange(Number(c.row), Number(c.col)).setValue(c.value || '');
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, updated: changes.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
