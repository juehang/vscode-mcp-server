# VS Code MCP Server

A Visual Studio Code extension (available on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=JuehangQin.vscode-mcp-server)) that allows Claude and other MCP clients to code directly in VS Code! Inspired by [Serena](https://github.com/oraios/serena), but using VS Code's built-in capabilities. Perfect for extending existing coding agents like Claude Code with VS Code-specific capabilities (symbol search, document outlines) without duplicating tools they already have. Note that this extension uses the streamable HTTP API, not the SSE API.

This extension can allow for execution of shell commands. This means that there is a potential security risk, so use with caution, and ensure that you trust the MCP client that you are using and that the port is not exposed to anything. Authentication would help, but as the MCP authentication spec is still in flux, this has not been implemented for now.

PRs are welcome!

## Why you might install this MCP server

- **Code agents that don’t run VS Code or IntelliJ.** Claude or any other client can talk to this extension instead of embedding the IDE itself, so the coding agent can live inside a chat app or automation pipeline while still accessing the workspace via MCP tools.
- **Headless workflows and CI-friendly diagnostics.** Trigger `get_diagnostics_code`, file edits, or `search_symbols_code` from scripts or bots that do not host a UI; the MCP server simply acts as an HTTP bridge into VS Code’s workspace.
- **Fill the gaps between IDE platforms.** Use this extension when you need VS Code-specific tools (symbol search, glob helpers, tree views) but your agent is already configured to work with IntelliJ’s MCP server; the new guide explains how both can coexist and when to switch between them (`docs/intellij-vscode-mcp.md`).

### Debug logging for tool calls

Enable the `vscode-mcp-server.logToolCalls` setting to emit every MCP tool invocation (name + args) into the **MCP Server Extension** output channel. Open **Settings** (Ctrl+, or ⌘+,), search for "MCP Server log tool calls", toggle it on, and then click the status bar item (or run the "Toggle MCP Server" command) to restart the server so the new flag takes effect. Cursor's settings UI uses the same configuration keys, so the same toggle appears there when you open Settings or use the `Ctrl+,` shortcut and search for the setting. Once enabled, open **View → Output**, select "MCP Server Extension", and you’ll see the inbound tool calls for debugging.

## Demo Video
https://github.com/user-attachments/assets/20b87dfb-fc39-4710-a910-b9481dde1e90

## Installation

1. Install the extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=JuehangQin.vscode-mcp-server) or clone this repository and run `npm install` and `npm run compile` to build it.

## Claude Desktop Configuration

Claude Desktop can be configured to use this extension as an MCP server. To do this, your `claude_desktop_config.json` file should look like this:
```
{
  "mcpServers": {
    "vscode-mcp-server": {
        "command": "npx",
        "args": ["mcp-remote@next", "http://localhost:3000/mcp"]
    }

  }
}
```

I also like to use this extension in a Claude project, as it allows me to specify additional instructions for Claude. I find the following prompt to work well:
```
You are working on an existing codebase, which you can access using your tools. These code tools interact with a VS Code workspace.

WORKFLOW ESSENTIALS:
1. Always start exploration with list_files_code on root directory (.) first
2. CRITICAL: Run get_diagnostics_code after EVERY set of code changes before completing tasks
3. For small edits (≤10 lines): use replace_lines_code with exact original content
4. For large changes, new files, or uncertain content: use create_file_code with overwrite=true

EXPLORATION STRATEGY:
- Start: list_files_code with path='.' (never recursive on root)
- Understand structure: read key files like package.json, README, main entry points
- Find symbols: use search_symbols_code for functions/classes, get_document_symbols_code for file overviews
- Before editing: read_file_code the target file to understand current content

EDITING BEST PRACTICES:
- Small modifications: replace_lines_code (requires exact original content match)
- If replace_lines_code fails: read_file_code the target lines, then retry with correct content
- Large changes: create_file_code with overwrite=true is more reliable
- After any changes: get_diagnostics_code to check for errors

PLANNING REQUIREMENTS:
Before making code modifications, present a comprehensive plan including:
- Confidence level (1-10) and reasoning
- Specific tools you'll use and why
- Files you'll modify and approach (small edits vs complete rewrites)
- How you'll verify the changes work (diagnostics, testing, etc.)

ERROR HANDLING:
- Let errors happen naturally - don't add unnecessary try/catch blocks
- For tool failures: follow the specific recovery guidance in each tool's description
- If uncertain about file content: use read_file_code to verify before making changes

APPROVAL PROCESS:
IMPORTANT: Only run code modification tools after presenting a plan and receiving explicit approval. Each change requires separate approval.

Do not add tests unless specifically requested. If you believe testing is important, explain why and let the user decide.
```

