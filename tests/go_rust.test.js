import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile, stripComments, generateSkeletonContent, determineLayer } from '../src/parser.js';
import { CodeIndexer } from '../src/indexer.js';

class MockDatabase {
  constructor() {
    this.files = [];
    this.symbols = [];
    this.dependencies = [];
    this.ranks = {};
    this.db = this;
  }

  saveFile(relativePath, hash, layer, summary, complexity) {
    this.files.push({ path: relativePath, hash, layer, summary, complexity, pagerank: 1.0 });
  }

  deleteFile(relativePath) {
    this.files = this.files.filter(f => f.path !== relativePath);
    this.symbols = this.symbols.filter(s => s.filePath !== relativePath);
    this.dependencies = this.dependencies.filter(d => d.from_file !== relativePath && d.to_file !== relativePath);
  }

  clearFileSymbolsAndDependencies(relativePath) {
    this.symbols = this.symbols.filter(s => s.filePath !== relativePath);
    this.dependencies = this.dependencies.filter(d => d.from_file !== relativePath);
  }

  saveFileContentFts(relativePath, fileContent) {
    // mock
  }

  saveSymbol(relativePath, name, type, signature, startLine, endLine) {
    this.symbols.push({ filePath: relativePath, name, type, signature, startLine, endLine });
  }

  saveDependency(fromFile, toFile, symbol) {
    this.dependencies.push({ from_file: fromFile, to_file: toFile, symbol });
  }

  getAllFiles() {
    return this.files.map(f => ({ ...f, pagerank: this.ranks[f.path] || 1.0 }));
  }

  updatePageRanks(ranks) {
    this.ranks = ranks;
  }

  updateFileMetrics(filePath, complexity, cIn, cOut, fragility) {
    const file = this.files.find(f => f.path === filePath);
    if (file) {
      file.complexity = complexity;
      file.coupling_in = cIn;
      file.coupling_out = cOut;
      file.fragility = fragility;
    }
  }

  prepare(query) {
    // extremely mock query preparation
    if (query.includes('SELECT * FROM dependencies')) {
      return {
        all: () => this.dependencies
      };
    }
    return {
      all: (param) => {
        if (query.includes('SELECT * FROM files WHERE path = ?')) {
          return this.files.filter(f => f.path === param);
        }
        return [];
      }
    };
  }
}

const tempWorkspace = path.resolve('./temp_workspace_go_rs');
if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
fs.mkdirSync(tempWorkspace);

// Go File
const goFile = path.join(tempWorkspace, 'main.go');
fs.writeFileSync(goFile, `// package main is the entry point
// This is a test package
package main

import (
	"fmt"
	"strings"
	alias "path/to/my_dep"
)

import "os"

type Config struct {
	Name string
}

type Service interface {
	Run() error
}

func main() {
	fmt.Println("Hello Go")
}

func Helper(val string) bool {
	return true
}
`);

// Rust File
const rsFile = path.join(tempWorkspace, 'lib.rs');
fs.writeFileSync(rsFile, `/**
 * This is a rust library
 * It does stuff
 */

use std::collections::HashMap;
pub use other_dep::helper;
use nested::pkg::{A, B};

pub struct Database {
    conn: string,
}

pub trait Repository {
    fn find_all() -> Vec<string>;
}

pub async fn connect_db() -> bool {
    true
}

fn internal_helper() {
    // local
}
`);

