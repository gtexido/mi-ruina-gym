const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const storeScript = fs.readFileSync(path.join(__dirname, '../routine-store.js'), 'utf8');
const GUS = html.match(/const DEFAULT_SHEET_ID='([^']+)'/)[1];
const VANE = 'vane_fixture_12345678901234567890';
const BAD = 'bad_fixture_12345678901234567890';
const SLOW = 'slow_fixture_12345678901234567890';
const KEY = 'Semana 1_0_0';
const sheetUrl = id => 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
const gusEndpoint = 'https://script.google.com/macros/s/gus_fixture/exec';
const vaneEndpoint = 'https://script.google.com/macros/s/vane_fixture/exec';

function workbook(person) {
  return { SheetNames: ['Semana 1'], Sheets: { 'Semana 1': [
    ['DÍA 1'],
    ['Ejercicio', 'Video', 'Series', 'Descanso', 'RPE', 'Peso', 'Observaciones'],
    ['Movilidad ' + person, '', '2x10', '30 s', '6', person === 'Vane' ? '8' : '15', 'Del entrenador'],
    ['ENTRENAMIENTO'],
    ['Ejercicio', 'Video', 'Series', 'Descanso', 'RPE', 'Peso', 'Observaciones'],
    [person === 'Vane' ? 'Sentadilla' : 'Remo', '', '3x10', '60 s', '7', '12', ''],
    ['DÍA 2'],
    ['Ejercicio', 'Video', 'Series', 'Descanso', 'RPE', 'Peso', 'Observaciones'],
    ['Ejercicio día 2 ' + person, '', '3x12', '45 s', '7', '10', '']
  ] } };
}

function element() {
  const classes = new Set();
  return { value: '', textContent: '', innerHTML: '', className: '', disabled: false, style: {},
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), toggle: (x, force) => { const enabled = force ?? !classes.has(x); enabled ? classes.add(x) : classes.delete(x); return enabled; } }
  };
}

function start({ seed = {}, search = '', original = null } = {}) {
  const values = new Map(Object.entries(seed)), elements = new Map(), requests = [], prompts = [];
  const document = { title: '', getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelector: () => null };
  document.getElementById('sheetUrl').value = sheetUrl(GUS);
  let releaseSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const storage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const context = vm.createContext({
    URL, URLSearchParams, JSON, Promise, localStorage: storage, document, location: { search }, navigator: {},
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {}, confirm: () => true, prompt: () => prompts.shift() ?? null,
    window: { addEventListener() {} },
    // Se prueban el lector y los flujos de la app con datos sintéticos.
    // La descarga XLSX real y su conversión con SheetJS no forman parte de esta prueba.
    XLSX: { read: value => value, utils: { sheet_to_json: value => value } },
    fetch: async (address, options = {}) => {
      const url = new URL(address); requests.push({ url: url.href, method: options.method || 'GET', body: options.body });
      if (url.hostname === 'docs.google.com') {
        const id = url.pathname.split('/')[3];
        if (id === SLOW) await slow;
        const body = id === BAD ? { SheetNames: [], Sheets: {} } : workbook(id === GUS ? 'Gustavo' : 'Vane');
        return { ok: true, arrayBuffer: async () => body };
      }
      if (url.hostname === 'script.google.com') {
        const id = url.pathname.includes('gus_fixture') ? GUS : VANE;
        if (!options.method) return { ok: true, json: async () => ({ protocol: 'mi-rutina-v1', spreadsheetId: id }) };
        const body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ ok: true, spreadsheetId: id, updated: body.changes.length }) };
      }
      throw new Error('Unexpected network request: ' + address);
    }
  });
  vm.runInContext(storeScript, context);
  vm.runInContext(original || appScript, context);
  const read = code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', context));
  const settle = async () => { for (let i = 0; i < 50; i++) { await new Promise(setImmediate); if (original || !vm.runInContext('isLoading', context)) return; } throw new Error('Load did not settle'); };
  const load = async id => { document.getElementById('sheetUrl').value = sheetUrl(id); await context.loadWorkout(); };
  return { context, storage, elements, requests, prompts, read, settle, load, releaseSlow, document };
}

