const test = require('node:test');
const assert = require('node:assert/strict');
const Profiles = require('../routine-store.js');
const GUS = 'gustavo_fixture_12345678901234567890';
const VANE = 'vanesa_fixture_12345678901234567890';
function memory(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { values, getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)) };
}

test('la migración conserva todos los registros anteriores y deja sus claves intactas', () => {
  const seed = {
    rt_sheetUrl: Profiles.canonicalUrl(GUS),
    rt_v12_completed: '{"Semana 1_0_0":true}',
    rt_v12_edits: '{"Semana 1_0_0":{"weight":"20","obs":"Registro anterior"}}',
    rt_v2_collapsed: '{"Semana 1_0_0":true}',
    rt_lastSession: '{"sheetName":"Semana 1","dayIdx":1}',
    rt_webhook: 'https://script.google.com/macros/s/legacy/exec'
  };
  const storage = memory(seed), store = Profiles.create(storage, GUS);
  store.migrateLegacy();
  const result = store.read(GUS);
  assert.deepEqual(result.edits, JSON.parse(seed.rt_v12_edits));
  assert.deepEqual(result.completed, JSON.parse(seed.rt_v12_completed));
  assert.deepEqual(result.collapsed, JSON.parse(seed.rt_v2_collapsed));
  assert.deepEqual(result.lastSession, JSON.parse(seed.rt_lastSession));
  assert.equal(result.webhook, seed.rt_webhook);
  assert.equal(result.webhookMode, 'legacy');
  for (const [key, value] of Object.entries(seed)) assert.equal(storage.getItem(key), value);
  assert.deepEqual(store.read(VANE).edits, {});
  assert.equal(store.read(VANE).webhook, '');
});

test('pesos, progreso, sesión y conexión de dos planillas nunca comparten estado', () => {
  const storage = memory(), store = Profiles.create(storage, GUS);
  store.migrateLegacy();
  const gus = store.read(GUS), vane = store.read(VANE);
  gus.edits.same = { weight: '30' }; gus.completed.same = true;
  gus.lastSession = { sheetName: 'Semana 2', dayIdx: 2 };
  gus.webhook = 'gus';
  vane.edits.same = { weight: '8' }; vane.webhook = 'vane';
  store.write(GUS, gus); store.write(VANE, vane);
  assert.equal(store.read(GUS).edits.same.weight, '30');
  assert.equal(store.read(VANE).edits.same.weight, '8');
  assert.deepEqual(store.read(VANE).completed, {});
  assert.equal(store.read(VANE).lastSession, null);
  assert.equal(store.read(GUS).webhook, 'gus');
  vane.edits = {}; vane.completed = {}; store.write(VANE, vane);
  assert.equal(store.read(GUS).edits.same.weight, '30');
  storage.setItem('rt_sheetUrl', Profiles.canonicalUrl(VANE));
  store.migrateLegacy();
  assert.deepEqual(store.read(VANE).edits, {});
});

test('la rutina anterior identifica al dueño de la migración, no un enlace nuevo', () => {
  const storage = memory({ rt_sheetUrl: Profiles.canonicalUrl(VANE), rt_v12_edits: '{"a":{"weight":"9"}}', rt_webhook: 'destino-anterior-no-verificado' });
  const store = Profiles.create(storage, GUS);
  store.migrateLegacy();
  assert.equal(store.read(VANE).edits.a.weight, '9');
  assert.deepEqual(store.read(GUS).edits, {});
  assert.equal(store.read(VANE).webhook, '');
  assert.equal(storage.getItem('rt_webhook'), 'destino-anterior-no-verificado');
});

test('una migración no sobrescribe perfiles existentes ni resucita datos ya limpiados', () => {
  const storage = memory({rt_v12_edits:'{"a":{"weight":"20"}}'}), store = Profiles.create(storage, GUS);
  store.write(GUS, { ...store.read(GUS), edits: { a: { weight: '40' } } });
  store.migrateLegacy();
  assert.equal(store.read(GUS).edits.a.weight, '40');
  store.write(GUS, { ...store.read(GUS), edits: {} });
  store.migrateLegacy();
  assert.deepEqual(store.read(GUS).edits, {});
  assert.equal(storage.getItem('rt_v12_edits'), '{"a":{"weight":"20"}}');
});

test('enlaces inválidos y datos corruptos no activan silenciosamente otra rutina', () => {
  for (const url of ['', 'https://example.com/spreadsheets/d/' + GUS, 'https://docs.google.com.evil.test/spreadsheets/d/' + GUS, 'http://docs.google.com/spreadsheets/d/' + GUS]) {
    assert.throws(() => Profiles.sheetId(url));
  }
  const storage = memory({rt_v12_edits:'{invalid'}), store = Profiles.create(storage, GUS);
  assert.throws(() => store.migrateLegacy());
  assert.equal(storage.getItem('rt_v12_edits'), '{invalid');
  assert.equal(storage.getItem('rt_profile_migration_v1'), null);
  assert.equal(storage.getItem('rt_profile_v1:' + GUS), null);
});

test('parámetros de compartir distintos identifican la misma planilla', () => {
  const a = 'https://docs.google.com/spreadsheets/d/' + GUS + '/edit?usp=sharing&ouid=123';
  const b = 'https://docs.google.com/spreadsheets/d/' + GUS + '/edit?usp=drivesdk';
  assert.equal(Profiles.sheetId(a), Profiles.sheetId(b));
  assert.equal(Profiles.canonicalUrl(a), Profiles.canonicalUrl(b));
});
