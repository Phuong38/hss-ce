import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, 'cli.js');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeOrAppend(filePath, content) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (!existing.includes('HSS-CE') && !existing.includes('hss-ce')) {
      fs.writeFileSync(filePath, existing + '\n' + content, 'utf-8');
      console.log(`Updated existing: ${filePath}`);
    } else {
      console.log(`Already configured: ${filePath}`);
    }
  } else {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Created: ${filePath}`);
  }
}

function generateAgentRules(targetProject, cliPath) {
  console.log('\n\x1b[34m=== Generating Coding Agent Rules & Workflows ===\x1b[0m');

  // 1. .agents/rules/hss-ce.md
  const rulesDir = path.join(targetProject, '.agents', 'rules');
  ensureDir(rulesDir);
  const rulesPath = path.join(rulesDir, 'hss-ce.md');
  const rulesContent = `## HSS-CE (Hybrid Semantic-Structural Context Engine)

This project has an active HSS-CE indexer database at \`.hss-ce/graph.db\`.

Rules:
- Before resolving complex changes or doing codebase mapping, check the map: \`node ${cliPath} map .\` to view PageRank importance, layers, and summaries.
- Run onboarding tour: \`node ${cliPath} tour .\` or use the MCP tool \`get_onboarding_tour\` to understand codebase layers (Entrypoints, Services, Storage) step-by-step.
- When searching for symbol definitions or callers, prefer running CLI query: \`node ${cliPath} query . <symbol>\` or using the MCP tool \`get_definition\` / \`get_callers\` rather than using raw \`grep\`.
- When modifying code files, keep the graph updated by running \`node ${cliPath} index .\` and generate docs with \`node ${cliPath} doc .\`.
`;
  fs.writeFileSync(rulesPath, rulesContent, 'utf-8');
  console.log(`Created: ${rulesPath}`);

  // 2. .agents/workflows/hss-ce.md
  const workflowsDir = path.join(targetProject, '.agents', 'workflows');
  ensureDir(workflowsDir);
  const workflowsPath = path.join(workflowsDir, 'hss-ce.md');
  const workflowsContent = `---
name: hss-ce
description: Run codebase indexing, query, onboarding tour, or document generation using HSS-CE
---

# Workflow: hss-ce

Follow these instructions to run HSS-CE tasks:

1. **Re-index Codebase:**
   \`\`\`sh
   node ${cliPath} index .
   \`\`\`
2. **Generate Onboarding Tour:**
   \`\`\`sh
   node ${cliPath} tour .
   \`\`\`
3. **Generate Architecture Diagrams & Documentation:**
   \`\`\`sh
   node ${cliPath} doc .
   \`\`\`
4. **Query Code Skeleton Map:**
   \`\`\`sh
   node ${cliPath} map .
   \`\`\`
5. **Lookup Symbol Definition & Callers:**
   \`\`\`sh
   node ${cliPath} query . <symbol>
   \`\`\`
6. **Enrich Codebase with AI Summaries:**
   \`\`\`sh
   GEMINI_API_KEY="your_api_key" node ${cliPath} enrich .
   \`\`\`
`;
  fs.writeFileSync(workflowsPath, workflowsContent, 'utf-8');
  console.log(`Created: ${workflowsPath}`);

  // 3. .cursorrules
  const cursorRulesPath = path.join(targetProject, '.cursorrules');
  const cursorRulesContent = `
# HSS-CE Rules for Cursor
- Use HSS-CE MCP tools (\`get_skeleton\`, \`get_definition\`, \`get_callers\`, \`get_routes\`, \`get_compact_map\`, \`pack_context\`, \`get_onboarding_tour\`) to explore the codebase and gather structural context.
- To view codebase onboarding tour, run: \`node ${cliPath} tour .\`
- To view codebase importance and layers, run: \`node ${cliPath} map . --compact --budget=1000\`
- To search symbols: \`node ${cliPath} query . <symbol>\`
- Keep index updated: \`node ${cliPath} index .\` after edits.
`;
  writeOrAppend(cursorRulesPath, cursorRulesContent);

  // 4. CLAUDE.md
  const claudePath = path.join(targetProject, 'CLAUDE.md');
  const claudeContent = `
# HSS-CE instructions for Claude Code
- Use the HSS-CE MCP server tools (including \`get_onboarding_tour\`) to search and gather structural context for functions/classes.
- To understand the project structure, run the onboarding tour: \`node ${cliPath} tour .\`
- Keep the index updated: \`node ${cliPath} index .\` after edits.
- Use \`node \${cliPath} map .\` for structural visualization of codebase.
`;
  writeOrAppend(claudePath, claudeContent);

  // 5. .aider.instructions.md
  const aiderInstructionsPath = path.join(targetProject, '.aider.instructions.md');
  const aiderInstructionsContent = `
# HSS-CE rules for Aider
- Aider can use HSS-CE via MCP configuration.
- To view codebase graph or symbol definitions, run \`node ${cliPath} query . <symbol>\` or \`node ${cliPath} map .\`.
- Update the index after editing files: \`node ${cliPath} index .\`.
`;
  writeOrAppend(aiderInstructionsPath, aiderInstructionsContent);
  
  console.log('\x1b[32mAgent rules & workflows successfully generated!\x1b[0m\n');
}

