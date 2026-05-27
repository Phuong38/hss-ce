import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeDatabase } from './db.js';
import { CodeIndexer } from './indexer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runExploreServer(dbPath, rootDir, port = 3000) {
  const db = new CodeDatabase(dbPath);

  const server = http.createServer((req, res) => {
    // Enable CORS for convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    try {
      // 1. Serve Dashboard HTML
      if (pathname === '/' || pathname === '/index.html' || pathname === '/explore.html') {
        const htmlPath = path.join(__dirname, 'explore.html');
        if (!fs.existsSync(htmlPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Dashboard HTML file not found.');
          return;
        }
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      // 2. API: Get Graph Data
      if (pathname === '/api/data') {
        const skeleton = db.getSkeletonMap();
        const dependencies = db.db.prepare('SELECT from_file, to_file, symbol FROM dependencies;').all();
        
        // Build raw Mermaid syntax for visualization backup
        const makeSafeId = (p) => p.replace(/[^a-zA-Z0-9]/g, '_');
        let mermaid = 'graph TD\n';
        if (dependencies.length === 0) {
          mermaid += '  NoDeps[No dependencies found]\n';
        } else {
          const filesSet = new Set();
          dependencies.forEach(d => {
            filesSet.add(d.from_file);
            filesSet.add(d.to_file);
          });
          filesSet.forEach(f => {
            mermaid += `  ${makeSafeId(f)}["${f}"]\n`;
          });
          dependencies.forEach(d => {
            const cleanSymbol = d.symbol.replace(/"/g, "'").replace(/[^\w-]/g, '_');
            mermaid += `  ${makeSafeId(d.from_file)} -->|"${cleanSymbol}"| ${makeSafeId(d.to_file)}\n`;
          });
        }

        const responseData = {
          files: skeleton,
          dependencies,
          mermaid,
          rootDir
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
        return;
      }

      // 3. API: Get File Content
      if (pathname === '/api/file') {
        const queryPath = parsedUrl.searchParams.get('path');
        if (!queryPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path parameter' }));
          return;
        }

        const absolutePath = path.resolve(rootDir, queryPath);
        const resolvedRoot = path.resolve(rootDir);

        // Security check: Directory Traversal Prevention
        if (!absolutePath.startsWith(resolvedRoot)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied: Path outside workspace.' }));
          return;
        }

        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found.' }));
          return;
        }

        const content = fs.readFileSync(absolutePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
        return;
      }

      // 4. API: Reindex Workspace
      if (pathname === '/api/reindex' && req.method === 'POST') {
        console.log('Triggering background re-indexing via dashboard...');
        const indexer = new CodeIndexer(db, rootDir);
        indexer.index();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 5. Default 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (e) {
      console.error('Explore Server Route Error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, () => {
    console.log(`\n🚀 HSS-CE Codebase Explorer Dashboard active!`);
    console.log(`👉 Open http://localhost:${port} in your browser.\n`);
  });

  return server;
}
