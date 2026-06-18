import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from '../src/parser.js';
import { CodeDatabase } from '../src/db.js';

const tempWorkspace = path.resolve('./temp_workspace_calls');
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
fs.mkdirSync(tempWorkspace);

// 1. Write JS test file
const jsFile = path.join(tempWorkspace, 'main.js');
fs.writeFileSync(jsFile, `
import { helper } from './utils.js';

function main() {
  console.log("Starting");
  const result = helper(42);
  helper(100);
  nestedCall();
  return result;
}

function nestedCall() {
  return Math.random();
}
`);

// 2. Write Python test file
const pyFile = path.join(tempWorkspace, 'service.py');
fs.writeFileSync(pyFile, `
def process():
    val = load_data()
    clean_val = sanitize(val)
    print(clean_val)
    return clean_val
`);

// 3. Write Go test file
const goFile = path.join(tempWorkspace, 'main.go');
fs.writeFileSync(goFile, `
package main
import "fmt"
func main() {
    val := calculate(5)
    fmt.Println(val)
}
`);

// 4. Write Rust test file
const rustFile = path.join(tempWorkspace, 'main.rs');
fs.writeFileSync(rustFile, `
fn main() {
    let x = process_input();
    println!("{}", x);
}
`);

try {
  console.log('--- RUNNING HSS-CE CALLS INDEXING TESTS ---');

  // Test 1: JS Calls Parsing
  console.log('Test 1: Parsing calls in JS/TS...');
  const jsResult = parseFile(jsFile);
  assert.ok(jsResult, 'JS parse result should not be null');
  console.log('JS calls found:', jsResult.calls);
  
  // helper should be called twice, nestedCall once.
  const helperCalls = jsResult.calls.filter(c => c.symbol === 'helper');
  assert.strictEqual(helperCalls.length, 2, 'Should detect helper called twice');
  assert.strictEqual(helperCalls[0].line, 6, 'First helper call should be at line 6');
  assert.strictEqual(helperCalls[1].line, 7, 'Second helper call should be at line 7');

  const nestedCalls = jsResult.calls.filter(c => c.symbol === 'nestedCall');
  assert.strictEqual(nestedCalls.length, 1, 'Should detect nestedCall once');
  assert.strictEqual(nestedCalls[0].line, 8, 'nestedCall should be at line 8');

  // Test 2: Python Calls Parsing (uses AST and/or regex fallback)
  console.log('Test 2: Parsing calls in Python...');
  const pyResult = parseFile(pyFile);
  assert.ok(pyResult, 'Python parse result should not be null');
  console.log('Python calls found:', pyResult.calls);
  
  const loadCalls = pyResult.calls.filter(c => c.symbol === 'load_data');
  assert.strictEqual(loadCalls.length, 1, 'Should detect load_data call');
  assert.strictEqual(loadCalls[0].line, 3, 'load_data call should be at line 3');

  const sanitizeCalls = pyResult.calls.filter(c => c.symbol === 'sanitize');
  assert.strictEqual(sanitizeCalls.length, 1, 'Should detect sanitize call');
  assert.strictEqual(sanitizeCalls[0].line, 4, 'sanitize call should be at line 4');

  // Test 3: Go Calls Parsing (uses regex)
  console.log('Test 3: Parsing calls in Go...');
  const goResult = parseFile(goFile);
  assert.ok(goResult, 'Go parse result should not be null');
  console.log('Go calls found:', goResult.calls);

  const calculateCalls = goResult.calls.filter(c => c.symbol === 'calculate');
  assert.strictEqual(calculateCalls.length, 1, 'Should detect calculate call');

  // Test 4: Rust Calls Parsing (uses regex)
  console.log('Test 4: Parsing calls in Rust...');
  const rustResult = parseFile(rustFile);
  assert.ok(rustResult, 'Rust parse result should not be null');
  console.log('Rust calls found:', rustResult.calls);

  const processInputCalls = rustResult.calls.filter(c => c.symbol === 'process_input');
  assert.strictEqual(processInputCalls.length, 1, 'Should detect process_input call');

  // Test 5: SQLite calls table integration and getCallers retrieval
  console.log('Test 5: Database calls table integration...');
  const dbFile = path.join(tempWorkspace, 'test_calls.db');
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  
  const db = new CodeDatabase(dbFile);
  
  // Save fake file records
  db.db.prepare("INSERT INTO files (path, hash, last_indexed) VALUES (?, ?, ?);").run('main.js', 'abc', Date.now());
  db.db.prepare("INSERT INTO files (path, hash, last_indexed) VALUES (?, ?, ?);").run('utils.js', 'def', Date.now());
  
  // Save dependency (import-based caller)
  db.saveDependency('main.js', 'utils.js', 'helper');
  
  // Save call references (AST/regex call expressions)
  db.saveCall('main.js', 'helper', 6);
  db.saveCall('main.js', 'helper', 7);
  
  const callers = db.getCallers('helper');
  console.log('Database callers returned for "helper":', callers);
  
  // getCallers should return the union of dependencies (line is null) and calls (line is 6 and 7)
  assert.ok(callers.length >= 3, 'Should return at least 3 caller rows');
  
  const lineNull = callers.find(c => c.file_path === 'main.js' && c.line === null);
  const line6 = callers.find(c => c.file_path === 'main.js' && c.line === 6);
  const line7 = callers.find(c => c.file_path === 'main.js' && c.line === 7);
  
  assert.ok(lineNull, 'Should find dependency-based caller with null line');
  assert.ok(line6, 'Should find call-based caller at line 6');
  assert.ok(line7, 'Should find call-based caller at line 7');

  console.log('All calls tests passed successfully!');
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