async function main() {
  console.log('\n\x1b[34m=== HSS-CE Agent Integration ===\x1b[0m');
  
  const projectPathInput = await askQuestion('Enter absolute path of target codebase to index (default: current dir): ');
  const targetProject = path.resolve(projectPathInput.trim() || '.');
  
  if (!fs.existsSync(targetProject)) {
    console.error(`\x1b[31mError: Path does not exist: ${targetProject}\x1b[0m`);
    rl.close();
    process.exit(1);
  }

  console.log(`\nTarget project selected: \x1b[32m${targetProject}\x1b[0m`);
  
  // Auto-generate agent rules and workflows
  generateAgentRules(targetProject, cliPath);
  console.log('\nSelect target Coding Agent to integrate:');
  console.log('1. Antigravity / Codex (Gemini IDE Assistant)');
  console.log('2. Claude Code');
  console.log('3. Aider');
  console.log('4. Cursor');
  console.log('5. Exit / Skip');
  
  const choice = await askQuestion('\nEnter choice (1-5): ');

  switch (choice.trim()) {
    case '1': { // Antigravity / Codex
      const home = homedir();
      const configDir = path.join(home, '.gemini', 'antigravity');
      const configPath = path.join(configDir, 'mcp_config.json');
      
      try {
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        
        let config = { mcpServers: {} };
        if (fs.existsSync(configPath)) {
          try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (!config.mcpServers) config.mcpServers = {};
          } catch {
            console.log('Warning: Existing mcp_config.json corrupt. Creating new.');
          }
        }
        
        config.mcpServers['hss-ce'] = {
          command: 'node',
          args: [cliPath, 'mcp', targetProject]
        };
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`\n\x1b[32mSuccess! HSS-CE registered in Antigravity config: ${configPath}\x1b[0m`);
      } catch (e) {
        console.error('\x1b[31mError writing config:\x1b[0m', e.message);
      }
      break;
    }

    case '2': { // Claude Code
      const configPath = path.join(targetProject, '.mcp.json');
      try {
        let config = { mcpServers: {} };
        if (fs.existsSync(configPath)) {
          try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (!config.mcpServers) config.mcpServers = {};
          } catch {}
        }
        
        config.mcpServers['hss-ce'] = {
          command: 'node',
          args: [cliPath, 'mcp', targetProject]
        };
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`\n\x1b[32mSuccess! HSS-CE registered in project .mcp.json: ${configPath}\x1b[0m`);
      } catch (e) {
        console.error('\x1b[31mError writing config:\x1b[0m', e.message);
      }
      break;
    }

    case '3': { // Aider
      const configPath = path.join(targetProject, 'aider.conf.yml');
      const entry = `mcp:\n  - node ${cliPath} mcp ${targetProject}\n`;
      try {
        let current = '';
        if (fs.existsSync(configPath)) {
          current = fs.readFileSync(configPath, 'utf-8');
        }
        if (current.includes('hss-ce') || current.includes(cliPath)) {
          console.log('HSS-CE already configured in aider.conf.yml');
        } else {
          fs.writeFileSync(configPath, current + '\n' + entry, 'utf-8');
          console.log(`\n\x1b[32mSuccess! HSS-CE entry added to: ${configPath}\x1b[0m`);
        }
      } catch (e) {
        console.error('\x1b[31mError writing config:\x1b[0m', e.message);
      }
      break;
    }

    case '4': { // Cursor
      console.log('\n\x1b[34m--- Cursor Manual Setup ---\x1b[0m');
      console.log('1. Open Cursor Settings -> Features -> MCP');
      console.log('2. Click "+ Add New MCP Server"');
      console.log('3. Fill details:');
      console.log('   - Name: hss-ce');
      console.log('   - Type: command');
      console.log(`   - Command: node ${cliPath} mcp ${targetProject}`);
      break;
    }

    default:
      console.log('Exited integration setup.');
      break;
  }

  rl.close();
}

main().catch(console.error);
