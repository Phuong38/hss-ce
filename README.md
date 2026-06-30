# HSS-CE: Hybrid Semantic-Structural Context Engine

HSS-CE is a lightweight, offline-first codebase indexer and Model Context Protocol (MCP) server. It optimizes how developers and AI coding agents explore, map, and interact with complex codebases.

By calculating file significance using a simplified reference-count **PageRank** and parsing code structures (classes, functions, endpoints, structs, traits) using AST-aware parsing (Python, JS/TS) and dedicated language-specific parsing engines (Go, Rust), HSS-CE provides high-density context without wasting your token budget.


---

## Honest Value Proposition: Why Use HSS-CE?

HSS-CE is **not** a magical AI assistant that writes code for you. It is a structured context provider that acts as a bridge between your codebase's architecture, yourself, and your AI tools.

### 1. For Developers (Onboarding & Navigation)
* **Interactive Architecture Map:** Generates a lightweight, dark-mode interactive HTML diagram (`architecture.html`). You can visually search files, see directory-grouped modules, and click nodes to highlight immediate dependencies or see local symbols.
* **Onboarding Tours:** Generates step-by-step markdown walkthroughs (`hss-ce tour`) that order your codebase from critical entrypoints down to services and storage layers. This helps you understand a new codebase in minutes.
* **100% Offline Summaries:** Automatically extracts plain-English JSDoc, block comments, and Python docstrings to construct a codebase overview database, requiring zero API keys, network requests, or costs.

### 2. For AI Coding Agents (Context Optimization)
* **Eliminate Token Waste:** Coding agents (like Claude Code, Cursor, Aider) often read entire files or directory trees to understand import flows. HSS-CE exposes an MCP server that lets agents query precise skeletal structures and dependency trees under strict token budgets.
* **Precise Symbol Navigation:** Instead of performing noisy text searches (like raw `grep` or `ripgrep`), agents use structured database queries to resolve exact function definitions and caller locations.
* **Automated Redaction (Secret Guard):** Before packing codebase files to send to LLM context, HSS-CE automatically redacts credentials, private keys, and API tokens, preventing security leaks.
* **Git-Aware Ignore System:** Automatically respects `.gitignore` rules in addition to local `.hssceignore` patterns, ensuring build artifacts, dependencies, and temporary files are excluded from the index.
* **Cache-Aligned Context Packing:** Re-orders context packs to place stable components (static headers, path-sorted skeleton maps, reference files) at the beginning of the prompt, and highly dynamic variables (like system stats and token budget) at the very end. This maximizes LLM provider KV caching hits, saving up to 50%+ on prompt cost and latency.
* **Smart JSON Crusher:** Automatically minifies, prunes, and recursively crushes generic JSON files. Slices large arrays, truncates long strings, limits large object keys, and elides deep nesting to save up to 90% of tokens on configuration and mock data files.
* **Lazy Content Retrieval (CCR):** Exposes a `read_file_content` MCP tool so agents can receive lightweight codebase skeletons first and load full contents dynamically on-demand, enabling lossless token efficiency.

### 3. Current Limitations & What It is Not
* **Hybrid AST-Regex Parsing Engine:** HSS-CE uses high-performance syntax parsers (Babel for JS/TS, Python AST module for Python) to resolve symbols, imports, and metadata accurately, alongside dedicated language-specific parsers for **Go** (functions, structs, interfaces, imports) and **Rust** (functions, structs, traits, imports). For other unsupported languages, it falls back to lightweight regex-based heuristic parsing. This balances parser speed, accuracy, and extensibility.
* **Dependency on Code Quality:** Local file summaries are parsed from comments/docstrings. If your codebase has zero comments, the summaries will be empty unless you explicitly run the remote LLM enrichment command (`hss-ce enrich`).


---

## Developer & Agent Workflows in Action

### A. How a Developer Uses HSS-CE
Imagine you need to modify a database schema file `src/db.js` in a large codebase, but you don't know what might break.
1. Open the generated `architecture.html` dashboard in your browser.
2. Search for `db.js`.
3. Click the `db.js` node. The graph automatically dims unrelated elements and highlights all service files that directly import it.
4. Read the symbols and summaries in the details panel to understand exactly what functions interact with the database.

### B. How an AI Agent Uses HSS-CE (Under the Hood)
When you ask your agent (e.g. Claude Code or Cursor): *"Find all callers of the authenticate function and tell me where it is defined"*, the agent bypasses slow search loops and makes a fast MCP tool call:
1. Agent invokes `get_definition(symbol: "authenticate")` → HSS-CE queries SQLite and returns the exact file path and signature.
2. Agent invokes `get_callers(symbol: "authenticate")` → HSS-CE returns a clean list of files and lines referencing the function.
3. Agent invokes `get_dependency_path(fromFile: "src/main.js", toFile: "src/db.js")` → HSS-CE traces and lists the step-by-step import path between files.
4. Agent invokes `search_symbols(query: "auth")` → HSS-CE fuzzy matches against indexed symbols and returns definition details.
5. Agent invokes `search_code(query: "TODO: fix", isRegex: false)` → HSS-CE performs a lightning-fast SQLite FTS5 index search, ranking results by BM25 relevance and PageRank structural importance.
6. Agent invokes `check_index_drift()` → HSS-CE returns drift status to verify if index matches files on disk.
7. Agent invokes `get_change_impact(target: "src/db.js", depth: 3)` → HSS-CE recursively traces upstream imports to assess blast radius before modifying any code.
8. Agent invokes `crush_log(logContent: "...", tokenBudget: 2000)` → HSS-CE collapses internal framework stack frames and prunes non-essential logs under a token budget while preserving error/exception contexts.
9. The agent reads only those specific files, completing the task with 90% fewer tokens and much higher accuracy.

