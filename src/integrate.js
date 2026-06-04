#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

### Core Developer Rules

#### 1. Think Before Coding
- Stop and state assumptions before writing code.
- Avoid overcomplicating. Present simple options first.

#### 2. Simplicity First
- Minimum code that solves the problem. No speculative features.
- If you write 200 lines and it could be 50, rewrite it.
- Remove any imports/variables/functions that your changes made unused.

#### 3. Surgical Changes
- Touch only what you must to fulfill the request.
- Match existing style. Don't refactor or "improve" adjacent code that isn't broken.

### Tool-First Guidelines
- Before exploring the codebase, use HSS-CE MCP tools (\`get_compact_map\`, \`get_onboarding_tour\`) to gather structural context.
- When searching for symbol definitions or callers, prefer running CLI query: \`npx hss-ce query . <symbol>\` or using MCP tools \`get_definition\` / \`get_callers\` rather than using raw \`grep\` or reading entire files.
- Keep the index updated by running \`npx hss-ce index .\` and generate docs with \`npx hss-ce doc .\` after making changes.
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
   npx hss-ce index .
   \`\`\`
2. **Generate Onboarding Tour:**
   \`\`\`sh
   npx hss-ce tour .
   \`\`\`
3. **Generate Architecture Diagrams & Documentation:**
   \`\`\`sh
   npx hss-ce doc .
   \`\`\`
4. **Query Code Skeleton Map:**
   \`\`\`sh
   npx hss-ce map .
   \`\`\`
5. **Lookup Symbol Definition & Callers:**
   \`\`\`sh
   npx hss-ce query . <symbol>
   \`\`\`
6. **Enrich Codebase with AI Summaries:**
   \`\`\`sh
   GEMINI_API_KEY="your_api_key" npx hss-ce enrich .
   \`\`\`
`;
  fs.writeFileSync(workflowsPath, workflowsContent, 'utf-8');
  console.log(`Created: ${workflowsPath}`);

  // 3. .cursorrules
  const cursorRulesPath = path.join(targetProject, '.cursorrules');
  const cursorRulesContent = `
# HSS-CE Rules for Cursor

## Core Developer Rules
- **Think Before Coding**: State assumptions, push back on overcomplication.
- **Simplicity First**: Write minimal code. Clean up imports/variables/functions that your changes make unused.
- **Surgical Changes**: Touch only what you must. Match existing style.

## Tool-First Guidelines
- Use HSS-CE MCP tools (\`get_skeleton\`, \`get_definition\`, \`get_callers\`, \`get_routes\`, \`get_compact_map\`, \`pack_context\`, \`get_onboarding_tour\`) to explore the codebase and gather structural context.
- To view codebase onboarding tour, run: \`npx hss-ce tour .\`
- To view codebase importance and layers, run: \`npx hss-ce map . --compact --budget=1000\`
- To search symbols: \`npx hss-ce query . <symbol>\`
- Keep index updated: \`npx hss-ce index .\` after edits.
`;
  writeOrAppend(cursorRulesPath, cursorRulesContent);

  // 4. CLAUDE.md
  const claudePath = path.join(targetProject, 'CLAUDE.md');
  const claudeContent = `
# HSS-CE instructions for Claude Code

## Core Developer Rules
- **Think Before Coding**: State assumptions, push back on overcomplication.
- **Simplicity First**: Write minimal code. Clean up imports/variables/functions that your changes make unused.
- **Surgical Changes**: Touch only what you must. Match existing style.

## Tool-First Guidelines
- Use the HSS-CE MCP server tools (including \`get_onboarding_tour\`) to search and gather structural context for functions/classes.
- To understand the project structure, run the onboarding tour: \`npx hss-ce tour .\`
- Keep the index updated: \`npx hss-ce index .\` after edits.
- Use \`npx hss-ce map .\` for structural visualization of codebase.
`;
  writeOrAppend(claudePath, claudeContent);

  // 5. .aider.instructions.md
  const aiderInstructionsPath = path.join(targetProject, '.aider.instructions.md');
  const aiderInstructionsContent = `
# HSS-CE rules for Aider

## Core Developer Rules
- **Think Before Coding**: State assumptions, push back on overcomplication.
- **Simplicity First**: Write minimal code. Clean up imports/variables/functions that your changes make unused.
- **Surgical Changes**: Touch only what you must. Match existing style.

## Tool-First Guidelines
- Aider can use HSS-CE via MCP configuration.
- To view codebase graph or symbol definitions, run \`npx hss-ce query . <symbol>\` or \`npx hss-ce map .\`.
- Update the index after editing files: \`npx hss-ce index .\`.
`;
  writeOrAppend(aiderInstructionsPath, aiderInstructionsContent);
  
  console.log('\x1b[32mAgent rules & workflows successfully generated!\x1b[0m\n');
}

