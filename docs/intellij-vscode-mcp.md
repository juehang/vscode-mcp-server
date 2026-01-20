# Bridging IntelliJ and VS Code MCP workflows

This note explains why the VS Code MCP server exists alongside the IntelliJ MCP server, highlights the workflows each one unlocks, and shows how to connect to the IntelliJ MCP tools when you already have Claude or another client running.

## Motivation and common use cases

1. **Bring IntelliJ diagnostics and refactoring into other clients.** JetBrains now exposes a full MCP server from IntelliJ IDEA 2025.2+, so external agents (Claude Desktop, Claude Code, VS Code) can run run configurations, read file problems, and execute refactors without leaving their chat window. VS Code’s MCP server fills the reverse gap: it lets agents call VS Code’s file, edit, and symbol tools even if the IDE is not listening for incoming MCP connections.[^1]
2. **Enable file-centric search tools that IntelliJ already ships with.** The new glob/keyword/tree tools mirror the IntelliJ-provided helpers (glob search, name keyword lookup, directory tree rendering) so Claude can navigate large repositories using the same mental model as the JetBrains clients.[^4]
3. **Use VS Code for language-agnostic MCP workflows.** VS Code hosts a single, free environment for every language, so a single extension configuration unlocks MCP tools for TypeScript, Rust, Python, Go, C++, and more without multiple JetBrains IDEs or paid licenses.[^2]

## Connecting to the IntelliJ MCP server

### Auto-configuration (IntelliJ 2025.2+)

1. Open **Settings → Tools → MCP Server** and enable the server.
2. In *Clients Auto-Configuration*, click **Auto-Configure** for Claude Desktop, Claude Code, VS Code, or any other client you want to connect.[^1]
3. Restart the external client (e.g., Claude Desktop) after IntelliJ finishes updating the JSON configuration.

IntelliJ already manages the correct transport (SSE is the recommended option) and the matching tool list, so the client only needs to know the updated URL.

### Manual setup steps

1. Still under **Settings → Tools → MCP Server**, enable the server and click **Copy SSE Config** (or **Copy stdio Config** when recommended for proxied connections).[^1]
2. Paste the generated JSON into your client’s configuration file (for Claude Desktop it lives under `claude_desktop_config.json`).
3. Restart the client with IntelliJ running first so the MCP handshake can complete.

### Older IDEs (before 2025.2)

Install the standalone “MCP Server” plugin from the JetBrains Marketplace, restart the IDE, and follow the same steps above. This mirrors the newer workflow but requires the plugin to be enabled manually.[^3]

## What VS Code offers on the MCP side

- VS Code does not ship with a built-in MCP server, so every client connection is outbound (VS Code connects *to* another MCP server).[^2]
- The workspace can still act as an MCP server by installing extensions such as this one, which expose file listing, editing, diagnostics, and symbol tools to agents.[^4]
- Once the extension is running, agents can call `list_files_code`, `read_file_code`, `replace_lines_code`, `get_diagnostics_code`, `search_symbols_code`, and the new glob/keyword/tree helpers to explore a project even when IntelliJ is not in use.

### Debug logging

If you need to trace exactly what the MCP client sends, enable the `vscode-mcp-server.logToolCalls` setting. Open Settings (Ctrl+, / ⌘+,), search for “MCP Server log tool calls”, toggle the option, then restart the extension via the status bar toggle or the `Toggle MCP Server` command so the flag takes effect. The tool calls appear in **View → Output → MCP Server Extension**, and Cursor users will see the same toggle because Cursor shares the same settings namespace.

## References

[^1]: https://www.jetbrains.com/help/idea/mcp-server.html
[^2]: https://code.visualstudio.com/docs/copilot/customization/mcp-servers
[^3]: https://apidog.com/blog/mcp-intellij-ides/
[^4]: https://github.com/juehang/vscode-mcp-server
