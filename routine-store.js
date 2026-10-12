/* Registros locales separados por planilla. No escribe en Google Sheets. */
(function (root) {
  'use strict';
  const PREFIX = 'rt_profile_v1:';
  const MIGRATED = 'rt_profile_migration_v1';

  function sheetId(value) {
    const text = String(value || '').trim();
    if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
    let url;
    try { url = new URL(text); } catch (_) { throw new Error('Pegá un enlace válido de Google Sheets.'); }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) {
      throw new Error('Pegá un enlace válido de Google Sheets.');
    }
    return match[1];
  }

  function canonicalUrl(value) {
    return 'https://docs.google.com/spreadsheets/d/' + sheetId(value) + '/edit';
  }

  function empty() {
    return { completed: {}, edits: {}, collapsed: {}, lastSession: null, displayName: '', webhook: '', webhookMode: '' };
  }

  function parse(raw, fallback, label) {
    if (raw === null) return fallback;
    try { return JSON.parse(raw); }
    catch (_) { throw new Error('No pude leer ' + label + '. Tus datos anteriores se conservaron.'); }
  }

  function create(storage, defaultId) {
    const defaultSheetId = sheetId(defaultId);
    function read(id) {
      const saved = parse(storage.getItem(PREFIX + sheetId(id)), null, 'los registros de esta rutina');
      if (saved === null) return empty();
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        throw new Error('Los registros de esta rutina no tienen un formato válido. No se sobrescribieron.');
      }
      for (const field of ['completed', 'edits', 'collapsed']) {
        if (saved[field] && (typeof saved[field] !== 'object' || Array.isArray(saved[field]))) {
          throw new Error('No pude leer los registros de esta rutina. No se sobrescribieron.');
        }
      }
      return Object.assign(empty(), saved);
    }
    function write(id, state) {
      storage.setItem(PREFIX + sheetId(id), JSON.stringify(state));
    }
    function migrateLegacy() {
      if (storage.getItem(MIGRATED)) return;
      // El enlace entrante nunca decide a quién pertenecen los registros anteriores.
      const previousUrl = storage.getItem('rt_sheetUrl');
      const previousId = previousUrl ? sheetId(previousUrl) : defaultSheetId;
      if (storage.getItem(PREFIX + previousId) === null) {
        const state = empty();
        state.completed = parse(storage.getItem('rt_v12_completed'), {}, 'el progreso anterior');
        state.edits = parse(storage.getItem('rt_v12_edits'), {}, 'los pesos y notas anteriores');
        state.collapsed = parse(storage.getItem('rt_v2_collapsed'), {}, 'las secciones anteriores');
        state.lastSession = parse(storage.getItem('rt_lastSession'), null, 'la sesión anterior');
        // La versión anterior tenía un solo destino de escritura. No lo atribuir
        // automáticamente a otra planilla si se había cambiado el enlace de lectura.
        state.webhook = previousId === defaultSheetId ? (storage.getItem('rt_webhook') || '') : '';
        state.webhookMode = state.webhook ? 'legacy' : '';
        write(previousId, state);
      }
      // Las claves originales quedan intactas como respaldo. Nunca se vuelven a importar.
      storage.setItem(MIGRATED, previousId);
    }
    return { read, write, migrateLegacy };
  }

  const api = { create, sheetId, canonicalUrl };
  root.RoutineProfiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
