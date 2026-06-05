import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempDbPath = path.resolve('./temp_test_dep.db');
const tempWorkspace = path.resolve('./temp_workspace_dep');

// Clean up any old files
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace with mock files representing a dependency chain:
// fileA.js -> fileB.js -> fileC.js
fs.mkdirSync(tempWorkspace);
const fileA = path.join(tempWorkspace, 'fileA.js');
const fileB = path.join(tempWorkspace, 'fileB.js');
const fileC = path.join(tempWorkspace, 'fileC.js');

fs.writeFileSync(fileA, `
import { funB } from './fileB.js';
export function funA() {
  funB();
}
`);

fs.writeFileSync(fileB, `
import { funC } from './fileC.js';
export function funB() {
  funC();
}
`);

fs.writeFileSync(fileC, `
export function funC() {
  console.log('Hello');
}
`);

try {
  console.log('--- RUNNING HSS-CE DEPENDENCY PATH TESTS ---');

  // Test 1: Initialize Database
  console.log('Test 1: Initializing database...');
  const db = new CodeDatabase(tempDbPath);
  assert.ok(db, 'CodeDatabase should initialize successfully');

  // Test 2: Index workspace files
  console.log('Test 2: Indexing mock files...');
  const indexer = new CodeIndexer(db, tempWorkspace);
  indexer.index(true);

  // Check database table records
  const files = db.getAllFiles();
  assert.strictEqual(files.length, 3, 'Should index 3 files');

  // Test 3: Check dependencies saved correctly
  console.log('Test 3: Checking dependencies database table...');
  const dependencies = db.db.prepare('SELECT * FROM dependencies ORDER BY from_file;').all();
  console.log('Saved dependencies:', dependencies);
  assert.strictEqual(dependencies.length, 2, 'Should have 2 dependencies in DB');

  // Test 4: Validate dependency path tracing
  console.log('Test 4: Tracing dependency path from fileA.js to fileC.js...');
  const pathResult = db.getDependencyPath('fileA.js', 'fileC.js');
  console.log('Path result:', pathResult);
  
  assert.ok(pathResult, 'Path from fileA.js to fileC.js should exist');
  assert.strictEqual(pathResult.length, 2, 'Path should consist of 2 steps');
  
  // Step 1: fileA.js -> fileB.js
  assert.strictEqual(pathResult[0].from, 'fileA.js');
  assert.strictEqual(pathResult[0].to, 'fileB.js');
  assert.strictEqual(pathResult[0].symbol, 'funB');
  
  // Step 2: fileB.js -> fileC.js
  assert.strictEqual(pathResult[1].from, 'fileB.js');
  assert.strictEqual(pathResult[1].to, 'fileC.js');
  assert.strictEqual(pathResult[1].symbol, 'funC');

  // Test 5: Verify no path for non-existent routes
  console.log('Test 5: Checking non-existent backward path...');
  const reversePath = db.getDependencyPath('fileC.js', 'fileA.js');
  assert.strictEqual(reversePath, null, 'Backward path should be null (graph is directed)');

  console.log('✅ ALL DEPENDENCY PATH TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up files
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
