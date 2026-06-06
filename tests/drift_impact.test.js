import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempDbPath = path.resolve('./temp_test_drift.db');
const tempWorkspace = path.resolve('./temp_workspace_drift');

// Clean up old files
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace
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
  console.log('original');
}
`);

try {
  console.log('--- RUNNING HSS-CE DRIFT & IMPACT TESTS ---');

  const db = new CodeDatabase(tempDbPath);
  const indexer = new CodeIndexer(db, tempWorkspace);

  // Test 1: Initial Indexing
  console.log('Test 1: Indexing mock workspace...');
  indexer.index(true);
  let status = indexer.checkDrift();
  assert.strictEqual(status.isStale, false, 'Initial index should not drift');
  assert.strictEqual(status.staleFiles.length, 0);
  assert.strictEqual(status.missingFiles.length, 0);
  assert.strictEqual(status.untrackedFiles.length, 0);

  // Test 2: Drift Detection - Stale File (Modified)
  console.log('Test 2: Modifying fileC.js on disk...');
  fs.writeFileSync(fileC, `
export function funC() {
  console.log('modified');
}
  `);
  status = indexer.checkDrift();
  assert.strictEqual(status.isStale, true, 'Index should be stale after modification');
  assert.deepStrictEqual(status.staleFiles, ['fileC.js']);

  // Reset/Reindex
  indexer.index();
  status = indexer.checkDrift();
  assert.strictEqual(status.isStale, false, 'Index should be clean after reindexing');

  // Test 3: Drift Detection - Missing File
  console.log('Test 3: Deleting fileC.js on disk...');
  fs.unlinkSync(fileC);
  status = indexer.checkDrift();
  assert.strictEqual(status.isStale, true, 'Index should be stale after deletion');
  assert.deepStrictEqual(status.missingFiles, ['fileC.js']);

  // Restore/Reindex
  fs.writeFileSync(fileC, `export function funC() {}`);
  indexer.index();

  // Test 4: Drift Detection - Untracked File
  console.log('Test 4: Creating new untracked file...');
  const fileD = path.join(tempWorkspace, 'fileD.js');
  fs.writeFileSync(fileD, 'export function funD() {}');
  status = indexer.checkDrift();
  assert.strictEqual(status.isStale, true, 'Index should be stale after adding file');
  assert.deepStrictEqual(status.untrackedFiles, ['fileD.js']);

  // Reindex to clear drift
  indexer.index();
  status = indexer.checkDrift();
  assert.strictEqual(status.isStale, false);

  // Test 5: Change Impact - Target File path
  console.log('Test 5: Running change impact analysis on fileC.js...');
  const fileImpact = db.getChangeImpact('fileC.js');
  assert.strictEqual(fileImpact.type, 'file');
  assert.strictEqual(fileImpact.startFiles[0], 'fileC.js');
  // fileB.js recursively imports fileC.js, and fileA.js recursively imports fileB.js.
  // Both fileB.js and fileA.js should be impacted!
  assert.strictEqual(fileImpact.impactedFiles.length, 2, 'Two files should be impacted by changing fileC.js');
  
  // Sort or inspect results
  const impactedPaths = fileImpact.impactedFiles.map(r => r.filePath);
  assert.ok(impactedPaths.includes('fileB.js'));
  assert.ok(impactedPaths.includes('fileA.js'));

  // Test 6: Change Impact - Symbol Name
  console.log('Test 6: Running change impact analysis on symbol "funC"...');
  const symbolImpact = db.getChangeImpact('funC');
  assert.strictEqual(symbolImpact.type, 'symbol');
  assert.strictEqual(symbolImpact.startFiles[0], 'fileC.js');
  assert.strictEqual(symbolImpact.impactedFiles.length, 2);

  // Test 7: Max Depth restriction
  console.log('Test 7: Running change impact analysis with depth limit = 1...');
  const limitedImpact = db.getChangeImpact('fileC.js', 1);
  // Only fileB.js (depth 1) should be included, fileA.js (depth 2) should be excluded
  assert.strictEqual(limitedImpact.impactedFiles.length, 1);
  assert.strictEqual(limitedImpact.impactedFiles[0].filePath, 'fileB.js');

  console.log('✅ ALL DRIFT & IMPACT TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
