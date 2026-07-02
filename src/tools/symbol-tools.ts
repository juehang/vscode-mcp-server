import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { toolResult, ToolFormat } from './tool-utils';

/**
 * Convert a symbol kind to a string representation
 * @param kind The symbol kind enum value
 * @returns String representation of the symbol kind
 */
function symbolKindToString(kind: vscode.SymbolKind): string {
    switch (kind) {
        case vscode.SymbolKind.File: return 'File';
        case vscode.SymbolKind.Module: return 'Module';
        case vscode.SymbolKind.Namespace: return 'Namespace';
        case vscode.SymbolKind.Package: return 'Package';
        case vscode.SymbolKind.Class: return 'Class';
        case vscode.SymbolKind.Method: return 'Method';
        case vscode.SymbolKind.Property: return 'Property';
        case vscode.SymbolKind.Field: return 'Field';
        case vscode.SymbolKind.Constructor: return 'Constructor';
        case vscode.SymbolKind.Enum: return 'Enum';
        case vscode.SymbolKind.Interface: return 'Interface';
        case vscode.SymbolKind.Function: return 'Function';
        case vscode.SymbolKind.Variable: return 'Variable';
        case vscode.SymbolKind.Constant: return 'Constant';
        case vscode.SymbolKind.String: return 'String';
        case vscode.SymbolKind.Number: return 'Number';
        case vscode.SymbolKind.Boolean: return 'Boolean';
        case vscode.SymbolKind.Array: return 'Array';
        case vscode.SymbolKind.Object: return 'Object';
        case vscode.SymbolKind.Key: return 'Key';
        case vscode.SymbolKind.Null: return 'Null';
        case vscode.SymbolKind.EnumMember: return 'EnumMember';
        case vscode.SymbolKind.Struct: return 'Struct';
        case vscode.SymbolKind.Event: return 'Event';
        case vscode.SymbolKind.Operator: return 'Operator';
        case vscode.SymbolKind.TypeParameter: return 'TypeParameter';
        default: return 'Unknown';
    }
}

/**
 * Converts a workspace URI to a path relative to the workspace root
 * @param uri The URI to convert
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
 * Get a preview of the code at a specific line
 * @param uri The URI of the document
 * @param line The line number (0-based)
 * @returns The line content as a string or undefined if not available
 */
