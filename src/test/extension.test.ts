import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as proxyquireLib from 'proxyquire';
import { createMockContext } from './testUtils';

// Configure proxyquire
const proxyquire = proxyquireLib.noPreserveCache().noCallThru();

suite('Extension Test Suite', () => {
    let mockMCPServer: any;
    let MockServerConstructor: sinon.SinonStub;
    let extension: any;
    let workspaceConfig: any;
    let statusBarItem: any;
    let context: any; // Changed type to any to avoid type errors
    let getConfigurationStub: sinon.SinonStub;
    let createStatusBarItemStub: sinon.SinonStub;
    let registerCommandStub: sinon.SinonStub;
    let onDidChangeConfigurationStub: sinon.SinonStub;

    setup(() => {
        // Create mock MCPServer
        mockMCPServer = {
            start: sinon.stub().resolves(),
            stop: sinon.stub().resolves(),
            setFileListingCallback: sinon.spy(),
            setupTools: sinon.spy()
        };
        
        // Mock constructor for MCPServer
        MockServerConstructor = sinon.stub().returns(mockMCPServer);
        
        // Load extension with mocked dependencies
        extension = proxyquire('../extension', {
            './server': { MCPServer: MockServerConstructor }
        });
        
        // Create mock status bar item
        statusBarItem = {
            text: '',
            tooltip: '',
            command: '',
            show: sinon.spy(),
            dispose: sinon.spy()
        };
        
        // Mock vscode.window.createStatusBarItem
        createStatusBarItemStub = sinon.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem);
        
        // Mock configuration
        workspaceConfig = {
            get: sinon.stub().callsFake((key: string) => {
                if (key === 'port') {
                    return 4321;
                }
                if (key === 'host') {
                    return '127.0.0.1';
                }
                if (key === 'defaultEnabled') {
                    return true;
                }
                if (key === 'enabledTools') {
                    return {};
                }
                return undefined;
            })
        };
        getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(workspaceConfig);
        
        // Create a mocked extension context
        context = createMockContext();
        
        // Mock command registration
        registerCommandStub = sinon.stub(vscode.commands, 'registerCommand').returns({
            dispose: sinon.spy()
        });
        
        // Mock onDidChangeConfiguration
        onDidChangeConfigurationStub = sinon.stub(vscode.workspace, 'onDidChangeConfiguration').returns({
            dispose: sinon.spy()
        });
    });

    teardown(() => {
        // Restore all sinon stubs and mocks after each test
        sinon.restore();
    });

    test('Extension should read port from configuration', async () => {
        // Activate the extension
        await extension.activate(context);
        
        // Check that configuration was accessed
        assert.strictEqual(getConfigurationStub.called, true, 'Configuration not accessed');
        assert.strictEqual(workspaceConfig.get.calledWith('port'), true, 'Port not read from configuration');
        
        // Check that MCPServer was created with configured port
        assert.strictEqual(MockServerConstructor.calledWith(4321), true, 'MCPServer not created with configured port');
    });

    test('Status bar item should be created with proper attributes', async () => {
        // Activate the extension
        await extension.activate(context);
        
        // Verify status bar was created
        assert.strictEqual(createStatusBarItemStub.called, true, 'Status bar item not created');
        
        // Check the status bar attributes
        assert.strictEqual(statusBarItem.command, 'vscode-mcp-server.toggleServer', 'Status bar command not set correctly');
        assert.strictEqual(statusBarItem.show.called, true, 'Status bar not shown');
        
        // Check that the text contains the port number
        assert.strictEqual(statusBarItem.text.includes('4321'), true, 'Status bar does not show configured port');
    });

    test('Server info command should be registered', async () => {
        // Activate the extension
        await extension.activate(context);
        
        // Check that the command was registered
        const showServerInfoCall = registerCommandStub.getCalls().find(
            call => call.args[0] === 'vscode-mcp-server.showServerInfo'
        );
        assert.strictEqual(showServerInfoCall !== undefined, true, 'Server info command not registered');
    });

    test('Configuration change listener should be registered', async () => {
        // Activate the extension  
        await extension.activate(context);
        
        // Check that the listener was registered
        assert.strictEqual(onDidChangeConfigurationStub.called, true, 'Configuration change listener not registered');
    });

    test('Deactivate should clean up resources', async () => {
        // First activate to set up resources
        await extension.activate(context);
        
        // Then deactivate
        await extension.deactivate();
        
        // Check that status bar was disposed
        assert.strictEqual(statusBarItem.dispose.called, true, 'Status bar not disposed during deactivation');
        
        // Check that server was stopped
        assert.strictEqual(mockMCPServer.stop.called, true, 'Server not stopped during deactivation');
    });
});
