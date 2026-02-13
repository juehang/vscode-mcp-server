import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolves a path to a VS Code URI.
 * If the path is absolute, uses it directly.
 * If relative, joins it with the first workspace folder.
 * @param inputPath The path to resolve
 * @returns The resolved URI
 * @throws Error if no workspace folder is open and path is relative
 */
export function resolvePathToUri(inputPath: string): vscode.Uri {
    // Check if path is absolute (Unix or Windows)
    if (path.isAbsolute(inputPath)) {
        return vscode.Uri.file(inputPath);
    }

    // Relative path - join with workspace
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    return vscode.Uri.joinPath(workspaceFolder.uri, inputPath);
}
