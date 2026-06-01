import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempDbPath = path.resolve('./temp_test.db');
const tempWorkspace = path.resolve('./temp_workspace');

// Clean up any old files
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace with mock files
fs.mkdirSync(tempWorkspace);
const fileA = path.join(tempWorkspace, 'fileA.js');
const fileB = path.join(tempWorkspace, 'fileB.js');

fs.writeFileSync(fileA, `
function calculateTotal(price, tax) {
  // PageRank is super useful for codebase analysis
  const total = price + (price * tax);
  return total;
}
`);

fs.writeFileSync(fileB, `
function analyzeCodebase() {
  // Calculate total metrics and PageRank
  console.log("Analyzing...");
}
`);

try {
  console.log('--- RUNNING HSS-CE FTS5 INTEGRATION TESTS ---');

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
  assert.strictEqual(files.length, 2, 'Should index 2 files');

  // Test 3: Validate file contents virtual table populated
  console.log('Test 3: Validating virtual table content...');
  const ftsRows = db.db.prepare('SELECT path, content FROM file_contents_fts;').all();
  assert.strictEqual(ftsRows.length, 2, 'Virtual table should store content for both files');
  assert.ok(ftsRows.some(row => row.content.includes('calculateTotal')), 'Should contain calculated total code');

  // Test 4: Validate FTS5 lexical searching & ranking
  console.log('Test 4: Searching code via FTS5 match query...');
  
  // Search for term in fileA
  const resultsTotal = db.searchCodeFts('calculateTotal');
  assert.strictEqual(resultsTotal.length, 1, 'Should find 1 match for calculateTotal');
  assert.strictEqual(resultsTotal[0].path, 'fileA.js', 'Path should be fileA.js');

  // Search for term in both files
  const resultsPageRank = db.searchCodeFts('PageRank');
  assert.strictEqual(resultsPageRank.length, 2, 'Should find 2 matches for PageRank');
  
  // Verify order of search results
  console.log('Search results for "PageRank":', resultsPageRank);

  // Test 5: Verify delete deletes from FTS
  console.log('Test 5: Verify file deletion cleanup...');
  db.deleteFile('fileB.js');
  const ftsRowsAfterDelete = db.db.prepare("SELECT path FROM file_contents_fts WHERE path = 'fileB.js';").all();
  assert.strictEqual(ftsRowsAfterDelete.length, 0, 'Deleted file content should be cleaned up from FTS table');

  console.log('✅ ALL FTS5 SEARCH TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up files
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
