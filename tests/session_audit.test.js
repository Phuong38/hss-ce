import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';

const tempDbPath = path.resolve('./temp_session_test.db');

// Clean up
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

try {
  console.log('--- RUNNING HSS-CE SESSION AUDIT LOGS TESTS ---');

  // Test 1: Initialize Database
  console.log('Test 1: Initializing database...');
  const db = new CodeDatabase(tempDbPath);
  assert.ok(db, 'CodeDatabase should initialize successfully');

  // Test 2: Logging session actions
  console.log('Test 2: Logging session actions...');
  db.logSessionAction('pack_context', null, null);
  db.logSessionAction('get_definition', 'src/db.js', 'getSessionActions');
  db.logSessionAction('search_code', null, 'PageRank');

  const actions = db.getSessionActions(50);
  assert.strictEqual(actions.length, 3, 'Should retrieve 3 session actions');
  
  // Verify order (DESC timestamp / ID)
  assert.strictEqual(actions[0].action_type, 'search_code', 'Most recent action should be first');
  assert.strictEqual(actions[0].symbol, 'PageRank', 'Should record correct query symbol');
  
  assert.strictEqual(actions[1].action_type, 'get_definition', 'Second action should match');
  assert.strictEqual(actions[1].file_path, 'src/db.js', 'Should record file path');
  assert.strictEqual(actions[1].symbol, 'getSessionActions', 'Should record symbol name');
  
  assert.strictEqual(actions[2].action_type, 'pack_context', 'Third action should match');
  assert.strictEqual(actions[2].file_path, null, 'File path should be null');
  
  // Test 3: Respecting query limit
  console.log('Test 3: Querying with limit...');
  const limitedActions = db.getSessionActions(2);
  assert.strictEqual(limitedActions.length, 2, 'Should respect query limit of 2');
  assert.strictEqual(limitedActions[0].action_type, 'search_code');
  assert.strictEqual(limitedActions[1].action_type, 'get_definition');

  // Test 4: Clearing session actions
  console.log('Test 4: Clearing session actions...');
  db.clearSessionActions();
  const clearedActions = db.getSessionActions(50);
  assert.strictEqual(clearedActions.length, 0, 'Should have 0 session actions after clear');

  console.log('✅ ALL SESSION AUDIT LOGS TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILED:', err.message);
  process.exit(1);
} finally {
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
}
