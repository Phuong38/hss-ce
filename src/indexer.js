import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { parseFile, determineLayer } from './parser.js';
import { calculatePageRank } from './pagerank.js';

export class CodeIndexer {
  constructor(db, rootDir) {
    this.db = db;
    this.rootDir = path.resolve(rootDir);
    this.ignorePatterns = this.loadIgnorePatterns();
  }

  loadIgnorePatterns() {
    const patterns = [];
    
    // Read .hssceignore
    const hssceIgnoreFile = path.join(this.rootDir, '.hssceignore');
    if (fs.existsSync(hssceIgnoreFile)) {
      try {
        const content = fs.readFileSync(hssceIgnoreFile, 'utf-8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            patterns.push(trimmed);
          }
        });
      } catch (err) {
        console.error('Failed to read .hssceignore:', err.message);
      }
    }

    // Read .gitignore
    const gitIgnoreFile = path.join(this.rootDir, '.gitignore');
    if (fs.existsSync(gitIgnoreFile)) {
      try {
        const content = fs.readFileSync(gitIgnoreFile, 'utf-8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            patterns.push(trimmed);
          }
        });
      } catch (err) {
        console.error('Failed to read .gitignore:', err.message);
      }
    }

    return Array.from(new Set(patterns));
  }

  shouldIgnore(relativePath) {
    const normRelative = relativePath.replace(/\\/g, '/');
    const parts = normRelative.split('/');
    
    // Default ignore list
    const defaults = ['node_modules', '.git', 'dist', 'build', '.hss-ce', '.codegraph', '.venv', 'venv', '.tmp', '.temp', 'temp'];
    if (parts.some(part => defaults.includes(part) || part.includes('venv') || part.includes('graphify'))) {
      return true;
    }

    for (const pattern of this.ignorePatterns) {
      let cleanPattern = pattern.replace(/\\/g, '/').trim();
      if (!cleanPattern) continue;

      const isDirectoryOnly = cleanPattern.endsWith('/');
      if (isDirectoryOnly) {
        cleanPattern = cleanPattern.slice(0, -1);
      }

      const isRootOnly = cleanPattern.startsWith('/');
      if (isRootOnly) {
        cleanPattern = cleanPattern.slice(1);
      }

      const hasInternalSlash = cleanPattern.includes('/');

      const regexStr = '^' + cleanPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*') + '$';
      
      try {
        const regex = new RegExp(regexStr);
        if (!hasInternalSlash && !isRootOnly) {
          const matchesSegment = parts.some(part => regex.test(part));
          if (matchesSegment) return true;
        } else {
          if (regex.test(normRelative)) {
            return true;
          }
          if (regex.test(normRelative.split('/')[0]) || (isDirectoryOnly && normRelative.startsWith(cleanPattern + '/'))) {
            return true;
          }
        }
      } catch (e) {
        if (normRelative.startsWith(cleanPattern) || normRelative.endsWith(cleanPattern)) {
          return true;
        }
      }
    }

    return false;
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
      const filePath = path.join(dir, file);
      const relativePath = path.relative(this.rootDir, filePath);
      
      if (this.shouldIgnore(relativePath)) {
        continue;
      }

      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          this.getFiles(filePath, fileList);
        } else {
          const ext = path.extname(filePath);
          if (['.js', '.ts', '.jsx', '.tsx', '.py', '.json', '.md', '.yaml', '.yml', '.toml', '.css', '.html', '.sh', '.sql'].includes(ext)) {
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

  // Resolve TS path aliases by looking for the nearest tsconfig.json
  resolvePathAlias(fromFile, importStr) {
    let currentDir = path.dirname(fromFile);
    const rootDir = this.rootDir;
    
    while (currentDir.startsWith(rootDir)) {
      const tsconfigPath = path.join(currentDir, 'tsconfig.json');
      if (fs.existsSync(tsconfigPath)) {
        try {
          const configContent = fs.readFileSync(tsconfigPath, 'utf-8');
          // Strip comments from JSON
          const cleanJson = configContent.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
          const config = JSON.parse(cleanJson);
          const compilerOptions = config.compilerOptions;
          if (compilerOptions && compilerOptions.paths) {
            const baseUrl = compilerOptions.baseUrl || '.';
            const baseDir = path.resolve(currentDir, baseUrl);
            
            for (const [aliasPattern, targetPatterns] of Object.entries(compilerOptions.paths)) {
              const regexStr = '^' + aliasPattern.replace(/\*/g, '(.*)') + '$';
              const regex = new RegExp(regexStr);
              const match = importStr.match(regex);
              
              if (match) {
                const wildcardValue = match[1] || '';
                for (const targetPattern of targetPatterns) {
                  const targetSubPath = targetPattern.replace(/\*/g, wildcardValue);
                  const resolvedPath = path.resolve(baseDir, targetSubPath);
                  
                  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
                    return resolvedPath;
                  }
                  
                  const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py'];
                  for (const ext of extensions) {
                    const testPath = resolvedPath + ext;
                    if (fs.existsSync(testPath)) {
                      return testPath;
                    }
                  }
                  for (const ext of extensions) {
                    const testPath = path.join(resolvedPath, 'index' + ext);
                    if (fs.existsSync(testPath)) {
                      return testPath;
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          // Ignore errors, check parent dir
        }
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return null;
  }

  // Resolve import path to actual file path
  resolveImportPath(fromFile, importStr) {
    const aliasResolved = this.resolvePathAlias(fromFile, importStr);
    if (aliasResolved) {
      return aliasResolved;
    }

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

        try {
          const { symbols, imports, summary, complexity } = parseFile(filePath);
          const layer = determineLayer(relativePath, symbols);
          this.db.saveFile(relativePath, currentHash, layer, summary, complexity);
          
          // Save file content to FTS
          try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            this.db.saveFileContentFts(relativePath, fileContent);
          } catch (ftsErr) {
            console.error(`Failed to index FTS content for ${relativePath}:`, ftsErr.message);
          }

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
          this.db.saveFile(relativePath, currentHash, 'service');
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

    // Auto-detect uncommitted/untracked files from Git to boost personalization (active working context)
    let gitPersonalization = [];
    try {
      const statusOutput = execSync('git status --porcelain', { cwd: this.rootDir, encoding: 'utf-8' });
      statusOutput.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const spaceIndex = trimmed.search(/\s/);
        if (spaceIndex !== -1) {
          let filePathStr = trimmed.slice(spaceIndex + 1).trim();
          if (filePathStr.startsWith('"') && filePathStr.endsWith('"')) {
            filePathStr = filePathStr.slice(1, -1);
          }
          filePathStr = filePathStr.replace(/\\/g, '/');
          gitPersonalization.push(filePathStr);
        }
      });
    } catch {
      // Ignore if git status fails
    }

    // Auto-detect files queried via MCP recently to boost personalization
    let sessionPersonalization = [];
    try {
      if (typeof this.db.getRecentActiveFiles === 'function') {
        sessionPersonalization = this.db.getRecentActiveFiles(24);
      }
    } catch {
      // Ignore database errors
    }

    let combinedPersonalization = [];
    if (personalization) {
      combinedPersonalization = [...personalization];
    }
    combinedPersonalization = [...combinedPersonalization, ...gitPersonalization, ...sessionPersonalization];
    combinedPersonalization = Array.from(new Set(combinedPersonalization)).filter(Boolean);

    if (combinedPersonalization.length > 0) {
      personalization = combinedPersonalization;
    }

    const files = this.db.getAllFiles();
    const dependencies = this.db.db.prepare(`SELECT * FROM dependencies;`).all();
    const ranks = calculatePageRank(files, dependencies, 20, 0.85, personalization, gitWeights);
    this.db.updatePageRanks(ranks);

    console.log('Calculating coupling and fragility metrics...');
    const updatedFiles = this.db.getAllFiles();
    const fanIn = {};
    const fanOut = {};
    updatedFiles.forEach(f => {
      fanIn[f.path] = new Set();
      fanOut[f.path] = new Set();
    });

    dependencies.forEach(d => {
      if (fanIn[d.to_file]) fanIn[d.to_file].add(d.from_file);
      if (fanOut[d.from_file]) fanOut[d.from_file].add(d.to_file);
    });

    for (const file of updatedFiles) {
      const cIn = fanIn[file.path] ? fanIn[file.path].size : 0;
      const cOut = fanOut[file.path] ? fanOut[file.path].size : 0;
      const comp = file.complexity !== null && file.complexity !== undefined ? file.complexity : 1.0;
      const frag = comp * (1.0 + cIn);
      this.db.updateFileMetrics(file.path, comp, cIn, cOut, frag);
    }

    console.log('Indexing completed successfully.');
  }

  checkDrift() {
    const allFiles = this.getFiles(this.rootDir);
    const dbFiles = this.db.getAllFiles();
    const dbFilesMap = new Map(dbFiles.map(f => [f.path, f]));
    
    const staleFiles = [];
    const missingFiles = [];
    const untrackedFiles = [];
    
    const diskPaths = new Set();
    
    for (const filePath of allFiles) {
      const relativePath = path.relative(this.rootDir, filePath);
      diskPaths.add(relativePath);
      const currentHash = this.getFileHash(filePath);
      
      const dbFile = dbFilesMap.get(relativePath);
      if (!dbFile) {
        untrackedFiles.push(relativePath);
      } else if (dbFile.hash !== currentHash) {
        staleFiles.push(relativePath);
      }
    }
    
    for (const dbFile of dbFiles) {
      if (!diskPaths.has(dbFile.path)) {
        missingFiles.push(dbFile.path);
      }
    }
    
    return {
      isStale: staleFiles.length > 0 || missingFiles.length > 0 || untrackedFiles.length > 0,
      staleFiles,
      missingFiles,
      untrackedFiles
    };
  }
}
