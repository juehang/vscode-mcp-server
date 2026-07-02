import * as vscode from 'vscode';

// This file provides test mocks for the extension
export class MockMCPServer {
    private port: number;
    private fileListingCallback?: (path: string, recursive: boolean) => Promise<Array<{path: string, type: 'file' | 'directory'}>>;

    constructor(port: number = 3000) {
        this.port = port;
    }

    public setFileListingCallback(callback: (path: string, recursive: boolean) => Promise<Array<{path: string, type: 'file' | 'directory'}>>) {
        this.fileListingCallback = callback;
    }

    public async start(): Promise<void> {
        // Mock implementation
        return Promise.resolve();
    }

    public async stop(): Promise<void> {
        // Mock implementation
        return Promise.resolve();
    }
}

export function getMCPServerMock() {
    return MockMCPServer;
}

// Create a partial type to allow partial implementation of ExtensionContext
type PartialExtensionContext = Partial<vscode.ExtensionContext> & {
    subscriptions: { dispose(): any }[];
    workspaceState: vscode.Memento;
    globalState: vscode.Memento & { setKeysForSync(keys: readonly string[]): void };
    extensionUri: vscode.Uri;
    extensionPath: string;
    asAbsolutePath(relativePath: string): string;
    logUri: vscode.Uri;
};

export function createMockContext(): PartialExtensionContext {
    // Create an event emitter with the correct type for SecretStorageChangeEvent
    const secretStorageChangeEmitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    
    // Create a partial implementation with just the properties we need
    const context: PartialExtensionContext = {
        subscriptions: [],
        workspaceState: {
            get: (_key: string, defaultValue?: any) => defaultValue,
            update: () => Promise.resolve(),
            keys: () => []
        },
        globalState: {
            get: (_key: string, defaultValue?: any) => defaultValue,
            update: () => Promise.resolve(),
            setKeysForSync: () => {},
            keys: () => []
        },
        extensionUri: vscode.Uri.file(''),
        extensionPath: '',
        asAbsolutePath: (relativePath: string) => relativePath,
        storageUri: undefined,
        globalStorageUri: vscode.Uri.file(''),
        logUri: vscode.Uri.file(''),
        extensionMode: vscode.ExtensionMode.Test,
        logPath: '',
        secrets: {
            get: () => Promise.resolve(undefined),
            store: () => Promise.resolve(),
            delete: () => Promise.resolve(),
            onDidChange: secretStorageChangeEmitter.event
        }
    };
    
    return context;
}
