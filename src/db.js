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
        last_indexed INTEGER NOT NULL
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

    // Create indexes for fast queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_dependencies_from ON dependencies(from_file);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_dependencies_symbol ON dependencies(symbol);`);
  }

  saveFile(filePath, hash) {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, hash, last_indexed)
      VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, last_indexed = excluded.last_indexed;
    `);
    stmt.run(filePath, hash, Date.now());
  }

  deleteFile(filePath) {
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

  getCallers(symbolName) {
    // Find files that depend on this symbol name
    const stmt = this.db.prepare(`
      SELECT DISTINCT from_file as file_path, symbol 
      FROM dependencies 
      WHERE symbol = ?;
    `);
    return stmt.all(symbolName);
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

  updatePageRanks(ranks) {
    const stmt = this.db.prepare(`UPDATE files SET pagerank = ? WHERE path = ?;`);
    for (const [filePath, rank] of Object.entries(ranks)) {
      stmt.run(rank, filePath);
    }
  }

  getSkeletonMap() {
    const files = this.db.prepare(`SELECT path, pagerank FROM files ORDER BY pagerank DESC;`).all();
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
        symbols: symbols.map(s => ({
          name: s.name,
          type: s.type,
          signature: s.signature
        }))
      });
    }
    return map;
  }
}
