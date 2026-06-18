import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import { execFileSync } from 'node:child_process';


function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function extractSummary(content, ext) {
  const trimmed = content.trim();
  if (ext === '.py') {
    // Match triple quote docstring at the top of python file
    const match = trimmed.match(/^(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
    if (match) {
      const doc = (match[1] || match[2] || '').trim();
      return doc.split('\n')[0].trim();
    }
  } else if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx' || ext === '.go' || ext === '.rs') {
    // Match JSDoc or block comment at the top of javascript file
    const match = trimmed.match(/^\/\*\*?([\s\S]*?)\*\//);
    if (match) {
      const comment = match[1] || '';
      const cleaned = comment
        .split('\n')
        .map(line => line.trim().replace(/^\*\s*/, ''))
        .filter(line => line)
        .join(' ')
        .trim();
      return cleaned.slice(0, 150);
    }
    // Match leading single-line comments
    const lines = trimmed.split('\n');
    let summaryLines = [];
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('//')) {
        summaryLines.push(trimmedLine.slice(2).trim());
      } else if (trimmedLine === '') {
        continue;
      } else {
        break;
      }
    }
    if (summaryLines.length > 0) {
      return summaryLines.join(' ').slice(0, 150);
    }
  }
  return null;
}

export function parseFile(filePath) {
  const ext = path.extname(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const symbols = [];
  const imports = [];
  const calls = [];
  let summary = extractSummary(content, ext);

  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
    parseJS(content, symbols, imports, calls);
  } else if (ext === '.py') {
    const astResult = parsePythonAST(filePath);
    if (astResult) {
      symbols.push(...astResult.symbols);
      imports.push(...astResult.imports);
      if (astResult.calls) {
        calls.push(...astResult.calls);
      }
      if (astResult.summary) {
        summary = astResult.summary;
      }
    } else {
      parsePython(content, symbols, imports, calls);
    }
  } else if (ext === '.go') {
    parseGo(content, symbols, imports, calls);
  } else if (ext === '.rs') {
    parseRust(content, symbols, imports, calls);
  }


  // Calculate complexity heuristic (control flow keywords + symbol count)
  const controlKeywords = [
    /\bif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcatch\b/g,
    /\bswitch\b/g, /\bcase\b/g, /\belif\b/g, /\bexcept\b/g,
    /\btry\b/g
  ];
  let keywordMatches = 0;
  controlKeywords.forEach(regex => {
    const matches = content.match(regex);
    if (matches) {
      keywordMatches += matches.length;
    }
  });
  const complexity = 1.0 + symbols.length * 1.5 + keywordMatches * 0.5;

  return { symbols, imports, summary, complexity, calls };
}

function walk(node, callback) {
  if (!node) return;
  callback(node);
  for (const key in node) {
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string') {
            walk(item, callback);
          }
        }
      } else if (typeof child.type === 'string') {
        walk(child, callback);
      }
    }
  }
}

