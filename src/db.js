import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';

export class CodeDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        pagerank REAL DEFAULT 1.0,
        last_indexed INTEGER NOT NULL,
        layer TEXT DEFAULT 'service',
        summary TEXT
      );
    `);

    // Dynamically alter table for backward compatibility
    try {
      this.db.exec(`ALTER TABLE files ADD COLUMN layer TEXT DEFAULT 'service';`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE files ADD COLUMN summary TEXT;`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE files ADD COLUMN complexity REAL DEFAULT 1.0;`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE files ADD COLUMN coupling_in INTEGER DEFAULT 0;`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE files ADD COLUMN coupling_out INTEGER DEFAULT 0;`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE files ADD COLUMN fragility REAL DEFAULT 1.0;`);
    } catch (_) {}

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS file_contents_fts USING fts5(
        path UNINDEXED,
        content
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        signature TEXT,
        start_line INTEGER,
        end_line INTEGER,
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dependencies (
        from_file TEXT NOT NULL,
        to_file TEXT NOT NULL,
        symbol TEXT NOT NULL,
        FOREIGN KEY(from_file) REFERENCES files(path) ON DELETE CASCADE
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        file_path TEXT NOT NULL,
        symbol TEXT NOT NULL,
        line INTEGER NOT NULL,
        FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        file_path TEXT,
        symbol TEXT,
        timestamp INTEGER NOT NULL
      );
    `);

    // Create indexes for fast queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_dependencies_from ON dependencies(from_file);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_dependencies_symbol ON dependencies(symbol);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_session_actions_timestamp ON session_actions(timestamp);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_calls_file_path ON calls(file_path);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_calls_symbol ON calls(symbol);`);
  }

  saveFileContentFts(filePath, content) {
    this.db.prepare(`DELETE FROM file_contents_fts WHERE path = ?;`).run(filePath);
    const stmt = this.db.prepare(`
      INSERT INTO file_contents_fts (path, content)
      VALUES (?, ?);
    `);
    stmt.run(filePath, content);
  }

  searchCodeFts(query) {
    const terms = query
      .split(/[\s,.:;'"(){}[\]+\-*\/\\&|^~%!?<>@#$]+/g)
      .map(t => t.trim())
      .filter(Boolean);
    if (terms.length === 0) return [];
    const ftsQuery = terms.map(t => `"${t}"`).join(' AND ');

    try {
      const stmt = this.db.prepare(`
        SELECT fts.path, files.pagerank, bm25(file_contents_fts) as bm25_score
        FROM file_contents_fts fts
        JOIN files ON files.path = fts.path
        WHERE file_contents_fts MATCH ?
        ORDER BY bm25_score ASC, files.pagerank DESC
        LIMIT 50;
      `);
      return stmt.all(ftsQuery);
    } catch (err) {
      try {
        const stmtSimple = this.db.prepare(`
          SELECT fts.path, files.pagerank, bm25(file_contents_fts) as bm25_score
          FROM file_contents_fts fts
          JOIN files ON files.path = fts.path
          WHERE file_contents_fts MATCH ?
          ORDER BY bm25_score ASC, files.pagerank DESC
          LIMIT 50;
        `);
        return stmtSimple.all(terms.map(t => `"${t}"`).join(' OR '));
      } catch (err2) {
        console.error('FTS search error:', err2.message);
        return [];
      }
    }
  }

  saveFile(filePath, hash, layer = 'service', summary = null, complexity = 1.0) {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, hash, last_indexed, layer, summary, complexity)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET 
        hash = excluded.hash, 
        last_indexed = excluded.last_indexed,
        layer = excluded.layer,
        summary = COALESCE(excluded.summary, files.summary),
        complexity = excluded.complexity;
    `);
    stmt.run(filePath, hash, Date.now(), layer, summary, complexity);
  }

  updateFileMetrics(filePath, complexity, couplingIn, couplingOut, fragility) {
    const stmt = this.db.prepare(`
      UPDATE files 
      SET complexity = ?, coupling_in = ?, coupling_out = ?, fragility = ?
      WHERE path = ?;
    `);
    stmt.run(complexity, couplingIn, couplingOut, fragility, filePath);
  }

  updateFileMetadata(filePath, layer, summary) {
    const stmt = this.db.prepare(`
      UPDATE files 
      SET layer = ?, summary = ?
      WHERE path = ?;
    `);
    stmt.run(layer, summary, filePath);
  }

  logSessionAction(actionType, filePath, symbol = null) {
    const stmt = this.db.prepare(`
      INSERT INTO session_actions (action_type, file_path, symbol, timestamp)
      VALUES (?, ?, ?, ?);
    `);
    stmt.run(actionType, filePath, symbol, Date.now());
  }

  getRecentActiveFiles(limitHours = 24) {
    const cutOff = Date.now() - (limitHours * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      SELECT DISTINCT file_path 
      FROM session_actions 
      WHERE timestamp >= ? AND file_path IS NOT NULL;
    `);
    const rows = stmt.all(cutOff);
    return rows.map(r => r.file_path);
  }

  deleteFile(filePath) {
    try {
      this.db.prepare(`DELETE FROM file_contents_fts WHERE path = ?;`).run(filePath);
    } catch (_) {}
    // Foreign key with ON DELETE CASCADE will handle symbols and dependencies
    const stmt = this.db.prepare(`DELETE FROM files WHERE path = ?;`);
    stmt.run(filePath);
  }

  getFile(filePath) {
    const stmt = this.db.prepare(`SELECT * FROM files WHERE path = ?;`);
    const results = stmt.all(filePath);
    return results.length > 0 ? results[0] : null;
  }

  getAllFiles() {
    return this.db.prepare(`SELECT * FROM files;`).all();
  }

  clearFileSymbolsAndDependencies(filePath) {
    this.db.prepare(`DELETE FROM symbols WHERE file_path = ?;`).run(filePath);
    this.db.prepare(`DELETE FROM dependencies WHERE from_file = ?;`).run(filePath);
    this.db.prepare(`DELETE FROM calls WHERE file_path = ?;`).run(filePath);
  }

  saveSymbol(filePath, name, type, signature, startLine, endLine) {
    const id = `${filePath}:${name}:${type}:${startLine}`;
    const stmt = this.db.prepare(`
      INSERT INTO symbols (id, file_path, name, type, signature, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING;
    `);
    stmt.run(id, filePath, name, type, signature, startLine, endLine);
  }

  saveDependency(fromFile, toFile, symbol) {
    const stmt = this.db.prepare(`
      INSERT INTO dependencies (from_file, to_file, symbol)
      VALUES (?, ?, ?);
    `);
    stmt.run(fromFile, toFile, symbol);
  }

  saveCall(filePath, symbol, line) {
    const stmt = this.db.prepare(`
      INSERT INTO calls (file_path, symbol, line)
      VALUES (?, ?, ?);
    `);
    stmt.run(filePath, symbol, line);
  }

  getCallers(symbolName) {
    // Find files and lines that call/reference this symbol name
    const stmt = this.db.prepare(`
      SELECT DISTINCT from_file as file_path, symbol, NULL as line
      FROM dependencies 
      WHERE symbol = ?
      UNION ALL
      SELECT file_path, symbol, line
      FROM calls
      WHERE symbol = ?;
    `);
    return stmt.all(symbolName, symbolName);
  }

  getDefinition(symbolName) {
    // Find files and location where this symbol is defined
    const stmt = this.db.prepare(`
      SELECT file_path, name, type, signature, start_line, end_line 
      FROM symbols 
      WHERE name = ?;
    `);
    return stmt.all(symbolName);
  }

  searchSymbols(query) {
    // Fuzzy search for symbol names matching the query pattern
    const stmt = this.db.prepare(`
      SELECT file_path, name, type, signature, start_line, end_line 
      FROM symbols 
      WHERE name LIKE ?;
    `);
    return stmt.all(`%${query}%`);
  }

  getDependencyPath(fromFile, toFile) {
    const deps = this.db.prepare('SELECT from_file, to_file, symbol FROM dependencies;').all();
    const adj = {};
    for (const row of deps) {
      if (!adj[row.from_file]) adj[row.from_file] = [];
      adj[row.from_file].push({ to: row.to_file, symbol: row.symbol });
    }

    const queue = [[fromFile, []]];
    const visited = new Set([fromFile]);

    while (queue.length > 0) {
      const [curr, path] = queue.shift();
      if (curr === toFile) {
        return path;
      }

      const neighbors = adj[curr] || [];
      for (const edge of neighbors) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          const newPath = [...path, { from: curr, to: edge.to, symbol: edge.symbol }];
          queue.push([edge.to, newPath]);
        }
      }
    }
    return null;
  }

  updatePageRanks(ranks) {
    const stmt = this.db.prepare(`UPDATE files SET pagerank = ? WHERE path = ?;`);
    for (const [filePath, rank] of Object.entries(ranks)) {
      stmt.run(rank, filePath);
    }
  }

  getSkeletonMap() {
    const files = this.db.prepare(`SELECT path, pagerank, layer, summary, complexity, coupling_in, coupling_out, fragility FROM files ORDER BY pagerank DESC;`).all();
    const map = [];
    for (const file of files) {
      const symbols = this.db.prepare(`
        SELECT name, type, signature 
        FROM symbols 
        WHERE file_path = ?
        ORDER BY start_line ASC;
      `).all(file.path);
      map.push({
        path: file.path,
        pagerank: file.pagerank,
        layer: file.layer || 'service',
        summary: file.summary || null,
        complexity: file.complexity || 1.0,
        coupling_in: file.coupling_in || 0,
        coupling_out: file.coupling_out || 0,
        fragility: file.fragility || 1.0,
        symbols: symbols.map(s => ({
          name: s.name,
          type: s.type,
          signature: s.signature
        }))
      });
    }
    return map;
  }

  getChangeImpact(target, maxDepth = 5) {
    let startFiles = [];
    
    // Check if target is a file
    const fileCheck = this.db.prepare('SELECT path FROM files WHERE path = ?;').all(target);
    if (fileCheck.length > 0) {
      startFiles.push(target);
    } else {
      // Check if target matches symbol name
      const symbolCheck = this.db.prepare('SELECT DISTINCT file_path FROM symbols WHERE name = ?;').all(target);
      if (symbolCheck.length > 0) {
        startFiles = symbolCheck.map(r => r.file_path);
      }
    }
    
    if (startFiles.length === 0) {
      return {
        target,
        type: 'unknown',
        impactedFiles: []
      };
    }
    
    const targetType = fileCheck.length > 0 ? 'file' : 'symbol';
    const visited = new Set(startFiles);
    const queue = [];
    const impactedFiles = [];
    
    for (const file of startFiles) {
      queue.push({ file, depth: 0, path: [] });
    }
    
    while (queue.length > 0) {
      const { file, depth, path } = queue.shift();
      if (depth >= maxDepth) continue;
      
      const stmt = this.db.prepare('SELECT from_file, symbol FROM dependencies WHERE to_file = ?;');
      const importers = stmt.all(file);
      
      for (const imp of importers) {
        if (!visited.has(imp.from_file)) {
          visited.add(imp.from_file);
          const newPath = [...path, { from: file, to: imp.from_file, symbol: imp.symbol }];
          impactedFiles.push({
            filePath: imp.from_file,
            depth: depth + 1,
            importedSymbol: imp.symbol,
            path: newPath
          });
          queue.push({ file: imp.from_file, depth: depth + 1, path: newPath });
        }
      }
    }
    
    return {
      target,
      type: targetType,
      startFiles,
      impactedFiles
    };
  }

  getSessionActions(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT id, action_type, file_path, symbol, timestamp 
      FROM session_actions 
      ORDER BY timestamp DESC 
      LIMIT ?;
    `);
    return stmt.all(limit);
  }

  clearSessionActions() {
    this.db.exec('DELETE FROM session_actions;');
  }
}
