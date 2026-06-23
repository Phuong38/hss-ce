import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempDbPath = path.resolve('./temp_structural_test.db');
const tempWorkspace = path.resolve('./temp_structural_workspace');

// Clean up
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace
fs.mkdirSync(tempWorkspace);
fs.mkdirSync(path.join(tempWorkspace, 'src'));

// Write files to mock codebase
fs.writeFileSync(path.join(tempWorkspace, 'src/entry.js'), `
// Entrypoint file
app.get('/api/users', (req, res) => {
  return res.json([]);
});
`);

fs.writeFileSync(path.join(tempWorkspace, 'src/service.js'), `
// Service file
function fetchUserData() {
  if (true) {
    for (let i = 0; i < 10; i++) {
      // Loop adds complexity
    }
  }
  return [];
}
`);

fs.writeFileSync(path.join(tempWorkspace, 'src/db.js'), `
// Storage file
class UserDatabase {
  saveUser(user) {
    return true;
  }
}
`);

try {
  console.log('--- RUNNING HSS-CE STRUCTURAL SEARCH INTEGRATION TESTS ---');

  // Test 1: Setup & Index
  console.log('Test 1: Indexing mock workspace...');
  const db = new CodeDatabase(tempDbPath);
  const indexer = new CodeIndexer(db, tempWorkspace);
  indexer.index(true);

  // Check files and layers
  const files = db.getAllFiles();
  assert.strictEqual(files.length, 3, 'Should index 3 files');

  const entryFile = db.getFile('src/entry.js');
  const serviceFile = db.getFile('src/service.js');
  const dbFile = db.getFile('src/db.js');

  assert.strictEqual(entryFile.layer, 'entrypoint', 'entry.js should be classified as entrypoint');
  assert.strictEqual(serviceFile.layer, 'service', 'service.js should be classified as service');
  assert.strictEqual(dbFile.layer, 'storage', 'db.js should be classified as storage');

  console.log('Test 2: Searching by symbol name only...');
  const allUserData = db.searchSymbols('UserData');
  console.log('found symbols:', allUserData);
  assert.strictEqual(allUserData.length, 2, 'Should find 2 symbols matching UserData');

  const exactUserData = db.searchSymbols('fetchUserData');
  assert.strictEqual(exactUserData.length, 1, 'Should find 1 symbol matching fetchUserData');
  assert.strictEqual(exactUserData[0].name, 'fetchUserData');

  // Test 3: Filter by type
  console.log('Test 3: Filtering by symbol type...');
  const routesOnly = db.searchSymbols('', { type: 'route' });
  assert.strictEqual(routesOnly.length, 1, 'Should find 1 route symbol');
  assert.strictEqual(routesOnly[0].name, 'GET /api/users');

  const classesOnly = db.searchSymbols('', { type: 'class' });
  assert.strictEqual(classesOnly.length, 1, 'Should find 1 class symbol');
  assert.strictEqual(classesOnly[0].name, 'UserDatabase');

  // Test 4: Filter by layer
  console.log('Test 4: Filtering by file layer...');
  const storageSymbols = db.searchSymbols('', { layer: 'storage' });
  assert.strictEqual(storageSymbols.length, 1, 'Should find 1 symbol in storage layer');
  assert.strictEqual(storageSymbols[0].name, 'UserDatabase');

  // Test 5: Filter by complexity
  console.log('Test 5: Filtering by complexity...');
  // service.js has complexity due to loops, entry.js has low complexity
  const simpleSymbols = db.searchSymbols('', { maxComplexity: 3.0 });
  assert.ok(simpleSymbols.length > 0, 'Should find simple symbols');
  assert.ok(!simpleSymbols.some(s => s.name === 'fetchUserData'), 'Should not include complex fetchUserData');

  console.log('✅ ALL STRUCTURAL SEARCH TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
