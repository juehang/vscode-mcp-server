import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'crypto';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolFormat = 'text' | 'json';

export interface ToolResponse<T = unknown> {
    ok: boolean;
    summary: string;
    data?: T;
    warnings?: string[];
    durationMs?: number;
}

export function toolResult<T>(
    response: ToolResponse<T>,
    format: ToolFormat = 'text',
    text?: string
): CallToolResult {
    return {
        content: [{
            type: 'text',
            text: format === 'json' ? JSON.stringify(response, null, 2) : (text ?? response.summary)
        }]
    };
}

export function getWorkspaceFolder(): vscode.WorkspaceFolder {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
    }
    return workspaceFolder;
}

export function getWorkspaceRoot(): string {
    return getWorkspaceFolder().uri.fsPath;
}

export function resolveWorkspacePath(workspacePath: string = '.'): { uri: vscode.Uri; fsPath: string; relativePath: string } {
    const workspaceRoot = getWorkspaceRoot();
    const normalizedPath = workspacePath || '.';
    const resolvedPath = path.resolve(workspaceRoot, normalizedPath);
    const relativePath = path.relative(workspaceRoot, resolvedPath) || '.';

    return {
        uri: vscode.Uri.file(resolvedPath),
        fsPath: resolvedPath,
        relativePath
    };
}

export function uriToWorkspacePath(uri: vscode.Uri): string {
    const workspaceRoot = getWorkspaceRoot();
    return path.relative(workspaceRoot, uri.fsPath) || '.';
}

export async function readTextFile(uri: vscode.Uri, encoding: string = 'utf-8'): Promise<string> {
    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder(encoding).decode(content);
}

export async function fileHash(uri: vscode.Uri): Promise<string> {
    const content = await vscode.workspace.fs.readFile(uri);
    return createHash('sha256').update(Buffer.from(content)).digest('hex');
}

export function detectLineEnding(text: string): string {
    return text.includes('\r\n') ? '\r\n' : '\n';
}
