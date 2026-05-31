#!/usr/bin/env node

import { CodeDatabase } from './db.js';
import { CodeIndexer } from './indexer.js';
import { runMcpServer } from './mcp-server.js';
import { stripComments } from './parser.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

const makeSafeId = (p) => p.replace(/[^a-zA-Z0-9]/g, '_');

function getGroupForPath(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const parts = p.split('/');
  
  if (p.startsWith('client/src/components/ui/')) {
    return 'Client UI Components';
  }
  if (p.startsWith('client/src/components/')) {
    return 'Client Components';
  }
  if (p.startsWith('client/src/lib/')) {
    return 'Client Lib';
  }
  if (p.startsWith('server/src/core/')) {
    return `Server Core: ${parts[3] || 'general'}`;
  }
  if (p.startsWith('server/src/infrastructure/')) {
    return 'Server Infra';
  }
  if (p.startsWith('server/src/jobs/')) {
    return 'Server Jobs';
  }
  if (p.startsWith('server/src/presentation/')) {
    return 'Server API';
  }
  if (p.startsWith('scripts/')) {
    return 'Scripts';
  }
  if (parts.length > 1) {
    return parts[0];
  }
  return 'Root';
}

function generateMermaidGraph(deps, isMarkdown = false) {
  let mermaid = isMarkdown ? "```mermaid\ngraph TD\n" : "graph TD\n";
  if (deps.length === 0) {
    mermaid += "  NoDependencies[No dependencies found]\n";
  } else {
    const files = new Set();
    deps.forEach(d => {
      files.add(d.from_file);
      files.add(d.to_file);
    });
    files.forEach(f => {
      mermaid += `  ${makeSafeId(f)}["${f}"]\n`;
    });
    deps.forEach(d => {
      const cleanSymbol = d.symbol.replace(/"/g, "'").replace(/[^\w-]/g, '_');
      mermaid += `  ${makeSafeId(d.from_file)} -->|"${cleanSymbol}"| ${makeSafeId(d.to_file)}\n`;
    });
  }
  if (isMarkdown) mermaid += "```\n";
  return mermaid;
}

function generateLayeredMermaidGraph(deps, map, isMarkdown = false) {
  let mermaid = isMarkdown ? "```mermaid\ngraph TD\n" : "graph TD\n";
  if (deps.length === 0) {
    mermaid += "  NoDependencies[No dependencies found]\n";
  } else {
    // Styling classes for nodes (using dark mode colors)
    mermaid += "  classDef entrypoint fill:#311b22,stroke:#f43f5e,stroke-width:2px,color:#fda4af;\n";
    mermaid += "  classDef service fill:#0f1d30,stroke:#38bdf8,stroke-width:2px,color:#7dd3fc;\n";
    mermaid += "  classDef storage fill:#06261a,stroke:#34d399,stroke-width:2px,color:#a7f3d0;\n\n";

    const entrypoints = map.filter(f => f.layer === 'entrypoint');
    const services = map.filter(f => f.layer === 'service');
    const storage = map.filter(f => f.layer === 'storage');

    const getGroupIcon = (groupName) => {
      if (groupName.includes('UI')) return '🎨 ';
      if (groupName.includes('Components')) return '🧩 ';
      if (groupName.includes('Lib')) return '📦 ';
      if (groupName.includes('Core')) return '🧠 ';
      if (groupName.includes('Infra')) return '🛠️ ';
      if (groupName.includes('Jobs')) return '⏰ ';
      if (groupName.includes('API')) return '🔌 ';
      if (groupName.includes('Scripts')) return '📜 ';
      return '📂 ';
    };

    const getNodeIcon = (layer) => {
      if (layer === 'entrypoint') return '🚀 ';
      if (layer === 'storage') return '💾 ';
      return '⚙️ ';
    };

    const renderLayer = (layerId, displayName, files, layerClass) => {
      if (files.length === 0) return '';
      let res = `  subgraph ${layerId}["${displayName}"]\n`;
      
      const groups = {};
      files.forEach(f => {
        const g = getGroupForPath(f.path);
        if (!groups[g]) groups[g] = [];
        groups[g].push(f);
      });
      
      Object.keys(groups).forEach(g => {
        const safeGroupId = makeSafeId(g);
        const icon = getGroupIcon(g);
        res += `    subgraph ${safeGroupId}["${icon}${g}"]\n`;
        groups[g].forEach(f => {
          const base = path.basename(f.path);
          const nodeIcon = getNodeIcon(f.layer);
          res += `      ${makeSafeId(f.path)}["${nodeIcon}${base}"]\n`;
        });
        res += `    end\n`;
      });
      
      res += '  end\n';

      // Apply style classes
      files.forEach(f => {
        res += `  class ${makeSafeId(f.path)} ${layerClass};\n`;
      });
      res += '\n';
      return res;
    };

    mermaid += renderLayer('Entrypoints', '🚀 Entrypoints', entrypoints, 'entrypoint');
    mermaid += renderLayer('Services', '⚙️ Services', services, 'service');
    mermaid += renderLayer('Storage', '💾 Storage', storage, 'storage');

    deps.forEach(d => {
      const cleanSymbol = d.symbol.replace(/"/g, "'").replace(/[^\w-]/g, '_');
      mermaid += `  ${makeSafeId(d.from_file)} -->|"${cleanSymbol}"| ${makeSafeId(d.to_file)}\n`;
    });
  }
  if (isMarkdown) mermaid += "```\n";
  return mermaid;
}

function estimateTokens(str) {
  return Math.ceil(str.length / 4);
}

function redactSecrets(content) {
  let redacted = content;
  
  // 1. AWS Access Key ID
  redacted = redacted.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY_ID]');
  
  // 2. OpenAI API Key
  redacted = redacted.replace(/\bsk-(?:proj-|or-v1-)?[a-zA-Z0-9]{32,}\b/g, '[REDACTED_OPENAI_KEY]');
  
  // 3. Slack Token
  redacted = redacted.replace(/\bxox[bpa]-[a-zA-Z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]');
  
  // 4. Generic secret/key/password assignment in code/config
  const secretAssignRegex = /(secret|password|passwd|key|token|auth|credential|private_key|passphrase)\s*(?:=|:)\s*['"]([^'"]{8,})['"]/gi;
  redacted = redacted.replace(secretAssignRegex, (match, param, val) => {
    if (
      val.includes('/') || 
      val.includes('\\') || 
      val.startsWith('http') || 
      val === 'true' || 
      val === 'false' || 
      val.length < 12
    ) {
      return match;
    }
    const separator = match.includes(':') ? ':' : '=';
    const quote = match.includes("'") ? "'" : '"';
    return `${param}${separator}${quote}[REDACTED]${quote}`;
  });

  return redacted;
}

function formatCompactMap(map, tokenBudget) {
  let output = `=== CODEBASE SIGNATURE MAP (Token Budget: ${tokenBudget}) ===\n`;
  let currentTokens = estimateTokens(output);

  for (const file of map) {
    let fileOutput = `\n📄 File: [${file.path}] (Rank: ${file.pagerank.toFixed(3)} | Layer: ${file.layer || 'service'})\n`;
    if (file.summary) {
      fileOutput += `  Summary: ${file.summary}\n`;
    }
    if (file.symbols.length === 0) {
      fileOutput += '  (No exported symbols/routes)\n';
    } else {
      file.symbols.forEach(sym => {
        fileOutput += `  🔹 [${sym.type.toUpperCase()}] ${sym.signature || sym.name}\n`;
      });
    }

    const fileTokens = estimateTokens(fileOutput);
    if (currentTokens + fileTokens > tokenBudget) {
      output += `\n... [Truncated due to token budget of ${tokenBudget} tokens] ...\n`;
      break;
    }

    output += fileOutput;
    currentTokens += fileTokens;
  }
  return output;
}

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printUsage();
  process.exit(1);
}

// Find flags
const activeFlag = args.find(a => a.startsWith('--active='));
const activeFiles = activeFlag ? activeFlag.split('=')[1].split(',') : null;

const compact = args.includes('--compact');
const noComments = args.includes('--no-comments');

const budgetFlag = args.find(a => a.startsWith('--budget='));
const tokenBudget = budgetFlag ? parseInt(budgetFlag.split('=')[1], 10) : 1000;

const outputFlag = args.find(a => a.startsWith('--output='));
const outputFile = outputFlag ? outputFlag.split('=')[1] : null;

// The target path is the first argument that is not a flag and is not the command
const targetPath = args.slice(1).find(a => !a.startsWith('-')) || '.';
const rootDir = path.resolve(targetPath);
if (!fs.existsSync(rootDir)) {
  console.error(`Target path does not exist: ${rootDir}`);
  process.exit(1);
}

// Store SQLite database in target codebase directory: .hss-ce/graph.db
const hssDir = path.join(rootDir, '.hss-ce');
const dbPath = path.join(hssDir, 'graph.db');

try {
  switch (command) {
    case 'index': {
      const db = new CodeDatabase(dbPath);
      const indexer = new CodeIndexer(db, rootDir);
      const forceIndex = args.includes('--force') || args.includes('-f');
      indexer.index(forceIndex, activeFiles);
      break;
    }

    case 'map': {
      const db = new CodeDatabase(dbPath);
      const map = db.getSkeletonMap();
      if (compact) {
        console.log(formatCompactMap(map, tokenBudget));
      } else {
        console.log(formatSkeletonMap(map));
      }
      break;
    }

    case 'query': {
      const extraArg = args.slice(1).find(a => !a.startsWith('-') && a !== targetPath);
      if (!extraArg) {
        console.error('Specify symbol name: query <path> <symbol>');
        process.exit(1);
      }
      const db = new CodeDatabase(dbPath);
      const defs = db.getDefinition(extraArg);
      const callers = db.getCallers(extraArg);
      
      console.log(`\n=== DEFINITION OF "${extraArg}" ===`);
      console.log(defs.length > 0 ? JSON.stringify(defs, null, 2) : 'Not found');
      
      console.log(`\n=== CALLERS OF "${extraArg}" ===`);
      console.log(callers.length > 0 ? JSON.stringify(callers, null, 2) : 'None');
      break;
    }

    case 'mcp': {
      // Ensure directory initialized
      if (!fs.existsSync(dbPath)) {
        console.error(`Index not found at: ${dbPath}. Run "index" command first.`);
        process.exit(1);
      }
      // Start MCP Server
      await runMcpServer(dbPath, rootDir);
      break;
    }

    case 'explore': {
      // Ensure directory initialized
      if (!fs.existsSync(dbPath)) {
        console.error(`Index not found at: ${dbPath}. Run "index" command first.`);
        process.exit(1);
      }
      const portFlag = args.find(a => a.startsWith('--port='));
      const port = portFlag ? parseInt(portFlag.split('=')[1], 10) : 3000;
      const { runExploreServer } = await import('./explore-server.js');
      runExploreServer(dbPath, rootDir, port);
      break;
    }

    case 'graph': {
      const db = new CodeDatabase(dbPath);
      let deps = db.db.prepare(`SELECT from_file, to_file, symbol FROM dependencies;`).all();
      const map = db.getSkeletonMap();
      if (map.length > 60) {
        const topFiles = map.slice(0, 60).map(f => f.path);
        const topFilesSet = new Set(topFiles);
        deps = deps.filter(d => topFilesSet.has(d.from_file) && topFilesSet.has(d.to_file));
      }
      console.log(generateMermaidGraph(deps, false));
      break;
    }

    case 'doc': {
      const db = new CodeDatabase(dbPath);
      const map = db.getSkeletonMap();
      let deps = db.db.prepare(`SELECT from_file, to_file, symbol FROM dependencies;`).all();
      
      // Filter dependencies for large codebases to keep the graph readable and avoid crashes
      let filteredMap = map;
      if (map.length > 60) {
        const topFiles = map.slice(0, 60).map(f => f.path);
        const topFilesSet = new Set(topFiles);
        const filteredDeps = deps.filter(d => topFilesSet.has(d.from_file) && topFilesSet.has(d.to_file));
        
        const connectedFiles = new Set();
        filteredDeps.forEach(d => {
          connectedFiles.add(d.from_file);
          connectedFiles.add(d.to_file);
        });
        
        deps = filteredDeps;
        filteredMap = map.filter(f => connectedFiles.has(f.path));
      }
      
      // 1. Generate standard markdown Mermaid block for README.md
      const mermaid = generateLayeredMermaidGraph(deps, filteredMap, true);

      let fileDescriptions = "";
      map.forEach(file => {
        fileDescriptions += `### [${file.path}](file:///${path.join(rootDir, file.path)})\n`;
        fileDescriptions += `* **Rank:** ${file.pagerank.toFixed(3)} | **Layer:** ${file.layer || 'service'}\n`;
        if (file.summary) {
          fileDescriptions += `* **Summary:** ${file.summary}\n`;
        }
        if (file.symbols.length > 0) {
          fileDescriptions += `* **Symbols:**\n`;
          file.symbols.forEach(sym => {
            fileDescriptions += `  - \`[${sym.type.toUpperCase()}]\` \`${sym.signature || sym.name}\`\n`;
          });
        } else {
          fileDescriptions += `* No exported symbols.\n`;
        }
        fileDescriptions += "\n";
      });

      const docContent = `# HSS-CE: Hybrid Semantic-Structural Context Engine

Local codebase indexer and MCP server designed to optimize context retrieval for AI coding agents.

## Architecture Diagram

${mermaid}

## Codebase Map & Symbols (PageRank Ordered)

${fileDescriptions}

## How to Run

### 1. Build Index
\`\`\`bash
node src/cli.js index .
\`\`\`

### 2. Run MCP Server
\`\`\`bash
node src/cli.js mcp .
\`\`\`
`;

      const docPath = path.join(rootDir, 'CODEBASE.md');
      fs.writeFileSync(docPath, docContent);
      console.log(`Documentation generated at: ${docPath}`);

      // 2. Generate interactive HTML architecture explorer
      const rawMermaidDef = generateLayeredMermaidGraph(deps, filteredMap, false);

      const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HSS-CE Codebase Explorer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
  <style>
    :root {
      --bg-dark: #0b0f19;
      --panel-bg: rgba(255, 255, 255, 0.03);
      --border-color: rgba(255, 255, 255, 0.08);
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --success: #34d399;
      --warning: #fbbf24;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-sans);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 1rem 2rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(11, 15, 25, 0.5);
      backdrop-filter: blur(10px);
    }
    header h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      background: linear-gradient(to right, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    header .path {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--text-muted);
      padding: 0.25rem 0.75rem;
      background: rgba(255,255,255,0.02);
      border-radius: 6px;
      border: 1px solid var(--border-color);
    }
    .layout {
      flex: 1;
      display: grid;
      grid-template-columns: 320px 1fr 340px;
      height: calc(100vh - 60px);
    }
    .panel {
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: rgba(11, 15, 25, 0.2);
    }
    .panel-header {
      padding: 1rem;
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .scrollable {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }
    .scrollable::-webkit-scrollbar { width: 6px; }
    .scrollable::-webkit-scrollbar-track { background: transparent; }
    .scrollable::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
    .scrollable::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

    .file-card {
      padding: 0.85rem;
      border-radius: 8px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      margin-bottom: 0.75rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .file-card:hover {
      border-color: rgba(56, 189, 248, 0.4);
      background: rgba(56, 189, 248, 0.02);
    }
    .file-card.active {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.08);
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
    }
    .file-name {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-right: 0.5rem;
    }
    .rank-badge {
      font-size: 0.75rem;
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
    }
    .rank-badge.high { background: rgba(52, 211, 153, 0.1); color: var(--success); }
    .rank-badge.mid { background: rgba(251, 191, 36, 0.1); color: var(--warning); }
    .rank-badge.low { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); }

    .layer-badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .layer-badge.entrypoint { background: rgba(244, 63, 94, 0.15); color: #fda4af; }
    .layer-badge.service { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; }
    .layer-badge.storage { background: rgba(52, 211, 153, 0.15); color: #a7f3d0; }

    .graph-panel {
      display: flex;
      flex-direction: column;
      background: radial-gradient(circle at center, #111827 0%, #030712 100%);
      position: relative;
    }
    .graph-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      padding: 1rem;
      position: relative;
    }
    #mermaid-target {
      width: 100%;
      height: 100%;
    }
    #mermaid-target svg .edgePath path {
      stroke: #6366f1 !important;
      stroke-width: 1.5px !important;
      transition: stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease, filter 0.25s ease;
    }
    #mermaid-target svg marker path,
    #mermaid-target svg marker polygon {
      fill: #6366f1 !important;
      transition: fill 0.25s ease;
    }

    .details-panel {
      border-right: none;
      border-left: 1px solid var(--border-color);
    }
    .detail-section {
      margin-bottom: 1.5rem;
    }
    .detail-section-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      letter-spacing: 0.025em;
    }
    .symbol-item {
      padding: 0.5rem;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
    }
    .symbol-type {
      font-size: 0.65rem;
      text-transform: uppercase;
      font-weight: 700;
      display: inline-block;
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
      margin-right: 0.4rem;
    }
    .type-class { background: rgba(129, 140, 248, 0.15); color: #a5b4fc; }
    .type-function { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; }
    .type-route { background: rgba(244, 63, 94, 0.15); color: #fda4af; }
    
    .symbol-sig {
      font-family: var(--font-mono);
      margin-top: 0.25rem;
      color: #cbd5e1;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <header>
    <h1>HSS-CE Codebase Explorer</h1>
    <div class="path" id="root-path">.</div>
  </header>
  <div class="layout">
    <div class="panel">
      <div class="panel-header">
        <span>Files</span>
        <span style="font-size:0.75rem;color:var(--text-muted);" id="file-count">0</span>
      </div>
      <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-color);">
        <input type="text" id="search-box" placeholder="Search files or symbols..." style="width: 100%; padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-main); font-family: var(--font-sans); font-size: 0.85rem;" oninput="filterFiles()" />
      </div>
      <div class="scrollable" id="files-list"></div>
    </div>
    
    <div class="panel graph-panel">
      <div class="panel-header">
        <span>Architecture Diagram</span>
      </div>
      <div class="graph-container">
        <div id="mermaid-target"></div>
      </div>
    </div>

    <div class="panel details-panel">
      <div class="panel-header">
        <span>Details</span>
      </div>
      <div class="scrollable" id="details-content">
        <div style="color:var(--text-muted);text-align:center;margin-top:2rem;">Click a file to view details</div>
      </div>
    </div>
  </div>

  <script>
    const data = ${JSON.stringify(map)};
    const mermaidDef = \`${rawMermaidDef.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
    const rootPath = "${rootDir.replace(/\\/g, '\\\\')}";

    document.getElementById('root-path').textContent = rootPath;
    document.getElementById('file-count').textContent = data.length + ' files';

    mermaid.initialize({ maxTextSize: 1000000, startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    const target = document.getElementById('mermaid-target');
    target.textContent = mermaidDef;
    target.className = 'mermaid';
    
    mermaid.run().then(() => {
      const svgElement = document.querySelector('#mermaid-target svg');
      if (svgElement) {
        svgElement.removeAttribute('style');
        svgElement.style.width = '100%';
        svgElement.style.height = '100%';
        svgPanZoom(svgElement, {
          zoomEnabled: true,
          controlIconsEnabled: true,
          fit: true,
          center: true,
          minZoom: 0.1,
          maxZoom: 10
        });

        // Add node click listeners
        svgElement.querySelectorAll('.node').forEach(nodeEl => {
          nodeEl.style.cursor = 'pointer';
          nodeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const idAttr = nodeEl.id || '';
            const match = idAttr.match(/flowchart-([a-zA-Z0-9_]+)/) || idAttr.match(/([a-zA-Z0-9_]+)/);
            const nodeId = match ? match[1] : '';
            const foundIndex = data.findIndex(f => f.path.replace(/[^a-zA-Z0-9]/g, '_') === nodeId);
            if (foundIndex !== -1) {
              selectFile(foundIndex);
            }
          });
        });

        // Clear selection on background click
        svgElement.addEventListener('click', () => {
          const cards = document.querySelectorAll('.file-card');
          cards.forEach(c => c.classList.remove('active'));
          const detailsContainer = document.getElementById('details-content');
          detailsContainer.innerHTML = '<div style="color:var(--text-muted);text-align:center;margin-top:2rem;">Click a file to view details</div>';
          highlightNodeInSvg(null);
        });
      }
    }).catch(err => console.error(err));

    const listContainer = document.getElementById('files-list');
    data.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.onclick = () => selectFile(index);
      
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.path;
      
      const badge = document.createElement('span');
      const pr = file.pagerank;
      badge.className = 'rank-badge ' + (pr > 0.8 ? 'high' : pr > 0.4 ? 'mid' : 'low');
      badge.textContent = pr.toFixed(3);
      
      card.appendChild(name);
      card.appendChild(badge);
      listContainer.appendChild(card);
    });

    function filterFiles() {
      const query = document.getElementById('search-box').value.toLowerCase();
      const cards = document.querySelectorAll('.file-card');
      cards.forEach((card, idx) => {
        const file = data[idx];
        const matchPath = file.path.toLowerCase().includes(query);
        const matchSym = file.symbols.some(s => s.name.toLowerCase().includes(query));
        if (matchPath || matchSym) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }

    function highlightNodeInSvg(filePath) {
      const svg = document.querySelector('#mermaid-target svg');
      if (!svg) return;

      const safeId = filePath ? filePath.replace(/[^a-zA-Z0-9]/g, '_') : null;

      // Reset all nodes and edges to default state
      svg.querySelectorAll('.node').forEach(el => {
        el.style.opacity = '1';
        el.style.removeProperty('color');
        const shape = el.querySelector('rect, polygon, circle, ellipse, path');
        if (shape) {
          shape.style.removeProperty('fill');
          shape.style.removeProperty('stroke');
          shape.style.removeProperty('stroke-width');
          shape.style.removeProperty('filter');
        }
        el.querySelectorAll('text, tspan').forEach(t => {
          t.style.removeProperty('fill');
          t.style.removeProperty('color');
        });
        el.querySelectorAll('span, div, p').forEach(t => {
          t.style.removeProperty('color');
        });
      });

      svg.querySelectorAll('path.flowchart-link').forEach(pathEl => {
        pathEl.style.opacity = '1';
        pathEl.style.removeProperty('stroke');
        pathEl.style.removeProperty('stroke-width');
        pathEl.style.removeProperty('filter');
      });
      svg.querySelectorAll('.edgeLabel').forEach(el => el.style.opacity = '1');

      if (!safeId) return;

      // Fade non-connected elements by default
      svg.querySelectorAll('.node').forEach(el => {
        const idAttr = el.id || '';
        const match = idAttr.match(/flowchart-([a-zA-Z0-9_]+)/) || idAttr.match(/([a-zA-Z0-9_]+)/);
        const nodeId = match ? match[1] : '';
        if (nodeId !== safeId) {
          el.style.opacity = '0.08';
        }
      });
      svg.querySelectorAll('path.flowchart-link').forEach(pathEl => {
        pathEl.style.opacity = '0.03';
      });
      svg.querySelectorAll('.edgeLabel').forEach(el => el.style.opacity = '0.03');

      // Find clicked node
      const nodeEl = svg.querySelector(\`.node[id*="\${safeId}"]\`) || svg.querySelector(\`[id^="\${safeId}"]\`);
      if (nodeEl) {
        // Highlight active node
        nodeEl.style.opacity = '1';
        nodeEl.parentNode.appendChild(nodeEl);
        const activeShape = nodeEl.querySelector('rect, polygon, circle, ellipse, path');
        if (activeShape) {
          activeShape.style.setProperty('fill', '#fbbf24', 'important'); // Solid gold background
          activeShape.style.setProperty('stroke', '#d97706', 'important'); // Gold/orange border
          activeShape.style.setProperty('stroke-width', '4px', 'important');
          activeShape.style.setProperty('filter', 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.8))', 'important');
        }
        nodeEl.style.setProperty('color', '#0b0f19', 'important');
        nodeEl.querySelectorAll('text, tspan').forEach(t => {
          t.style.setProperty('fill', '#0b0f19', 'important');
          t.style.setProperty('color', '#0b0f19', 'important');
        });
        nodeEl.querySelectorAll('span, div, p').forEach(t => {
          t.style.setProperty('color', '#0b0f19', 'important');
        });
        
        // Highlight connected edges and nodes using their generated SVG path IDs
        svg.querySelectorAll('path.flowchart-link').forEach(pathEl => {
          if (pathEl && pathEl.id) {
            const idx = pathEl.id.indexOf('-L_');
            if (idx !== -1) {
              let parts = pathEl.id.slice(idx + 3);
              const lastUnderscoreIdx = parts.lastIndexOf('_');
              if (lastUnderscoreIdx !== -1) {
                parts = parts.slice(0, lastUnderscoreIdx);
                
                let isConnected = false;
                let targetNodeId = null;
                const allNodeIds = data.map(f => f.path.replace(/[^a-zA-Z0-9]/g, '_'));
                
                if (parts.startsWith(safeId + '_')) {
                  const candidate = parts.slice(safeId.length + 1);
                  if (allNodeIds.includes(candidate)) {
                    isConnected = true;
                    targetNodeId = candidate;
                  }
                }
                
                if (!isConnected && parts.endsWith('_' + safeId)) {
                  const candidate = parts.slice(0, parts.length - safeId.length - 1);
                  if (allNodeIds.includes(candidate)) {
                    isConnected = true;
                    targetNodeId = candidate;
                  }
                }
                
                if (isConnected) {
                  pathEl.style.opacity = '1';
                  pathEl.style.setProperty('stroke', '#06b6d4', 'important'); // Glowing electric cyan
                  pathEl.style.setProperty('stroke-width', '4px', 'important');
                  pathEl.style.setProperty('filter', 'drop-shadow(0 0 6px rgba(6, 182, 212, 0.8))', 'important');
                  
                  // Bring edge parent group to front
                  const edgeGroup = pathEl.closest('g');
                  if (edgeGroup && edgeGroup !== svg) {
                    edgeGroup.parentNode.appendChild(edgeGroup);
                  }
                  
                  // Highlight connected nodes
                  const connectedNode = svg.querySelector(\`.node[id*="\${targetNodeId}"]\`) || svg.querySelector(\`[id^="\${targetNodeId}"]\`);
                  if (connectedNode) {
                    connectedNode.style.opacity = '1';
                    connectedNode.parentNode.appendChild(connectedNode); // Bring connected node to front
                    
                    const connShape = connectedNode.querySelector('rect, polygon, circle, ellipse, path');
                    if (connShape) {
                      connShape.style.setProperty('fill', '#0ea5e9', 'important'); // Solid sky blue background
                      connShape.style.setProperty('stroke', '#0284c7', 'important'); // Vivid sky blue border
                      connShape.style.setProperty('stroke-width', '3px', 'important');
                      connShape.style.setProperty('filter', 'drop-shadow(0 0 8px rgba(14, 165, 233, 0.6))', 'important');
                    }
                    connectedNode.style.setProperty('color', '#ffffff', 'important');
                    connectedNode.querySelectorAll('text, tspan').forEach(t => {
                      t.style.setProperty('fill', '#ffffff', 'important');
                      t.style.setProperty('color', '#ffffff', 'important');
                    });
                    connectedNode.querySelectorAll('span, div, p').forEach(t => {
                      t.style.setProperty('color', '#ffffff', 'important');
                    });
                  }
                }
              }
            }
          }
        });
      }
    }

    function selectFile(index) {
      const cards = document.querySelectorAll('.file-card');
      cards.forEach((c, idx) => {
        if (idx === index) {
          c.classList.add('active');
          c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        else c.classList.remove('active');
      });

      const file = data[index];
      const detailsContainer = document.getElementById('details-content');
      detailsContainer.innerHTML = '';

      const titleSec = document.createElement('div');
      titleSec.className = 'detail-section';
      titleSec.innerHTML = \`
        <h2 style="font-size:1.1rem;margin-bottom:0.25rem;word-break:break-all;">\${file.path}</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;margin:0.5rem 0;">
          <span class="layer-badge \${file.layer}">\${file.layer.toUpperCase()}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);">PageRank: \${file.pagerank.toFixed(4)}</span>
        </div>
        \${file.summary ? \`<p style="font-size:0.85rem;color:var(--text-main);line-height:1.4;background:rgba(255,255,255,0.02);padding:0.75rem;border-radius:6px;border:1px solid var(--border-color);margin-top:0.5rem;">\${file.summary}</p>\` : ''}
      \`;
      detailsContainer.appendChild(titleSec);

      const symSec = document.createElement('div');
      symSec.className = 'detail-section';
      symSec.innerHTML = '<div class="detail-section-title">Symbols</div>';
      
      if (file.symbols.length === 0) {
        symSec.innerHTML += '<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic">No exported symbols</div>';
      } else {
        file.symbols.forEach(sym => {
          const item = document.createElement('div');
          item.className = 'symbol-item';
          
          const typeClass = 'type-' + sym.type.toLowerCase();
          item.innerHTML = \`
            <div>
              <span class="symbol-type \${typeClass}">\${sym.type}</span>
              <strong style="color:var(--text-main)">\${sym.name}</strong>
            </div>
            \${sym.signature ? \`<div class="symbol-sig">\${sym.signature}</div>\` : ''}
          \`;
          symSec.appendChild(item);
        });
      }
      detailsContainer.appendChild(symSec);

      highlightNodeInSvg(file.path);
    }
  </script>
</body>
</html>
`;

      const htmlPath = path.join(rootDir, 'architecture.html');
      fs.writeFileSync(htmlPath, htmlTemplate);
      console.log(`HTML Dashboard generated at: ${htmlPath}`);
      break;
    }

    case 'enrich': {
      const db = new CodeDatabase(dbPath);
      const forceEnrich = args.includes('--force');
      const apiKey = process.env.GEMINI_API_KEY || args.find(a => a.startsWith('--key='))?.split('=')[1] || null;
      const { enrichCodebase } = await import('./enrich.js');
      await enrichCodebase(db, rootDir, apiKey, forceEnrich);
      break;
    }

    case 'tour': {
      const db = new CodeDatabase(dbPath);
      const map = db.getSkeletonMap();
      
      console.log('# HSS-CE Codebase Onboarding Tour\n');
      console.log('This tour guides you through the codebase architecture step-by-step, ordered by PageRank significance.\n');

      const entrypoints = map.filter(f => f.layer === 'entrypoint');
      const services = map.filter(f => f.layer === 'service');
      const storage = map.filter(f => f.layer === 'storage');

      console.log('## 1. Entrypoints & Endpoints (How the app starts / receives input)');
      if (entrypoints.length === 0) console.log('* No entrypoint layer files detected.');
      else {
        entrypoints.forEach(f => {
          console.log(`### 📄 [${f.path}](file:///${path.join(rootDir, f.path)}) (PageRank: ${f.pagerank.toFixed(3)})`);
          if (f.summary) console.log(`> ${f.summary}\n`);
          if (f.symbols.length > 0) {
            console.log('*Exported Symbols:*');
            f.symbols.forEach(s => console.log(`- \`[${s.type.toUpperCase()}]\` \`${s.signature || s.name}\``));
            console.log('');
          }
        });
      }

      console.log('## 2. Business Logic & Services (Core operations)');
      if (services.length === 0) console.log('* No service layer files detected.');
      else {
        services.slice(0, 15).forEach(f => {
          console.log(`### 📄 [${f.path}](file:///${path.join(rootDir, f.path)}) (PageRank: ${f.pagerank.toFixed(3)})`);
          if (f.summary) console.log(`> ${f.summary}\n`);
          if (f.symbols.length > 0) {
            console.log('*Exported Symbols:*');
            f.symbols.forEach(s => console.log(`- \`[${s.type.toUpperCase()}]\` \`${s.signature || s.name}\``));
            console.log('');
          }
        });
        if (services.length > 15) {
          console.log(`*And ${services.length - 15} other service files...*\n`);
        }
      }

      console.log('## 3. Data & Storage (Persistence & Models)');
      if (storage.length === 0) console.log('* No storage layer files detected.');
      else {
        storage.forEach(f => {
          console.log(`### 📄 [${f.path}](file:///${path.join(rootDir, f.path)}) (PageRank: ${f.pagerank.toFixed(3)})`);
          if (f.summary) console.log(`> ${f.summary}\n`);
          if (f.symbols.length > 0) {
            console.log('*Exported Symbols:*');
            f.symbols.forEach(s => console.log(`- \`[${s.type.toUpperCase()}]\` \`${s.signature || s.name}\``));
            console.log('');
          }
        });
      }
      break;
    }

    case 'pack': {
      const db = new CodeDatabase(dbPath);
      const map = db.getSkeletonMap();
      
      let packedOutput = `<!-- HSS-CE Codebase Context Pack (Budget: ${tokenBudget} tokens) -->\n`;
      let currentTokens = estimateTokens(packedOutput);

      for (const file of map) {
        const absoluteFilePath = path.join(rootDir, file.path);
        if (!fs.existsSync(absoluteFilePath)) continue;
        
        let content = '';
        try {
          content = fs.readFileSync(absoluteFilePath, 'utf-8');
        } catch {
          continue;
        }

        content = redactSecrets(content);
        if (noComments) {
          content = stripComments(content, path.extname(file.path));
        }

        const fileBlock = `<file path="${file.path}">\n${content}\n</file>\n`;
        const fileTokens = estimateTokens(fileBlock);

        if (currentTokens + fileTokens > tokenBudget) {
          packedOutput += `\n<!-- Truncated: reached token budget of ${tokenBudget} tokens -->\n`;
          break;
        }

        packedOutput += fileBlock;
        currentTokens += fileTokens;
      }

      if (outputFile) {
        const fullOutputPath = path.resolve(outputFile);
        fs.writeFileSync(fullOutputPath, packedOutput, 'utf-8');
        console.log(`Packed context written to: ${fullOutputPath}`);
      } else {
        console.log(packedOutput);
      }
      break;
    }

    case 'search': {
      const db = new CodeDatabase(dbPath);
      const query = args.slice(1).filter(a => !a.startsWith('-'))[1];
      if (!query) {
        console.error('Usage: hss-ce search <path> <query>');
        process.exit(1);
      }
      const results = db.searchSymbols(query);
      if (results.length === 0) {
        console.log(`No symbols matching "${query}" found.`);
      } else {
        console.log(`=== SYMBOLS MATCHING "${query}" ===`);
        results.forEach(sym => {
          console.log(`\n📄 [${sym.type.toUpperCase()}] ${sym.name} (File: ${sym.file_path}:${sym.start_line})`);
          if (sym.signature) console.log(`   Signature: ${sym.signature}`);
        });
      }
      break;
    }

    case 'search-code': {
      const db = new CodeDatabase(dbPath);
      const query = args.slice(1).filter(a => !a.startsWith('-'))[1];
      if (!query) {
        console.error('Usage: hss-ce search-code <path> <query>');
        process.exit(1);
      }
      const isRegex = args.includes('--regex');
      const files = db.getAllFiles();
      const results = [];
      let searchRegex;
      if (isRegex) {
        searchRegex = new RegExp(query, 'i');
      }
      for (const file of files) {
        const absPath = path.join(rootDir, file.path);
        if (!fs.existsSync(absPath)) continue;
        try {
          const fileContent = fs.readFileSync(absPath, 'utf-8');
          const lines = fileContent.split('\n');
          lines.forEach((lineContent, idx) => {
            const lineNum = idx + 1;
            let isMatch = false;
            if (isRegex) {
              isMatch = searchRegex.test(lineContent);
            } else {
              isMatch = lineContent.toLowerCase().includes(query.toLowerCase());
            }
            if (isMatch) {
              results.push({
                filePath: file.path,
                line: lineNum,
                content: lineContent.trim()
              });
            }
          });
        } catch (err) {
          // Ignore read errors
        }
      }
      if (results.length === 0) {
        console.log(`No code occurrences matching "${query}" found.`);
      } else {
        console.log(`=== CODE OCCURRENCES MATCHING "${query}" ===`);
        results.slice(0, 100).forEach(res => {
          console.log(`\n📄 File: ${res.filePath}:${res.line}`);
          console.log(`   > ${res.content}`);
        });
        if (results.length > 100) {
          console.log(`\n...and ${results.length - 100} more occurrences.`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
} catch (e) {
  console.error('Error executing command:', e.message);
  process.exit(1);
}

function printUsage() {
  console.log(`
Usage: hss-ce <command> <path> [arguments/flags]

Commands:
  index <path>             Parse and build code graph database.
                           Flags: --active=file1,file2 (boost files in PageRank)
  map <path>               Print cached skeleton map (PageRank ordered).
                           Flags: --compact (elide to signatures under budget), --budget=1000
  query <path> <symbol>    Lookup definition and callers for a symbol.
  search <path> <query>    Fuzzy search symbol names matching query pattern.
  search-code <path> <q>   Search text snippet/regex across indexed files.
                           Flags: --regex
  graph <path>             Print Mermaid file dependency graph.
  doc <path>               Generate README.md documentation with Mermaid graph.
  pack <path>              Pack files into structured XML under a token budget.
                           Flags: --budget=1000, --output=file.txt, --no-comments
  enrich <path>            Enrich codebase index with AI-generated summaries.
                           Flags: --key=api_key (or set GEMINI_API_KEY), --force
  tour <path>              Generate step-by-step codebase onboarding tour.
  mcp <path>               Start MCP server (stdio transport).
  explore <path>           Start interactive local codebase explorer dashboard.
                           Flags: --port=3000
`);
}

function formatSkeletonMap(map) {
  let output = '=== CODEBASE SKELETON MAP (PageRank Ordered) ===\n';
  for (const file of map) {
    output += `\n📄 File: [${file.path}] (Rank: ${file.pagerank.toFixed(3)} | Layer: ${file.layer || 'service'})\n`;
    if (file.summary) {
      output += `  Summary: ${file.summary}\n`;
    }
    if (file.symbols.length === 0) {
      output += '  (No exported symbols/routes)\n';
    } else {
      file.symbols.forEach(sym => {
        output += `  🔹 [${sym.type.toUpperCase()}] ${sym.signature || sym.name}\n`;
      });
    }
  }
  return output;
}
