import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CodeDatabase } from './db.js';
import { CodeIndexer } from './indexer.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
          description: 'Pack codebase files under a token budget into structured XML with secret redactions.',
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
          if (activeFiles && activeFiles.length > 0) {
            const indexer = new CodeIndexer(db, rootDir);
            indexer.index(false, activeFiles);
          }
          
          const budget = args?.budget || 2000;
          const map = db.getSkeletonMap();
          
          const estimateTokens = (str) => Math.ceil(str.length / 4);
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

          let packedOutput = `<!-- HSS-CE Codebase Context Pack (Budget: ${budget} tokens) -->\n`;
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

            const fileBlock = `<file path="${file.path}">\n${content}\n</file>\n`;
            const fileTokens = estimateTokens(fileBlock);

            if (currentTokens + fileTokens > budget) {
              packedOutput += `\n<!-- Truncated: reached token budget of ${budget} tokens -->\n`;
              break;
            }

            packedOutput += fileBlock;
            currentTokens += fileTokens;
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

          return {
            content: [
              {
                type: 'text',
                text: tour
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
