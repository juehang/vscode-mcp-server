import * as vscode from 'vscode';
import * as path from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Type for file listing results
export type FileListingResult = Array<{path: string, type: 'file' | 'directory'}>;

// Type for the file listing callback function
export type FileListingCallback = (path: string, recursive: boolean) => Promise<FileListingResult>;

// Default maximum character count
const DEFAULT_MAX_CHARACTERS = 100000;

/**
 * Lists files and directories in the VS Code workspace
 * @param workspacePath The path within the workspace to list files from
 * @param recursive Whether to list files recursively
 * @returns Array of file and directory entries
 */
export async function listWorkspaceFiles(workspacePath: string, recursive: boolean = false): Promise<FileListingResult> {
    console.log(`[listWorkspaceFiles] Starting with path: ${workspacePath}, recursive: ${recursive}`);
    
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    
    // Create URI for the target directory
    const targetUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
    console.log(`[listWorkspaceFiles] Target URI: ${targetUri.fsPath}`);

    async function processDirectory(dirUri: vscode.Uri, currentPath: string = ''): Promise<FileListingResult> {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        const result: FileListingResult = [];

        for (const [name, type] of entries) {
            const entryPath = currentPath ? path.join(currentPath, name) : name;
            const itemType: 'file' | 'directory' = (type & vscode.FileType.Directory) ? 'directory' : 'file';
            
            result.push({ path: entryPath, type: itemType });

            if (recursive && itemType === 'directory') {
                const subDirUri = vscode.Uri.joinPath(dirUri, name);
                const subEntries = await processDirectory(subDirUri, entryPath);
                result.push(...subEntries);
            }
        }

        return result;
    }

    try {
        const result = await processDirectory(targetUri);
        console.log(`[listWorkspaceFiles] Found ${result.length} entries`);
        return result;
    } catch (error) {
        console.error('[listWorkspaceFiles] Error:', error);
        throw error;
    }
}

/**
 * Reads a file from the VS Code workspace with character limit check
 * @param workspacePath The path within the workspace to the file
 * @param encoding Encoding to convert the file content to a string. Use 'base64' for base64-encoded string
 * @param maxCharacters Maximum character count (default: 100,000)
 * @param startLine The start line number (0-based, inclusive). Use -1 to read from the beginning.
 * @param endLine The end line number (0-based, inclusive). Use -1 to read to the end.
 * @returns File content as string (either text-encoded or base64)
 */
export async function readWorkspaceFile(
    workspacePath: string, 
    encoding: string = 'utf-8', 
    maxCharacters: number = DEFAULT_MAX_CHARACTERS,
    startLine: number = -1,
    endLine: number = -1
): Promise<string> {
    console.log(`[readWorkspaceFile] Starting with path: ${workspacePath}, encoding: ${encoding}, maxCharacters: ${maxCharacters}, startLine: ${startLine}, endLine: ${endLine}`);
    
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    
    // Create URI for the target file
    const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);
    console.log(`[readWorkspaceFile] File URI: ${fileUri.fsPath}`);

    try {
        // Read the file content as Uint8Array
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        console.log(`[readWorkspaceFile] File read successfully, size: ${fileContent.byteLength} bytes`);
        
        if (encoding === 'base64') {
            // Special case for base64 encoding
            if (fileContent.byteLength > maxCharacters) {
                throw new Error(`File content exceeds the maximum character limit (approx. ${fileContent.byteLength} bytes vs ${maxCharacters} allowed)`);
            }
            
            // For base64, we cannot extract lines meaningfully, so we ignore startLine and endLine
            if (startLine >= 0 || endLine >= 0) {
                console.warn(`[readWorkspaceFile] Line numbers specified for base64 encoding, ignoring`);
            }
            
            return Buffer.from(fileContent).toString('base64');
        } else {
            // Regular text encoding (utf-8, latin1, etc.)
            const textDecoder = new TextDecoder(encoding);
            const textContent = textDecoder.decode(fileContent);
            
            // Check if the character count exceeds the limit
            if (textContent.length > maxCharacters) {
                throw new Error(`File content exceeds the maximum character limit (${textContent.length} vs ${maxCharacters} allowed)`);
            }
            
            // If line numbers are specified and valid, extract just those lines
            if (startLine >= 0 || endLine >= 0) {
                // Split the content into lines
                const lines = textContent.split('\n');
                
                // Set effective start and end lines
                const effectiveStartLine = startLine >= 0 ? startLine : 0;
                const effectiveEndLine = endLine >= 0 ? Math.min(endLine, lines.length - 1) : lines.length - 1;
                
                // Validate line numbers
                if (effectiveStartLine >= lines.length) {
                    throw new Error(`Start line ${effectiveStartLine + 1} is out of range (1-${lines.length})`);
                }
                
                // Make sure endLine is not less than startLine
                if (effectiveEndLine < effectiveStartLine) {
                    throw new Error(`End line ${effectiveEndLine + 1} is less than start line ${effectiveStartLine + 1}`);
                }
                
                // Extract the requested lines and join them back together
                const partialContent = lines.slice(effectiveStartLine, effectiveEndLine + 1).join('\n');
                console.log(`[readWorkspaceFile] Returning lines ${effectiveStartLine + 1}-${effectiveEndLine + 1}, length: ${partialContent.length} characters`);
                return partialContent;
            }
            
            return textContent;
        }
    } catch (error) {
        console.error('[readWorkspaceFile] Error:', error);
        throw error;
    }
}

