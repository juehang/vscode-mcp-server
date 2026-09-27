import express from "express";
import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from 'http';
import { Request, Response } from 'express';
import { registerFileTools, FileListingCallback } from './tools/file-tools';
import { registerEditTools } from './tools/edit-tools';
import { registerShellTools } from './tools/shell-tools';
import { registerDiagnosticsTools } from './tools/diagnostics-tools';
import { registerSymbolTools } from './tools/symbol-tools';
import { logger } from './utils/logger';

export interface ToolConfiguration {
    file: boolean;
    edit: boolean;
    shell: boolean;
    diagnostics: boolean;
    symbol: boolean;
}

export class MCPServer {
    private toolsReady = false;
    private app: express.Application;
    private httpServer?: Server;
    private port: number;
    private host: string;
    private fileListingCallback?: FileListingCallback;
    private terminal?: vscode.Terminal;
    private toolConfig: ToolConfiguration;

    public setFileListingCallback(callback: FileListingCallback) {
        this.fileListingCallback = callback;
    }

    constructor(port: number = 3000, host: string = '127.0.0.1', terminal?: vscode.Terminal, toolConfig?: ToolConfiguration) {
        this.port = port;
        this.host = host;
        this.terminal = terminal;
        this.toolConfig = toolConfig || {
            file: true,
            edit: true,
            shell: true,
            diagnostics: true,
            symbol: true
        };
        this.app = express();
        this.app.use(express.json());

        // Note: setupTools() is no longer called here
        this.setupRoutes();
        this.setupEventHandlers();
    }
    
    public setupTools(): void {
        if (this.fileListingCallback) {
            logger.info(`Setting up MCP tools with configuration: ${JSON.stringify(this.toolConfig)}`);
            this.toolsReady = true;
        } else {
            logger.warn('File listing callback not set during tools setup');
        }
    }

    // In stateless mode the SDK requires a fresh server + transport per request
    private createServer(): McpServer {
        const server = new McpServer({
            name: "vscode-mcp-server",
            version: "1.0.0",
        }, {
            capabilities: {
                logging: {},
                tools: {
                    listChanged: false
                }
            }
        });
        if (!this.toolsReady || !this.fileListingCallback) {
            return server;
        }
        if (this.toolConfig.file) {
            registerFileTools(server, this.fileListingCallback);
        }
        if (this.toolConfig.edit) {
            registerEditTools(server);
        }
        if (this.toolConfig.shell) {
            registerShellTools(server, this.terminal);
        }
        if (this.toolConfig.diagnostics) {
            registerDiagnosticsTools(server);
        }
        if (this.toolConfig.symbol) {
            registerSymbolTools(server);
        }
        return server;
    }

    private async handleMcpRequest(req: Request, res: Response, body: unknown): Promise<void> {
        try {
            const server = this.createServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });
            res.on('close', () => {
                transport.close();
                server.close();
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (error) {
            logger.error(`Error handling MCP request: ${error instanceof Error ? error.message : String(error)}`);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    }

    private setupRoutes(): void {
        // Handle POST requests for client-to-server communication
        this.app.post('/mcp', async (req, res) => {
            logger.info(`Request received: ${req.method} ${req.url}`);
            await this.handleMcpRequest(req, res, req.body);
        });

        // Handle SSE endpoint for server-to-client streaming
        this.app.get('/mcp/sse', async (req, res) => {
            logger.info('Received SSE connection request');
            await this.handleMcpRequest(req, res, undefined);
        });

        // Handle unsupported methods
        this.app.get('/mcp', async (req, res) => {
            logger.info('Received GET MCP request');
            res.writeHead(405).end(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Method not allowed."
                },
                id: null
            }));
        });

        this.app.delete('/mcp', async (req, res) => {
            logger.info('Received DELETE MCP request');
            res.writeHead(405).end(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Method not allowed."
                },
                id: null
            }));
        });

        // Handle OPTIONS requests for CORS
        this.app.options('/mcp', (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
            res.status(204).end();
        });
    }

    private setupEventHandlers(): void {
        // Log HTTP server events
        if (this.httpServer) {
            this.httpServer.on('error', (error: Error) => {
                logger.error(`[Server] HTTP Server Error: ${error.message}`);
            });

            this.httpServer.on('listening', () => {
                logger.info(`[Server] HTTP Server ready`);
            });

            this.httpServer.on('close', () => {
                logger.info(`[Server] HTTP Server closed`);
            });
        }
    }

    public async start(): Promise<void> {
        try {
            logger.info('[MCPServer.start] Starting MCP server');
            const startTime = Date.now();

            // Start HTTP server
            logger.info('[MCPServer.start] Starting HTTP server');
            const httpServerStartTime = Date.now();
            
            return new Promise((resolve) => {
                // Bind to localhost only for security
                this.httpServer = this.app.listen(this.port, this.host, () => {
                    const httpStartTime = Date.now() - httpServerStartTime;
                    logger.info(`[MCPServer.start] HTTP Server started (took ${httpStartTime}ms)`);
                    logger.info(`MCP Server listening on ${this.host}:${this.port}`);
                    
                    const totalTime = Date.now() - startTime;
                    logger.info(`[MCPServer.start] Server startup complete (total: ${totalTime}ms)`);
                    
                    resolve();
                });
            });
        } catch (error) {
            logger.error(`[MCPServer.start] Failed to start MCP Server: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    public async stop(forceTimeout: number = 5000): Promise<void> {
        logger.info('[MCPServer.stop] Starting server shutdown process');
        const stopStartTime = Date.now();
        
        try {
            // Close HTTP server with timeout
            if (this.httpServer) {
                logger.info('[MCPServer.stop] Closing HTTP server (with timeout)');
                const httpServerCloseStart = Date.now();
                
                await Promise.race([
                    // Normal close operation
                    new Promise<void>((resolve, reject) => {
                        this.httpServer!.close((err) => {
                            const httpCloseTime = Date.now() - httpServerCloseStart;
                            if (err) {
                                logger.error(`[MCPServer.stop] HTTP server closed with error: ${err.message} (took ${httpCloseTime}ms)`);
                                reject(err);
                            } else {
                                logger.info(`[MCPServer.stop] HTTP server closed successfully (took ${httpCloseTime}ms)`);
                                resolve();
                            }
                        });
                    }),
                    
                    // Timeout fallback
                    new Promise<void>((resolve) => {
                        setTimeout(() => {
                            logger.warn(`[MCPServer.stop] HTTP server close timed out after ${forceTimeout}ms - forcing close`);
                            // We resolve anyway to continue with the shutdown process
                            resolve();
                        }, forceTimeout);
                    })
                ]);
            }

            const totalStopTime = Date.now() - stopStartTime;
            logger.info(`[MCPServer.stop] MCP Server shutdown complete (total: ${totalStopTime}ms)`);
        } catch (error) {
            logger.error(`[MCPServer.stop] Error during server shutdown: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}