function setupGitHooks(targetProject, cliPath) {
  const gitDir = path.join(targetProject, '.git');
  if (!fs.existsSync(gitDir)) return;
  if (!fs.lstatSync(gitDir).isDirectory()) return;

  const hooksDir = path.join(gitDir, 'hooks');
  ensureDir(hooksDir);

  const hooks = ['post-checkout', 'post-merge'];
  const hookContent = `#!/bin/sh
# HSS-CE Git Hook: Auto-index codebase in the background
npx hss-ce index . > /dev/null 2>&1 &
`;

  console.log('\n\x1b[34m=== Setting up Git Hooks ===\x1b[0m');
  hooks.forEach(hook => {
    const hookPath = path.join(hooksDir, hook);
    fs.writeFileSync(hookPath, hookContent, { encoding: 'utf-8', mode: 0o755 });
    console.log(`Created Git Hook: ${hookPath}`);
  });
  console.log('\x1b[32mGit hooks for automatic indexing successfully set up!\x1b[0m\n');
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

  // Set up Git hooks for auto-indexing on checkout/merge
  setupGitHooks(targetProject, cliPath);


  // Auto-build codebase index & generate docs
  console.log('\n\x1b[34m=== Building Initial Codebase Index & Diagrams ===\x1b[0m');
  try {
    console.log('Analyzing codebase structure and calculating PageRank (Offline)...');
    execSync(`node "${cliPath}" index "${targetProject}"`, { stdio: 'inherit' });
    
    console.log('\nGenerating CODEBASE.md and architecture.html...');
    execSync(`node "${cliPath}" doc "${targetProject}"`, { stdio: 'inherit' });
    console.log('\n\x1b[32mCodebase indexed and dashboard generated successfully!\x1b[0m');
  } catch (err) {
    console.error('\x1b[31mError building initial index:\x1b[0m', err.message);
  }

  console.log('\nSelect target Coding Agent to integrate:');
  console.log('1. Antigravity / Codex (Gemini IDE Assistant)');
  console.log('2. Claude Code');
  console.log('3. Aider');
  console.log('4. Cursor');
  console.log('5. Claude Desktop');
  console.log('6. Exit / Skip');
  
  const choice = await askQuestion('\nEnter choice (1-6): ');

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

    case '5': { // Claude Desktop
      const home = homedir();
      const isWin = process.platform === 'win32';
      const configDir = isWin 
        ? path.join(process.env.APPDATA, 'Claude') 
        : path.join(home, 'Library', 'Application Support', 'Claude');
      const configPath = path.join(configDir, 'claude_desktop_config.json');
      
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
            console.log('Warning: Existing config corrupt. Creating new.');
          }
        }
        
        config.mcpServers['hss-ce'] = {
          command: 'node',
          args: [cliPath, 'mcp', targetProject]
        };
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`\n\x1b[32mSuccess! HSS-CE registered in Claude Desktop config: ${configPath}\x1b[0m`);
      } catch (e) {
        console.error('\x1b[31mError writing config:\x1b[0m', e.message);
      }
      break;
    }

    default:
      console.log('Exited integration setup.');
      break;
  }

  rl.close();
}

main().catch(console.error);