function parseJS(content, symbols, imports, calls) {
  try {
    const ast = babelParse(content, {
      sourceType: 'module',
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'exportDefaultFrom',
        'dynamicImport'
      ],
      errorRecovery: true
    });

    const getSourceSlice = (start, end) => content.slice(start, end).trim();

    walk(ast, (node) => {
      // 1. Imports
      if (node.type === 'ImportDeclaration') {
        const fromPath = node.source.value;
        node.specifiers.forEach(spec => {
          if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier' || spec.type === 'ImportSpecifier') {
            imports.push({
              symbol: spec.local.name,
              from: fromPath
            });
          }
        });
      }

      // 2. Classes
      else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        if (node.id) {
          const name = node.id.name;
          const startLine = node.loc ? node.loc.start.line : 1;
          const endLine = node.loc ? node.loc.end.line : startLine;
          let signature = '';
          if (node.body && node.body.start) {
            signature = getSourceSlice(node.start, node.body.start);
            if (signature.endsWith('{')) signature = signature.slice(0, -1).trim();
          } else {
            signature = `class ${name}`;
            if (node.superClass) {
              const baseName = node.superClass.name || node.superClass.id?.name || 'Base';
              signature += ` extends ${baseName}`;
            }
          }
          symbols.push({
            name,
            type: 'class',
            signature,
            startLine,
            endLine
          });
        }
      }

      // 3. Function Declarations
      else if (node.type === 'FunctionDeclaration') {
        if (node.id) {
          const name = node.id.name;
          const startLine = node.loc ? node.loc.start.line : 1;
          const endLine = node.loc ? node.loc.end.line : startLine;
          let signature = '';
          if (node.body && node.body.start) {
            signature = getSourceSlice(node.start, node.body.start);
            if (signature.endsWith('{')) signature = signature.slice(0, -1).trim();
          } else {
            signature = `function ${name}()`;
          }
          symbols.push({
            name,
            type: 'function',
            signature,
            startLine,
            endLine
          });
        }
      }

      // 4. Arrow Functions / Constant Functions declared via variables
      else if (node.type === 'VariableDeclaration') {
        node.declarations.forEach(decl => {
          if (decl.id && decl.id.type === 'Identifier') {
            const name = decl.id.name;
            const init = decl.init;
            if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
              const startLine = node.loc ? node.loc.start.line : 1;
              const endLine = node.loc ? node.loc.end.line : startLine;
              let signature = '';
              if (init.body && init.body.start) {
                signature = getSourceSlice(node.start, init.body.start);
                if (signature.endsWith('{')) signature = signature.slice(0, -1).trim();
                if (signature.endsWith('=>')) {
                  signature = `${signature} ...`;
                }
              } else {
                signature = `const ${name} = () => ...`;
              }
              signature = signature.replace(/\s+/g, ' ');
              symbols.push({
                name,
                type: 'function',
                signature,
                startLine,
                endLine
              });
            }
          }
        });
      }

      // 5. Express/Route definitions & Calls extraction
      else if (node.type === 'CallExpression') {
        const callee = node.callee;
        let isRoute = false;
        if (callee.type === 'MemberExpression') {
          const obj = callee.object;
          const prop = callee.property;
          if (
            obj.type === 'Identifier' &&
            (obj.name === 'app' || obj.name === 'router') &&
            prop.type === 'Identifier' &&
            ['get', 'post', 'put', 'delete', 'patch'].includes(prop.name)
          ) {
            isRoute = true;
            const method = prop.name.toUpperCase();
            if (node.arguments.length > 0) {
              const arg = node.arguments[0];
              if (arg.type === 'StringLiteral' || arg.type === 'Literal') {
                const routePath = arg.value;
                const name = `${method} ${routePath}`;
                const startLine = node.loc ? node.loc.start.line : 1;
                const endLine = node.loc ? node.loc.end.line : startLine;
                symbols.push({
                  name,
                  type: 'route',
                  signature: `${method} ${routePath}`,
                  startLine,
                  endLine
                });
              }
            }
          }
        }
        
        if (!isRoute) {
          let callSymbol = null;
          if (callee.type === 'Identifier') {
            callSymbol = callee.name;
          } else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
            if (callee.property && callee.property.type === 'Identifier') {
              callSymbol = callee.property.name;
            }
          }
          
          if (callSymbol && !['require', 'import', 'super', 'expect', 'describe', 'it', 'test', 'beforeEach', 'afterEach'].includes(callSymbol)) {
            if (callee.type === 'MemberExpression' && callee.object && callee.object.type === 'Identifier' && callee.object.name === 'console') {
              // skip console calls
            } else {
              const startLine = node.loc ? node.loc.start.line : 1;
              calls.push({ symbol: callSymbol, line: startLine });
            }
          }
        }
      }

      // 6. Interfaces
      else if (node.type === 'TSInterfaceDeclaration') {
        const name = node.id.name;
        const startLine = node.loc ? node.loc.start.line : 1;
        const endLine = node.loc ? node.loc.end.line : startLine;
        let signature = '';
        if (node.body && node.body.start) {
          signature = getSourceSlice(node.start, node.body.start);
          if (signature.endsWith('{')) signature = signature.slice(0, -1).trim();
        } else {
          signature = `interface ${name}`;
        }
        symbols.push({
          name,
          type: 'interface',
          signature,
          startLine,
          endLine
        });
      }

      // 7. Types
      else if (node.type === 'TSTypeAliasDeclaration') {
        const name = node.id.name;
        const startLine = node.loc ? node.loc.start.line : 1;
        const endLine = node.loc ? node.loc.end.line : startLine;
        const signature = getSourceSlice(node.start, node.end).replace(/;$/, '').trim();
        symbols.push({
          name,
          type: 'type',
          signature,
          startLine,
          endLine
        });
      }
    });

  } catch (err) {
    parseJSRegex(content, symbols, imports, calls);
  }
}

