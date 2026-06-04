import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';
import { determineLayer, generateSkeletonContent } from '../src/parser.js';

const tempDbPath = path.resolve('./temp_pack_test.db');
const tempWorkspace = path.resolve('./temp_pack_workspace');

// Clean up
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace
fs.mkdirSync(tempWorkspace);
const fileJS = path.join(tempWorkspace, 'app.js');
const fileJSON = path.join(tempWorkspace, 'package.json');
const fileMD = path.join(tempWorkspace, 'README.md');
const fileYAML = path.join(tempWorkspace, 'config.yaml');

fs.writeFileSync(fileJS, `console.log("Hello HSS-CE");`);
fs.writeFileSync(fileJSON, `{\n  "name": "mock-app",\n  "version": "1.0.0"\n}`);
fs.writeFileSync(fileMD, `# Mock App\nThis is a mock application for testing.`);
fs.writeFileSync(fileYAML, `environment: production\nport: 8080`);

try {
  console.log('--- RUNNING HSS-CE LAYER & PACK INTEGRATION TESTS ---');

  // Test 1: Initialize Database
  console.log('Test 1: Initializing database...');
  const db = new CodeDatabase(tempDbPath);
  assert.ok(db, 'Database should initialize');

  // Test 2: Index mock workspace
  console.log('Test 2: Indexing config and doc files...');
  const indexer = new CodeIndexer(db, tempWorkspace);
  indexer.index(true);

  // Check indexed files
  const files = db.getAllFiles();
  assert.strictEqual(files.length, 4, 'Should index 4 files (js, json, md, yaml)');

  // Test 3: Validate Layer Classifications
  console.log('Test 3: Validating layer classifications...');
  const indexedJS = files.find(f => f.path === 'app.js');
  const indexedJSON = files.find(f => f.path === 'package.json');
  const indexedMD = files.find(f => f.path === 'README.md');
  const indexedYAML = files.find(f => f.path === 'config.yaml');

  assert.strictEqual(indexedJS.layer, 'entrypoint', 'app.js should be classified as entrypoint');
  assert.strictEqual(indexedJSON.layer, 'config', 'package.json should be classified as config');
  assert.strictEqual(indexedYAML.layer, 'config', 'config.yaml should be classified as config');
  assert.strictEqual(indexedMD.layer, 'documentation', 'README.md should be classified as documentation');

  // Test 4: Validate pack XML/Markdown output
  console.log('Test 4: Packing codebase into XML and Markdown...');
  const map = db.getSkeletonMap();
  
  // XML Pack Simulation
  let xmlPack = '<!-- HSS-CE Codebase Context Pack -->\n';
  for (const file of map) {
    const filePath = path.join(tempWorkspace, file.path);
    const content = fs.readFileSync(filePath, 'utf-8');
    xmlPack += `<file path="${file.path}">\n${content}\n</file>\n`;
  }
  assert.ok(xmlPack.includes('<file path="package.json">'), 'XML Pack should include package.json tag');
  assert.ok(xmlPack.includes('<file path="README.md">'), 'XML Pack should include README.md tag');

  // Markdown Pack Simulation
  let mdPack = '<!-- HSS-CE Codebase Context Pack -->\n\n';
  for (const file of map) {
    const filePath = path.join(tempWorkspace, file.path);
    const content = fs.readFileSync(filePath, 'utf-8');
    let extName = path.extname(file.path).slice(1);
    if (extName === 'json') extName = 'json';
    mdPack += `## File: ${file.path}\n\`\`\`${extName}\n${content}\n\`\`\`\n\n`;
  }
  assert.ok(mdPack.includes('## File: package.json'), 'Markdown Pack should header for package.json');
  assert.ok(mdPack.includes('```json'), 'Markdown Pack should codeblock style for json');

  // Test 5: Validate compact skeleton generation
  console.log('Test 5: Validating compact skeleton generation...');
  const mockJSContent = `
import { foo } from './foo.js';
import bar from './bar.js';

// Some comment
function testFunc(a, b) {
  const c = a + b;
  return c;
}

export class Calculator {
  add(x, y) {
    return x + y;
  }
}
`;
  const mockJSSymbols = [
    { name: 'testFunc', type: 'function', signature: 'function testFunc(a, b)', startLine: 6 },
    { name: 'Calculator', type: 'class', signature: 'class Calculator', startLine: 11 }
  ];
  const jsSkeleton = generateSkeletonContent(mockJSContent, '.js', mockJSSymbols, 'Mock JS File');
  
  assert.ok(jsSkeleton.includes('import { foo } from \'./foo.js\';'), 'JS skeleton should preserve imports');
  assert.ok(jsSkeleton.includes('import bar from \'./bar.js\';'), 'JS skeleton should preserve default imports');
  assert.ok(jsSkeleton.includes('function testFunc(a, b) { /* body elided */ }'), 'JS skeleton should elide function body');
  assert.ok(jsSkeleton.includes('class Calculator { /* class body elided */ }'), 'JS skeleton should elide class body');
  assert.ok(jsSkeleton.includes('Mock JS File'), 'JS skeleton should include summary/docstring');
  assert.ok(!jsSkeleton.includes('const c = a + b;'), 'JS skeleton should NOT contain execution bodies');

  const mockPyContent = `
import sys
from os import path

def my_func(x):
    # comment
    return x * 2

class MyClass(object):
    def __init__(self):
        pass
`;
  const mockPySymbols = [
    { name: 'my_func', type: 'function', signature: 'def my_func(x)', startLine: 5 },
    { name: 'MyClass', type: 'class', signature: 'class MyClass(object)', startLine: 9 }
  ];
  const pySkeleton = generateSkeletonContent(mockPyContent, '.py', mockPySymbols, 'Mock Py File');
  
  assert.ok(pySkeleton.includes('import sys'), 'Py skeleton should preserve import sys');
  assert.ok(pySkeleton.includes('from os import path'), 'Py skeleton should preserve from import');
  assert.ok(pySkeleton.includes('def my_func(x): ...'), 'Py skeleton should elide function body');
  assert.ok(pySkeleton.includes('class MyClass(object): ...'), 'Py skeleton should elide class body');
  assert.ok(pySkeleton.includes('Mock Py File'), 'Py skeleton should include summary/docstring');
  assert.ok(!pySkeleton.includes('return x * 2'), 'Py skeleton should NOT contain execution bodies');

  // Test 6: Deterministic sorting in pack options
  console.log('Test 6: Validating deterministic sorting...');
  const unsortedMap = [
    { path: 'z.js', pagerank: 0.9 },
    { path: 'a.js', pagerank: 0.1 },
    { path: 'm.js', pagerank: 0.5 }
  ];
  
  const sortByPath = [...unsortedMap].sort((a, b) => a.path.localeCompare(b.path));
  assert.strictEqual(sortByPath[0].path, 'a.js', 'First element sorted by path should be a.js');
  assert.strictEqual(sortByPath[1].path, 'm.js', 'Second element sorted by path should be m.js');
  assert.strictEqual(sortByPath[2].path, 'z.js', 'Third element sorted by path should be z.js');
  
  const sortByPagerank = [...unsortedMap].sort((a, b) => b.pagerank - a.pagerank);
  assert.strictEqual(sortByPagerank[0].path, 'z.js', 'First element sorted by pagerank should be z.js');
  assert.strictEqual(sortByPagerank[1].path, 'm.js', 'Second element sorted by pagerank should be m.js');
  assert.strictEqual(sortByPagerank[2].path, 'a.js', 'Third element sorted by pagerank should be a.js');

  // Test 7: Progressive compression fallback simulation
  console.log('Test 7: Validating progressive compression fallback...');
  const budget = 150;
  let currentTokens = 0;
  const mockMap = [
    { path: 'active.js', pagerank: 0.9, symbols: [], summary: 'Active' },
    { path: 'other.js', pagerank: 0.5, symbols: [{ name: 'foo', type: 'function', signature: 'function foo()', startLine: 1 }], summary: 'Other' }
  ];
  
  const activeFiles = ['active.js'];
  const progressive = true;
  
  const filesContent = {
    'active.js': 'console.log("Very active file that must remain full");'.repeat(5),
    'other.js': 'function foo() {\n' + '  console.log("Some long function body here");\n'.repeat(10) + '}'
  };
  
  let output = '';
  const estimateTokens = (str) => Math.ceil(str.length / 4);
  
  for (const file of mockMap) {
    let content = filesContent[file.path];
    
    let useSkeleton = false;
    if (progressive) {
      const isActive = activeFiles.includes(file.path);
      if (currentTokens > 0.6 * budget && !isActive) {
        useSkeleton = true;
      }
    }
    
    const generateBlock = (fileContent, skeletonMode) => {
      let procContent = fileContent;
      if (skeletonMode) {
        procContent = generateSkeletonContent(procContent, path.extname(file.path), file.symbols, file.summary);
      }
      return `<file path="${file.path}">\n${procContent}\n</file>\n`;
    };
    
    let fileBlock = generateBlock(content, useSkeleton);
    let fileTokens = estimateTokens(fileBlock);
    
    if (currentTokens + fileTokens > budget) {
      if (progressive && !useSkeleton) {
        useSkeleton = true;
        fileBlock = generateBlock(content, true);
        fileTokens = estimateTokens(fileBlock);
      }
      if (currentTokens + fileTokens > budget) {
        output += `\n<!-- Truncated -->\n`;
        break;
      }
    }
    
    output += fileBlock;
    currentTokens += fileTokens;
  }
  
  assert.ok(output.includes('active.js'), 'Output should contain active.js');
  assert.ok(output.includes('other.js'), 'Output should contain other.js');
  assert.ok(output.includes('function foo() { /* body elided */ }'), 'other.js should be compressed progressively to skeleton instead of being truncated');
  assert.ok(!output.includes('Some long function body here'), 'other.js body should be elided');

  console.log('✅ ALL LAYER & PACK INTEGRATION TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