/**
 * Registers MCP file-related tools with the server
 * @param server MCP server instance
 * @param fileListingCallback Callback function for file listing operations
 */
export function registerFileTools(
    server: McpServer, 
    fileListingCallback: FileListingCallback
): void {
    // Add list_files tool
    server.tool(
        'list_files_code',
        `Explores directory structure in VS Code workspace.

        WHEN TO USE: Understanding project structure, finding files before read/modify operations.
        
        CRITICAL: NEVER set recursive=true on root directory (.) - output too large. Use recursive only on specific subdirectories.
        
        Returns files and directories at specified path. Start with path='.' to explore root, then dive into specific subdirectories with recursive=true.`,
        {
            path: z.string().describe('The path to list files from'),
            recursive: z.boolean().optional().default(false).describe('Whether to list files recursively')
        },
        async ({ path, recursive = false }): Promise<CallToolResult> => {
            console.log(`[list_files] Tool called with path=${path}, recursive=${recursive}`);
            
            if (!fileListingCallback) {
                console.error('[list_files] File listing callback not set');
                throw new Error('File listing callback not set');
            }

            try {
                console.log('[list_files] Calling file listing callback');
                const files = await fileListingCallback(path, recursive);
                console.log(`[list_files] Callback returned ${files.length} items`);
                
                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(files, null, 2)
                        }
                    ]
                };
                console.log('[list_files] Successfully completed');
                return result;
            } catch (error) {
                console.error('[list_files] Error in tool:', error);
                throw error;
            }
        }
    );

    // Update read_file tool with line number parameters
    server.tool(
        'read_file_code',
        `Retrieves file contents with size limits and partial reading support.

        WHEN TO USE: Reading code, config files, analyzing implementations. Files >100k chars will fail.
        
        Encoding: Text encodings (utf-8, latin1, etc.) for text files, 'base64' for base64-encoded string.
        Line numbers: Use startLine/endLine (1-based) for large files to read specific sections only.
        
        If file too large: Use startLine/endLine to read relevant sections only.`,
        {
            path: z.string().describe('The path to the file to read'),
            encoding: z.string().optional().default('utf-8').describe('Encoding to convert the file content to a string. Use "base64" for base64-encoded string'),
            maxCharacters: z.number().optional().default(DEFAULT_MAX_CHARACTERS).describe('Maximum character count (default: 100,000)'),
            startLine: z.number().optional().default(-1).describe('The start line number (1-based, inclusive). Default: read from beginning, denoted by -1'),
            endLine: z.number().optional().default(-1).describe('The end line number (1-based, inclusive). Default: read to end, denoted by -1')
        },
        async ({ path, encoding = 'utf-8', maxCharacters = DEFAULT_MAX_CHARACTERS, startLine = -1, endLine = -1 }): Promise<CallToolResult> => {
            console.log(`[read_file] Tool called with path=${path}, encoding=${encoding}, maxCharacters=${maxCharacters}, startLine=${startLine}, endLine=${endLine}`);
            
            // Convert 1-based input to 0-based for VS Code API
            const zeroBasedStartLine = startLine > 0 ? startLine - 1 : startLine;
            const zeroBasedEndLine = endLine > 0 ? endLine - 1 : endLine;
            
            try {
                console.log('[read_file] Reading file');
                const content = await readWorkspaceFile(path, encoding, maxCharacters, zeroBasedStartLine, zeroBasedEndLine);
                
                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: content
                        }
                    ]
                };
                console.log(`[read_file] File read successfully, length: ${content.length} characters`);
                return result;
            } catch (error) {
                console.error('[read_file] Error in tool:', error);
                throw error;
            }
        }
    );

    // Add move_file tool
    server.tool(
        'move_file_code',
        `Moves a file or directory to a new location using VS Code's WorkspaceEdit API.

        WHEN TO USE: Reorganizing project structure, moving files between directories.

        This operation uses VS Code's refactoring capabilities to ensure imports and references are updated correctly.

        IMPORTANT: This will update all references to the moved file in the workspace.`,
        {
            sourcePath: z.string().describe('The current path of the file or directory to move'),
            targetPath: z.string().describe('The new path where the file or directory should be moved to'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if target already exists')
        },
        async ({ sourcePath, targetPath, overwrite = false }): Promise<CallToolResult> => {
            console.log(`[move_file] Tool called with sourcePath=${sourcePath}, targetPath=${targetPath}, overwrite=${overwrite}`);

            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder is open');
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            const workspaceUri = workspaceFolder.uri;

            const sourceUri = vscode.Uri.joinPath(workspaceUri, sourcePath);
            const targetUri = vscode.Uri.joinPath(workspaceUri, targetPath);

            try {
                console.log(`[move_file] Moving from ${sourceUri.fsPath} to ${targetUri.fsPath}`);

                // Use WorkspaceEdit for proper refactoring support
                const edit = new vscode.WorkspaceEdit();
                edit.renameFile(sourceUri, targetUri, { overwrite });

                const success = await vscode.workspace.applyEdit(edit);

                if (!success) {
                    throw new Error('Failed to apply file move operation; check if target and source are valid');
                }

                console.log('[move_file] File move completed successfully');

                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: `Successfully moved ${sourcePath} to ${targetPath}`
                        }
                    ]
                };
                return result;
            } catch (error) {
                console.error('[move_file] Error in tool:', error);
                throw error;
            }
        }
    );

    // Add rename_file tool
    server.tool(
        'rename_file_code',
        `Renames a file or directory using VS Code's WorkspaceEdit API.

        WHEN TO USE: Renaming files to follow naming conventions, refactoring code.

        This operation uses VS Code's refactoring capabilities to ensure imports and references are updated correctly.

        IMPORTANT: This will update all references to the renamed file in the workspace.`,
        {
            filePath: z.string().describe('The current path of the file or directory to rename'),
            newName: z.string().describe('The new name for the file or directory'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if a file with the new name already exists')
        },
        async ({ filePath, newName, overwrite = false }): Promise<CallToolResult> => {
            console.log(`[rename_file] Tool called with filePath=${filePath}, newName=${newName}, overwrite=${overwrite}`);

            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder is open');
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            const workspaceUri = workspaceFolder.uri;

            const fileUri = vscode.Uri.joinPath(workspaceUri, filePath);
            const directoryPath = path.dirname(filePath);
            const newFilePath = path.join(directoryPath, newName);
            const newFileUri = vscode.Uri.joinPath(workspaceUri, newFilePath);

            try {
                console.log(`[rename_file] Renaming ${fileUri.fsPath} to ${newFileUri.fsPath}`);

                // Use WorkspaceEdit for proper refactoring support
                const edit = new vscode.WorkspaceEdit();
                edit.renameFile(fileUri, newFileUri, { overwrite });

                const success = await vscode.workspace.applyEdit(edit);

                if (!success) {
                    throw new Error('Failed to apply file rename operation; check if target and source are valid');
                }

                console.log('[rename_file] File rename completed successfully');

                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: `Successfully renamed ${filePath} to ${newName}`
                        }
                    ]
                };
                return result;
            } catch (error) {
                console.error('[rename_file] Error in tool:', error);
                throw error;
            }
        }
    );

    // Add copy_file tool
    server.tool(
        'copy_file_code',
        `Copies a file to a new location.

        WHEN TO USE: Creating backups, duplicating files for testing, creating template files.
        
        LIMITATION: Only works for files, not directories.`,
        {
            sourcePath: z.string().describe('The path of the file to copy'),
            targetPath: z.string().describe('The path where the copy should be created'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if target already exists')
        },
        async ({ sourcePath, targetPath, overwrite = false }): Promise<CallToolResult> => {
            console.log(`[copy_file] Tool called with sourcePath=${sourcePath}, targetPath=${targetPath}, overwrite=${overwrite}`);

            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder is open');
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            const workspaceUri = workspaceFolder.uri;

            const sourceUri = vscode.Uri.joinPath(workspaceUri, sourcePath);
            const targetUri = vscode.Uri.joinPath(workspaceUri, targetPath);

            try {
                console.log(`[copy_file] Copying from ${sourceUri.fsPath} to ${targetUri.fsPath}`);

                // Check if target already exists
                let targetExists = false;
                try {
                    await vscode.workspace.fs.stat(targetUri);
                    targetExists = true;
                } catch (error) {
                    // Only ignore FileNotFound errors - rethrow others (permissions, network, etc.)
                    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                        // Target doesn't exist, which is fine - continue with copy
                        targetExists = false;
                    } else {
                        // Rethrow unexpected errors (permissions, network issues, etc.)
                        throw error;
                    }
                }

                if (targetExists && !overwrite) {
                    throw new Error(`Target file ${targetPath} already exists. Use overwrite=true to overwrite.`);
                }

                // Read the source file
                const fileContent = await vscode.workspace.fs.readFile(sourceUri);

                // Write to target file
                await vscode.workspace.fs.writeFile(targetUri, fileContent);

                console.log('[copy_file] File copy completed successfully');

                const result: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: `Successfully copied ${sourcePath} to ${targetPath}`
                        }
                    ]
                };
                return result;
            } catch (error) {
                console.error('[copy_file] Error in tool:', error);
                throw error;
            }
        }
    );

    // Add find_files_by_glob tool
    server.tool(
        'find_files_by_glob',
        `Searches the workspace for files that match a glob pattern.

        WHEN TO USE: Locate files by extension or folder structure (e.g., **/*.java).
        
        NOTE: Prefer narrow patterns and use exclude filters to keep result sets manageable.`,
        {
            pattern: z.string().describe('Glob pattern that matches files relative to the workspace (e.g., **/*.ts)'),
            exclude: z.string().optional().describe('Optional glob pattern to skip (e.g., **/node_modules/**)'),
            maxResults: z
                .number()
                .optional()
                .default(100)
                .describe('Maximum number of matches to return (1-1000)')
        },
        async ({ pattern, exclude, maxResults = 100 }): Promise<CallToolResult> => {
            console.log(`[find_files_by_glob] pattern=${pattern}, exclude=${exclude}, maxResults=${maxResults}`);
            const normalizedLimit = clamp(maxResults, 1, MAX_SEARCH_RESULTS);
            const matches = await searchWorkspaceFilesByGlob(pattern, exclude, normalizedLimit);
            const resultText = formatSearchResults('Glob search results', matches);
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText
                    }
                ]
            };
        }
    );

    // Add find_files_by_name_keyword tool
    server.tool(
        'find_files_by_name_keyword',
        `Performs a fast name-based lookup using the workspace index.

        WHEN TO USE: Scan by partial file or folder names without reading entire directories.`,
        {
            keyword: z.string().describe('Keyword to match within file and directory names'),
            maxResults: z
                .number()
                .optional()
                .default(100)
                .describe('Maximum number of results to return (1-1000)')
        },
        async ({ keyword, maxResults = 100 }): Promise<CallToolResult> => {
            console.log(`[find_files_by_name_keyword] keyword=${keyword}, maxResults=${maxResults}`);
            const normalizedLimit = clamp(maxResults, 1, MAX_SEARCH_RESULTS);
            const matches = await searchWorkspaceFilesByNameKeyword(keyword, normalizedLimit);
            const resultText = formatSearchResults(`Keyword search for "${keyword}"`, matches);
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText
                    }
                ]
            };
        }
    );

    // Add list_directory_tree tool
    server.tool(
        'list_directory_tree',
        `Renders a directory tree starting at the provided path.

        WHEN TO USE: Get a hierarchical overview of folders before exploring individual files.
        
        TIP: Combine with list_files_code for deeper inspection.`,
        {
            path: z.string().optional().default('.').describe('Workspace path to render (default: root)'),
            maxDepth: z
                .number()
                .optional()
                .default(DEFAULT_TREE_DEPTH)
                .describe('Maximum depth of the tree (1-8)')
        },
        async ({ path: treePath = '.', maxDepth = DEFAULT_TREE_DEPTH }): Promise<CallToolResult> => {
            console.log(`[list_directory_tree] path=${treePath}, maxDepth=${maxDepth}`);
            const normalizedDepth = clamp(maxDepth, 1, MAX_TREE_DEPTH);
            const treeOutput = await buildDirectoryTree(treePath, normalizedDepth);
            return {
                content: [
                    {
                        type: 'text',
                        text: treeOutput
                    }
                ]
            };
        }
    );

}