function parseJSRegex(content, symbols, imports, calls) {
  // 1. Imports
  // Pattern: import defaultVal, { val1, val2 } from 'module'
  // Simplified matching for import statements
  const importRegex = /import\s+(?:([\w*]+(?:\s+as\s+\w+)?)|(?:\{\s*([^}]+)\s*\}))\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const defaultImport = match[1];
    const namedImports = match[2];
    const fromPath = match[3];

    if (defaultImport) {
      const cleanImport = defaultImport.replace(/\*\s+as\s+/, '').trim();
      imports.push({ symbol: cleanImport, from: fromPath });
    }
    if (namedImports) {
      namedImports.split(',').forEach(item => {
        // Strip comments and extra spaces
        const cleanItem = item.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
        // Remove TypeScript 'type' prefix (e.g., 'type Campaign')
        const cleanerItem = cleanItem.replace(/^type\s+/, '').trim();
        if (!cleanerItem) return;

        const parts = cleanerItem.split(/\s+as\s+/);
        const name = parts[parts.length - 1].trim();
        if (name && /^[a-zA-Z0-9_]+$/.test(name)) {
          imports.push({ symbol: name, from: fromPath });
        }
      });
    }
  }

  // 2. Classes
  const classRegex = /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const ext = match[2] ? ` extends ${match[2]}` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'class',
      signature: `class ${name}${ext}`,
      startLine: line,
      endLine: line // simplified for now
    });
  }

  // 3. Functions
  const funcRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{;\n]+))?/g;
  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2] || '';
    const returnType = match[3] ? `: ${match[3].trim()}` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `function ${name}(${params.replace(/\s+/g, ' ')})${returnType}`,
      startLine: line,
      endLine: line
    });
  }

  // 4. Arrow Functions / Constant Functions
  const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=>{\n]+))?\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2] || '';
    const returnType = match[3] ? `: ${match[3].trim()}` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `const ${name} = (${params.replace(/\s+/g, ' ')})${returnType} => ...`,
      startLine: line,
      endLine: line
    });
  }

  // 5. Express/Route definitions
  const routeRegex = /(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const name = `${method} ${routePath}`;
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'route',
      signature: `${method} ${routePath}`,
      startLine: line,
      endLine: line
    });
  }

  // 6. Interfaces
  const interfaceRegex = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{\n]+))?/g;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const ext = match[2] ? ` extends ${match[2].trim()}` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'interface',
      signature: `interface ${name}${ext}`,
      startLine: line,
      endLine: line
    });
  }

  // 7. Types
  const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g;
  while ((match = typeRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'type',
      signature: `type ${name}`,
      startLine: line,
      endLine: line
    });
  }

  // Extract calls via regex
  let callMatch;
  const callRegex = /\b([a-zA-Z_]\w*)\s*\(/g;
  const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'const', 'let', 'var', 'import', 'export', 'default', 'return', 'throw', 'require', 'expect', 'describe', 'it', 'test', 'super']);
  while ((callMatch = callRegex.exec(content)) !== null) {
    const sym = callMatch[1];
    if (!JS_KEYWORDS.has(sym)) {
      const line = getLineNumber(content, callMatch.index);
      calls.push({ symbol: sym, line });
    }
  }
}

