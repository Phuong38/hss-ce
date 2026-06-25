import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { minifySyntax } from '../src/parser.js';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';

const tempWorkspace = path.resolve('./temp_minify_workspace');
const tempDbPath = path.join(tempWorkspace, '.hss-ce', 'graph.db');

if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
fs.mkdirSync(tempWorkspace, { recursive: true });

try {
  console.log('--- RUNNING HSS-CE MINIFY SYNTAX TESTS ---');

  // Test 1: Test Javascript/Typescript minification directly
  console.log('Test 1: Testing direct JS minification...');
  const jsCode = `
  // A comment to be removed
  const shortString = "hello";
  
  
  const longString = "this is a very very very very very very very very very very very very very very very long string literal";
  
  /* Multiline comment
     should also be stripped */
  
  function test() {
    console.log(shortString, longString);
  }
  `;
  const jsMinified = minifySyntax(jsCode, '.js');
  
  assert.ok(!jsMinified.includes('A comment to be removed'), 'Comments should be stripped');
  assert.ok(!jsMinified.includes('Multiline comment'), 'Multiline comments should be stripped');
  assert.ok(jsMinified.includes('shortString = "hello"'), 'Short strings should not be elided');
  // Check string truncation
  assert.ok(jsMinified.includes('... [elided '), 'Long string should be truncated');
  assert.ok(jsMinified.includes('this is a very very very very '), 'Prefix of long string should remain');
  // Check empty line compression
  assert.ok(!jsMinified.includes('\n\n'), 'All blank lines should be stripped by stripComments/minifySyntax');

  // Test 2: Test Python minification (including triple quotes)
  console.log('Test 2: Testing direct Python minification...');
  const pyCode = `
# Python comment
short_str = 'python'


long_str = "this is a python double-quoted string that is extremely extremely extremely extremely long and needs to be elided to save space"
def foo():
    pass
`;
  const pyMinified = minifySyntax(pyCode, '.py');
  assert.ok(!pyMinified.includes('# Python comment'), 'Python comment should be stripped');
  assert.ok(pyMinified.includes("short_str = 'python'"), 'Short single-quoted string not elided');
  assert.ok(pyMinified.includes('... [elided '), 'Python long double-quoted string should be truncated');
  assert.ok(!pyMinified.includes('\n\n'), 'All blank lines should be stripped by stripComments/minifySyntax');

  // Test 3: CLI integration with --minify-syntax
  console.log('Test 3: Testing CLI --minify-syntax option...');
  fs.writeFileSync(path.join(tempWorkspace, 'app.js'), jsCode);

  const db = new CodeDatabase(tempDbPath);
  const indexer = new CodeIndexer(db, tempWorkspace);
  indexer.index(true);

  const xmlOutput = execSync(`node src/cli.js pack ${tempWorkspace} --db=${tempDbPath} --budget=3000 --format=xml --minify-syntax`).toString();
  assert.ok(xmlOutput.includes('<hss_ce_context_pack>'), 'Should pack successfully');
  assert.ok(!xmlOutput.includes('Multiline comment'), 'CLI packed code should not contain comments');
  assert.ok(xmlOutput.includes('... [elided '), 'CLI packed code should have truncated long strings');

  console.log('✅ ALL MINIFY SYNTAX TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