For context efficiency when exploring codebases, consider adding this to your CLAUDE.md:
```
## VS Code Symbol Tools for Context Efficiency
Use VS Code symbol tools to reduce context consumption:
- `get_document_symbols_code` for file structure overview instead of reading entire files
- `search_symbols_code` to find symbols by name across the project
- `get_symbol_definition_code` for type info and docs without full file context
- Workflow: get outline → search symbols → get definitions → read implementation only when needed
```



This extension serves as a Model Context Protocol (MCP) server, exposing VS Code's filesystem and editing capabilities to MCP clients.

## Features

The VS Code MCP Server extension implements an MCP-compliant server that allows AI models and other MCP clients to:

- **List files and directories** in your VS Code workspace
- **Read file contents** with encoding support and size limits
- **Move files and directories** with proper refactoring support for imports
- **Rename files and directories** with automatic reference updates
- **Copy files** to new locations (files only, not directories)
- **Search files with glob patterns** to match extensions or directories quickly (find_files_by_glob)
- **Find files by name keyword** for fast name-based lookup (find_files_by_name_keyword)
- **Render directory trees** to see the workspace hierarchy before digging in (list_directory_tree)
- **Search for symbols** across your workspace
- **Get symbol definitions** and hover information by line and symbol name
- **Create new files** using VS Code's WorkspaceEdit API
- **Make line replacements** in files
- **Check for diagnostics** (errors and warnings) in your workspace
- **Execute shell commands** in the integrated terminal with shell integration
- **Toggle the server** on and off via a status bar item

This extension enables AI assistants and other tools to interact with your VS Code workspace through the standardized MCP protocol.

## How It Works

The extension creates an MCP server that:

1. Runs locally on a configurable port (when enabled)
2. Handles MCP protocol requests via HTTP
3. Exposes VS Code's functionality as MCP tools
4. Provides a status bar indicator showing server status, which can be clicked to toggle the server on/off

## Supported MCP Tools

### File Tools
- **list_files_code**: Lists files and directories in your workspace
  - Parameters:
    - `path`: The path to list files from
    - `recursive` (optional): Whether to list files recursively

- **read_file_code**: Reads file contents
  - Parameters:
    - `path`: The path to the file to read
    - `encoding` (optional): File encoding (default: utf-8)
    - `maxCharacters` (optional): Maximum character count (default: 100,000)

- **move_file_code**: Moves a file or directory to a new location using VS Code's WorkspaceEdit API
  - Parameters:
    - `sourcePath`: The current path of the file or directory to move
    - `targetPath`: The new path where the file or directory should be moved to
    - `overwrite` (optional): Whether to overwrite if target already exists (default: false)

- **rename_file_code**: Renames a file or directory using VS Code's WorkspaceEdit API
  - Parameters:
    - `filePath`: The current path of the file or directory to rename
    - `newName`: The new name for the file or directory
    - `overwrite` (optional): Whether to overwrite if a file with the new name already exists (default: false)

- **copy_file_code**: Copies a file to a new location using VS Code's file system API
  - Parameters:
    - `sourcePath`: The path of the file to copy
    - `targetPath`: The path where the copy should be created
    - `overwrite` (optional): Whether to overwrite if target already exists (default: false)

- **find_files_by_glob**: Finds files matching a glob pattern, optionally skipping other paths
  - Parameters:
    - `pattern`: Glob pattern relative to the workspace (e.g., `**/*.ts`)
    - `exclude` (optional): Glob pattern for paths to ignore (e.g., `**/node_modules/**`)
    - `maxResults` (optional): Upper limit of matches to return (default: 100)

- **find_files_by_name_keyword**: Searches indexed file/directory names for a keyword
  - Parameters:
    - `keyword`: Keyword to match in names
    - `maxResults` (optional): Upper limit of matches to return (default: 100)

- **list_directory_tree**: Renders an ASCII-style directory tree from the starting path
  - Parameters:
    - `path` (optional): Workspace path to render (default: `.`)
    - `maxDepth` (optional): Maximum depth to traverse (default: 3, max 8)

### Edit Tools
- **create_file_code**: Creates a new file using VS Code's WorkspaceEdit API
  - Parameters:
    - `path`: The path to the file to create
    - `content`: The content to write to the file
    - `overwrite` (optional): Whether to overwrite if the file exists (default: false)
    - `ignoreIfExists` (optional): Whether to ignore if the file exists (default: false)

