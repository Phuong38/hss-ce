import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempWorkspace = path.resolve('./temp_crusher_workspace');
const tempDbPath = path.join(tempWorkspace, '.hss-ce', 'graph.db');

// Clean up
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace
fs.mkdirSync(tempWorkspace, { recursive: true });

const mockJSONPath = path.join(tempWorkspace, 'data.json');
const deepJSONPath = path.join(tempWorkspace, 'deep.json');

// Mock data JSON containing large arrays, long strings, large key counts
fs.writeFileSync(mockJSONPath, JSON.stringify({
  users: [
    { id: 1, name: "Alice", bio: "A very long biography that extends way past the limit of one hundred and fifty characters to test if the string truncation functionality of the smart json crusher works correctly and as intended." },
    { id: 2, name: "Bob" },
    { id: 3, name: "Charlie" },
    { id: 4, name: "David" },
    { id: 5, name: "Eve" }
  ],
  settings: {
    k1: "v1",
    k2: "v2",
    k3: "v3",
    k4: "v4",
    k5: "v5",
    k6: "v6",
    k7: "v7",
    k8: "v8",
    k9: "v9",
    k10: "v10",
    k11: "v11",
    k12: "v12"
  }
}, null, 2));

// Deep nested JSON
fs.writeFileSync(deepJSONPath, JSON.stringify({
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: "too deep"
              }
            }
          }
        }
      }
    }
  }
}, null, 2));

try {
  console.log('--- RUNNING HSS-CE SMART JSON CRUSHER TESTS ---');

  // Index workspace
  console.log('Test 1: Indexing workspace...');
  const db = new CodeDatabase(tempDbPath);
  const indexer = new CodeIndexer(db, tempWorkspace);
  indexer.index(true);

  // Execute CLI pack
  console.log('Test 2: Verifying Smart JSON Crusher output...');
  const xmlOutput = execSync(`node src/cli.js pack ${tempWorkspace} --db=${tempDbPath} --budget=10000 --format=xml`).toString();

  // Parse result from packaged XML output to inspect the content
  // The content of data.json in the XML should match our compressed format
  assert.ok(xmlOutput.includes('"users"'), 'Should contain users key');
  
  // 1. Array Truncation Check: should keep 3 elements and add elided count
  assert.ok(xmlOutput.includes('... [2 items elided]'), 'Should truncate array and indicate elided items count');
  assert.ok(xmlOutput.includes('Alice'), 'Should contain first element');
  assert.ok(!xmlOutput.includes('David'), 'Should not contain David');
  assert.ok(!xmlOutput.includes('Eve'), 'Should not contain Eve');

  // 2. String Truncation Check: bio should be truncated and contain elided suffix
  assert.ok(xmlOutput.includes('... [truncated'), 'Should truncate long string and indicate truncated chars');

  // 3. Object Key Limiting Check: settings should have 10 keys and "__elided_keys__"
  assert.ok(xmlOutput.includes('__elided_keys__'), 'Should indicate elided keys in settings');
  assert.ok(xmlOutput.includes('... [2 keys elided]'), 'Should indicate correct number of elided keys');
  assert.ok(xmlOutput.includes('"k1":"v1"'), 'Should contain k1');
  assert.ok(!xmlOutput.includes('"k11"'), 'Should not contain k11');
  assert.ok(!xmlOutput.includes('"k12"'), 'Should not contain k12');

  // 4. Nesting Depth Check: deep.json should contain "deep nesting elided"
  assert.ok(xmlOutput.includes('... [deep nesting elided]'), 'Should elide deep nesting levels');

  console.log('✅ ALL SMART JSON CRUSHER TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