async function getPreview(uri: vscode.Uri, line?: number): Promise<string | undefined> {
    if (line === undefined) {
        return undefined;
    }

    try {
        // Try to open the document from VS Code's text document manager
        const documents = vscode.workspace.textDocuments;
        let document = documents.find(doc => doc.uri.toString() === uri.toString());
        
        // If document is not already open, try to read it from the file system
        if (!document) {
            try {
                const content = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(content).toString('utf8');
                const lines = text.split(/\r?\n/);
                
                if (line >= 0 && line < lines.length) {
                    return lines[line].trim();
                }
            } catch (error) {
                logger.warn(`[getPreview] Could not read file: ${error instanceof Error ? error.message : String(error)}`);
                return undefined;
            }
        } else {
            // Document is open, get the line directly
            if (line >= 0 && line < document.lineCount) {
                return document.lineAt(line).text.trim();
            }
        }
    } catch (error) {
        logger.warn(`[getPreview] Error getting preview: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return undefined;
}

/**
 * Get the text content of a specific line in a file
 * @param uri The URI of the document
 * @param line The line number (0-based)
 * @returns The text content of the line or undefined if line doesn't exist
 */
async function getLineText(uri: vscode.Uri, line: number): Promise<string | undefined> {
    try {
        // Open the document using VS Code's API
        const document = await vscode.workspace.openTextDocument(uri);
        
        // Check if the line exists
        if (line >= 0 && line < document.lineCount) {
            return document.lineAt(line).text;
        }
        return undefined;
    } catch (error) {
        logger.warn(`[getLineText] Error getting line text: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

/**
 * Find the first occurrence of a symbol in a line of text
 * @param lineText The text content of the line
 * @param symbolName The exact symbol name to search for
 * @returns The character position (index) where the symbol starts, or -1 if not found
 */
function findSymbolInLine(lineText: string, symbolName: string): number {
    return lineText.indexOf(symbolName);
}

/**
 * Process hover content to extract string value
 * @param content The hover content item
 * @returns String representation of the content
 */
function processHoverContent(content: any): string {
    if (typeof content === 'string') {
        return content;
    } else if (content && typeof content === 'object' && 'value' in content) {
        return content.value;
    }
    return String(content);
}

/**
 * Get hover information for a symbol at a specific position in a document
 * @param uri The URI of the text document
 * @param position The position of the symbol
 * @returns Hover information for the symbol
 */
export async function getSymbolHoverInfo(
    uri: vscode.Uri,
    position: vscode.Position
): Promise<{
    hovers: Array<{
        contents: string[];
        range?: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
        preview?: string;
    }>;
}> {
    logger.info(`[getSymbolHoverInfo] Getting hover info for ${uri.toString()} at position (${position.line},${position.character})`);
    
    try {
        // Execute the hover provider
        const commandResult = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider',
            uri,
            position
        ) || [];
        
        logger.info(`[getSymbolHoverInfo] Found ${commandResult.length} hover results`);
        
        // Map the hover results to a more friendly format
        const hovers = await Promise.all(commandResult.map(async hover => {
            // Process the contents
            let contents: string[] = [];
            
            if (Array.isArray(hover.contents)) {
                contents = hover.contents.map(processHoverContent);
            } else if (hover.contents) {
                contents = [processHoverContent(hover.contents)];
            }
            
            // Format the range if available
            const range = hover.range ? {
                start: {
                    line: hover.range.start.line,
                    character: hover.range.start.character
                },
                end: {
                    line: hover.range.end.line,
                    character: hover.range.end.character
                }
            } : undefined;
            
            // Get a preview of the code if range is available
            const preview = await getPreview(uri, hover.range?.start.line);
            
            return { contents, range, preview };
        }));
        
        return { hovers };
    } catch (error) {
        logger.error(`[getSymbolHoverInfo] Error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

/**
 * Search for symbols across the workspace
 * @param query The search query
 * @param maxResults Maximum number of results to return
 * @returns Array of formatted symbol information objects
 */
export async function searchWorkspaceSymbols(query: string, maxResults: number = 10): Promise<{
    symbols: Array<{
        name: string;
        kind: string;
        location: string;
        containerName?: string;
        range?: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    }>;
    total: number;
}> {
    logger.info(`[searchWorkspaceSymbols] Starting with query: "${query}", maxResults: ${maxResults}`);
    
    try {
        // Execute the workspace symbol provider
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            query
        ) || [];
        
        logger.info(`[searchWorkspaceSymbols] Found ${symbols.length} symbols`);
        
        // Get total count before limiting
        const totalCount = symbols.length;
        
        // Apply limit
        const limitedSymbols = symbols.slice(0, maxResults);
        
        // Format the results
        const result = {
            symbols: limitedSymbols.map(symbol => {
                const formatted = {
                    name: symbol.name,
                    kind: symbolKindToString(symbol.kind),
                    location: `${uriToWorkspacePath(symbol.location.uri)}:${symbol.location.range.start.line + 1}:${symbol.location.range.start.character}`,
                    range: {
                        start: {
                            line: symbol.location.range.start.line + 1,
                            character: symbol.location.range.start.character
                        },
                        end: {
                            line: symbol.location.range.end.line + 1,
                            character: symbol.location.range.end.character
                        }
                    }
                };
                
                // Add container name if available
                if (symbol.containerName) {
                    Object.assign(formatted, { containerName: symbol.containerName });
                }
                
                return formatted;
            }),
            total: totalCount
        };
        
        return result;
    } catch (error) {
        logger.error(`[searchWorkspaceSymbols] Error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

/**
 * Get all document symbols from a file in hierarchical format
 * @param uri The URI of the document
 * @param maxDepth Maximum nesting depth to display (optional)
 * @returns Formatted symbol information with hierarchy
 */
export async function getDocumentSymbols(
    uri: vscode.Uri, 
    maxDepth?: number
): Promise<{
    symbols: Array<{
        name: string;
        detail?: string;
        kind: string;
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
        selectionRange: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
        depth: number;
        children?: any[];
    }>;
    total: number;
    totalByKind: Record<string, number>;
}> {
    logger.info(`[getDocumentSymbols] Getting symbols for ${uri.toString()}, maxDepth: ${maxDepth}`);
    
    try {
        // Execute the document symbol provider
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            uri
        ) || [];
        
        logger.info(`[getDocumentSymbols] Found ${symbols.length} top-level symbols`);
        
        const flatSymbols: any[] = [];
        const kindCounts: Record<string, number> = {};
        
        // Recursive function to process symbols and their children
        function processSymbols(symbols: vscode.DocumentSymbol[], depth: number = 0) {
            for (const symbol of symbols) {
                // Skip if max depth exceeded
                if (maxDepth !== undefined && depth > maxDepth) {
                    continue;
                }
                
                const kindString = symbolKindToString(symbol.kind);
                kindCounts[kindString] = (kindCounts[kindString] || 0) + 1;
                
                const processedSymbol = {
                    name: symbol.name,
                    detail: symbol.detail || undefined,
                    kind: kindString,
                    range: {
                        start: {
                            line: symbol.range.start.line + 1,
                            character: symbol.range.start.character
                        },
                        end: {
                            line: symbol.range.end.line + 1,
                            character: symbol.range.end.character
                        }
                    },
                    selectionRange: {
                        start: {
                            line: symbol.selectionRange.start.line + 1,
                            character: symbol.selectionRange.start.character
                        },
                        end: {
                            line: symbol.selectionRange.end.line + 1,
                            character: symbol.selectionRange.end.character
                        }
                    },
                    depth,
                    children: symbol.children && symbol.children.length > 0 ? symbol.children.length : undefined
                };
                
                flatSymbols.push(processedSymbol);
                
                // Recursively process children
                if (symbol.children && symbol.children.length > 0) {
                    processSymbols(symbol.children, depth + 1);
                }
            }
        }
        
        processSymbols(symbols);
        
        return {
            symbols: flatSymbols,
            total: flatSymbols.length,
            totalByKind: kindCounts
        };
    } catch (error) {
        logger.error(`[getDocumentSymbols] Error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

/**
 * Registers MCP symbol-related tools with the server
 * @param server MCP server instance
 */
export function registerSymbolTools(server: McpServer): void {
    // Add search_symbols tool
    server.tool(
        'search_symbols',
        `Searches for symbols (functions, classes, variables) across workspace using fuzzy matching.

        WHEN TO USE: Finding function/class definitions, exploring project structure, locating specific elements.
        
        Search: Supports partial terms (e.g., 'createW' matches 'createWorkspaceFile'). Returns location and container info.
        Limit results to avoid overwhelming output - increase maxResults only if needed.`,
        {
            query: z.string().describe('The search query for symbol names'),
            maxResults: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)')
        },
        async ({ query, maxResults = 10 }): Promise<CallToolResult> => {
            logger.info(`[search_symbols] Tool called with query="${query}", maxResults=${maxResults}`);
            
            try {
                logger.info('[search_symbols] Searching workspace symbols');
                const result = await searchWorkspaceSymbols(query, maxResults);
                
                let resultText: string;
                
                if (result.symbols.length === 0) {
                    resultText = `No symbols found matching query "${query}".`;
                } else {
                    resultText = `Found ${result.total} symbols matching query "${query}"`;
                    
                    if (result.total > maxResults) {
                        resultText += ` (showing first ${maxResults})`;
                    }
                    
                    resultText += ":\n\n";
                    
                    for (const symbol of result.symbols) {
                        resultText += `${symbol.name} (${symbol.kind})`;
                        if (symbol.containerName) {
                            resultText += ` in ${symbol.containerName}`;
                        }
                        resultText += `\nLocation: ${symbol.location}\n\n`;
                    }
                }
                
                const callResult: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: resultText
                        }
                    ]
                };
                logger.info('[search_symbols] Successfully completed');
                return callResult;
            } catch (error) {
                logger.error(`[search_symbols] Error in tool: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // Add get_symbol_definition tool with updated parameters
    server.tool(
        'get_symbol_definition',
        `Gets definition information for a symbol using hover data (type, docs, source).

        WHEN TO USE: Understanding what a symbol represents, checking function signatures, quick API reference.
        USE search_symbols instead for: finding symbols by name across the project.
        
        Requires exact symbol name and line number. If symbol not found on line, returns clear message.`,
        {
            path: z.string().describe('The path to the file containing the symbol'),
            line: z.number().describe('The line number of the symbol (1-based)'),
            symbol: z.string().describe('The symbol name to look for on the specified line')
        },
        async ({ path, line, symbol }): Promise<CallToolResult> => {
            logger.info(`[get_symbol_definition] Tool called with path="${path}", line=${line}, symbol="${symbol}"`);
            
            // Convert 1-based input to 0-based for VS Code API
            const zeroBasedLine = line - 1;
            try {
                if (!vscode.workspace.workspaceFolders) {
                    throw new Error('No workspace folder open');
                }
                
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const fullPath = require('path').resolve(workspaceRoot, path);
                const uri = vscode.Uri.file(fullPath);
                
                // Check if file exists
                try {
                    await vscode.workspace.fs.stat(uri);
                } catch (error) {
                    throw new Error(`File not found: ${path}`);
                }
                
                // Get the content of the specified line
                const lineText = await getLineText(uri, zeroBasedLine);
                if (!lineText) {
                    throw new Error(`Line ${line} not found in file: ${path}`);
                }
                
                // Find the character position of the symbol in the line
                const character = findSymbolInLine(lineText, symbol);
                if (character === -1) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Symbol "${symbol}" not found on line ${line} in file: ${path}`
                            }
                        ]
                    };
                }
                
                // Create a position object
                const position = new vscode.Position(zeroBasedLine, character);
                
                // Get hover information
                const hoverResult = await getSymbolHoverInfo(uri, position);
                
                let resultText: string;
                
                if (hoverResult.hovers.length === 0) {
                    resultText = `No definition information found for symbol "${symbol}" at ${path}:${line}:${character}.`;
                } else {
                    resultText = `Definition information for symbol "${symbol}" at ${path}:${line}:${character}:\n\n`;
                    
                    for (const hover of hoverResult.hovers) {
                        // Add preview if available
                        if (hover.preview) {
                            resultText += `Code context: \`${hover.preview}\`\n\n`;
                        }
                        
                        // Add contents
                        for (const content of hover.contents) {
                            resultText += `${content}\n\n`;
                        }
                        
                        // Add range if available
                        if (hover.range) {
                            resultText += `Symbol range: [${hover.range.start.line}:${hover.range.start.character}] to [${hover.range.end.line}:${hover.range.end.character}]\n\n`;
                        }
                    }
                }
                
                const callResult: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: resultText
                        }
                    ]
                };
                logger.info('[get_symbol_definition] Successfully completed');
                return callResult;
            } catch (error) {
                logger.error(`[get_symbol_definition] Error in tool: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // Add get_document_symbols tool
    server.tool(
        'get_document_symbols',
        `Gets complete symbol outline for a file showing hierarchical structure and line numbers.

        WHEN TO USE: Understanding file structure, getting overview of all symbols, finding symbol positions. This tool should be be preferred over reading the file using read_file when only an overview of the file is needed.
        USE search_symbols instead for: finding specific symbols by name across the project.
        
        Shows classes, functions, methods, variables with line ranges. Use maxDepth for large files to avoid deep nesting.`,
        {
            path: z.string().describe('The path to the file to analyze (relative to workspace)'),
            maxDepth: z.number().optional().describe('Maximum nesting depth to display (optional)')
        },
        async ({ path, maxDepth }): Promise<CallToolResult> => {
            logger.info(`[get_document_symbols] Tool called with path="${path}", maxDepth=${maxDepth}`);
            
            try {
                if (!vscode.workspace.workspaceFolders) {
                    throw new Error('No workspace folder open');
                }
                
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const fullPath = require('path').resolve(workspaceRoot, path);
                const uri = vscode.Uri.file(fullPath);
                
                // Check if file exists
                try {
                    await vscode.workspace.fs.stat(uri);
                } catch (error) {
                    throw new Error(`File not found: ${path}`);
                }
                
                logger.info('[get_document_symbols] Getting document symbols');
                const result = await getDocumentSymbols(uri, maxDepth);
                
                let resultText: string;
                
                if (result.symbols.length === 0) {
                    resultText = `No symbols found in file: ${path}`;
                } else {
                    resultText = `Document symbols for ${path} (${result.total} total symbols):\n\n`;
                    
                    // Add summary by kind
                    const kindSummary = Object.entries(result.totalByKind)
                        .map(([kind, count]) => `${count} ${kind}${count !== 1 ? 's' : ''}`)
                        .join(', ');
                    resultText += `Summary: ${kindSummary}\n\n`;
                    
                    // Add hierarchical symbol listing
                    for (const symbol of result.symbols) {
                        const indent = '  '.repeat(symbol.depth);
                        resultText += `${indent}${symbol.name} (${symbol.kind})`;
                        
                        if (symbol.detail) {
                            resultText += ` - ${symbol.detail}`;
                        }
                        
                        resultText += `\n${indent}  Range: ${symbol.range.start.line}:${symbol.range.start.character}-${symbol.range.end.line}:${symbol.range.end.character}`;
                        
                        if (symbol.children !== undefined) {
                            resultText += ` | Children: ${symbol.children}`;
                        }
                        
                        resultText += '\n\n';
                    }
                }
                
                const callResult: CallToolResult = {
                    content: [
                        {
                            type: 'text',
                            text: resultText
                        }
                    ]
                };
                logger.info('[get_document_symbols] Successfully completed');
                return callResult;
            } catch (error) {
                logger.error(`[get_document_symbols] Error in tool: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    server.tool(
        'find_references',
        `Finds references for a symbol at a line and character position.`,
        {
            path: z.string(),
            line: z.number().describe('1-based line number'),
            character: z.number().describe('0-based character offset'),
            maxResults: z.number().optional().default(50),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ path, line, character, maxResults = 50, format = 'text' }): Promise<CallToolResult> => {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }
            const uri = vscode.Uri.file(require('path').resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, path));
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                new vscode.Position(line - 1, character)
            ) || [];
            const references = locations.slice(0, maxResults).map(location => ({
                file: uriToWorkspacePath(location.uri),
                line: location.range.start.line + 1,
                character: location.range.start.character
            }));
            return toolResult({
                ok: true,
                summary: `Found ${locations.length} reference(s)`,
                data: { references, total: locations.length }
            }, format as ToolFormat, references.map(ref => `${ref.file}:${ref.line}:${ref.character}`).join('\n'));
        }
    );

    server.tool(
        'go_to_definition',
        `Gets definition locations for a symbol at a line and character position.`,
        {
            path: z.string(),
            line: z.number().describe('1-based line number'),
            character: z.number().describe('0-based character offset'),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ path, line, character, format = 'text' }): Promise<CallToolResult> => {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }
            const uri = vscode.Uri.file(require('path').resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, path));
            const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                'vscode.executeDefinitionProvider',
                uri,
                new vscode.Position(line - 1, character)
            ) || [];
            const locations = definitions.map(definition => {
                if ('targetUri' in definition) {
                    return {
                        file: uriToWorkspacePath(definition.targetUri),
                        line: definition.targetRange.start.line + 1,
                        character: definition.targetRange.start.character
                    };
                }
                return {
                    file: uriToWorkspacePath(definition.uri),
                    line: definition.range.start.line + 1,
                    character: definition.range.start.character
                };
            });
            return toolResult({
                ok: true,
                summary: `Found ${locations.length} definition location(s)`,
                data: { locations }
            }, format as ToolFormat, locations.map(location => `${location.file}:${location.line}:${location.character}`).join('\n'));
        }
    );

    server.tool(
        'rename_symbol',
        `Renames a symbol using VS Code language provider support.`,
        {
            path: z.string(),
            line: z.number().describe('1-based line number'),
            character: z.number().describe('0-based character offset'),
            newName: z.string(),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ path, line, character, newName, format = 'text' }): Promise<CallToolResult> => {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }
            const uri = vscode.Uri.file(require('path').resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, path));
            const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                'vscode.executeDocumentRenameProvider',
                uri,
                new vscode.Position(line - 1, character),
                newName
            );
            if (!edit) {
                throw new Error('Rename provider did not return edits');
            }
            const success = await vscode.workspace.applyEdit(edit);
            await vscode.workspace.saveAll(false);
            return toolResult({
                ok: success,
                summary: success ? `Renamed symbol to ${newName}` : 'Rename failed',
                data: { path, line, character, newName }
            }, format as ToolFormat);
        }
    );

    server.tool(
        'get_code_actions',
        `Gets available code actions for a file or range.`,
        {
            path: z.string(),
            startLine: z.number().optional().default(1),
            endLine: z.number().optional(),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ path, startLine = 1, endLine, format = 'text' }): Promise<CallToolResult> => {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }
            const uri = vscode.Uri.file(require('path').resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, path));
            const document = await vscode.workspace.openTextDocument(uri);
            const range = new vscode.Range(startLine - 1, 0, (endLine ?? startLine) - 1, document.lineAt((endLine ?? startLine) - 1).text.length);
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                'vscode.executeCodeActionProvider',
                uri,
                range
            ) || [];
            const data = actions.map((action, index) => ({ index, title: action.title, kind: action.kind?.value }));
            return toolResult({
                ok: true,
                summary: `Found ${data.length} code action(s)`,
                data
            }, format as ToolFormat, data.map(action => `${action.index}: ${action.title}${action.kind ? ` (${action.kind})` : ''}`).join('\n'));
        }
    );

    server.tool(
        'format_document',
        `Formats a document using VS Code format providers.`,
        {
            path: z.string(),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ path, format = 'text' }): Promise<CallToolResult> => {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }
            const uri = vscode.Uri.file(require('path').resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, path));
            const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
                'vscode.executeFormatDocumentProvider',
                uri,
                {}
            ) || [];
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(uri, edits);
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            await vscode.workspace.saveAll(false);
            return toolResult({
                ok: success,
                summary: success ? `Formatted ${path} with ${edits.length} edit(s)` : `Failed to format ${path}`,
                data: { path, edits: edits.length }
            }, format as ToolFormat);
        }
    );

    server.tool(
        'organize_imports',
        `Organizes imports for a document using VS Code code actions.`,
        {
            path: z.string(),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ path, format = 'text' }): Promise<CallToolResult> => {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }
            const uri = vscode.Uri.file(require('path').resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, path));
            await vscode.commands.executeCommand('editor.action.organizeImports', uri);
            await vscode.workspace.saveAll(false);
            return toolResult({
                ok: true,
                summary: `Organized imports for ${path}`,
                data: { path }
            }, format as ToolFormat);
        }
    );
}
