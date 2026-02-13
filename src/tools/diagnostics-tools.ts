import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import { resolvePathToUri } from '../utils/path-utils.js';

/**
 * Get diagnostics for the entire workspace or a specific file
 * @param filePath Optional file path to check
 * @returns Array of [Uri, Diagnostic[]] tuples
 */
function getDiagnostics(filePath?: string): [vscode.Uri, vscode.Diagnostic[]][] {
    console.log(`[getDiagnostics] Starting with filePath: ${filePath || 'all files'}`);

    // If filePath is provided, get diagnostics for that file only
    if (filePath) {
        // Resolve path (handles both absolute and relative paths)
        const fileUri = resolvePathToUri(filePath);
        console.log(`[getDiagnostics] Getting diagnostics for file: ${fileUri.fsPath}`);

        const diagnostics = vscode.languages.getDiagnostics(fileUri);
        return diagnostics.length > 0 ? [[fileUri, diagnostics]] : [];
    }

    // Otherwise, get diagnostics for all files
    console.log('[getDiagnostics] Getting diagnostics for all files');
    return vscode.languages.getDiagnostics();
}

/**
 * Get severity name from DiagnosticSeverity enum
 * @param severity The diagnostic severity level
 * @returns String representation of the severity
 */
function getSeverityName(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return 'Error';
        case vscode.DiagnosticSeverity.Warning:
            return 'Warning';
        case vscode.DiagnosticSeverity.Information:
            return 'Information';
        case vscode.DiagnosticSeverity.Hint:
            return 'Hint';
        default:
            return 'Unknown';
    }
}

/**
 * Convert workspace URI to relative path
 * @param uri The Uri to convert
 * @returns Path relative to workspace root
 */
function uriToWorkspacePath(uri: vscode.Uri): string {
    if (!vscode.workspace.workspaceFolders) {
        return uri.fsPath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceRoot = workspaceFolder.uri.fsPath;
    
    // Convert to relative path
    const relativePath = path.relative(workspaceRoot, uri.fsPath);
    return relativePath;
}

/**
 * Format diagnostics for output
 * @param diagnostics Array of diagnostics to format
 * @param severities Array of severity levels to include
 * @param format Format of the output (text or json)
 * @param includeSource Whether to include the diagnostic source
 * @returns Formatted diagnostics as string or object
 */
function formatDiagnostics(
    diagnostics: [vscode.Uri, vscode.Diagnostic[]][], 
    severities: vscode.DiagnosticSeverity[],
    format: 'text' | 'json' = 'text',
    includeSource: boolean = true
): string | object {
    console.log(`[formatDiagnostics] Format: ${format}, Include source: ${includeSource}`);
    
    // Filter and transform diagnostics
    const result: Array<{
        file: string;
        line: number;
        column: number;
        severity: string;
        message: string;
        source?: string;
    }> = [];
    
    let totalIssues = 0;
    
    for (const [uri, fileDiagnostics] of diagnostics) {
        const filePath = uriToWorkspacePath(uri);
        
        for (const diagnostic of fileDiagnostics) {
            // Skip diagnostics with severity not in the specified list
            if (!severities.includes(diagnostic.severity)) {
                continue;
            }
            
            totalIssues++;
            
            // Convert the diagnostic to a structured object
            const issue = {
                file: filePath,
                line: diagnostic.range.start.line + 1, // Convert to 1-based line number
                column: diagnostic.range.start.character + 1, // Convert to 1-based column number
                severity: getSeverityName(diagnostic.severity),
                message: diagnostic.message,
            };
            
            // Add source if requested
            if (includeSource && diagnostic.source) {
                Object.assign(issue, { source: diagnostic.source });
            }
            
            result.push(issue);
        }
    }
    
    // Return formatted result based on requested format
    if (format === 'json') {
        return result;
    }
    
    // Format as text
    if (result.length === 0) {
        return 'No issues found.';
    }
    
    let output = `Found ${totalIssues} issue(s):\n\n`;
    
    for (const issue of result) {
        output += `${issue.severity}: ${issue.file}:${issue.line}:${issue.column}\n`;
        output += `  ${issue.message}\n`;
        
        if (includeSource && issue.source) {
            output += `  Source: ${issue.source}\n`;
        }
        
        output += '\n';
    }
    
    return output;
}

/**
 * Registers MCP diagnostics-related tools with the server
 * @param server MCP server instance
 */
export function registerDiagnosticsTools(server: McpServer): void {
    // Add get_diagnostics tool
    server.tool(
        'get_diagnostics_code',
        `CRITICAL: Run this after EVERY series of code changes to check for errors before completing tasks.

        Analyzes code for warnings and errors using VS Code's integrated linters.

        WHEN TO USE: After edits, before task completion, debugging build issues.
        Scope: Single file (faster) or entire workspace (comprehensive).
        Severities: 0=Error, 1=Warning, 2=Info, 3=Hint. Defaults to errors and warnings only.`,
        {
            path: z.string().optional().default('').describe('Optional file path to check. If not provided, checks the entire workspace. The file path must be a file, not a directory.'),
            severities: z.array(z.number()).optional().default([0, 1]).describe('Array of severity levels to include (0=Error, 1=Warning, 2=Information, 3=Hint)'),
            format: z.enum(['text', 'json']).optional().default('text').describe('Output format'),
            includeSource: z.boolean().optional().default(true).describe('Whether to include the diagnostic source to identify which linter/extension flagged each issue')
        },
        async ({ path, severities = [0, 1], format = 'text', includeSource = true }): Promise<CallToolResult> => {
            console.log(`[get_diagnostics] Tool called with path=${path || 'all'}, severities=${severities.join(',')}, format=${format}`);
            
            try {
                console.log('[get_diagnostics] Getting diagnostics');
                const diagnostics = getDiagnostics(path);
                
                console.log(`[get_diagnostics] Found diagnostics for ${diagnostics.length} files`);
                const formattedResult = formatDiagnostics(diagnostics, severities, format, includeSource);
                
                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: format === 'json' 
                                ? JSON.stringify(formattedResult, null, 2) 
                                : formattedResult as string
                        }
                    ]
                };
                console.log('[get_diagnostics] Successfully completed');
                return result;
            } catch (error) {
                console.error('[get_diagnostics] Error in tool:', error);
                throw error;
            }
        }
    );
}