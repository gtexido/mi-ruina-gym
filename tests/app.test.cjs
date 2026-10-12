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

function start({ seed = {}, search = '', original = null, xlsx = null, workbooks = {} } = {}) {
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
    // Por defecto se usan datos sintéticos. La prueba opcional de archivo
    // inyecta la misma versión de SheetJS que usa la app y el binario real.
    XLSX: xlsx || { read: value => value, utils: { sheet_to_json: value => value } },
    fetch: async (address, options = {}) => {
      const url = new URL(address); requests.push({ url: url.href, method: options.method || 'GET', body: options.body });
      if (url.hostname === 'docs.google.com') {
        const id = url.pathname.split('/')[3];
        if (id === SLOW) await slow;
        const body = workbooks[id] ?? (id === BAD ? { SheetNames: [], Sheets: {} } : workbook(id === GUS ? 'Gustavo' : 'Vane'));
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

test('las nuevas rutinas incluyen Plan N en orden y mantienen cada día y columna de guardado', async () => {
  const rows = workbook('Vane').Sheets['Semana 1'].map(row => row.slice(0, 6));
  const data = { SheetNames: ['Semana 3', 'Plan 2', 'Plan 1', 'Seguimiento General'], Sheets: {
    'Semana 3': rows, 'Plan 1': rows, 'Plan 2': rows,
    'Seguimiento General': [['Semana', 'Entrenamientos realizados'], ['Semana 1', 0]]
  } };
  const app = start({ search: '?rutina=' + VANE, workbooks: { [VANE]: data } });
  await app.settle();
  assert.deepEqual(app.read('book.map(s => s.name)'), ['Plan 1', 'Plan 2', 'Semana 3']);
  assert.equal(app.read('book[activeSheet].name'), 'Semana 3');
  for (const sheet of app.read('book')) {
    assert.deepEqual(sheet.days.map(d => d.label), ['DÍA 1', 'DÍA 2']);
    assert.deepEqual(sheet.days[0].sections[1].exercises[0].cols, { weight: 6, obs: null });
  }
  app.context.edit('Plan 1_0_1', 'weight', '7');
  app.context.edit('Plan 1_0_1', 'obs', 'Nota local');
  app.prompts.push(vaneEndpoint);
  await app.context.saveRemote();
  const post = app.requests.find(r => r.method === 'POST');
  assert.deepEqual(JSON.parse(post.body).changes, [
    {sheet:'Plan 1',row:6,col:6,value:'7'}
  ]);
  // Las nuevas pestañas no amplían ni alteran el plan histórico de Gustavo.
  const gus = start({ workbooks: { [GUS]: data } }); await gus.settle();
  assert.deepEqual(gus.read('book.map(s => s.name)'), ['Semana 3']);
});

test('el XLSX privado conserva todos los ejercicios, valores visibles y destinos de guardado', {
  skip: !(process.env.ROUTINE_XLSX_PATH && process.env.ROUTINE_SHEETJS_PATH)
}, async t => {
  const crypto = require('node:crypto');
  const xlsx = require(path.resolve(process.env.ROUTINE_SHEETJS_PATH));
  assert.equal(xlsx.version, '0.18.5', 'Debe usarse la misma versión de SheetJS que carga index.html');
  const binary = fs.readFileSync(process.env.ROUTINE_XLSX_PATH);
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const beforeHash = digest(binary);
  const source = xlsx.read(binary, {type:'array'});
  const seed = legacySeed();
  const app = start({ seed, search: '?rutina=' + VANE + '&nombre=Vane', xlsx, workbooks: { [VANE]: binary } });
  await app.settle();
  assert.equal(app.read('currentRoutineId'), VANE);
  const book = app.read('book');
  const routineNames = source.SheetNames.filter(n => /^(Semana|Plan)\s*\d+$/i.test(n));
  assert.deepEqual(book.map(s => s.name).sort(), [...routineNames].sort());
  const summary = [];
  for (const sheet of book) {
    const ws = source.Sheets[sheet.name];
    const end = xlsx.utils.decode_range(ws['!ref']).e.r + 1;
    const visible = address => String(ws[address]?.w ?? ws[address]?.v ?? '').trim();
    const expected = [];
    let day = '';
    // Control independiente por las filas con video y series del archivo:
    // no reutiliza la clasificación de filas ni los encabezados de la app.
    for (let row = 1; row <= end; row++) {
      if (/^D[IÍ]A\s*\d+/i.test(visible('A' + row))) day = 'DÍA ' + visible('A' + row).match(/\d+/)[0];
      if (/^https?:\/\//.test(visible('B' + row)) && visible('A' + row) && visible('C' + row)) {
        expected.push({row,day,name:visible('A'+row),video:visible('B'+row),reps:visible('C'+row),rest:visible('D'+row),rpe:visible('E'+row),weight:visible('F'+row)});
      }
    }
    assert.ok(expected.length, 'El archivo de validación debe tener ejercicios con video y series');
    const actual = sheet.days.flatMap(d => d.sections.flatMap(s => s.exercises.map(ex => ({...ex,day:d.label}))));
    assert.deepEqual(actual.map(ex => ex.row), expected.map(ex => ex.row));
    for (let i = 0; i < actual.length; i++) {
      for (const field of ['day','name','video','reps','rest']) assert.equal(actual[i][field], expected[i][field], sheet.name+' fila '+actual[i].row+' '+field);
      // Las filas de calentamiento pueden tener anotaciones en columnas sin encabezado.
      if (actual[i].cols.weight) {
        assert.equal(actual[i].cols.weight, 6);
        assert.equal(actual[i].weight, expected[i].weight);
        assert.equal(actual[i].rpe, expected[i].rpe);
      }
      assert.equal(actual[i].cols.obs, null, 'Este fixture no contiene una columna de observaciones');
      assert.match(actual[i].video, /(?:shorts\/|v=|youtu\.be\/)[A-Za-z0-9_-]{11}/);
    }
    summary.push({pestana:sheet.name,dias:sheet.days.length,ejercicios:actual.length});
  }
  assert.deepEqual(app.read('completed'), {});
  assert.deepEqual(app.read('edits'), {});
  app.context.edit('Semana 3_0_0', 'weight', 'Prueba local');
  app.context.toggleDone('Semana 3_0_0');
  app.context.clearLocalData();
  for (const [key,value] of Object.entries(seed)) if (key !== 'rt_sheetUrl') assert.equal(app.storage.getItem(key), value);
  assert.equal(JSON.parse(app.storage.getItem('rt_profile_v1:' + GUS)).edits[KEY].weight, '25');
  assert.equal(app.requests.filter(r => r.method === 'POST').length, 0);
  assert.equal(digest(fs.readFileSync(process.env.ROUTINE_XLSX_PATH)), beforeHash);
  if (process.env.ROUTINE_BASELINE_PATH) {
    const oldHtml = fs.readFileSync(process.env.ROUTINE_BASELINE_PATH, 'utf8');
    const original = [...oldHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    const options = { seed:legacySeed(),xlsx,workbooks:{[GUS]:binary} };
    const oldApp = start({...options,original}), newApp = start(options);
    await oldApp.settle(); await newApp.settle();
    assert.deepEqual(newApp.read('book'), oldApp.read('book'), 'El lector de Gustavo debe conservar los valores y el orden de la versión publicada');
    assert.deepEqual(newApp.read('edits'), oldApp.read('edits'));
    assert.deepEqual(newApp.read('completed'), oldApp.read('completed'));
  }
  t.diagnostic(JSON.stringify({archivoSinCambios:true,solapas:summary}));
});
