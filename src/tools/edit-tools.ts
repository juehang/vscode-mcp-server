import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Creates a new file in the VS Code workspace using WorkspaceEdit
 * @param workspacePath The path within the workspace to the file
 * @param content The content to write to the file
 * @param overwrite Whether to overwrite if the file exists
 * @param ignoreIfExists Whether to ignore if the file exists
 * @returns Promise that resolves when the edit operation completes
 */
export async function createWorkspaceFile(
    workspacePath: string,
    content: string,
    overwrite: boolean = false,
    ignoreIfExists: boolean = false
): Promise<void> {
    console.log(`[createWorkspaceFile] Starting with path: ${workspacePath}, overwrite: ${overwrite}, ignoreIfExists: ${ignoreIfExists}`);
    
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    
    // Create URI for the target file
    const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
    console.log(`[createWorkspaceFile] File URI: ${fileUri.fsPath}`);

    try {
        // Create a WorkspaceEdit
        const workspaceEdit = new vscode.WorkspaceEdit();
        
        // Convert content to Uint8Array
        const contentBuffer = new TextEncoder().encode(content);
        
        // Add createFile operation to the edit
        workspaceEdit.createFile(fileUri, {
            contents: contentBuffer,
            overwrite: overwrite,
            ignoreIfExists: ignoreIfExists
        });
        
        // Apply the edit
        const success = await vscode.workspace.applyEdit(workspaceEdit);
        
        if (success) {
            console.log(`[createWorkspaceFile] File created successfully: ${fileUri.fsPath}`);
            
            // Open the document to trigger linting
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);
            console.log(`[createWorkspaceFile] File opened in editor`);
        } else {
            throw new Error(`Failed to create file: ${fileUri.fsPath}`);
        }
    } catch (error) {
        console.error('[createWorkspaceFile] Error:', error);
        throw error;
    }
}

/**
 * Replaces specific lines in a file in the VS Code workspace
 * @param workspacePath The path within the workspace to the file
 * @param startLine The start line number (0-based, inclusive)
 * @param endLine The end line number (0-based, inclusive)
 * @param content The new content to replace the lines with
 * @param originalCode The original code for validation
 * @returns Promise that resolves when the edit operation completes
 */
export async function replaceWorkspaceFileLines(
    workspacePath: string,
    startLine: number,
    endLine: number,
    content: string,
    originalCode: string
): Promise<void> {
    console.log(`[replaceWorkspaceFileLines] Starting with path: ${workspacePath}, lines: ${startLine}-${endLine}`);
    
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    
    // Create URI for the target file
    const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
    console.log(`[replaceWorkspaceFileLines] File URI: ${fileUri.fsPath}`);

    try {
        // Open the document (or get it if already open)
        const document = await vscode.workspace.openTextDocument(fileUri);
        
        // Validate line numbers
        if (startLine < 0 || startLine >= document.lineCount) {
            throw new Error(`Start line ${startLine + 1} is out of range (1-${document.lineCount})`);
        }
        if (endLine < startLine || endLine >= document.lineCount) {
            throw new Error(`End line ${endLine + 1} is out of range (${startLine + 1}-${document.lineCount})`);
        }
        
        // Get the text within the specified line range
        const rangeStartOffset = document.offsetAt(new vscode.Position(startLine, 0));
        const rangeEndOffset = endLine < document.lineCount - 1
            ? document.offsetAt(new vscode.Position(endLine + 1, 0))
            : document.getText().length;
        const rangeText = document.getText().substring(rangeStartOffset, rangeEndOffset);
        
        // Search for originalCode as substring (like desktop_edit_block)
        const matchIndex = rangeText.indexOf(originalCode);
        if (matchIndex === -1) {
            const preview = rangeText.length > 200 
                ? rangeText.substring(0, 200) + '...' 
                : rangeText;
            throw new Error(
                `Original code not found in lines ${startLine + 1}-${endLine + 1}. ` +
                `Line range content preview:\n${preview}`
            );
        }
        
        // Calculate exact position of the match
        const matchOffset = rangeStartOffset + matchIndex;
        const matchStartPos = document.positionAt(matchOffset);
        const matchEndPos = document.positionAt(matchOffset + originalCode.length);
        const matchRange = new vscode.Range(matchStartPos, matchEndPos);
        
        // Get the active text editor or show the document
        let editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== fileUri.toString()) {
            editor = await vscode.window.showTextDocument(document);
        }
        
        // Apply the edit
        const success = await editor.edit((editBuilder) => {
            editBuilder.replace(matchRange, content);
        });
        
        if (success) {
            console.log(`[replaceWorkspaceFileLines] Lines replaced successfully`);
            
            // Save the document to persist changes
            await document.save();
            console.log(`[replaceWorkspaceFileLines] Document saved`);
        } else {
            throw new Error(`Failed to replace lines in file: ${fileUri.fsPath}`);
        }
    } catch (error) {
        console.error('[replaceWorkspaceFileLines] Error:', error);
        throw error;
    }
}

