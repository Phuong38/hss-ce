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
