import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getWorkspaceRoot, resolveWorkspacePath, toolResult, ToolFormat } from './tool-utils';

interface ProcessSession {
    id: string;
    command: string;
    cwd: string;
    process: ChildProcessWithoutNullStreams;
    output: string[];
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    startedAt: number;
    lastReadIndex: number;
}

const sessions = new Map<string, ProcessSession>();
let nextSessionId = 1;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_OUTPUT = 20000;

function trimOutput(text: string, maxCharacters: number): { text: string; truncated: boolean } {
    if (text.length <= maxCharacters) {
        return { text, truncated: false };
    }
    return {
        text: text.slice(text.length - maxCharacters),
        truncated: true
    };
}

function createSession(command: string, cwd: string, timeout?: number): ProcessSession {
    const id = String(nextSessionId++);

    // ── Shell 检测 ──
    // PowerShell 原生支持 Unicode，直接执行即可。
    // cmd.exe 默认代码页为 GBK（中文系统），Node.js 的 toString() 以 UTF-8 解码会乱码，
    // 因此自动加上 chcp 65001 切换代码页为 UTF-8。
    const shellPath = vscode.env.shell || process.env.COMSPEC || 'cmd.exe';
    const isCmd = path.basename(shellPath).toLowerCase() === 'cmd.exe';

    const cmd = isCmd
        ? `chcp 65001 >nul && ${command}`                     // cmd → 切 UTF-8
        : `$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`;  // PowerShell → 设 UTF-8

    const child = spawn(cmd, {
        cwd,
        shell: shellPath,
        env: process.env
    });

    const session: ProcessSession = {
        id,
        command,
        cwd,
        process: child,
        output: [],
        startedAt: Date.now(),
        lastReadIndex: 0
    };

    child.stdout.on('data', (chunk: Buffer) => session.output.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => session.output.push(chunk.toString()));
    child.on('close', (code, signal) => {
        session.exitCode = code;
        session.signal = signal;
    });

    if (timeout && timeout > 0) {
        setTimeout(() => {
            if (session.exitCode === undefined) {
                child.kill();
            }
        }, timeout);
    }

    sessions.set(id, session);
    return session;
}