const MAX_SEARCH_RESULTS = 1000;
const DEFAULT_TREE_DEPTH = 3;
const MAX_TREE_DEPTH = 8;

function clamp(value: number, minValue: number, maxValue: number): number {
    return Math.max(minValue, Math.min(maxValue, value));
}

function getWorkspaceFolderOrThrow(): vscode.WorkspaceFolder {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        throw new Error('No workspace folder is open');
    }

    return vscode.workspace.workspaceFolders[0];
}

function getWorkspaceRelativePath(targetUri: vscode.Uri): string {
    const folder = getWorkspaceFolderOrThrow();
    const relativePath = path.relative(folder.uri.fsPath, targetUri.fsPath);
    return relativePath || '.';
}

function formatSearchResults(title: string, matches: string[]): string {
    if (matches.length === 0) {
        return `${title} returned no matches.`;
    }

    const lines = [`${title} (${matches.length} file${matches.length === 1 ? '' : 's'}):`];
    matches.forEach((match, index) => lines.push(`${index + 1}. ${match}`));
    return lines.join('\n');
}

async function searchWorkspaceFilesByGlob(pattern: string, exclude: string | undefined, maxResults: number): Promise<string[]> {
    if (!pattern.trim()) {
        throw new Error('Glob pattern cannot be empty');
    }

    const uris = await vscode.workspace.findFiles(pattern, exclude, maxResults);
    return uris.map(getWorkspaceRelativePath);
}