/**
 * Escapes special regex characters for literal string matching
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Counts regex matches in a file without modifying it (preview helper)
 */
async function countRegexMatches(
    fileUri: vscode.Uri,
    pattern: string,
    literal: boolean = false,
    startLine?: number,
    endLine?: number
): Promise<{ count: number; searchText: string }> {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const fullText = document.getText();

    let searchText: string;
    let rangeStartOffset: number;
    let rangeEndOffset: number;

    if (startLine === undefined && endLine === undefined) {
        searchText = fullText;
        rangeStartOffset = 0;
        rangeEndOffset = fullText.length;
    } else {
        const start = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
        const end = endLine !== undefined ? Math.min(document.lineCount - 1, endLine - 1) : document.lineCount - 1;
        if (start > end) {
            throw new Error(`startLine (${startLine}) cannot be greater than endLine (${endLine})`);
        }
        rangeStartOffset = document.offsetAt(new vscode.Position(start, 0));
        rangeEndOffset = end < document.lineCount - 1
            ? document.offsetAt(new vscode.Position(end + 1, 0))
            : fullText.length;
        searchText = fullText.substring(rangeStartOffset, rangeEndOffset);
    }

    let regex: RegExp;
    try {
        regex = literal
            ? new RegExp(escapeRegex(pattern), 'g')
            : new RegExp(pattern, 'gm');
    } catch (e) {
        throw new Error(`Invalid regex pattern: ${pattern} — ${e instanceof Error ? e.message : String(e)}`);
    }

    const matches = searchText.match(regex);
    return { count: matches ? matches.length : 0, searchText };
}

/**
 * Replaces text in a file using regex pattern matching — no line numbers needed!
 * @param workspacePath The path within the workspace to the file
 * @param pattern The regex pattern (or literal string if literal=true)
 * @param replacement The replacement string
 * @param literal Whether to treat pattern as literal string (default false = regex)
 * @param expectedReplacements Required: expected number of replacements, throws if mismatch (prevents accidental mass-replacements like $ matching every line)
 * @param startLine Optional: 1-based start line (inclusive), default 1 = beginning
 * @param endLine Optional: 1-based end line (inclusive), default = end of file
 * @returns Number of replacements made
 */