async function waitForSession(session: ProcessSession, timeout: number): Promise<void> {
    if (session.exitCode !== undefined) {
        return;
    }

    await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, timeout);
        session.process.once('close', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function getSessionOutput(session: ProcessSession, sinceLastRead: boolean, maxCharacters: number) {
    const chunks = sinceLastRead ? session.output.slice(session.lastReadIndex) : session.output;
    if (sinceLastRead) {
        session.lastReadIndex = session.output.length;
    }
    return trimOutput(chunks.join(''), maxCharacters);
}

export function registerShellTools(server: McpServer): void {
    server.tool(
        'execute_shell_command',
        `Executes a shell command. Short commands return a completed result; long-running commands return a sessionId for polling or stdin writes.`,
        {
            command: z.string().describe('The shell command to execute'),
            cwd: z.string().optional().default('.').describe('Working directory relative to the workspace root'),
            timeout: z.number().optional().default(DEFAULT_TIMEOUT_MS).describe('Milliseconds to wait before returning a session for ongoing commands'),
            maxOutputCharacters: z.number().optional().default(DEFAULT_MAX_OUTPUT).describe('Maximum output characters to return'),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ command, cwd = '.', timeout = DEFAULT_TIMEOUT_MS, maxOutputCharacters = DEFAULT_MAX_OUTPUT, format = 'text' }): Promise<CallToolResult> => {
            const start = Date.now();
            const workdir = cwd === '.' ? getWorkspaceRoot() : resolveWorkspacePath(cwd).fsPath;
            const session = createSession(command, workdir, 0);
            await waitForSession(session, timeout);

            const output = getSessionOutput(session, false, maxOutputCharacters);
            const running = session.exitCode === undefined;
            const data = {
                command,
                cwd: workdir,
                sessionId: running ? session.id : undefined,
                running,
                exitCode: session.exitCode,
                signal: session.signal,
                output: output.text,
                truncated: output.truncated
            };

            if (!running) {
                sessions.delete(session.id);
            }

            return toolResult({
                ok: !running && session.exitCode === 0,
                summary: running
                    ? `Command is still running in session ${session.id}`
                    : `Command exited with code ${session.exitCode}`,
                data,
                durationMs: Date.now() - start
            }, format as ToolFormat, `$ ${command}\n${output.truncated ? '[output truncated]\n' : ''}${output.text}${running ? `\n[session_id: ${session.id}]` : `\n[exit_code: ${session.exitCode}]`}`);
        }
    );

    server.tool(
        'read_process_output',
        `Reads output from a running shell session.`,
        {
            sessionId: z.string().describe('Session id returned by execute_shell_command or start_process'),
            sinceLastRead: z.boolean().optional().default(true).describe('Only return output not previously read'),
            maxOutputCharacters: z.number().optional().default(DEFAULT_MAX_OUTPUT),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ sessionId, sinceLastRead = true, maxOutputCharacters = DEFAULT_MAX_OUTPUT, format = 'text' }): Promise<CallToolResult> => {
            const session = sessions.get(sessionId);
            if (!session) {
                throw new Error(`Unknown process session: ${sessionId}`);
            }

            const output = getSessionOutput(session, sinceLastRead, maxOutputCharacters);
            const running = session.exitCode === undefined;
            const data = {
                sessionId,
                running,
                exitCode: session.exitCode,
                signal: session.signal,
                output: output.text,
                truncated: output.truncated
            };

            if (!running && sinceLastRead) {
                sessions.delete(sessionId);
            }

            return toolResult({
                ok: true,
                summary: running ? `Session ${sessionId} is still running` : `Session ${sessionId} exited with code ${session.exitCode}`,
                data
            }, format as ToolFormat, `${output.truncated ? '[output truncated]\n' : ''}${output.text}${running ? '' : `\n[exit_code: ${session.exitCode}]`}`);
        }
    );

    server.tool(
        'write_process_stdin',
        `Writes text to a running shell session stdin.`,
        {
            sessionId: z.string(),
            chars: z.string().describe('Characters to write to stdin'),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ sessionId, chars, format = 'text' }): Promise<CallToolResult> => {
            const session = sessions.get(sessionId);
            if (!session) {
                throw new Error(`Unknown process session: ${sessionId}`);
            }
            session.process.stdin.write(chars);
            return toolResult({
                ok: true,
                summary: `Wrote ${chars.length} characters to session ${sessionId}`,
                data: { sessionId, written: chars.length }
            }, format as ToolFormat);
        }
    );

    server.tool(
        'stop_process',
        `Stops a running shell session.`,
        {
            sessionId: z.string(),
            signal: z.string().optional().default('SIGTERM'),
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ sessionId, signal = 'SIGTERM', format = 'text' }): Promise<CallToolResult> => {
            const session = sessions.get(sessionId);
            if (!session) {
                throw new Error(`Unknown process session: ${sessionId}`);
            }
            session.process.kill(signal as NodeJS.Signals);
            return toolResult({
                ok: true,
                summary: `Sent ${signal} to session ${sessionId}`,
                data: { sessionId, signal }
            }, format as ToolFormat);
        }
    );

    server.tool(
        'list_processes',
        `Lists active shell sessions.`,
        {
            format: z.enum(['text', 'json']).optional().default('text')
        },
        async ({ format = 'text' }): Promise<CallToolResult> => {
            const data = Array.from(sessions.values()).map(session => ({
                sessionId: session.id,
                command: session.command,
                cwd: session.cwd,
                running: session.exitCode === undefined,
                exitCode: session.exitCode,
                startedAt: new Date(session.startedAt).toISOString()
            }));
            return toolResult({
                ok: true,
                summary: `${data.length} process session(s)`,
                data
            }, format as ToolFormat, JSON.stringify(data, null, 2));
        }
    );
}
