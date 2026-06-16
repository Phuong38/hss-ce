import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempWorkspace = path.resolve('./temp_compression_workspace');
const tempDbPath = path.join(tempWorkspace, '.hss-ce', 'graph.db');

// Clean up
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace
fs.mkdirSync(tempWorkspace, { recursive: true });
const fileJS = path.join(tempWorkspace, 'app.js');
const fileJSON = path.join(tempWorkspace, 'package.json');
const fileConfigJSON = path.join(tempWorkspace, 'config.json');

fs.writeFileSync(fileJS, `
export function hello() {
  console.log("Hello HSS-CE");
}
`);

fs.writeFileSync(fileJSON, JSON.stringify({
  name: "hss-ce-test",
  version: "1.0.0",
  description: "Temporary test package",
  private: true,
  scripts: {
    test: "echo test"
  },
  dependencies: {
    "some-dep": "^1.0.0"
  },
  devDependencies: {
    "some-dev-dep": "^1.0.0"
  },
  author: "Author Name",
  license: "MIT"
}, null, 2));

fs.writeFileSync(fileConfigJSON, JSON.stringify({
  port: 8080,
  host: "localhost",
  logging: {
    level: "debug",
    format: "json"
  }
}, null, 2));

let xmlOutput = '';

try {
  console.log('--- RUNNING HSS-CE COMPRESSION & CACHE ALIGNMENT TESTS ---');

  // Test 1: Index workspace
  console.log('Test 1: Indexing workspace...');
  const db = new CodeDatabase(tempDbPath);
  const indexer = new CodeIndexer(db, tempWorkspace);
  indexer.index(true);

  // Test 2: Execute CLI pack in XML format
  console.log('Test 2: Verifying XML codebase packaging structure...');
  xmlOutput = execSync(`node src/cli.js pack ${tempWorkspace} --db=${tempDbPath} --budget=3000 --format=xml`).toString();

  // Check cache-aligned sections
  assert.ok(xmlOutput.includes('<hss_ce_context_pack>'), 'Should have root tag');
  assert.ok(xmlOutput.includes('<system_stats>'), 'Should have system_stats tag');
  assert.ok(xmlOutput.includes('<codebase_skeleton_map>'), 'Should have codebase_skeleton_map tag');
  assert.ok(xmlOutput.includes('<reference_file_contents>'), 'Should have reference_file_contents tag');
  assert.ok(xmlOutput.includes('<active_file_contents>'), 'Should have active_file_contents tag');

  // Test 3: Verify JSON Compaction
  console.log('Test 3: Checking JSON compaction...');
  // Compacted package.json should NOT contain description or license fields (Task 2)
  assert.ok(xmlOutput.includes('"name":"hss-ce-test"'), 'Should contain name in compacted package.json');
  assert.ok(xmlOutput.includes('"scripts":{"test":"echo test"}'), 'Should contain scripts');
  assert.ok(!xmlOutput.includes('"description":'), 'Should NOT contain metadata fields like description in compacted package.json');
  assert.ok(!xmlOutput.includes('"license":'), 'Should NOT contain license in compacted package.json');

  // General JSON should be minified (no indentation/spaces)
  assert.ok(xmlOutput.includes('{"port":8080,"host":"localhost","logging":{"level":"debug","format":"json"}}'), 'General JSON file should be fully minified');

  // Test 4: Execute CLI pack in Markdown format
  console.log('Test 4: Verifying Markdown codebase packaging structure...');
  const mdOutput = execSync(`node src/cli.js pack ${tempWorkspace} --db=${tempDbPath} --budget=3000 --format=markdown`).toString();

  assert.ok(mdOutput.includes('# HSS-CE Codebase Context Pack'), 'Should have Markdown title');
  assert.ok(mdOutput.includes('## 1. Codebase Skeleton Map'), 'Should have Skeleton Map section');
  assert.ok(mdOutput.includes('## 2. Reference File Contents'), 'Should have Reference File Contents section');
  assert.ok(mdOutput.includes('## 3. Active Files (Focus)'), 'Should have Active Files section');
  assert.ok(mdOutput.includes('## 4. System Stats'), 'Should have System Stats section');

  console.log('✅ ALL COMPRESSION & CACHE ALIGNMENT TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.log('XML Output was:\n', xmlOutput);
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