export async function replaceWorkspaceFileByRegex(
    workspacePath: string,
    pattern: string,
    replacement: string,
    literal: boolean = false,
    expectedReplacements: number,
    startLine?: number,
    endLine?: number
): Promise<number> {
    console.log(`[replaceWorkspaceFileByRegex] path: ${workspacePath}, pattern: ${pattern}, literal: ${literal}, startLine: ${startLine}, endLine: ${endLine}`);
    
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
    
    try {
        const document = await vscode.workspace.openTextDocument(fileUri);
        const fullText = document.getText();
        
        // Use helper to count matches and get search text range
        const { count: actualCount, searchText } = await countRegexMatches(fileUri, pattern, literal, startLine, endLine);
        
        // Calculate the full document offset range
        let rangeStartOffset: number;
        let rangeEndOffset: number;
        
        if (startLine === undefined && endLine === undefined) {
            rangeStartOffset = 0;
            rangeEndOffset = fullText.length;
        } else {
            const start = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
            const end = endLine !== undefined ? Math.min(document.lineCount - 1, endLine - 1) : document.lineCount - 1;
            rangeStartOffset = document.offsetAt(new vscode.Position(start, 0));
            rangeEndOffset = end < document.lineCount - 1 
                ? document.offsetAt(new vscode.Position(end + 1, 0))
                : fullText.length;
        }
        
        // Verify expected count matches actual (required, prevents accidents like $ matching every line)
        if (actualCount !== expectedReplacements) {
            throw new Error(
                `Expected ${expectedReplacements} replacement(s), but pattern matched ${actualCount} time(s). ` +
                `No changes were made.`
            );
        }
        
        if (actualCount === 0) {
            return 0; // No matches, nothing to do
        }
        
        // Build regex for replacement
        let replaceRegex: RegExp;
        try {
            replaceRegex = literal
                ? new RegExp(escapeRegex(pattern), 'g')
                : new RegExp(pattern, 'gm');
        } catch (e) {
            throw new Error(`Invalid regex pattern: ${pattern} — ${e instanceof Error ? e.message : String(e)}`);
        }
        
        // Perform replacement only within the specified range
        const newSearchText = searchText.replace(replaceRegex, replacement);
        const newText = fullText.substring(0, rangeStartOffset) + newSearchText + fullText.substring(rangeEndOffset);
        
        // Apply via WorkspaceEdit (full document replace)
        const workspaceEdit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(fullText.length)
        );
        workspaceEdit.replace(fileUri, fullRange, newText);
        
        const success = await vscode.workspace.applyEdit(workspaceEdit);
        
        if (success) {
            await document.save();
            console.log(`[replaceWorkspaceFileByRegex] ${actualCount} replacement(s) made`);
        } else {
            throw new Error(`Failed to apply regex replacement to file: ${fileUri.fsPath}`);
        }
        
        return actualCount;
    } catch (error) {
        console.error('[replaceWorkspaceFileByRegex] Error:', error);
        throw error;
    }
}

/**
 * Registers MCP edit-related tools with the server
 * @param server MCP server instance
 * 
 * 注意: replace_lines / replace_regex / preview_regex 已被屏蔽。
 * 请使用 diff-tools.ts 中的 edit_file / apply_diff / preview_diff。
 */
export function registerEditTools(server: McpServer): void {
    // Add create_file tool
    server.tool(
        'create_file',
        `Creates new files or completely rewrites existing files.

        WHEN TO USE: New files, large modifications (>10 lines), complete file rewrites.
        For small edits, use edit_file or apply_diff instead.

        File handling: Use overwrite=true to replace existing files, ignoreIfExists=true to skip if file exists.
        Always check with list_files first unless you specifically want to overwrite.`,
        {
            path: z.string().describe('The path to the file to create'),
            content: z.string().describe('The content to write to the file'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if the file exists'),
            ignoreIfExists: z.boolean().optional().default(false).describe('Whether to ignore if the file exists')
        },
        async ({ path, content, overwrite = false, ignoreIfExists = false }): Promise<CallToolResult> => {
            console.log(`[create_file] Tool called with path=${path}, overwrite=${overwrite}, ignoreIfExists=${ignoreIfExists}`);
            
            try {
                console.log('[create_file] Creating file');
                await createWorkspaceFile(path, content, overwrite, ignoreIfExists);
                
                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: `File ${path} created successfully`
                        }
                    ]
                };
                console.log('[create_file] Successfully completed');
                return result;
            } catch (error) {
                console.error('[create_file] Error in tool:', error);
                throw error;
            }
        }
    );

    // ⛔ 以下工具已屏蔽，请使用 diff-tools.ts 中的替代工具:
    // - replace_lines → edit_file（精确文本匹配替换）
    // - replace_regex → apply_diff（unified diff 编辑）
    // - preview_regex → preview_diff（diff 预览）
}