function parsePython(content, symbols, imports, calls) {
  let match;
  
  // 1. Imports
  // from module import symbol1, symbol2
  const fromImportRegex = /^from\s+(\S+)\s+import\s+([\w\s,]+)/gm;
  while ((match = fromImportRegex.exec(content)) !== null) {
    const fromPath = match[1];
    const imported = match[2];
    imported.split(',').forEach(item => {
      // Strip python parenthesis and comments
      const cleanItem = item.replace(/[()]/g, '').split('#')[0].trim();
      if (!cleanItem) return;

      const parts = cleanItem.split(/\s+as\s+/);
      const name = parts[parts.length - 1].trim();
      if (name && /^[a-zA-Z0-9_]+$/.test(name)) {
        imports.push({ symbol: name, from: fromPath });
      }
    });
  }

  // import module
  const importRegex = /^import\s+(\w+(?:\s*,\s*\w+)*)/gm;
  while ((match = importRegex.exec(content)) !== null) {
    match[1].split(',').forEach(item => {
      const parts = item.trim().split(/\s+as\s+/);
      const name = parts[parts.length - 1].trim();
      if (name) {
        imports.push({ symbol: name, from: name });
      }
    });
  }

  // 2. Classes
  const classRegex = /^class\s+(\w+)(?:\(([^)]+)\))?:/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const bases = match[2] ? `(${match[2]})` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'class',
      signature: `class ${name}${bases}`,
      startLine: line,
      endLine: line
    });
  }

  // 3. Functions
  const defRegex = /^\s*def\s+(\w+)\s*\(([^)]*)\):/gm;
  while ((match = defRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2] || '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `def ${name}(${params.replace(/\s+/g, ' ')})`,
      startLine: line,
      endLine: line
    });
  }

  // 4. FastAPI Routes
  const routeRegex = /@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const name = `${method} ${routePath}`;
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'route',
      signature: `${method} ${routePath}`,
      startLine: line,
      endLine: line
    });
  }

  // Extract calls via regex
  let callMatch;
  const callRegex = /\b([a-zA-Z_]\w*)\s*\(/g;
  const PY_KEYWORDS = new Set(['if', 'elif', 'else', 'for', 'while', 'def', 'class', 'import', 'from', 'as', 'return', 'try', 'except', 'finally', 'with', 'assert', 'raise', 'pass', 'print', 'super', 'len', 'range', 'list', 'dict', 'set', 'tuple']);
  while ((callMatch = callRegex.exec(content)) !== null) {
    const sym = callMatch[1];
    if (!PY_KEYWORDS.has(sym)) {
      const line = getLineNumber(content, callMatch.index);
      calls.push({ symbol: sym, line });
    }
  }
}