- **replace_lines_code**: Replaces specific lines in a file
  - Parameters:
    - `path`: The path to the file to modify
    - `startLine`: The start line number (1-based, inclusive)
    - `endLine`: The end line number (1-based, inclusive)
    - `content`: The new content to replace the lines with
    - `originalCode`: The original code for validation

### Diagnostics Tools
- **get_diagnostics_code**: Checks for warnings and errors in your workspace
  - Parameters:
    - `path` (optional): File path to check (if not provided, checks the entire workspace)
    - `severities` (optional): Array of severity levels to include (0=Error, 1=Warning, 2=Information, 3=Hint). Default: [0, 1]
    - `format` (optional): Output format ('text' or 'json'). Default: 'text'
    - `includeSource` (optional): Whether to include the diagnostic source. Default: true

  This tool is particularly useful for:
  - Code quality checks before committing changes
  - Verifying fixes resolved all reported issues
  - Identifying problems in specific files or the entire workspace

### Symbol Tools
- **search_symbols_code**: Searches for symbols across the workspace
  - Parameters:
    - `query`: The search query for symbol names
    - `maxResults` (optional): Maximum number of results to return (default: 10)
  
  This tool is useful for:
  - Finding definitions of symbols (functions, classes, variables, etc.) across the codebase
  - Exploring project structure and organization
  - Locating specific elements by name

- **get_symbol_definition_code**: Gets definition information for a symbol in a file
  - Parameters:
    - `path`: The path to the file containing the symbol
    - `line`: The line number of the symbol
    - `symbol`: The symbol name to look for on the specified line
  
  This tool provides:
  - Type information, documentation, and source details for symbols
  - Code context showing the line where the symbol appears
  - Symbol range information
  
  It's particularly useful for:
  - Understanding what a symbol represents without navigating away
  - Checking function signatures, type definitions, or documentation
  - Quick reference for APIs or library functions

- **get_document_symbols_code**: Gets an outline of all symbols in a file, showing the hierarchical structure
  - Parameters:
    - `path`: The path to the file to analyze (relative to workspace)
    - `maxDepth` (optional): Maximum nesting depth to display
  
  This tool provides:
  - Complete symbol tree for a document (similar to VS Code's Outline view)
  - Hierarchical structure showing classes, functions, methods, variables, etc.
  - Position information and symbol kinds for each symbol
  - Summary statistics by symbol type
  
  It's particularly useful for:
  - Understanding file structure and organization at a glance
  - Getting an overview of all symbols in a document
  - Analyzing code architecture and relationships
  - Finding all symbols of specific types within a file

### Shell Tools
- **execute_shell_command_code**: Executes a shell command in the VS Code integrated terminal with shell integration
  - Parameters:
    - `command`: The shell command to execute
    - `cwd` (optional): Optional working directory for the command (default: '.')

  This tool is useful for:
  - Running CLI commands and build operations
  - Executing git commands
  - Performing any shell operations that require terminal access
  - Getting command output for analysis and further processing

## Caveats/TODO

Currently, only one workspace is supported. The extension also only works locally, to avoid exposing your VS Code instance to any network you may be connected to.

## Extension Settings

* `vscode-mcp-server.port`: The port number for the MCP server (default: 3000)
* `vscode-mcp-server.host`: Host address for the MCP server (default: 127.0.0.1)
* `vscode-mcp-server.defaultEnabled`: Whether the MCP server should be enabled by default on VS Code startup
* `vscode-mcp-server.enabledTools`: Configure which tool categories are enabled (file, edit, shell, diagnostics, symbol)

**Selective Tool Configuration**: Useful for coding agents that already have certain capabilities. For example, with Claude Code you might disable file/edit tools and only enable symbol tools to add VS Code-specific symbol searching without tool duplication.

## Using with MCP Clients

To connect MCP clients to this server, configure them to use:
```
http://localhost:3000/mcp
```

Or if you've configured a custom host:
```
http://[your-host]:3000/mcp
```

Remember that you need to enable the server first by clicking on the status bar item!

## Guides

- **IntelliJ ↔ VS Code MCP workflows**: `docs/intellij-vscode-mcp.md` explains why you might connect to JetBrains’ built-in MCP server, how the Auto-Configure workflow works, where manual JSON edits go, and what VS Code can do when it acts as an MCP server itself.

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

[MIT](LICENSE)