---

## Quick Start: Set Up a New Project (Single-Command Setup)

HSS-CE is designed to be set up on any target codebase with a single installation step.

### 1. Prerequisite
Ensure you have **Node.js (v18+)** and **Git** installed on your system.

### 2. Install and Configure

#### Option A: Run via NPX (Recommended - No Install Needed)
Run the configuration wizard directly without global installation issues:
```bash
npx --package hss-ce hss-ce-integrate
```


#### Option B: Install via NPM (Global)
Install globally to make the commands permanent:
```bash
npm install -g hss-ce
```
*Note: On macOS/Linux, if you encounter `EACCES` permission errors, either run with `sudo npm install -g hss-ce` or use a Node manager like `nvm`.*

Once installed, move into your target project directory and initialize it:
```bash
hss-ce-integrate
```

#### Option C: Install from Source (Git Clone)
If you prefer to clone and install the source code manually:
```bash
git clone https://github.com/phuonglt/hss-ce.git
cd hss-ce
bash install.sh
```



### 3. What the Installer Does Automatically
Once launched, the script will:
1. Install all required dependencies.
2. Register the global CLI commands (`hss-ce` and `hss-ce-integrate`).
3. Launch the setup wizard to ask for the path of your target codebase.
4. **Auto-Index:** Analyze your target codebase, calculate PageRank structural weights, and build the SQLite database (`.hss-ce/graph.db`).
5. **Auto-Doc:** Generate a `CODEBASE.md` markdown map and an interactive `architecture.html` dashboard in your target project directory.
6. **Auto-Agent Setup:** Write context instructions and rules (`.cursorrules`, `CLAUDE.md`, `.aider.instructions.md`, `.agents/rules/hss-ce.md`) so your AI agents immediately know how to use HSS-CE.
7. **Agent MCP Integration:** Prompt you to automatically add HSS-CE to your favorite coding client (Claude Desktop, Cursor, Claude Code, Aider, or Antigravity).
8. **Git Hooks Setup:** Installs background Git hooks (`post-checkout` and `post-merge`) in your target repository to automatically trigger fast codebase indexing in the background whenever you switch branches or merge updates, keeping your database perfectly synced with your current branch.

---

## CLI Reference Guide

If you prefer using the terminal manually, HSS-CE provides the following commands:

| Command | Usage | Description |
|---|---|---|
| `hss-ce index <path>` | `hss-ce index .` | Scan codebase structure and build local index. Add `-f` to force re-scan. |
| `hss-ce watch <path>` | `hss-ce watch .` | Monitor codebase files and sync index in real-time. Add `--debounce=300` to set delay in ms. |
| `hss-ce map <path>` | `hss-ce map . --compact` | Print PageRank-ordered file structure. Add `--budget=1000` to limit tokens. |
| `hss-ce doc <path>` | `hss-ce doc .` | Regenerate `CODEBASE.md` and `architecture.html` dashboard. |
| `hss-ce tour <path>` | `hss-ce tour .` | Display a step-by-step onboarding walkthrough tour of the codebase. |
| `hss-ce query <path> <sym>` | `hss-ce query . validateUser` | Instantly lookup definition and callers for a specific symbol. |
| `hss-ce path <path> <from> <to>` | `hss-ce path . src/cli.js src/db.js` | Find directed dependency/import path chain from one file to another. |
| `hss-ce search <path> <query>` | `hss-ce search . auth` | Fuzzy search symbol names matching query pattern. |
| `hss-ce search-code <path> <q>` | `hss-ce search-code . TODO --regex` | Search text snippet/regex across indexed files. Add `--regex` for regex pattern. |
| `hss-ce pack <path>` | `hss-ce pack . --budget=2000 --format=markdown --progressive --sort=path` | Package source/config/docs files into structured XML/Markdown for LLM context, with secret redacting. Supports progressive fallback compression to skeletons and deterministic sorting. |
| `hss-ce enrich <path>` | `hss-ce enrich .` | (Optional) Fetch AI-generated summaries via Gemini API (requires `GEMINI_API_KEY`). |
| `hss-ce status <path>` | `hss-ce status .` | Check if index has drifted from the local files on disk (modified/missing/untracked files). |
| `hss-ce impact <path> <target>` | `hss-ce impact . src/db.js` | Trace recursive change impact blast radius (importers) for a file or symbol. Add `--depth=N` flag to set max traversal depth (default 5). |
| `hss-ce crush-log <file>` | `hss-ce crush-log tests.log --budget=1000` | Compress verbose compiler, build, or test runner log files to fit within a token budget by collapsing internal framework stack frames and retaining failure lines/contexts. |

