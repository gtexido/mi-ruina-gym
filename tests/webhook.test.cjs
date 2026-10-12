const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../apps-script-webhook.gs'), 'utf8');
function fixture(sheetName = 'Semana 1') {
  const writes = [];
  const rows = [
    ['DÍA 1'],
    ['Ejercicio', 'Video', 'Series', 'Descanso', 'RPE', 'Peso', 'Observaciones'],
    ['Movilidad', '', '2x10', '30 s', '6', '5', ''],
    ['Entrenamiento: Piernas'],
    ['Ejercicio', 'Video', 'Series', 'Descanso', 'RPE', 'Peso', 'Observaciones'],
    ['Sentadilla', '', '3x10', '60 s', '7', '10', '']
  ];
  const sheet = { getDataRange: () => ({ getValues: () => rows }), getRange: (row, col) => ({ setValue: value => writes.push({ row, col, value }) }) };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'fixture-id', getSheetByName: name => name === sheetName ? sheet : null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  const post = changes => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(changes) } }).text);
  return { context, writes, post };
}
test('el destino devuelve su identidad y rechaza un ID ajeno antes de escribir', () => {
  const f = fixture();
  assert.equal(JSON.parse(f.context.doGet().text).spreadsheetId, 'fixture-id');
  assert.equal(f.post({ spreadsheetId: 'another-id', changes: [{ sheet: 'Semana 1', row: 3, col: 6, value: '99' }] }).ok, false);
  assert.equal(f.writes.length, 0);
});
test('solo guarda pesos y observaciones, incluido cero, sin cambiar ejercicios ni series', () => {
  const f = fixture();
  const result = f.post({ spreadsheetId: 'fixture-id', changes: [
    { sheet: 'Semana 1', row: 3, col: 6, value: 0 },
    { sheet: 'Semana 1', row: 6, col: 7, value: 'Nota' }
  ] });
  assert.equal(result.ok, true); assert.equal(result.updated, 2);
  assert.deepEqual(f.writes, [{row:3,col:6,value:0},{row:6,col:7,value:'Nota'}]);
  const g = fixture();
  assert.equal(g.post({ spreadsheetId: 'fixture-id', changes: [
    { sheet: 'Semana 1', row: 3, col: 6, value: '9' },
    { sheet: 'Semana 1', row: 6, col: 1, value: 'Ejercicio distinto' }
  ] }).ok, false);
  assert.equal(g.writes.length, 0);
});
test('rechaza encabezados, secciones y celdas fuera del plan', () => {
  for (const row of [2, 4, 5, 99]) {
    const f = fixture();
    assert.equal(f.post({ spreadsheetId: 'fixture-id', changes: [{ sheet: 'Semana 1', row, col: 6, value: 'x' }] }).ok, false);
    assert.equal(f.writes.length, 0);
  }
});

test('Plan N permite pesos y notas, pero nunca ejercicios ni pestañas de seguimiento', () => {
  const f = fixture('Plan 2');
  assert.equal(f.post({spreadsheetId:'fixture-id',changes:[{sheet:'Plan 2',row:6,col:6,value:'8'}]}).ok, true);
  assert.equal(f.post({spreadsheetId:'fixture-id',changes:[{sheet:'Plan 2',row:6,col:1,value:'Otro ejercicio'}]}).ok, false);
  assert.equal(f.writes.length, 1);
  const other = fixture('Seguimiento General');
  assert.equal(other.post({spreadsheetId:'fixture-id',changes:[{sheet:'Seguimiento General',row:3,col:6,value:'8'}]}).ok, false);
  assert.equal(other.writes.length, 0);
});
