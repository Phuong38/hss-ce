import * as path from 'node:path';

/**
 * Estimates token count using character length approximation.
 */
function estimateTokens(str) {
  return Math.ceil(str.length / 4);
}

/**
 * Checks if a file path is internal to node runtime, test runner, or external package.
 */
function isInternalPath(filePath) {
  if (!filePath) return true;
  
  const normalized = filePath.replace(/\\/g, '/');
  
  // Node.js internals
  if (normalized.includes('node:internal') || normalized.includes('internal/modules')) {
    return true;
  }
  
  // Dependency folders
  if (normalized.includes('node_modules/') || normalized.includes('.venv/') || normalized.includes('venv/')) {
    return true;
  }
  
  // Standard test runner libraries
  if (
    normalized.includes('mocha/lib') ||
    normalized.includes('jest-jasmine2') ||
    normalized.includes('jest-runner') ||
    normalized.includes('jest-runtime') ||
    normalized.includes('ts-node/src') ||
    normalized.includes('pytest/') ||
    normalized.includes('unittest/')
  ) {
    return true;
  }
  
  // Python system libraries
  if (normalized.includes('lib/python') || normalized.includes('site-packages/')) {
    return true;
  }
  
  // Rust/Go system libraries
  if (normalized.includes('/rustc/') || normalized.includes('go/src/')) {
    return true;
  }

  // Absolute system paths that aren't user directories
  if (normalized.startsWith('/') && (
    normalized.startsWith('/usr/') || 
    normalized.startsWith('/lib/') || 
    normalized.startsWith('/System/') ||
    normalized.startsWith('/private/var/')
  )) {
    return true;
  }

  return false;
}

/**
 * Parses and returns stack trace info if line matches stack trace pattern.
 */
function parseStackLine(line) {
  // JS/TS: at funcName (path:line:col)
  const jsWithFunc = line.match(/^\s*at\s+(.+)\s+\((.+):(\d+):(\d+)\)$/);
  if (jsWithFunc) {
    return { isStack: true, func: jsWithFunc[1], file: jsWithFunc[2], line: jsWithFunc[3] };
  }

  // JS/TS: at path:line:col
  const jsNoFunc = line.match(/^\s*at\s+(.+):(\d+):(\d+)$/);
  if (jsNoFunc) {
    return { isStack: true, func: '', file: jsNoFunc[1], line: jsNoFunc[2] };
  }

  // Python: File "path", line X, in func
  const pyStack = line.match(/^\s*File\s+['"](.+)['"],\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/);
  if (pyStack) {
    return { isStack: true, func: pyStack[3] || '', file: pyStack[1], line: pyStack[2] };
  }

  // Go/Rust: path/to/file.go:12 or path/to/file.rs:12
  const genericStack = line.match(/(?:^|\s)([\w./\\-]+?\.(?:go|rs|js|ts|py)):(\d+)\b/);
  if (genericStack) {
    return { isStack: true, func: '', file: genericStack[1], line: genericStack[2] };
  }

  return { isStack: false };
}

/**
 * Collapses consecutive internal stack trace lines.
 */
export function collapseStackTraces(logContent) {
  const lines = logContent.split('\n');
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseStackLine(line);

    if (parsed.isStack) {
      const itemLines = [line];
      // Python frame check: if it is Python style, consume the next line if it is code
      if (line.trim().startsWith('File ') && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextParsed = parseStackLine(nextLine);
        if (!nextParsed.isStack && nextLine.trim() !== '' && !nextLine.startsWith('Traceback') && !nextLine.startsWith('Error')) {
          itemLines.push(nextLine);
          i++;
        }
      }
      items.push({
        isStack: true,
        isInternal: isInternalPath(parsed.file),
        lines: itemLines
      });
    } else {
      items.push({
        isStack: false,
        isInternal: false,
        lines: [line]
      });
    }
  }

  // Now, collapse consecutive internal stack items
  const collapsed = [];
  let internalCount = 0;

  for (const item of items) {
    if (item.isStack && item.isInternal) {
      internalCount++;
    } else {
      if (internalCount > 0) {
        if (internalCount === 1) {
          collapsed.push(`    [... 1 internal stack frame elided]`);
        } else {
          collapsed.push(`    [... ${internalCount} internal stack frames elided]`);
        }
        internalCount = 0;
      }
      collapsed.push(...item.lines);
    }
  }

  if (internalCount > 0) {
    if (internalCount === 1) {
      collapsed.push(`    [... 1 internal stack frame elided]`);
    } else {
      collapsed.push(`    [... ${internalCount} internal stack frames elided]`);
    }
  }

  return collapsed.join('\n');
}

/**
 * Main function: Compresses log content within a token budget.
 */
export function crushLog(logContent, rootDir, tokenBudget = 2000) {
  if (!logContent) return '';
  
  // 1. Collapse stack traces first
  let crushed = collapseStackTraces(logContent);
  
  // 2. If it fits the budget, return it
  if (estimateTokens(crushed) <= tokenBudget) {
    return crushed;
  }
  
  // 3. Perform smart line-level pruning to fit budget
  const lines = crushed.split('\n');
  const totalLines = lines.length;
  
  // Track which lines we want to keep
  const keep = new Set();
  
  // Estimate target lines we can fit based on budget and average 80 chars per line
  const maxLines = Math.floor((tokenBudget * 4) / 80);
  const headCountMax = Math.max(3, Math.min(30, Math.floor(maxLines * 0.25)));
  const tailCountMax = Math.max(5, Math.min(50, Math.floor(maxLines * 0.35)));
  
  const headCount = Math.min(headCountMax, totalLines);
  for (let i = 0; i < headCount; i++) {
    keep.add(i);
  }
  
  const tailCount = Math.min(tailCountMax, totalLines);
  for (let i = totalLines - tailCount; i < totalLines; i++) {
    keep.add(i);
  }
  
  // Scan middle for error/failure lines and mark them + surrounding context
  const errorPatterns = /\b(error|exception|fail|failed|panic|critical|uncaught|warning)\b/i;
  for (let i = headCount; i < totalLines - tailCount; i++) {
    if (errorPatterns.test(lines[i])) {
      // Keep error line
      keep.add(i);
      // Keep context: 2 lines before, 2 lines after
      for (let offset = -2; offset <= 2; offset++) {
        const target = i + offset;
        if (target >= 0 && target < totalLines) {
          keep.add(target);
        }
      }
    }
  }
  
  // Build final crushed lines
  const finalLines = [];
  let eliding = false;
  let elidedCount = 0;
  
  for (let i = 0; i < totalLines; i++) {
    if (keep.has(i)) {
      if (eliding) {
        finalLines.push(`[... ${elidedCount} lines elided ...]`);
        eliding = false;
        elidedCount = 0;
      }
      finalLines.push(lines[i]);
    } else {
      eliding = true;
      elidedCount++;
    }
  }
  if (eliding) {
    finalLines.push(`[... ${elidedCount} lines elided ...]`);
  }
  
  let result = finalLines.join('\n');
  
  // 4. Hard truncation fallback if still over budget
  if (estimateTokens(result) > tokenBudget) {
    const budgetChars = tokenBudget * 4;
    const half = Math.floor(budgetChars / 2);
    result = result.slice(0, half) + `\n\n[... Log truncated to fit token budget ...]\n\n` + result.slice(-half);
  }
  
  return result;
}