## HSS-CE vs. 2026 Context & Agent Landscapes

As of mid-2026, the AI agent ecosystem has evolved significantly. Below is a comparative analysis of HSS-CE against leading context and agent frameworks, along with our roadmap inspired by their architectures:

### 1. Comparative Analysis

| Feature | HSS-CE | Headroom (`chopratejas/headroom`) | CodeGraph (`colbymchenry/codegraph`) | Claude-Context (`zilliztech/claude-context`) |
| :--- | :--- | :--- | :--- | :--- |
| **Parsing Engine** | Hybrid (AST for JS/TS/Py, specialized regex for Go/Rust, regex fallback) | AST-aware (Languages-specific) | Tree-sitter AST (High accuracy) | AST-aware chunking |
| **Search Method** | SQLite FTS5 (Local keyword/BM25) | Heuristic compression & retrieval | SQLite query/Call-graph lookup | Semantic vector search (Milvus) |
| **Context Compression**| PageRank elision, Skeleton mode & Smart JSON Crusher | SmartCrusher (JSON), CodeCompressor | Signature elision | Embedding-based filtering |
| **Sync Mechanism** | Git hooks / CLI commands | Filesystem events / Proxy | Native FS watchers | Merkle trees |
| **Deployment** | 100% Offline (Local CLI/MCP) | Proxy / MCP server | 100% Offline (Local MCP) | Hybrid/Cloud (Requires DB & Key) |

### 2. Key Architectural Lessons
*   **Tree-sitter AST Parsing:** CodeGraph demonstrates that transitioning from regex parsing to Tree-sitter AST parsing significantly improves symbol resolution accuracy and cross-file import tracking, particularly for complex JS/TS/Python syntax.
*   **Context-Compressed Retrieval (CCR) & KV Caching:** Headroom's prefix alignment and JSON `SmartCrusher` show that optimization of LLM prompt caches is a critical factor in latency and cost reduction.
*   **Semantic Local Search:** Claude-Context's use of embeddings highlights the value of semantic search, which HSS-CE can adopt locally via lightweight libraries like `sqlite-vss` to avoid external API calls.

### 3. HSS-CE Future Roadmap & Implementation Plan
*   **Phase 1: AST-Aware & Language-Specific Parsing (Completed for JS/TS, Python, Go, and Rust)**
    *   *Goal:* Integrate AST/specialized parsers (Node.js Babel for JS/TS, python3 `ast` module for Python, regex-based parsers for Go & Rust) to resolve signatures, imports, structs, interfaces, and traits.
    *   *Testing:* Verified with `tests/python_ast.test.js`, `tests/go_rust.test.js`, and existing tests.

*   **Phase 2: KV-Cache prefix alignment (Completed)**
    *   *Goal:* Implement deterministic prompt formatting to lock stable context chunks (e.g. static headers, skeleton structures, and reference files sorted by path) at the beginning of prompt outputs, while moving highly dynamic variables (like total/active file counts and budget) to the footer.
*   **Phase 3: Real-Time Sync Watcher (Completed)**
    *   *Goal:* Add a local file watcher using `chokidar` to automatically sync SQLite `.hss-ce/graph.db` on file change events.
*   **Phase 4: Smart JSON Crusher (Completed)**
    *   *Goal:* Recursively prune, slice, and compress nested JSON objects, arrays, and long strings under token budget constraints to save up to 90% of tokens on configuration and mock data files.
*   **Phase 5: Smart Log & Stack Trace Crusher (Completed)**
    *   *Goal:* Parse, group, and collapse internal framework stack traces (Node.js, python unittest/pytest, Go runtime, etc.) and prune non-essential log lines under token budget constraints while retaining error lines and local context.

---

## Inspirations & Credits

HSS-CE draws inspiration and features from several exceptional open-source tools:
- **[Repomix](https://github.com/yamadashy/repomix) / [GitIngest](https://github.com/coderamp-labs/gitingest)**: Inspires our XML context packaging and budget-bounded file packing with token calculations.
- **[Aider](https://github.com/Aider-AI/aider)**: Inspires our signature-only codebase skeleton mapping and token-budgeted structure elision.
- **[Graphify](https://github.com/safishamsi/graphify)** / **[CodeGraph](https://github.com/colbymchenry/codegraph)**: Inspires our structural codebase graph modeling, import tracking, and PageRank scoring.
- **[CodeCTX](https://github.com/tavilyai/codectx)**: Inspires our personalized context boost around user active files.
- **[Understand-Anything](https://github.com/Lum1104/Understand-Anything)**: Inspires our logical layering (entrypoint/service/storage), interactive visual dashboard highlighting, and guided onboarding tours.
- **[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) & [Headroom](https://github.com/chopratejas/headroom)**: Inspires our prompt cache KV-alignment, JSON compaction, and Content-Compressed Retrieval (CCR) strategies.

---

## License
Licensed under the [MIT License](LICENSE).

