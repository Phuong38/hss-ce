import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CodeDatabase } from './db.js';
import { CodeIndexer } from './indexer.js';
import { stripComments, generateSkeletonContent } from './parser.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

const redactSecrets = (content) => {
  let redacted = content;
  redacted = redacted.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY_ID]');
  redacted = redacted.replace(/\bsk-(?:proj-|or-v1-)?[a-zA-Z0-9]{32,}\b/g, '[REDACTED_OPENAI_KEY]');
  redacted = redacted.replace(/\bxox[bpa]-[a-zA-Z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]');
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
};

function compactJsonContent(content, filePath) {
  try {
    const obj = JSON.parse(content);
    if (path.basename(filePath) === 'package.json') {
      const compacted = {};
      const keysToKeep = ['name', 'version', 'type', 'scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'bin'];
      for (const k of keysToKeep) {
        if (obj[k] !== undefined) compacted[k] = obj[k];
      }
      return JSON.stringify(compacted);
    }
    return JSON.stringify(obj);
  } catch (err) {
    return content;
  }
}

export async function runMcpServer(dbPath, rootDir) {
  const db = new CodeDatabase(dbPath);
  const server = new Server(
    { name: 'hss-ce', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_skeleton',
          description: 'Get codebase skeleton. Lists top files by PageRank and their declared symbols (classes, functions, routes). Use this first to understand codebase structure.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                description: 'Maximum number of files to return (default 30)',
                default: 30
              }
            }
          }
        },
        {
          name: 'get_definition',
          description: 'Find file path and lines where a symbol (function, class, variable name) is defined.',
          inputSchema: {
            type: 'object',
            properties: {
              symbolName: {
                type: 'string',
                description: 'The exact name of the symbol to search'
              }
            },
            required: ['symbolName']
          }
        },
        {
          name: 'get_callers',
          description: 'Find all files that import or call a specific symbol.',
          inputSchema: {
            type: 'object',
            properties: {
              symbolName: {
                type: 'string',
                description: 'The name of the symbol to check callers for'
              }
            },
            required: ['symbolName']
          }
        },
        {
          name: 'get_routes',
          description: 'List all framework-aware API endpoints (Express, FastAPI) parsed in the codebase.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'incremental_reindex',
          description: 'Trigger incremental indexing of the workspace to sync any recent file edits.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_mermaid_graph',
          description: 'Get Mermaid dependency graph syntax for codebase visualization.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_compact_map',
          description: 'Get compact token-budgeted signature map of codebase. Can personalize/boost active files.',
          inputSchema: {
            type: 'object',
            properties: {
              budget: {
                type: 'integer',
                description: 'Token budget for the map (default 1000)',
                default: 1000
              },
              activeFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of currently active file paths to boost in PageRank'
              }
            }
          }
        },
        {
          name: 'pack_context',
          description: 'Pack codebase files under a token budget into structured XML or Markdown with secret redactions.',
          inputSchema: {
            type: 'object',
            properties: {
              budget: {
                type: 'integer',
                description: 'Token budget for the pack (default 2000)',
                default: 2000
              },
              activeFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of active files to personalize the PageRank ordering'
              },
              noComments: {
                type: 'boolean',
                description: 'Strip comments from packaged files to conserve token budget (default false)',
                default: false
              },
              format: {
                type: 'string',
                description: 'Output format: "xml" or "markdown" (default "xml")',
                enum: ['xml', 'markdown'],
                default: 'xml'
              },
              compact: {
                type: 'boolean',
                description: 'Pack skeletons instead of full content for files (default false)',
                default: false
              },
              progressive: {
                type: 'boolean',
                description: 'Progressively compress files to skeleton when budget runs low instead of truncating (default false)',
                default: false
              },
              sort: {
                type: 'string',
                description: 'Ordering of files: "pagerank" or "path" (default "pagerank")',
                enum: ['pagerank', 'path'],
                default: 'pagerank'
              }
            }
          }
        },
        {
          name: 'get_onboarding_tour',
          description: 'Get step-by-step codebase onboarding tour. Explains files by layer (Entrypoint, Service, Storage) and structural rank.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_symbol_context',
          description: 'Get lines of code containing a class, function, or route definition plus surrounding context (padding lines). Conserves tokens compared to loading full files.',
          inputSchema: {
            type: 'object',
            properties: {
              symbolName: {
                type: 'string',
                description: 'The exact name of the symbol to retrieve context for'
              },
              paddingLines: {
                type: 'integer',
                description: 'Number of lines of padding above and below the symbol (default 15)',
                default: 15
              }
            },
            required: ['symbolName']
          }
        },
        {
          name: 'get_enriched_context',
          description: 'Get graph-enriched codebase context for a symbol (cAST). Contains definition code, file metrics (PageRank, complexity, coupling, fragility), and lists of upstream callers and downstream dependencies.',
          inputSchema: {
            type: 'object',
            properties: {
              symbolName: {
                type: 'string',
                description: 'The exact name of the symbol to retrieve enriched context for'
              },
              paddingLines: {
                type: 'integer',
                description: 'Number of context padding lines around symbol definition (default 15)',
                default: 15
              }
            },
            required: ['symbolName']
          }
        },
        {
          name: 'search_symbols',
          description: 'Search for symbol definitions matching a query pattern (fuzzy search).',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query/pattern to match against symbol names (e.g. "auth")'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'search_code',
          description: 'Search for a text snippet or regular expression pattern across the indexed files in the codebase.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The text snippet or regex pattern to search for'
              },
              isRegex: {
                type: 'boolean',
                description: 'Whether to treat the query as a regular expression (default false)',
                default: false
              }
            },
            required: ['query']
          }
        },
        {
          name: 'get_dependency_path',
          description: 'Find import/dependency path chain from one file to another in the codebase context.',
          inputSchema: {
            type: 'object',
            properties: {
              fromFile: {
                type: 'string',
                description: 'The starting file path (can be absolute or relative)'
              },
              toFile: {
                type: 'string',
                description: 'The destination file path (can be absolute or relative)'
              }
            },
            required: ['fromFile', 'toFile']
          }
        },
        {
          name: 'read_file_content',
          description: 'Read the full content of a specific file from the codebase (useful when file content was elided in the context pack).',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The path of the file to read (can be absolute or relative)'
              }
            },
            required: ['filePath']
          }
        },
        {
          name: 'check_index_drift',
          description: 'Check if the codebase index has drifted from the actual files on disk (modified files, missing files, untracked/new files).',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_change_impact',
          description: 'Analyze recursive change impact blast radius (importers) for a file path or symbol.',
          inputSchema: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: 'The file path (relative or absolute) or symbol name to analyze'
              },
              depth: {
                type: 'integer',
                description: 'Maximum traversal depth (default 5)',
                default: 5
              }
            },
            required: ['target']
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_skeleton': {
          const limit = args?.limit || 30;
          const skeleton = db.getSkeletonMap();
          const sliced = skeleton.slice(0, limit);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(sliced, null, 2)
              }
            ]
          };
        }

        case 'get_definition': {
          const symName = args?.symbolName;
          const results = db.getDefinition(symName);
          
          if (results.length > 0) {
            results.forEach(res => {
              try { db.logSessionAction('get_definition', res.file_path, symName); } catch {}
            });
          }
          
          return {
            content: [
              {
                type: 'text',
                text: results.length > 0
                  ? JSON.stringify(results, null, 2)
                  : `Symbol "${symName}" not found in current index.`
              }
            ]
          };
        }

        case 'get_callers': {
          const symName = args?.symbolName;
          const results = db.getCallers(symName);
          
          return {
            content: [
              {
                type: 'text',
                text: results.length > 0
                  ? JSON.stringify(results, null, 2)
                  : `No callers found for symbol "${symName}".`
              }
            ]
          };
        }

        case 'get_routes': {
          const allSymbols = db.db.prepare(`
            SELECT file_path, name, signature, start_line 
            FROM symbols 
            WHERE type = 'route';
          `).all();
          
          return {
            content: [
              {
                type: 'text',
                text: allSymbols.length > 0
                  ? JSON.stringify(allSymbols, null, 2)
                  : 'No web routes parsed in this codebase.'
              }
            ]
          };
        }

        case 'incremental_reindex': {
          const indexer = new CodeIndexer(db, rootDir);
          indexer.index();
          return {
            content: [
              {
                type: 'text',
                text: 'Incremental indexing finished.'
              }
            ]
          };
        }

        case 'get_mermaid_graph': {
          const deps = db.db.prepare(`SELECT from_file, to_file, symbol FROM dependencies;`).all();
          const makeSafeId = (p) => p.replace(/[^a-zA-Z0-9]/g, '_');
          let mermaid = "graph TD\n";
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
              mermaid += `  ${makeSafeId(d.from_file)} -->|"${d.symbol}"| ${makeSafeId(d.to_file)}\n`;
            });
          }
          return {
            content: [
              {
                type: 'text',
                text: mermaid
              }
            ]
          };
        }

        case 'get_compact_map': {
          const activeFiles = args?.activeFiles || null;
          if (activeFiles && activeFiles.length > 0) {
            const indexer = new CodeIndexer(db, rootDir);
            indexer.index(false, activeFiles);
          }
          
          const budget = args?.budget || 1000;
          const map = db.getSkeletonMap();
          
          const estimateTokens = (str) => Math.ceil(str.length / 4);
          let output = `=== CODEBASE SIGNATURE MAP (Token Budget: ${budget}) ===\n`;
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
            if (currentTokens + fileTokens > budget) {
              output += `\n... [Truncated due to token budget of ${budget} tokens] ...\n`;
              break;
            }

            output += fileOutput;
            currentTokens += fileTokens;
          }

          return {
            content: [
              {
                type: 'text',
                text: output
              }
            ]
          };
        }

        case 'pack_context': {
          const activeFiles = args?.activeFiles || null;
          const noComments = args?.noComments || false;
          const format = args?.format || 'xml';
          const compact = args?.compact || false;
          const progressive = args?.progressive || false;
          const sort = args?.sort || 'pagerank';
          if (activeFiles && activeFiles.length > 0) {
            const indexer = new CodeIndexer(db, rootDir);
            indexer.index(false, activeFiles);
          }
          
          const budget = args?.budget || 2000;
          let map = db.getSkeletonMap();

          if (sort === 'path') {
            map.sort((a, b) => a.path.localeCompare(b.path));
          }
          
          const estimateTokens = (str) => Math.ceil(str.length / 4);

          // 1. Build codebase skeleton map section
          let skeletonBlocks = '';
          const skeletonFiles = [];

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

            let skelBlockContent = '';
            const ext = path.extname(file.path);
            const isJs = ['.js', '.ts', '.jsx', '.tsx'].includes(ext);
            const isPy = ext === '.py';
            const isGo = ext === '.go';
            const isRs = ext === '.rs';
            if (isJs || isPy || isGo || isRs) {
              skelBlockContent = generateSkeletonContent(content, ext, file.symbols, file.summary);
            } else if (ext === '.json') {
              skelBlockContent = compactJsonContent(content, file.path);
            } else {
              const commentPrefix = (isPy || isRs) ? '#' : '//';
              skelBlockContent = `${commentPrefix} [File content elided. Use read_file_content("${file.path}") to inspect full content.]`;
            }

            let skelBlock = '';
            if (format === 'markdown') {
              let extName = ext.slice(1);
              if (extName === 'tsx' || extName === 'jsx') extName = 'typescript';
              if (extName === 'ts' || extName === 'js') extName = 'javascript';
              if (extName === 'py') extName = 'python';
              if (extName === 'go') extName = 'go';
              if (extName === 'rs') extName = 'rust';
              skelBlock = `### File: ${file.path} (Skeleton)\n\`\`\`${extName}\n${skelBlockContent}\n\`\`\`\n\n`;
            } else {
              skelBlock = `<file path="${file.path}" type="skeleton">\n${skelBlockContent}\n</file>\n`;
            }

            const skelTokens = estimateTokens(skelBlock);
            if (estimateTokens(skeletonBlocks) + skelTokens + 200 > budget) {
              break;
            }

            skeletonBlocks += skelBlock;
            skeletonFiles.push({ file, content });
          }

          // Estimate tokens for header/stats
          let headerAndStats = '';
          if (format === 'markdown') {
            headerAndStats = `<!-- HSS-CE Codebase Context Pack (Budget: ${budget} tokens) -->\n\n` +
              `# HSS-CE Codebase Context Pack\n\n` +
              `## 1. System Stats\n` +
              `* Total Files: ${skeletonFiles.length}\n` +
              `* Active Files: ${activeFiles ? activeFiles.length : 0}\n\n` +
              `## 2. Codebase Skeleton Map\n`;
          } else {
            headerAndStats = `<!-- HSS-CE Codebase Context Pack (Budget: ${budget} tokens) -->\n` +
              `<hss_ce_context_pack budget="${budget}">\n` +
              `  <system_stats>\n` +
              `    <total_files>${skeletonFiles.length}</total_files>\n` +
              `    <active_files>${activeFiles ? activeFiles.length : 0}</active_files>\n` +
              `  </system_stats>\n\n` +
              `  <codebase_skeleton_map>\n`;
          }

          let currentTokens = estimateTokens(headerAndStats) + estimateTokens(skeletonBlocks);
          if (format === 'xml') {
            currentTokens += estimateTokens(`\n  </codebase_skeleton_map>\n`);
          }

          // 2. Select files to include as full content
          const fullContentNonActive = [];
          const fullContentActive = [];

          if (!compact) {
            const activeFilesList = [];
            const nonActiveFilesList = [];

            for (const item of skeletonFiles) {
              const isActive = activeFiles && activeFiles.includes(item.file.path);
              if (isActive) {
                activeFilesList.push(item);
              } else {
                nonActiveFilesList.push(item);
              }
            }

            // Prioritize active files first
            for (const item of activeFilesList) {
              let fileContent = item.content;
              const ext = path.extname(item.file.path);
              if (ext === '.json') {
                fileContent = compactJsonContent(fileContent, item.file.path);
              } else if (noComments) {
                fileContent = stripComments(fileContent, ext);
              }

              let fileBlock = '';
              if (format === 'markdown') {
                let extName = ext.slice(1);
                if (extName === 'tsx' || extName === 'jsx') extName = 'typescript';
                if (extName === 'ts' || extName === 'js') extName = 'javascript';
                if (extName === 'py') extName = 'python';
                if (extName === 'go') extName = 'go';
                if (extName === 'rs') extName = 'rust';
                fileBlock = `### File: ${item.file.path}\n\`\`\`${extName}\n${fileContent}\n\`\`\`\n\n`;
              } else {
                fileBlock = `<file path="${item.file.path}">\n${fileContent}\n</file>\n`;
              }

              const fileTokens = estimateTokens(fileBlock);
              if (currentTokens + fileTokens <= budget) {
                fullContentActive.push(fileBlock);
                currentTokens += fileTokens;
              }
            }

            // Include non-active files next
            for (const item of nonActiveFilesList) {
              let fileContent = item.content;
              const ext = path.extname(item.file.path);
              if (ext === '.json') {
                fileContent = compactJsonContent(fileContent, item.file.path);
              } else if (noComments) {
                fileContent = stripComments(fileContent, ext);
              }

              let fileBlock = '';
              if (format === 'markdown') {
                let extName = ext.slice(1);
                if (extName === 'tsx' || extName === 'jsx') extName = 'typescript';
                if (extName === 'ts' || extName === 'js') extName = 'javascript';
                if (extName === 'py') extName = 'python';
                if (extName === 'go') extName = 'go';
                if (extName === 'rs') extName = 'rust';
                fileBlock = `### File: ${item.file.path}\n\`\`\`${extName}\n${fileContent}\n\`\`\`\n\n`;
              } else {
                fileBlock = `<file path="${item.file.path}">\n${fileContent}\n</file>\n`;
              }

              const fileTokens = estimateTokens(fileBlock);
              if (currentTokens + fileTokens <= budget) {
                fullContentNonActive.push(fileBlock);
                currentTokens += fileTokens;
              }
            }
          }

          // 3. Assemble final output
          let packedOutput = headerAndStats + skeletonBlocks;

          if (format === 'markdown') {
            packedOutput += `## 3. Reference File Contents\n`;
            if (fullContentNonActive.length === 0) {
              packedOutput += `*No reference files included in full content (exceeded budget).*\n\n`;
            } else {
              packedOutput += fullContentNonActive.join('');
            }

            packedOutput += `## 4. Active Files (Focus)\n`;
            if (fullContentActive.length === 0) {
              packedOutput += `*No active files included in full content (exceeded budget).*\n\n`;
            } else {
              packedOutput += fullContentActive.join('');
            }
          } else {
            packedOutput += `  </codebase_skeleton_map>\n\n` +
              `  <reference_file_contents>\n` +
              (fullContentNonActive.length > 0 ? fullContentNonActive.join('') : '') +
              `  </reference_file_contents>\n\n` +
              `  <active_file_contents>\n` +
              (fullContentActive.length > 0 ? fullContentActive.join('') : '') +
              `  </active_file_contents>\n` +
              `</hss_ce_context_pack>\n`;
          }

          return {
            content: [
              {
                type: 'text',
                text: packedOutput
              }
            ]
          };
        }

        case 'get_onboarding_tour': {
          const map = db.getSkeletonMap();
          
          let tour = '# HSS-CE Codebase Onboarding Tour\n\n';
          tour += 'This tour guides you through the codebase architecture step-by-step, ordered by PageRank significance.\n\n';

          const entrypoints = map.filter(f => f.layer === 'entrypoint');
          const services = map.filter(f => f.layer === 'service');
          const storage = map.filter(f => f.layer === 'storage');
          const configs = map.filter(f => f.layer === 'config');
          const docs = map.filter(f => f.layer === 'documentation');

          tour += '## 1. Entrypoints & Endpoints (How the app starts / receives input)\n';
          if (entrypoints.length === 0) tour += '* No entrypoint layer files detected.\n';
          else {
            entrypoints.forEach(f => {
              tour += `### 📄 [${f.path}] (PageRank: ${f.pagerank.toFixed(3)})\n`;
              if (f.summary) tour += `> ${f.summary}\n\n`;
              if (f.symbols.length > 0) {
                tour += '*Exported Symbols:*\n';
                f.symbols.forEach(s => {
                  tour += `- \`[${s.type.toUpperCase()}]\` \`${s.signature || s.name}\`\n`;
                });
                tour += '\n';
              }
            });
          }

          tour += '## 2. Business Logic & Services (Core operations)\n';
          if (services.length === 0) tour += '* No service layer files detected.\n';
          else {
            services.slice(0, 15).forEach(f => {
              tour += `### 📄 [${f.path}] (PageRank: ${f.pagerank.toFixed(3)})\n`;
              if (f.summary) tour += `> ${f.summary}\n\n`;
              if (f.symbols.length > 0) {
                tour += '*Exported Symbols:*\n';
                f.symbols.forEach(s => {
                  tour += `- \`[${s.type.toUpperCase()}]\` \`${s.signature || s.name}\`\n`;
                });
                tour += '\n';
              }
            });
            if (services.length > 15) {
              tour += `*And ${services.length - 15} other service files...*\n\n`;
            }
          }

          tour += '## 3. Data & Storage (Persistence & Models)\n';
          if (storage.length === 0) tour += '* No storage layer files detected.\n';
          else {
            storage.forEach(f => {
              tour += `### 📄 [${f.path}] (PageRank: ${f.pagerank.toFixed(3)})\n`;
              if (f.summary) tour += `> ${f.summary}\n\n`;
              if (f.symbols.length > 0) {
                tour += '*Exported Symbols:*\n';
                f.symbols.forEach(s => {
                  tour += `- \`[${s.type.toUpperCase()}]\` \`${s.signature || s.name}\`\n`;
                });
                tour += '\n';
              }
            });
          }

          tour += '## 4. Configurations (Settings & Environments)\n';
          if (configs.length === 0) tour += '* No configuration files detected.\n';
          else {
            configs.forEach(f => {
              tour += `### 📄 [${f.path}] (PageRank: ${f.pagerank.toFixed(3)})\n`;
              if (f.summary) tour += `> ${f.summary}\n\n`;
            });
          }

          tour += '## 5. Documentation & Metadata\n';
          if (docs.length === 0) tour += '* No documentation files detected.\n';
          else {
            docs.forEach(f => {
              tour += `### 📄 [${f.path}] (PageRank: ${f.pagerank.toFixed(3)})\n`;
              if (f.summary) tour += `> ${f.summary}\n\n`;
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: tour
              }
            ]
          };
        }

        case 'get_symbol_context': {
          const symName = args?.symbolName;
          const padding = args?.paddingLines !== undefined ? args.paddingLines : 15;
          const results = db.getDefinition(symName);
          
          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Symbol "${symName}" not found in current index.`
                }
              ]
            };
          }

          results.forEach(res => {
            try { db.logSessionAction('get_symbol_context', res.file_path, symName); } catch {}
          });

          let output = `=== Context for Symbol: ${symName} ===\n`;

          for (const res of results) {
            const absPath = path.join(rootDir, res.file_path);
            if (!fs.existsSync(absPath)) {
              output += `\nFile ${res.file_path} not found on disk.\n`;
              continue;
            }

            try {
              const fileContent = fs.readFileSync(absPath, 'utf-8');
              const lines = fileContent.split('\n');
              
              const startLine = Math.max(1, (res.start_line || 1) - padding);
              const endLine = Math.min(lines.length, (res.end_line || res.start_line || 1) + padding);

              output += `\n📄 File: [${res.file_path}] (Lines: ${startLine}-${endLine})\n`;
              output += `Symbol definition: ${res.signature || res.name} (type: ${res.type})\n`;
              
              let extName = path.extname(res.file_path).slice(1);
              if (extName === 'tsx' || extName === 'jsx') extName = 'typescript';
              if (extName === 'ts' || extName === 'js') extName = 'javascript';
              if (extName === 'py') extName = 'python';
              if (extName === 'go') extName = 'go';
              if (extName === 'rs') extName = 'rust';

              output += '```' + extName + '\n';
              for (let i = startLine; i <= endLine; i++) {
                const prefix = i === res.start_line ? '👉 ' : '   ';
                output += `${prefix}${i}: ${lines[i - 1]}\n`;
              }
              output += '```\n';
            } catch (err) {
              output += `\nError reading file ${res.file_path}: ${err.message}\n`;
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: output
              }
            ]
          };
        }

        case 'get_enriched_context': {
          const symName = args?.symbolName;
          const padding = args?.paddingLines !== undefined ? args.paddingLines : 15;
          const definitions = db.getDefinition(symName);
          
          if (definitions.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Symbol "${symName}" not found in current index.`
                }
              ]
            };
          }

          definitions.forEach(res => {
            try { db.logSessionAction('get_enriched_context', res.file_path, symName); } catch {}
          });

          let output = `=== Graph-Enriched Context (cAST) for Symbol: ${symName} ===\n`;

          for (const def of definitions) {
            const fileRow = db.db.prepare('SELECT * FROM files WHERE path = ?;').all(def.file_path)[0];
            const pagerank = fileRow ? fileRow.pagerank : 1.0;
            const layer = fileRow ? fileRow.layer : 'service';
            const complexity = fileRow ? fileRow.complexity : 1.0;
            const couplingIn = fileRow ? fileRow.coupling_in : 0;
            const couplingOut = fileRow ? fileRow.coupling_out : 0;
            const fragility = fileRow ? fileRow.fragility : 1.0;
            const summary = fileRow ? fileRow.summary : null;

            const callers = db.getCallers(symName);
            const dependencies = db.db.prepare('SELECT to_file, symbol FROM dependencies WHERE from_file = ?;').all(def.file_path);

            const absPath = path.join(rootDir, def.file_path);
            let codeSnippet = '';
            
            if (fs.existsSync(absPath)) {
              try {
                const fileContent = fs.readFileSync(absPath, 'utf-8');
                const lines = fileContent.split('\n');
                const startLine = Math.max(1, (def.start_line || 1) - padding);
                const endLine = Math.min(lines.length, (def.end_line || def.start_line || 1) + padding);

                let extName = path.extname(def.file_path).slice(1);
                if (extName === 'tsx' || extName === 'jsx') extName = 'typescript';
                if (extName === 'ts' || extName === 'js') extName = 'javascript';
                if (extName === 'py') extName = 'python';
                if (extName === 'go') extName = 'go';
                if (extName === 'rs') extName = 'rust';

                codeSnippet += '```' + extName + '\n';
                for (let i = startLine; i <= endLine; i++) {
                  const prefix = i === def.start_line ? '👉 ' : '   ';
                  codeSnippet += `${prefix}${i}: ${lines[i - 1]}\n`;
                }
                codeSnippet += '```\n';
              } catch (err) {
                codeSnippet = `Error reading file: ${err.message}\n`;
              }
            } else {
              codeSnippet = 'File not found on disk.\n';
            }

            output += `
<symbol_definition name="${def.name}" type="${def.type}" file="${def.file_path}">
  <metrics>
    <pagerank>${pagerank.toFixed(4)}</pagerank>
    <layer>${layer}</layer>
    <complexity>${complexity.toFixed(1)}</complexity>
    <coupling_in>${couplingIn} (how many files depend on this file)</coupling_in>
    <coupling_out>${couplingOut} (how many files this file depends on)</coupling_out>
    <fragility>${fragility.toFixed(1)} (higher means change is more risky)</fragility>
  </metrics>
  ${summary ? `<summary>${summary}</summary>` : ''}
  
  <code_definition>
${codeSnippet}  </code_definition>

  <upstream_callers>
${callers.length > 0 ? callers.map(c => `    <caller file="${c.file_path}" symbol="${c.symbol}" />`).join('\n') : '    <!-- No callers found -->'}
  </upstream_callers>

  <downstream_dependencies>
${dependencies.length > 0 ? dependencies.map(d => `    <dependency file="${d.to_file}" symbol="${d.symbol}" />`).join('\n') : '    <!-- No external dependencies found -->'}
  </downstream_dependencies>
</symbol_definition>
`;
          }

          return {
            content: [
              {
                type: 'text',
                text: output.trim()
              }
            ]
          };
        }

        case 'search_symbols': {
          const query = args?.query;
          if (!query) {
            throw new Error('Query parameter is required');
          }
          const results = db.searchSymbols(query);
          return {
            content: [
              {
                type: 'text',
                text: results.length > 0
                  ? JSON.stringify(results, null, 2)
                  : `No symbols matching "${query}" found.`
              }
            ]
          };
        }

        case 'search_code': {
          const query = args?.query;
          const isRegex = !!args?.isRegex;
          if (!query) {
            throw new Error('Query parameter is required');
          }

          const results = [];
          
          if (isRegex) {
            const files = db.getAllFiles();
            const searchRegex = new RegExp(query, 'i');
            for (const file of files) {
              const absPath = path.join(rootDir, file.path);
              if (!fs.existsSync(absPath)) continue;

              try {
                const fileContent = fs.readFileSync(absPath, 'utf-8');
                const lines = fileContent.split('\n');
                
                lines.forEach((lineContent, idx) => {
                  const lineNum = idx + 1;
                  if (searchRegex.test(lineContent)) {
                    results.push({
                      filePath: file.path,
                      line: lineNum,
                      content: lineContent.trim()
                    });
                  }
                });
              } catch (err) {
                // Ignore reading errors for single files
              }
            }
          } else {
            const matchingFiles = db.searchCodeFts(query);
            for (const matched of matchingFiles) {
              const absPath = path.join(rootDir, matched.path);
              if (!fs.existsSync(absPath)) continue;

              try {
                const fileContent = fs.readFileSync(absPath, 'utf-8');
                const lines = fileContent.split('\n');
                
                lines.forEach((lineContent, idx) => {
                  const lineNum = idx + 1;
                  if (lineContent.toLowerCase().includes(query.toLowerCase())) {
                    results.push({
                      filePath: matched.path,
                      line: lineNum,
                      content: lineContent.trim()
                    });
                  }
                });
              } catch (err) {
                // Ignore reading errors for single files
              }
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: results.length > 0
                  ? JSON.stringify(results.slice(0, 100), null, 2)
                  : `No code occurrences matching "${query}" found.`
              }
            ]
          };
        }

        case 'get_dependency_path': {
          const fromFile = args?.fromFile;
          const toFile = args?.toFile;
          if (!fromFile || !toFile) {
            throw new Error('Both fromFile and toFile parameters are required');
          }

          const getRelativePath = (p) => {
            if (path.isAbsolute(p)) {
              return path.relative(rootDir, p);
            }
            if (p.startsWith('.')) {
              return path.relative(rootDir, path.resolve(rootDir, p));
            }
            return p;
          };

          const relFrom = getRelativePath(fromFile);
          const relTo = getRelativePath(toFile);

          const pathResult = db.getDependencyPath(relFrom, relTo);

          let outputText = '';
          if (pathResult) {
            outputText = `Dependency path found from "${relFrom}" to "${relTo}":\n\n`;
            pathResult.forEach((step, index) => {
              outputText += `${index + 1}. [${step.from}] imports "${step.symbol}" from [${step.to}]\n`;
            });
          } else {
            outputText = `No dependency path found from "${relFrom}" to "${relTo}".`;
          }

          return {
            content: [
              {
                type: 'text',
                text: outputText
              }
            ]
          };
        }

        case 'read_file_content': {
          const filePath = args?.filePath;
          if (!filePath) {
            throw new Error('filePath parameter is required');
          }

          const getRelativePath = (p) => {
            if (path.isAbsolute(p)) {
              return path.relative(rootDir, p);
            }
            if (p.startsWith('.')) {
              return path.relative(rootDir, path.resolve(rootDir, p));
            }
            return p;
          };

          const relPath = getRelativePath(filePath);
          const absPath = path.resolve(rootDir, relPath);

          if (!fs.existsSync(absPath)) {
            throw new Error(`File not found: ${relPath}`);
          }

          const content = fs.readFileSync(absPath, 'utf-8');
          
          let compacted = content;
          if (path.extname(relPath) === '.json') {
            compacted = compactJsonContent(content, relPath);
          }
          const redacted = redactSecrets(compacted);

          return {
            content: [
              {
                type: 'text',
                text: redacted
              }
            ]
          };
        }

        case 'check_index_drift': {
          const indexer = new CodeIndexer(db, rootDir);
          const drift = indexer.checkDrift();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(drift, null, 2)
              }
            ]
          };
        }

        case 'get_change_impact': {
          const target = args?.target;
          const depth = args?.depth !== undefined ? args.depth : 5;
          if (!target) {
            throw new Error('target parameter is required');
          }
          
          let normalizedArg = target;
          if (fs.existsSync(path.resolve(rootDir, target))) {
            normalizedArg = path.relative(rootDir, path.resolve(rootDir, target));
          }
          
          const impact = db.getChangeImpact(normalizedArg, depth);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(impact, null, 2)
              }
            ]
          };
        }

        default:
          throw new Error(`Tool not found: ${name}`);
      }
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${error.message}`
          }
        ]
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('HSS-CE MCP Server connected over stdio.');
}
