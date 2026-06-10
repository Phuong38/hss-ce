import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from '../src/parser.js';

const tempWorkspace = path.resolve('./temp_workspace_py_ast');
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
fs.mkdirSync(tempWorkspace);

const pyFile = path.join(tempWorkspace, 'service.py');
fs.writeFileSync(pyFile, `"""
This is a module docstring for testing.
It has multiple lines.
"""
import os
from math import sqrt, pi as pi_val
from fastapi import FastAPI, APIRouter

app = FastAPI()
router = APIRouter()

class BaseService:
    pass

class AuthService(BaseService):
    def __init__(self, key):
        self.key = key

    async def authenticate(self, username, password):
        return True

@app.post("/login")
async def login_route(req):
    return {"status": "ok"}

@router.get("/status")
def status_route():
    return "active"
`);

try {
  console.log('--- RUNNING HSS-CE PYTHON AST PARSING TESTS ---');

  // Test 1: Standard AST parsing
  console.log('Test 1: Parsing python file via AST...');
  const result = parseFile(pyFile);
  
  assert.ok(result, 'Parse result should not be null');
  assert.strictEqual(result.summary, 'This is a module docstring for testing.', 'Should extract module docstring');
  
  // Verify imports
  const imp = result.imports;
  assert.ok(imp.length >= 4, 'Should parse imports');
  const osImport = imp.find(i => i.symbol === 'os');
  assert.ok(osImport, 'Should find os import');
  assert.strictEqual(osImport.from, 'os');

  const sqrtImport = imp.find(i => i.symbol === 'sqrt');
  assert.ok(sqrtImport, 'Should find sqrt import');
  assert.strictEqual(sqrtImport.from, 'math');

  const piImport = imp.find(i => i.symbol === 'pi_val');
  assert.ok(piImport, 'Should find aliased pi import');
  assert.strictEqual(piImport.from, 'math');

  // Verify symbols
  const syms = result.symbols;
  console.log('Parsed symbols:', syms);
  
  const baseServiceClass = syms.find(s => s.name === 'BaseService');
  assert.ok(baseServiceClass, 'Should find BaseService class');
  assert.strictEqual(baseServiceClass.type, 'class');
  assert.strictEqual(baseServiceClass.signature, 'class BaseService');

  const authServiceClass = syms.find(s => s.name === 'AuthService');
  assert.ok(authServiceClass, 'Should find AuthService class');
  assert.strictEqual(authServiceClass.type, 'class');
  assert.strictEqual(authServiceClass.signature, 'class AuthService(BaseService)');

  const authFunc = syms.find(s => s.name === 'authenticate');
  assert.ok(authFunc, 'Should find authenticate method');
  assert.strictEqual(authFunc.type, 'function');
  assert.strictEqual(authFunc.signature, 'async def authenticate(self, username, password)');

  const initFunc = syms.find(s => s.name === '__init__');
  assert.ok(initFunc, 'Should find __init__ method');
  assert.strictEqual(initFunc.type, 'function');
  assert.strictEqual(initFunc.signature, 'def __init__(self, key)');

  // Verify FastAPI routes
  const loginRoute = syms.find(s => s.type === 'route' && s.signature === 'POST /login');
  assert.ok(loginRoute, 'Should find FastAPI post route');

  const statusRoute = syms.find(s => s.type === 'route' && s.signature === 'GET /status');
  assert.ok(statusRoute, 'Should find FastAPI get route');

  // Test 2: Fallback on syntax error
  console.log('Test 2: Parsing python file with syntax error...');
  const errorFile = path.join(tempWorkspace, 'error.py');
  fs.writeFileSync(errorFile, `
# Unfinished class syntax
class BadSyntax
  def foo():
    pass
`);
  const errorResult = parseFile(errorFile);
  assert.ok(errorResult, 'Should fall back gracefully and return result even on syntax error');
  // Check that regex parser was used as fallback
  console.log('Error result symbols:', errorResult.symbols);

  console.log('✅ ALL PYTHON AST PARSING TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ TEST FAILURE:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
