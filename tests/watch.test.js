import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempDbPath = path.resolve('./temp_test_watch.db');
const tempWorkspace = path.resolve('./temp_workspace_watch');

// Clean up old files
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace
fs.mkdirSync(tempWorkspace);
const fileA = path.join(tempWorkspace, 'fileA.js');
const fileB = path.join(tempWorkspace, 'fileB.js');

fs.writeFileSync(fileA, `
export function funA() {
  console.log('A');
}
`);

fs.writeFileSync(fileB, `
import { funA } from './fileA.js';
export function funB() {
  funA();
}
`);

try {
  console.log('--- RUNNING HSS-CE REAL-TIME WATCH TESTS ---');

  const db = new CodeDatabase(tempDbPath);
  const indexer = new CodeIndexer(db, tempWorkspace);

  let resolveSync;
  let syncPromise = new Promise(resolve => {
    resolveSync = resolve;
  });

  const onSync = () => {
    resolveSync();
  };

  // Start watching
  const watcher = indexer.watch({ debounceMs: 50 }, onSync);

  // Wait for initial index
  await syncPromise;
  console.log('Initial indexing completed.');

  // Validate initial contents
  let files = db.getAllFiles();
  assert.strictEqual(files.length, 2);
  let fileNames = files.map(f => f.path);
  assert.ok(fileNames.includes('fileA.js'));
  assert.ok(fileNames.includes('fileB.js'));

  // Test Case 1: Add new file
  console.log('Scenario 1: Adding a new file (fileC.js)...');
  syncPromise = new Promise(resolve => {
    resolveSync = resolve;
  });
  const fileC = path.join(tempWorkspace, 'fileC.js');
  fs.writeFileSync(fileC, `
  import { funB } from './fileB.js';
  export function funC() {
    funB();
  }
  `);

  await syncPromise;

  files = db.getAllFiles();
  assert.strictEqual(files.length, 3);
  fileNames = files.map(f => f.path);
  assert.ok(fileNames.includes('fileC.js'));

  // Verify symbols
  let syms = db.db.prepare("SELECT * FROM symbols WHERE file_path = 'fileC.js';").all();
  assert.strictEqual(syms.length, 1);
  assert.strictEqual(syms[0].name, 'funC');

  // Verify dependencies
  let deps = db.db.prepare("SELECT * FROM dependencies WHERE from_file = 'fileC.js';").all();
  assert.strictEqual(deps.length, 1);
  assert.strictEqual(deps[0].to_file, 'fileB.js');

  // Test Case 2: Modify existing file
  console.log('Scenario 2: Modifying fileC.js...');
  syncPromise = new Promise(resolve => {
    resolveSync = resolve;
  });
  fs.writeFileSync(fileC, `
  import { funA } from './fileA.js';
  export function funCModified() {
    funA();
  }
  `);

  await syncPromise;

  // Verify updated symbols
  syms = db.db.prepare("SELECT * FROM symbols WHERE file_path = 'fileC.js';").all();
  assert.strictEqual(syms.length, 1);
  assert.strictEqual(syms[0].name, 'funCModified');

  // Verify updated dependencies
  deps = db.db.prepare("SELECT * FROM dependencies WHERE from_file = 'fileC.js';").all();
  assert.strictEqual(deps.length, 1);
  assert.strictEqual(deps[0].to_file, 'fileA.js');

  // Test Case 3: Delete file
  console.log('Scenario 3: Deleting fileC.js...');
  syncPromise = new Promise(resolve => {
    resolveSync = resolve;
  });
  fs.unlinkSync(fileC);

  await syncPromise;

  files = db.getAllFiles();
  assert.strictEqual(files.length, 2);
  fileNames = files.map(f => f.path);
  assert.ok(!fileNames.includes('fileC.js'));

  // Clean up watcher
  await watcher.close();

  console.log('✅ ALL REAL-TIME WATCH TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up files
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