async function searchWorkspaceFilesByNameKeyword(keyword: string, maxResults: number): Promise<string[]> {
    const trimmedKeyword = keyword.trim();

    if (!trimmedKeyword) {
        throw new Error('Keyword cannot be empty');
    }

    const escapedKeyword = escapeGlobCharacters(trimmedKeyword);
    const pattern = `**/*${escapedKeyword}*`;
    const uris = await vscode.workspace.findFiles(pattern, undefined, maxResults);
    return uris.map(getWorkspaceRelativePath);
}

function escapeGlobCharacters(value: string): string {
    return value.replace(/([*?\[\]{}()!+^])/g, "\$1");
}

async function buildDirectoryTree(treePath: string, maxDepth: number): Promise<string> {
    const folder = getWorkspaceFolderOrThrow();
    const normalizedPath = treePath.trim() ? treePath : '.';
    const rootUri = vscode.Uri.joinPath(folder.uri, normalizedPath);

    let rootStat;
    try {
        rootStat = await vscode.workspace.fs.stat(rootUri);
    } catch (error) {
        throw new Error(`Unable to access ${normalizedPath}: ${(error as Error).message}`);
    }

    const lines = [normalizedPath === '.' ? '.' : normalizedPath];

    if (!(rootStat.type & vscode.FileType.Directory)) {
        return lines.join('\n');
    }

    await traverseDirectory(rootUri, 1, '', lines, maxDepth);
    return lines.join('\n');
}