const legacySeed = () => ({
  rt_sheetUrl: sheetUrl(GUS),
  rt_v12_edits: JSON.stringify({ [KEY]: { weight: '25', obs: 'Nota previa de Gustavo' } }),
  rt_v12_completed: JSON.stringify({ [KEY]: true }),
  rt_v2_collapsed: '{}',
  rt_lastSession: JSON.stringify({ sheetName: 'Semana 1', dayIdx: 0 }),
  rt_webhook: gusEndpoint
});

test('un enlace de Vane abre su plan sin heredar registros ni conexión de Gustavo', async () => {
  const seed = legacySeed(), app = start({ seed, search: '?rutina=' + VANE + '&nombre=Vane' });
  await app.settle();
  assert.equal(app.read('currentRoutineId'), VANE);
  assert.deepEqual(app.read('edits'), {});
  assert.deepEqual(app.read('completed'), {});
  assert.equal(app.read('currentProfile.webhook'), '');
  assert.equal(app.document.title, 'Mi Rutina — Vane');
  assert.match(app.elements.get('panels').innerHTML, /Movilidad Vane/);
  assert.doesNotMatch(app.elements.get('panels').innerHTML, /Nota previa de Gustavo/);
  assert.equal(app.read('book[0].days[0].focus'), 'Entrenamiento');
  app.context.edit(KEY, 'weight', '9');
  app.context.edit(KEY, 'obs', 'Nota de Vane');
  app.context.toggleDone(KEY);
  await app.load(GUS);
  assert.equal(app.read('edits')[KEY].weight, '25');
  assert.equal(app.read('edits')[KEY].obs, 'Nota previa de Gustavo');
  assert.equal(app.read('currentProfile.webhook'), gusEndpoint);
  assert.equal(app.read('book[0].days[0].focus'), 'Espalda - Hombros');
  await app.load(VANE);
  assert.equal(app.read('edits')[KEY].weight, '9');
  assert.equal(app.read('completed')[KEY], true);
  app.context.clearLocalData();
  assert.deepEqual(app.read('edits'), {});
  await app.load(GUS);
  assert.equal(app.read('edits')[KEY].weight, '25');
  for (const [key, value] of Object.entries(seed)) if (key !== 'rt_sheetUrl') assert.equal(app.storage.getItem(key), value);
  assert.equal(app.requests.filter(r => r.method === 'POST').length, 0);
});

test('cada rutina recuerda su día al volver y al reabrir la app', async () => {
  const app = start({ seed: legacySeed() }); await app.settle();
  vm.runInContext('activeDay=1;saveSession()', app.context);
  await app.load(VANE);
  assert.equal(app.read('activeDay'), 0);
  await app.load(GUS);
  assert.equal(app.read('activeDay'), 1);
  // La reapertura se comprueba con las claves persistidas, sin compartir objetos en memoria.
  const seed = {rt_sheetUrl:sheetUrl(GUS),rt_profile_migration_v1:GUS};
  seed['rt_profile_v1:'+GUS] = app.storage.getItem('rt_profile_v1:'+GUS);
  seed['rt_profile_v1:'+VANE] = app.storage.getItem('rt_profile_v1:'+VANE);
  const reopened = start({seed}); await reopened.settle();
  assert.equal(reopened.read('activeDay'), 1);
  assert.equal(reopened.read('edits')[KEY].weight, '25');
});

