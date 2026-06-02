import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CodeDatabase } from '../src/db.js';
import { CodeIndexer } from '../src/indexer.js';
import { determineLayer } from '../src/parser.js';

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

  console.log('✅ ALL LAYER & PACK INTEGRATION TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