async function traverseDirectory(
    dirUri: vscode.Uri,
    depth: number,
    prefix: string,
    lines: string[],
    maxDepth: number
): Promise<void> {
    if (depth > maxDepth) {
        return;
    }

    let entries: [string, vscode.FileType][];

    try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch (error) {
        console.error(`[traverseDirectory] Failed to read ${dirUri.fsPath}:`, error);
        return;
    }

    const sortedEntries = entries.sort(([nameA, typeA], [nameB, typeB]) => {
        const isDirA = Boolean(typeA & vscode.FileType.Directory);
        const isDirB = Boolean(typeB & vscode.FileType.Directory);

        if (isDirA !== isDirB) {
            return isDirA ? -1 : 1;
        }

        return nameA.localeCompare(nameB);
    });

    for (let index = 0; index < sortedEntries.length; index++) {
        const [name, type] = sortedEntries[index];
        const isLast = index === sortedEntries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const displayName = type & vscode.FileType.Directory ? `${name}/` : name;
        lines.push(`${prefix}${connector}${displayName}`);

        if ((type & vscode.FileType.Directory) && depth < maxDepth) {
            const childPrefix = prefix + (isLast ? '    ' : '│   ');
            const childUri = vscode.Uri.joinPath(dirUri, name);
            await traverseDirectory(childUri, depth + 1, childPrefix, lines, maxDepth);
        }
    }
}
