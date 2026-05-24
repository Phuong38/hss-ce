# HSS-CE: Hybrid Semantic-Structural Context Engine

HSS-CE is a lightweight codebase indexer and Model Context Protocol (MCP) server designed to optimize context retrieval for AI coding assistants. It calculates file significance using **PageRank** and parses symbols (classes, functions, endpoints) using high-performance regex-based parsers, ensuring your AI agents work on the most contextually relevant parts of your codebase without blowing your token budget.

---

## Key Features

1. **PageRank Relevance Engine:** Ranks codebase files structurally based on import and dependency counts, giving LLMs a clear directory map.
2. **Git Commit Weighting:** Integrates Git commit history to boost files changed frequently or recently.
3. **Personalized PageRank & Layering:** Boosts relevance weights dynamically around your current "active files" and automatically groups codebase files into **Entrypoint, Service, and Storage** layers.
4. **Interactive Web Dashboard:** Generates an interactive, zoomable HTML diagram (`architecture.html`) where you can search nodes, highlight dependency flows, and click on nodes to see symbols and summaries.
5. **AI-Enriched Summaries:** Enables lightweight AI-powered file summarization (stored in SQLite) via Gemini API.
6. **Guided Onboarding Tours:** Generates step-by-step onboarding walkthroughs (`hss-ce tour`) tracing from high-rank Entrypoints down to Storage.
7. **Token-Budgeted Compact Maps & Context Packing:** Packages symbol signatures or full codebases under token budgets with Secret Guard redaction.

---

## Quick Start (For Beginners)

If you are new to programming or AI tools, follow these simple steps to install and set up HSS-CE.

### 1. Requirements
Ensure you have **Node.js** (version 18+) and **Git** installed on your system:
- Check Node.js: open your terminal and run `node -v`
- Check Git: run `git --version`

### 2. Download and Setup
Open your terminal, navigate to the folder where you want to download HSS-CE, and run:
```bash
git clone https://github.com/phuonglt/hss-ce.git
cd hss-ce
bash install.sh
```
This script will verify your environment, install the necessary dependencies, and launch an interactive integration wizard.

The wizard will:
- Ask for your target codebase path.
- **Automatically generate agent rules and workflows** in your target project directory (creates `.agents/rules/hss-ce.md`, `.agents/workflows/hss-ce.md`, `.cursorrules`, `CLAUDE.md`, and `.aider.instructions.md`).
- Prompt you to register HSS-CE for your preferred coding agent (Antigravity, Claude Code, Aider, or Cursor).


### 3. Make HSS-CE Command Global (Optional)
To run the `hss-ce` command from anywhere on your computer:
```bash
npm link
```

---

## Coding Agent Integrations

Integrating HSS-CE with your AI coding agents allows them to query your codebase structure automatically.

### 1. Antigravity & Codex (Gemini IDE Assistant)
Antigravity and Codex use a global `mcp_config.json` file. Add this config block to `~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "hss-ce": {
      "command": "node",
      "args": [
        "/absolute/path/to/hss-ce/src/cli.js",
        "mcp",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

### 2. Claude Code
Claude Code automatically looks for MCP configurations. Add this to your project's `.mcp.json` or global config:
```json
{
  "mcpServers": {
    "hss-ce": {
      "command": "node",
      "args": [
        "/absolute/path/to/hss-ce/src/cli.js",
        "mcp",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

### 3. Cursor
To use HSS-CE within Cursor:
1. Open Cursor and go to **Settings > Features > MCP**.
2. Click **+ Add New MCP Server**.
3. Fill in the fields:
   - **Name:** `hss-ce`
   - **Type:** `command`
   - **Command:** `node /absolute/path/to/hss-ce/src/cli.js mcp /absolute/path/to/your/project`
4. Click **Save**.

### 4. Aider
To run Aider with HSS-CE as an MCP client:
Add this line to your `aider.conf.yml` or pass it in your command line parameters:
```yaml
mcp:
  - node /absolute/path/to/hss-ce/src/cli.js mcp /absolute/path/to/your/project
```

---

## CLI Usage

For manual terminal usage:

```bash
# 1. Index codebase (determines files and logical layers)
hss-ce index /path/to/project

# 2. Index codebase and prioritize specific files (Personalization)
hss-ce index /path/to/project --active=src/db.js,src/indexer.js

# 3. View structural codebase map (includes layer details)
hss-ce map /path/to/project

# 4. View a compact, elided signature-only map under a token budget
hss-ce map /path/to/project --compact --budget=1000

# 5. Pack codebase files under a token budget with Secret Guard redaction
hss-ce pack /path/to/project --budget=2000 --output=packed_context.txt

# 6. Enrich codebase index with AI-generated summaries (Gemini API)
export GEMINI_API_KEY="your_api_key_here"
hss-ce enrich /path/to/project

# 7. Generate a step-by-step onboarding tour of the codebase
hss-ce tour /path/to/project
```

---

## Inspirations & Credits

HSS-CE draws inspiration and features from several exceptional open-source tools:
- **[Repomix](https://github.com/yamadashy/repomix) / [GitIngest](https://github.com/coderamp-labs/gitingest)**: Inspires our XML context packaging and budget-bounded file packing with token calculations.
- **[Aider](https://github.com/Aider-AI/aider)**: Inspires our signature-only codebase skeleton mapping and token-budgeted structure elision.
- **[Graphify](https://github.com/safishamsi/graphify)** / **[CodeGraph](https://github.com/colbymchenry/codegraph)**: Inspires our structural codebase graph modeling, import tracking, and PageRank scoring.
- **[CodeCTX](https://github.com/tavilyai/codectx)**: Inspires our personalized context boost around user active files.
- **[Understand-Anything](https://github.com/Lum1104/Understand-Anything)**: Inspires our logical layering (Entrypoint/Service/Storage), interactive visual dashboard highlighting, and guided onboarding tours.

---

## License
Licensed under the [MIT License](LICENSE).

