import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { parseFile } from './parser.js';
import { calculatePageRank } from './pagerank.js';

export class CodeIndexer {
  constructor(db, rootDir) {
    this.db = db;
    this.rootDir = path.resolve(rootDir);
  }

  // Calculate file hash for change detection
  getFileHash(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  // Walk directory recursively
  getFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      // Exclude common build/temp/venv folders
      if (
        file === 'node_modules' || 
        file === '.git' || 
        file === 'dist' || 
        file === 'build' ||
        file === '.codegraph' ||
        file === '.hss-ce' ||
        file === '.tmp' ||
        file === '.temp' ||
        file === 'temp' ||
        file === 'venv' ||
        file === '.venv' ||
        file.includes('venv') ||
        file.includes('graphify')
      ) {
        continue;
      }

      const filePath = path.join(dir, file);
      
      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          this.getFiles(filePath, fileList);
        } else {
          const ext = path.extname(filePath);
          if (['.js', '.ts', '.jsx', '.tsx', '.py'].includes(ext)) {
            fileList.push(filePath);
          }
        }
      } catch (err) {
        // Skip files that cannot be stated (e.g. broken symlinks, locks)
        continue;
      }
    }
    return fileList;
  }

  // Resolve import path to actual file path
  resolveImportPath(fromFile, importStr) {
    const fromDir = path.dirname(fromFile);
    
    // 1. Relative imports (e.g., './foo', '../bar')
    if (importStr.startsWith('.')) {
      const resolvedBase = path.resolve(fromDir, importStr);
      
      // Try direct file match (if extension already included)
      if (fs.existsSync(resolvedBase) && fs.statSync(resolvedBase).isFile()) {
        return resolvedBase;
      }

      const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py'];
      
      // Try direct file extension match
      for (const ext of extensions) {
        const testPath = resolvedBase + ext;
        if (fs.existsSync(testPath)) {
          return testPath;
        }
      }
      
      // Try index file match (e.g., './foo/index.js')
      for (const ext of extensions) {
        const testPath = path.join(resolvedBase, 'index' + ext);
        if (fs.existsSync(testPath)) {
          return testPath;
        }
      }
    }

    // 2. Fallback to scanning repo for any file ending with the import string
    // E.g., importing "components/Button" -> matches "/Users/.../src/components/Button.tsx"
    const cleanedImport = importStr.replace(/^@\//, ''); // Clean aliases
    return cleanedImport;
  }

  index(force = false, personalization = null) {
    console.log(`Starting codebase indexing in: ${this.rootDir}`);
    const allFiles = this.getFiles(this.rootDir);
    console.log(`Found ${allFiles.length} candidate source files.`);

    const currentFilesMap = new Map();
    const dbFiles = this.db.getAllFiles();
    const dbFilesMap = new Map(dbFiles.map(f => [f.path, f]));

    let parsedCount = 0;
    let skippedCount = 0;

    // Track raw imports to resolve after parsing
    // Structure: Map<filePath, Array<{ symbol, from }>>
    const rawImportsMap = new Map();

    for (const filePath of allFiles) {
      const relativePath = path.relative(this.rootDir, filePath);
      const currentHash = this.getFileHash(filePath);
      currentFilesMap.set(relativePath, currentHash);

      const dbFile = dbFilesMap.get(relativePath);
      const needsParsing = force || !dbFile || dbFile.hash !== currentHash;

      if (needsParsing) {
        parsedCount++;
        // Clear previous state of the file
        this.db.clearFileSymbolsAndDependencies(relativePath);
        this.db.saveFile(relativePath, currentHash);

        try {
          const { symbols, imports } = parseFile(filePath);
          
          // Save symbols
          for (const sym of symbols) {
            this.db.saveSymbol(
              relativePath,
              sym.name,
              sym.type,
              sym.signature,
              sym.startLine,
              sym.endLine
            );
          }

          rawImportsMap.set(relativePath, imports);
        } catch (e) {
          console.error(`Error parsing file ${relativePath}:`, e.message);
        }
      } else {
        skippedCount++;
        // If not parsed, we still need to load its dependencies for PageRank recalculation
        // but we don't rewrite the symbols.
      }
    }

    // Clean up files in DB that no longer exist
    for (const dbFile of dbFiles) {
      if (!currentFilesMap.has(dbFile.path)) {
        console.log(`Deleting removed file from index: ${dbFile.path}`);
        this.db.deleteFile(dbFile.path);
      }
    }

    console.log(`Parsed ${parsedCount} files. Skipped ${skippedCount} unchanged files.`);

    // Resolve dependencies for all newly parsed files
    if (rawImportsMap.size > 0) {
      console.log('Resolving import dependencies...');
      for (const [relativePath, imports] of rawImportsMap.entries()) {
        const absolutePath = path.resolve(this.rootDir, relativePath);
        
        for (const imp of imports) {
          const resolved = this.resolveImportPath(absolutePath, imp.from);
          if (!resolved) continue;

          let targetRelativePath = '';
          if (path.isAbsolute(resolved)) {
            targetRelativePath = path.relative(this.rootDir, resolved);
          } else {
            // Fuzzy match for non-relative path
            const possibleTargets = allFiles.filter(f => 
              f.endsWith(resolved) || f.replace(/\.[^/.]+$/, '').endsWith(resolved)
            );
            if (possibleTargets.length > 0) {
              targetRelativePath = path.relative(this.rootDir, possibleTargets[0]);
            }
          }

          if (targetRelativePath && targetRelativePath !== relativePath) {
            this.db.saveDependency(relativePath, targetRelativePath, imp.symbol);
          }
        }
      }
    }

    // Recalculate PageRank
    console.log('Calculating PageRank scores...');
    
    // Fetch Git weights
    let gitWeights = null;
    try {
      const output = execSync('git log --name-only --pretty=format: -n 1000', { cwd: this.rootDir, encoding: 'utf-8' });
      gitWeights = {};
      output.split('\n').forEach(line => {
        const trimmed = line.trim().replace(/\\/g, '/');
        if (trimmed) {
          gitWeights[trimmed] = (gitWeights[trimmed] || 0) + 1;
        }
      });
    } catch {
      // Ignore if git command fails or git not initialized
    }

    const files = this.db.getAllFiles();
    const dependencies = this.db.db.prepare(`SELECT * FROM dependencies;`).all();
    const ranks = calculatePageRank(files, dependencies, 20, 0.85, personalization, gitWeights);
    this.db.updatePageRanks(ranks);

    console.log('Indexing completed successfully.');
  }
}