function parseGo(content, symbols, imports, calls) {
  let match;
  
  // 1. Go Imports
  const goMultiImportRegex = /import\s*\(\s*([\s\S]*?)\s*\)/g;
  while ((match = goMultiImportRegex.exec(content)) !== null) {
    const blockContent = match[1];
    const lines = blockContent.split('\n');
    for (const line of lines) {
      const clean = line.replace(/\/\/.*$/, '').trim();
      if (!clean) continue;
      const m = clean.match(/^(?:(\w+)\s+)?`([^`]+)`|^(?:(\w+)\s+)?"([^"]+)"/);
      if (m) {
        const alias = m[1] || m[3];
        const fromPath = m[2] || m[4];
        const symbol = alias || path.basename(fromPath);
        imports.push({ symbol, from: fromPath });
      }
    }
  }
  
  const goSingleImportRegex = /import\s+(?:(\w+)\s+)?(?:"([^"]+)"|`([^`]+)`)/g;
  while ((match = goSingleImportRegex.exec(content)) !== null) {
    const alias = match[1];
    const fromPath = match[2] || match[3];
    const symbol = alias || path.basename(fromPath);
    imports.push({ symbol, from: fromPath });
  }

  // 2. Go Functions
  const goFuncRegex = /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*([^{;\n]+))?/g;
  while ((match = goFuncRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2] || '';
    const returnType = match[3] && match[3].trim() ? ` ${match[3].trim()}` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `func ${name}(${params.replace(/\s+/g, ' ')})${returnType}`,
      startLine: line,
      endLine: line
    });
  }

  // 3. Go Structs
  const goStructRegex = /type\s+(\w+)\s+struct\b/g;
  while ((match = goStructRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'struct',
      signature: `type ${name} struct`,
      startLine: line,
      endLine: line
    });
  }

  // 4. Go Interfaces
  const goInterfaceRegex = /type\s+(\w+)\s+interface\b/g;
  while ((match = goInterfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'interface',
      signature: `type ${name} interface`,
      startLine: line,
      endLine: line
    });
  }

  // Extract calls via regex
  let callMatch;
  const callRegex = /\b([a-zA-Z_]\w*)\s*\(/g;
  const GO_KEYWORDS = new Set(['if', 'for', 'switch', 'select', 'case', 'default', 'defer', 'go', 'func', 'type', 'struct', 'interface', 'import', 'package', 'return', 'panic', 'recover', 'make', 'new', 'append', 'len', 'cap', 'copy', 'close', 'delete', 'print', 'println']);
  while ((callMatch = callRegex.exec(content)) !== null) {
    const sym = callMatch[1];
    if (!GO_KEYWORDS.has(sym)) {
      const line = getLineNumber(content, callMatch.index);
      calls.push({ symbol: sym, line });
    }
  }
}

function parseRust(content, symbols, imports, calls) {
  let match;

  // 1. Rust Imports
  const rustUseRegex = /^(?:pub\s+)?use\s+([^;]+);/gm;
  while ((match = rustUseRegex.exec(content)) !== null) {
    const rawPath = match[1].trim();
    const braceMatch = rawPath.match(/([\w:]+)::\{([^}]+)\}/);
    if (braceMatch) {
      const prefix = braceMatch[1];
      const items = braceMatch[2].split(',');
      for (const item of items) {
        const cleanItem = item.trim();
        if (!cleanItem) continue;
        const parts = cleanItem.split(/\s+as\s+/);
        const symbol = parts[parts.length - 1].trim();
        imports.push({ symbol, from: `${prefix}::${symbol}` });
      }
    } else {
      const parts = rawPath.split(/\s+as\s+/);
      const alias = parts[parts.length - 1].trim().split('::').pop();
      const fromPath = parts[0].trim();
      imports.push({ symbol: alias, from: fromPath });
    }
  }

  // 2. Rust Functions
  const rustFuncRegex = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)(?:\s*->\s*([^{;\n]+))?/g;
  while ((match = rustFuncRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[3] || '';
    const returnType = match[4] && match[4].trim() ? ` -> ${match[4].trim()}` : '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `fn ${name}(${params.replace(/\s+/g, ' ')})${returnType}`,
      startLine: line,
      endLine: line
    });
  }

  // 3. Rust Structs
  const rustStructRegex = /(?:pub\s+)?struct\s+(\w+)/g;
  while ((match = rustStructRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'struct',
      signature: `struct ${name}`,
      startLine: line,
      endLine: line
    });
  }

  // 4. Rust Traits
  const rustTraitRegex = /(?:pub\s+)?trait\s+(\w+)/g;
  while ((match = rustTraitRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'trait',
      signature: `trait ${name}`,
      startLine: line,
      endLine: line
    });
  }

  // Extract calls via regex
  let callMatch;
  const callRegex = /\b([a-zA-Z_]\w*)\s*(?:!\s*)?\(/g;
  const RUST_KEYWORDS = new Set(['if', 'else', 'match', 'for', 'while', 'loop', 'fn', 'struct', 'enum', 'trait', 'impl', 'use', 'mod', 'pub', 'async', 'await', 'let', 'mut', 'return', 'unsafe', 'const', 'static', 'type', 'println', 'print', 'panic', 'format']);
  while ((callMatch = callRegex.exec(content)) !== null) {
    const sym = callMatch[1];
    if (!RUST_KEYWORDS.has(sym)) {
      const line = getLineNumber(content, callMatch.index);
      calls.push({ symbol: sym, line });
    }
  }
}

