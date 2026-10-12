/**
 * Conexión opcional de UNA planilla con Mi Rutina.
 * Instalar en Apps Script de esa planilla y publicar como aplicación web.
 * La app funciona y guarda localmente aunque no se configure esta conexión.
 * Esta versión requiere el spreadsheetId que envía la app con perfiles.
 * No instalar sobre una conexión existente antes de actualizar su cliente.
 */
function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalize_(value) {
  return String(value == null ? '' : value).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function doGet() {
  return jsonResponse_({
    protocol: 'mi-rutina-v1',
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId()
  });
}

// Reproduce la identificación de encabezados del lector, sin modificar el plan.
function editableColumns_(rows, rowNumber) {
  var allowed = [];
  for (var i = 0; i < rowNumber; i++) {
    var row = rows[i] || [];
    var labels = row.map(normalize_);
    var first = labels[0] || '';
    var section = first.indexOf('entrada en calor') >= 0 || first.indexOf('zona media') >= 0 || first.indexOf('entrenamiento') >= 0;
    var day = /^dia\s*\d+/.test(first);
    var header = labels.indexOf('ejercicio') >= 0 && labels.some(function(v) { return v.indexOf('series') >= 0; });
    var sectionHeader = section && labels.some(function(v) {
      return /video|series|descanso|peso|rpe/.test(v);
    });
    if (day || section) allowed = [];
    if (header || sectionHeader) {
      var weight = labels.findIndex(function(v) { return v.indexOf('peso') >= 0; });
      var observations = labels.map(function(v, n) { return v.indexOf('observ') >= 0 ? n : -1; }).filter(function(n) { return n >= 0; });
      allowed = [];
      if (weight >= 0) allowed.push(weight + 1);
      if (observations.length) allowed.push(observations[observations.length - 1] + 1);
    }
    if (i === rowNumber - 1 && (!first || day || section || header || first === 'ejercicio' || first.indexOf('video explicativo') >= 0)) return [];
  }
  return allowed;
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var id = ss.getId();
    if (body.spreadsheetId !== id) throw new Error('La conexión pertenece a otra planilla.');
    if (!Array.isArray(body.changes) || body.changes.length > 2000) throw new Error('La lista de cambios no es válida.');
    var sources = {};
    // Validar todo el lote antes de escribir la primera celda.
    var pending = body.changes.map(function(c) {
      if (!c || typeof c.sheet !== 'string' || !(/^(?:semana|plan)\s*\d+$/i.test(c.sheet) || normalize_(c.sheet).indexOf('entrenamiento en casa') >= 0)) {
        throw new Error('La pestaña no pertenece a una rutina.');
      }
      if (!Number.isInteger(c.row) || !Number.isInteger(c.col) || c.row < 1 || c.col < 1) throw new Error('La celda no es válida.');
      var cacheKey = 'sheet:' + c.sheet;
      if (!sources[cacheKey]) {
        var sh = ss.getSheetByName(c.sheet);
        if (!sh) throw new Error('La pestaña ya no existe.');
        sources[cacheKey] = { sheet: sh, rows: sh.getDataRange().getValues() };
      }
      var source = sources[cacheKey];
      if (c.row > source.rows.length || editableColumns_(source.rows, c.row).indexOf(c.col) < 0) {
        throw new Error('Solo se pueden guardar pesos y observaciones de ejercicios.');
      }
      if (typeof c.value !== 'string' && typeof c.value !== 'number') throw new Error('El valor no es válido.');
      var value = c.value;
      // Una nota se guarda como texto, nunca como una fórmula nueva.
      if (typeof value === 'string' && value.charAt(0) === '=') value = "'" + value;
      return { sheet: source.sheet, row: c.row, col: c.col, value: value };
    });
    pending.forEach(function(c) { c.sheet.getRange(c.row, c.col).setValue(c.value); });
    return jsonResponse_({ ok: true, spreadsheetId: id, updated: pending.length });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}