test('enlaces inválidos o formatos incompatibles dejan intacta la rutina cargada', async () => {
  const app = start({ seed: legacySeed() }); await app.settle();
  const before = app.storage.getItem('rt_profile_v1:' + GUS);
  const requestCount = app.requests.length;
  app.document.getElementById('sheetUrl').value = 'enlace inválido';
  await app.context.loadWorkout();
  assert.equal(app.requests.length, requestCount);
  assert.equal(app.read('currentRoutineId'), GUS);
  assert.equal(app.storage.getItem('rt_profile_v1:' + GUS), before);
  await app.load(BAD);
  assert.equal(app.read('currentRoutineId'), GUS);
  assert.equal(app.storage.getItem('rt_sheetUrl'), sheetUrl(GUS));
  assert.equal(app.storage.getItem('rt_profile_v1:' + BAD), null);
  assert.equal(app.storage.getItem('rt_profile_v1:' + GUS), before);
});

test('un enlace de entrada inválido no carga la rutina de Gustavo como reemplazo', async () => {
  const app = start({ seed: legacySeed(), search: '?rutina=no-es-una-planilla' });
  await app.settle();
  assert.equal(app.requests.length, 0);
  assert.equal(app.read('currentRoutineId'), '');
  assert.equal(app.document.getElementById('sheetUrl').value, 'no-es-una-planilla');
  assert.equal(app.storage.getItem('rt_sheetUrl'), sheetUrl(GUS));
});

test('una carga lenta anterior no reemplaza la última rutina elegida', async () => {
  const app = start({ seed: legacySeed() }); await app.settle();
  const previous = app.load(SLOW);
  await app.load(VANE);
  app.releaseSlow(); await previous;
  assert.equal(app.read('currentRoutineId'), VANE);
  assert.equal(app.storage.getItem('rt_sheetUrl'), sheetUrl(VANE));
});

test('Guardar Sheet rechaza el destino de Gustavo al configurar la rutina de Vane', async () => {
  const app = start({ seed: legacySeed(), search: '?rutina=' + VANE + '&nombre=Vane' }); await app.settle();
  app.context.edit(KEY, 'weight', '9');
  app.prompts.push(gusEndpoint);
  await app.context.saveRemote();
  assert.equal(app.requests.filter(r => r.method === 'POST').length, 0);
  assert.equal(app.read('currentProfile.webhook'), '');
  assert.match(app.elements.get('status').textContent, /no corresponde/);
  app.prompts.push(vaneEndpoint);
  await app.context.saveRemote();
  const post = app.requests.find(r => r.method === 'POST');
  assert.equal(post.url, vaneEndpoint);
  assert.equal(JSON.parse(post.body).spreadsheetId, VANE);
  assert.equal(JSON.parse(post.body).changes[0].value, '9');
  assert.equal(app.read('currentProfile.webhookMode'), 'verified');
  assert.equal(app.storage.getItem('rt_webhook'), gusEndpoint);
});

test('la conexión anterior sigue asociada solo a Gustavo y no se anuncia una confirmación inexistente', async () => {
  const app = start({ seed: legacySeed() }); await app.settle();
  await app.context.saveRemote();
  const posts = app.requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(posts[0].url, gusEndpoint);
  assert.equal(JSON.parse(posts[0].body).spreadsheetId, GUS);
  assert.match(app.elements.get('status').textContent, /Confirmá el guardado/);
  app.document.getElementById('sheetUrl').value = sheetUrl(VANE);
  await app.context.saveRemote();
  assert.equal(app.requests.filter(r => r.method === 'POST').length, 1);
});

test('el lector conserva exactamente el plan de Gustavo respecto de la versión publicada', {skip: !process.env.ROUTINE_BASELINE_PATH}, async () => {
  const oldHtml = fs.readFileSync(process.env.ROUTINE_BASELINE_PATH, 'utf8');
  const original = [...oldHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const oldApp = start({seed:legacySeed(), original}), newApp = start({seed:legacySeed()});
  await oldApp.settle(); await newApp.settle();
  assert.deepEqual(newApp.read('book'), oldApp.read('book'));
  assert.deepEqual(newApp.read('edits'), oldApp.read('edits'));
  assert.deepEqual(newApp.read('completed'), oldApp.read('completed'));
});