try {
  console.log('--- RUNNING HSS-CE GO & RUST PARSING TESTS ---');

  // Test 1: Go Parsing
  console.log('Test 1: Parsing Go file...');
  const goResult = parseFile(goFile);
  assert.ok(goResult, 'Go parse result should not be null');
  assert.strictEqual(goResult.summary, 'package main is the entry point This is a test package', 'Should extract Go top comment summary');

  // Verify Go imports
  const goImports = goResult.imports;
  console.log('Go imports:', goImports);
  assert.ok(goImports.find(i => i.symbol === 'fmt' && i.from === 'fmt'));
  assert.ok(goImports.find(i => i.symbol === 'strings' && i.from === 'strings'));
  assert.ok(goImports.find(i => i.symbol === 'alias' && i.from === 'path/to/my_dep'));
  assert.ok(goImports.find(i => i.symbol === 'os' && i.from === 'os'));

  // Verify Go symbols
  const goSymbols = goResult.symbols;
  console.log('Go symbols:', goSymbols);
  assert.ok(goSymbols.find(s => s.name === 'Config' && s.type === 'struct' && s.signature === 'type Config struct'));
  assert.ok(goSymbols.find(s => s.name === 'Service' && s.type === 'interface' && s.signature === 'type Service interface'));
  assert.ok(goSymbols.find(s => s.name === 'main' && s.type === 'function' && s.signature === 'func main()'));
  assert.ok(goSymbols.find(s => s.name === 'Helper' && s.type === 'function' && s.signature === 'func Helper(val string) bool'));

  // Test 2: Rust Parsing
  console.log('Test 2: Parsing Rust file...');
  const rsResult = parseFile(rsFile);
  assert.ok(rsResult, 'Rust parse result should not be null');
  assert.strictEqual(rsResult.summary, 'This is a rust library It does stuff', 'Should extract Rust top comment summary');

  // Verify Rust imports
  const rsImports = rsResult.imports;
  console.log('Rust imports:', rsImports);
  assert.ok(rsImports.find(i => i.symbol === 'HashMap' && i.from === 'std::collections::HashMap'));
  assert.ok(rsImports.find(i => i.symbol === 'helper' && i.from === 'other_dep::helper'));
  assert.ok(rsImports.find(i => i.symbol === 'A' && i.from === 'nested::pkg::A'));
  assert.ok(rsImports.find(i => i.symbol === 'B' && i.from === 'nested::pkg::B'));

  // Verify Rust symbols
  const rsSymbols = rsResult.symbols;
  console.log('Rust symbols:', rsSymbols);
  assert.ok(rsSymbols.find(s => s.name === 'Database' && s.type === 'struct' && s.signature === 'struct Database'));
  assert.ok(rsSymbols.find(s => s.name === 'Repository' && s.type === 'trait' && s.signature === 'trait Repository'));
  assert.ok(rsSymbols.find(s => s.name === 'connect_db' && s.type === 'function' && s.signature === 'fn connect_db() -> bool'));
  assert.ok(rsSymbols.find(s => s.name === 'internal_helper' && s.type === 'function' && s.signature === 'fn internal_helper()'));

  // Test 3: Comment Stripping
  console.log('Test 3: Comment stripping on Go/Rust...');
  const strippedGo = stripComments(fs.readFileSync(goFile, 'utf-8'), '.go');
  assert.ok(!strippedGo.includes('// package main is the entry point'));
  assert.ok(strippedGo.includes('package main'));

  const strippedRs = stripComments(fs.readFileSync(rsFile, 'utf-8'), '.rs');
  assert.ok(!strippedRs.includes('This is a rust library'));
  assert.ok(strippedRs.includes('pub struct Database'));

  // Test 4: Skeleton Generation
  console.log('Test 4: Skeleton generation for Go/Rust...');
  const goSkeleton = generateSkeletonContent(fs.readFileSync(goFile, 'utf-8'), '.go', goSymbols, goResult.summary);
  console.log('Go skeleton:\n', goSkeleton);
  assert.ok(goSkeleton.includes('package main is the entry point'));
  assert.ok(goSkeleton.includes('import ('));
  assert.ok(goSkeleton.includes('type Config struct { /* struct fields elided */ }'));
  assert.ok(goSkeleton.includes('func main() { /* body elided */ }'));

  const rsSkeleton = generateSkeletonContent(fs.readFileSync(rsFile, 'utf-8'), '.rs', rsSymbols, rsResult.summary);
  console.log('Rust skeleton:\n', rsSkeleton);
  assert.ok(rsSkeleton.includes('This is a rust library'));
  assert.ok(rsSkeleton.includes('use std::collections::HashMap;'));
  assert.ok(rsSkeleton.includes('struct Database { /* struct fields elided */ }'));
  assert.ok(rsSkeleton.includes('fn connect_db() -> bool { /* body elided */ }'));

  // Test 5: Layer classification
  console.log('Test 5: Layer classification...');
  assert.strictEqual(determineLayer('main.go', goSymbols), 'entrypoint');
  assert.strictEqual(determineLayer('lib.rs', rsSymbols), 'entrypoint');
  assert.strictEqual(determineLayer('service.go', goSymbols), 'service');

  // Test 6: CodeIndexer integration
  console.log('Test 6: CodeIndexer integration with Go/Rust...');
  const mockDb = new MockDatabase();
  const indexer = new CodeIndexer(mockDb, tempWorkspace);
  
  indexer.index(true);

  const indexedFiles = mockDb.files;
  console.log('Indexed files:', indexedFiles);
  assert.strictEqual(indexedFiles.length, 2, 'Should index 2 files');
  
  const mainFile = indexedFiles.find(f => f.path === 'main.go');
  assert.ok(mainFile);
  assert.strictEqual(mainFile.layer, 'entrypoint');
  assert.strictEqual(mainFile.summary, 'package main is the entry point This is a test package');

  const libFile = indexedFiles.find(f => f.path === 'lib.rs');
  assert.ok(libFile);
  assert.strictEqual(libFile.layer, 'entrypoint');

  console.log('✅ ALL GO & RUST TESTS PASSED SUCCESSFULLY!');
} catch (err) {
  console.error('❌ GO & RUST TEST FAILURE:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempWorkspace)) fs.rmSync(tempWorkspace, { recursive: true });
}