export function determineLayer(filePath, symbols = []) {
  const normPath = filePath.toLowerCase().replace(/\\/g, '/');
  const baseName = path.basename(normPath);
  const ext = path.extname(normPath);

  // 1. Configuration layer
  if (
    ['.json', '.yaml', '.yml', '.toml', '.ini'].includes(ext) ||
    baseName === '.env.example' ||
    baseName === 'package.json' ||
    baseName === 'tsconfig.json'
  ) {
    return 'config';
  }

  // 2. Documentation layer
  if (['.md', '.txt'].includes(ext)) {
    return 'documentation';
  }

  // 3. Entrypoint classification
  if (
    baseName === 'cli.js' || 
    baseName === 'cli.ts' || 
    baseName === 'main.py' || 
    baseName === 'app.js' || 
    baseName === 'app.ts' || 
    baseName === 'server.js' || 
    baseName === 'server.ts' || 
    baseName === 'main.go' ||
    baseName === 'main.rs' ||
    baseName === 'lib.rs' ||
    normPath.includes('/routes/') ||
    normPath.includes('/controllers/') ||
    normPath.includes('/api/') ||
    symbols.some(s => s.type === 'route')
  ) {
    return 'entrypoint';
  }

  // 4. Storage classification
  if (
    normPath.includes('/db/') ||
    normPath.includes('/database/') ||
    normPath.includes('/models/') ||
    normPath.includes('/schemas/') ||
    baseName.includes('db.') ||
    baseName.includes('database.') ||
    baseName.includes('schema.') ||
    baseName.includes('model.') ||
    normPath.includes('sqlite') ||
    normPath.includes('postgres') ||
    normPath.includes('mongo') ||
    baseName === 'prisma.ts' ||
    baseName === 'schema.prisma'
  ) {
    return 'storage';
  }

  // 5. Logic/Service classification
  return 'service';
}


