import * as fs from 'node:fs';
import * as path from 'node:path';

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

export function parseFile(filePath) {
  const ext = path.extname(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const symbols = [];
  const imports = [];

  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
    parseJS(content, symbols, imports);
  } else if (ext === '.py') {
    parsePython(content, symbols, imports);
  }

  return { symbols, imports };
}

function parseJS(content, symbols, imports) {
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
  const funcRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2] || '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `function ${name}(${params.replace(/\s+/g, ' ')})`,
      startLine: line,
      endLine: line
    });
  }

  // 4. Arrow Functions / Constant Functions
  const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2] || '';
    const line = getLineNumber(content, match.index);
    symbols.push({
      name,
      type: 'function',
      signature: `const ${name} = (${params.replace(/\s+/g, ' ')}) => ...`,
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
}

function parsePython(content, symbols, imports) {
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
}
