import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditProject } from '../src/auditor.js';

const tempWorkspace = path.resolve('./temp_audit_workspace');

// Clean up old workspace
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });

// Setup workspace with mock files containing vulnerabilities
fs.mkdirSync(tempWorkspace);

// Write mock files
fs.writeFileSync(path.join(tempWorkspace, 'secrets.js'), `
// Hardcoded secrets
const awsKey = "AKIA1234567890ABCDEF";
const openAiKey = "sk-proj-1234567890abcdef1234567890abcdef1234567890abcdef";
const password = "my-super-secret-password-123";
`);

fs.writeFileSync(path.join(tempWorkspace, 'dangerous.js'), `
// Dangerous API calls
eval("console.log('dangerous')");
const { exec } = require('child_process');
exec('rm -rf /');
`);

fs.writeFileSync(path.join(tempWorkspace, 'package.json'), JSON.stringify({
  name: "mock-package",
  dependencies: {
    "lodash": "4.17.20", // Vulnerable
    "minimist": "*",     // Wildcard
    "some-safe-package": "^1.0.0"
  }
}, null, 2));

try {
  console.log('--- RUNNING HSS-CE SECURITY AUDITOR TESTS ---');

  // Test 1: Run Auditor on tempWorkspace
  console.log('Test 1: Running auditor...');
  // Mock db that returns empty since we fall back to directory traversal if DB is empty
  const mockDb = { getAllFiles: () => [] };
  const { findings } = auditProject(mockDb, tempWorkspace);

  console.log(`Auditor found ${findings.length} findings.`);

  // Test 2: Check secrets detection
  console.log('Test 2: Checking secret findings...');
  const secretFindings = findings.filter(f => f.type === 'secret');
  assert.ok(secretFindings.some(f => f.detail.includes('AWS Access Key')), 'Should find AWS Key');
  assert.ok(secretFindings.some(f => f.detail.includes('OpenAI API Key')), 'Should find OpenAI Key');
  assert.ok(secretFindings.some(f => f.detail.includes('Possible hardcoded secret')), 'Should find hardcoded password');

  // Test 3: Check dangerous APIs detection
  console.log('Test 3: Checking dangerous API findings...');
  const dangerousFindings = findings.filter(f => f.type === 'dangerous_api');
  assert.ok(dangerousFindings.some(f => f.detail.includes('eval()')), 'Should find eval()');
  assert.ok(dangerousFindings.some(f => f.detail.includes('child_process execution')), 'Should find child_process.exec');

  // Test 4: Check dependency package.json scans
  console.log('Test 4: Checking dependency findings...');
  const dependencyFindings = findings.filter(f => f.type === 'dependency');
  assert.ok(dependencyFindings.some(f => f.detail.toLowerCase().includes('vulnerable') && f.detail.includes('lodash')), 'Should find vulnerable lodash');
  assert.ok(dependencyFindings.some(f => f.detail.includes('Wildcard') && f.detail.includes('minimist')), 'Should find wildcard dependency');

  console.log('✅ ALL SECURITY AUDITOR TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