export function stripComments(content, ext) {
  if (['.js', '.ts', '.jsx', '.tsx', '.go', '.rs'].includes(ext)) {
    let stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
    stripped = stripped.replace(/(^|[^\:]|^\:[^\/])\/\/.*$/gm, '$1');
    stripped = stripped.split('\n')
      .map(line => line.trimEnd())
      .filter(line => line !== '')
      .join('\n');
    return stripped;
  } else if (ext === '.py') {
    let stripped = content.replace(/"""[\s\S]*?"""/g, '');
    stripped = stripped.replace(/'''[\s\S]*?'''/g, '');
    stripped = stripped.replace(/#.*$/gm, '');
    stripped = stripped.split('\n')
      .map(line => line.trimEnd())
      .filter(line => line !== '')
      .join('\n');
    return stripped;
  }
  return content;
}

export function generateSkeletonContent(content, ext, symbols = [], summary = null) {
  const isJs = ['.js', '.ts', '.jsx', '.tsx'].includes(ext);
  const isPy = ext === '.py';
  const isGo = ext === '.go';
  const isRs = ext === '.rs';

  if (!isJs && !isPy && !isGo && !isRs) {
    return content;
  }

  const lines = [];

  // 1. Summary / Docstring
  if (summary) {
    if (isJs || isGo || isRs) {
      lines.push(`/**\n * ${summary}\n */\n`);
    } else if (isPy) {
      lines.push(`"""\n${summary}\n"""\n`);
    }
  }

  // 2. Extract imports from the original content
  const importLines = [];
  if (isJs) {
    // Match import statements (single or multi-line)
    const jsImportRegex = /import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g;
    let match;
    while ((match = jsImportRegex.exec(content)) !== null) {
      importLines.push(match[0]);
    }
    // Also capture side-effect imports, e.g. import 'foo';
    const jsSideEffectImportRegex = /^import\s+['"][^'"]+['"];?/gm;
    while ((match = jsSideEffectImportRegex.exec(content)) !== null) {
      if (!importLines.includes(match[0])) {
        importLines.push(match[0]);
      }
    }
  } else if (isPy) {
    const pyImportRegex = /^(?:import\s+.+|from\s+.+\s+import\s+.+)/gm;
    let match;
    while ((match = pyImportRegex.exec(content)) !== null) {
      importLines.push(match[0]);
    }
  } else if (isGo) {
    const goImportRegex = /import\s+(?:"[^"]+"|\([\s\S]*?\))/g;
    let match;
    while ((match = goImportRegex.exec(content)) !== null) {
      importLines.push(match[0]);
    }
  } else if (isRs) {
    const rsUseRegex = /^(?:pub\s+)?use\s+[^;]+;/gm;
    let match;
    while ((match = rsUseRegex.exec(content)) !== null) {
      importLines.push(match[0]);
    }
  }

  if (importLines.length > 0) {
    lines.push(importLines.join('\n'));
    lines.push(''); // blank line after imports
  }

  // 3. Format symbol signatures
  const sortedSymbols = [...symbols].sort((a, b) => a.startLine - b.startLine);
  
  sortedSymbols.forEach(sym => {
    if (sym.type === 'class') {
      if (isJs) {
        lines.push(`${sym.signature || `class ${sym.name}`} { /* class body elided */ }`);
      } else if (isPy) {
        let sig = sym.signature || `class ${sym.name}`;
        if (!sig.endsWith(':')) sig += ':';
        lines.push(`${sig} ...`);
      }
    } else if (sym.type === 'struct') {
      if (isGo) {
        lines.push(`${sym.signature || `type ${sym.name} struct`} { /* struct fields elided */ }`);
      } else if (isRs) {
        lines.push(`${sym.signature || `struct ${sym.name}`} { /* struct fields elided */ }`);
      }
    } else if (sym.type === 'trait') {
      lines.push(`${sym.signature || `trait ${sym.name}`} { /* trait methods elided */ }`);
    } else if (sym.type === 'function') {
      if (isJs) {
        let sig = sym.signature || `function ${sym.name}()`;
        if (sig.includes('=> ...')) {
          // Replace '=> ...' with arrow function skeleton
          sig = sig.replace('=> ...', '=> { /* body elided */ }');
        } else if (sig.includes('=>')) {
          // If it's an arrow function without the suffix
          sig = `${sig} { /* body elided */ }`;
        } else {
          sig = `${sig} { /* body elided */ }`;
        }
        lines.push(sig);
      } else if (isPy) {
        let sig = sym.signature || `def ${sym.name}()`;
        if (!sig.endsWith(':')) sig += ':';
        lines.push(`${sig} ...`);
      } else if (isGo) {
        lines.push(`${sym.signature || `func ${sym.name}()`} { /* body elided */ }`);
      } else if (isRs) {
        lines.push(`${sym.signature || `fn ${sym.name}()`} { /* body elided */ }`);
      }
    } else if (sym.type === 'interface') {
      lines.push(`${sym.signature || `interface ${sym.name}`} { /* interface body elided */ }`);
    } else if (sym.type === 'type') {
      lines.push(`${sym.signature || `type ${sym.name}`} = any; /* type body elided */`);
    } else if (sym.type === 'route') {
      if (isJs || isGo) {
        lines.push(`// Route: ${sym.signature || sym.name}`);
      } else if (isPy || isRs) {
        lines.push(`# Route: ${sym.signature || sym.name}`);
      }
    }
  });

  return lines.join('\n');
}

const PYTHON_AST_PARSER_SCRIPT = `
import ast
import json
import sys

def parse_py(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        tree = ast.parse(content, filename=filepath)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

    symbols = []
    imports = []
    calls = []
    
    summary = ast.get_docstring(tree)
    if summary:
        summary = summary.split('\\n')[0].strip()

    class Visitor(ast.NodeVisitor):
        def visit_Import(self, node):
            for name in node.names:
                imports.append({'symbol': name.asname or name.name, 'from': name.name})
            self.generic_visit(node)

        def visit_ImportFrom(self, node):
            module = node.module or ''
            for name in node.names:
                imports.append({'symbol': name.asname or name.name, 'from': module})
            self.generic_visit(node)

        def visit_Call(self, node):
            func = node.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name and name not in ('app', 'router', 'get', 'post', 'put', 'delete', 'patch'):
                calls.append({'symbol': name, 'line': node.lineno})
            self.generic_visit(node)

        def visit_ClassDef(self, node):
            bases = []
            for b in node.bases:
                resolved = None
                if hasattr(ast, 'unparse'):
                    try:
                        resolved = ast.unparse(b)
                    except:
                        pass
                if not resolved:
                    if isinstance(b, ast.Name):
                        resolved = b.id
                    elif isinstance(b, ast.Attribute):
                        resolved = f"{b.value.id if isinstance(b.value, ast.Name) else ''}.{b.attr}"
                if resolved:
                    bases.append(resolved)

            signature = f"class {node.name}"
            if bases:
                signature += f"({', '.join(bases)})"
            symbols.append({
                'name': node.name,
                'type': 'class',
                'signature': signature,
                'startLine': node.lineno,
                'endLine': getattr(node, 'end_lineno', node.lineno)
            })
            self.generic_visit(node)

        def visit_FunctionDef(self, node):
            self.handle_func(node)
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node):
            self.handle_func(node, is_async=True)
            self.generic_visit(node)

        def handle_func(self, node, is_async=False):
            args = []
            for arg in node.args.args:
                args.append(arg.arg)
            
            is_route = False
            route_signature = ""
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call):
                    func = dec.func
                    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
                        if func.value.id in ('app', 'router') and func.attr in ('get', 'post', 'put', 'delete', 'patch'):
                            is_route = True
                            route_path = ""
                            if dec.args:
                                first_arg = dec.args[0]
                                if isinstance(first_arg, ast.Constant):
                                    route_path = str(first_arg.value)
                                elif isinstance(first_arg, ast.Str):
                                    route_path = str(first_arg.s)
                            route_signature = f"{func.attr.upper()} {route_path}"
            
            sig_prefix = "async def" if is_async else "def"
            sig = f"{sig_prefix} {node.name}({', '.join(args)})"
            symbols.append({
                'name': node.name,
                'type': 'function',
                'signature': sig,
                'startLine': node.lineno,
                'endLine': getattr(node, 'end_lineno', node.lineno)
            })
            if is_route:
                symbols.append({
                    'name': route_signature,
                    'type': 'route',
                    'signature': route_signature,
                    'startLine': node.lineno,
                    'endLine': getattr(node, 'end_lineno', node.lineno)
                })

    Visitor().visit(tree)
    print(json.dumps({'symbols': symbols, 'imports': imports, 'summary': summary, 'calls': calls}))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(1)
    parse_py(sys.argv[1])
`;


function parsePythonAST(filePath) {
  try {
    const output = execFileSync('python3', ['-', filePath], {
      input: PYTHON_AST_PARSER_SCRIPT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 30000
    });
    const parsed = JSON.parse(output.trim());
    if (parsed.error) {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}


