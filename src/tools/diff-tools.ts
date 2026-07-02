import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { detectLineEnding, resolveWorkspacePath, toolResult, ToolFormat } from './tool-utils';

// ============================================================
// Unified Diff 格式解析与应用
// 抄自 Continue (github.com/continuedev/continue)
// 核心文件: core/edit/lazy/unifiedDiffApply.ts
// ============================================================

export interface DiffLine {
  type: 'same' | 'new' | 'old';
  line: string;
}

interface Hunk {
  oldStart: number;  // 旧文件起始行号（从 @@ 头解析）
  oldCount: number;
  newStart: number;  // 新文件起始行号
  newCount: number;
  lines: string[];
}

/**
 * 检查字符串是否符合 unified diff 格式
 * 标准格式: @@ -n,m +n,m @@
 */
export function isUnifiedDiffFormat(diff: string): boolean {
  const lines = diff.trim().split("\n");

  if (lines.length < 3) {
    return false;
  }

  let hasHunkHeader = false;
  let hasValidContent = false;

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      // 忽略文件头
    } else if (line.match(/^@@ -\d+,?\d* \+\d+,?\d* @@/)) {
      hasHunkHeader = true;
    } else if (line.match(/^[+ -]/) || line === "") {
      hasValidContent = true;
    }
  }

  return hasHunkHeader && hasValidContent;
}

/**
 * 从 hunk 行中提取 "before" 部分（即删除行和上下文行）
 */
function extractBeforeLines(hunkLines: string[]): string[] {
  return hunkLines
    .filter((line) => line.startsWith("-") || !line.startsWith("+"))
    .map((line) => line.substring(1));
}

/**
 * 比较两行是否匹配（忽略行首空白）
 */
function linesMatch(a: string, b: string): boolean {
  return a === b;
}

/**
 * 在源码中搜索 hunk 的 "before" 块
 * @param sourceLines 源文件行数组
 * @param hunkBeforeLines hunk 的 before 部分（删除行 + 上下文行）
 * @param startIndex 搜索起始位置（上一个 hunk 结束处）
 * @param preferredStart 行号提示（从 @@ 头解析），优先在附近 ±20 行搜索
 */
function findHunkInSource(
  sourceLines: string[],
  hunkBeforeLines: string[],
  startIndex: number,
  preferredStart?: number,
): number {
  // 搜索范围：从 startIndex 到末尾
  const maxStart = sourceLines.length - hunkBeforeLines.length;
  if (maxStart < 0) return -1;

  // 先尝试在 preferredStart 附近 ±20 行范围内搜索
  if (preferredStart !== undefined) {
    const searchBegin = Math.max(startIndex, Math.max(0, preferredStart - 1 - 20));
    const searchEnd = Math.min(maxStart, preferredStart - 1 + 20);
    for (let i = searchBegin; i <= searchEnd; i++) {
      if (tryMatchAt(sourceLines, i, hunkBeforeLines)) return i;
    }
  }

  // 回退：从 startIndex 开始全文搜索
  for (let i = startIndex; i <= maxStart; i++) {
    if (tryMatchAt(sourceLines, i, hunkBeforeLines)) return i;
  }
  return -1;
}

/** 检查 sourceLines 中 i 位置是否匹配 hunkBeforeLines */
function tryMatchAt(sourceLines: string[], i: number, hunkBeforeLines: string[]): boolean {
  for (let j = 0; j < hunkBeforeLines.length; j++) {
    if (!linesMatch(sourceLines[i + j], hunkBeforeLines[j])) {
      return false;
    }
  }
  return true;
}

/**
 * 解析 unified diff 文本为 hunks 数组
 */
function parseUnifiedDiff(diffText: string): Hunk[] {
  const lines = diffText.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("@@")) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      // 解析 @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      currentHunk = {
        oldStart: match ? parseInt(match[1]) : 1,
        oldCount: match ? parseInt(match[2] || '1') : 1,
        newStart: match ? parseInt(match[3]) : 1,
        newCount: match ? parseInt(match[4] || '1') : 1,
        lines: []
      };
      continue;
    }
    currentHunk?.lines.push(line);
  }
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  return hunks;
}

/**
 * 应用 unified diff 到源码，返回 DiffLine 数组
 */
export function applyUnifiedDiff(
  sourceCode: string,
  unifiedDiffText: string,
): DiffLine[] {
  const sourceLines = sourceCode.split(/\r?\n/);
  const hunks = parseUnifiedDiff(unifiedDiffText);
  const diffResult: DiffLine[] = [];
  let currentPos = 0;

  for (const hunk of hunks) {
    const hunkBeforeLines = extractBeforeLines(hunk.lines);
    const hunkStart = findHunkInSource(sourceLines, hunkBeforeLines, currentPos, hunk.oldStart);
    
    if (hunkStart === -1) {
      throw new Error("Hunk could not be applied cleanly to source code.");
    }

    // 输出 hunk 之前的未修改行
    for (let i = currentPos; i < hunkStart; i++) {
      diffResult.push({ type: "same", line: sourceLines[i] });
    }

    let hunkSourcePos = hunkStart;

    for (const dline of hunk.lines) {
      const srcLine = sourceLines[hunkSourcePos];
      if (dline.startsWith("+")) {
        // 新增行
        diffResult.push({ type: "new", line: dline.substring(1) });
      } else if (dline.startsWith("-")) {
        // 删除行
        diffResult.push({ type: "old", line: srcLine });
        hunkSourcePos++;
      } else {
        // 上下文行
        diffResult.push({ type: "same", line: srcLine });
        hunkSourcePos++;
      }
    }
    currentPos = hunkSourcePos;
  }

  // 输出剩余未修改行
  for (let i = currentPos; i < sourceLines.length; i++) {
    diffResult.push({ type: "same", line: sourceLines[i] });
  }

  return diffResult;
}

/**
 * 将 DiffLine[] 应用为 VS Code 的 WorkspaceEdit
 */
export async function applyDiffToFile(
  workspacePath: string,
  diffLines: DiffLine[],
): Promise<number> {
  if (!vscode.workspace.workspaceFolders) {
    throw new Error('No workspace folder is open');
  }

  const workspaceFolder = vscode.workspace.workspaceFolders[0];
  const workspaceUri = workspaceFolder.uri;
  const fileUri = vscode.Uri.joinPath(workspaceUri, workspacePath);

  // 读取原文件以检测换行符风格，避免破坏 CRLF
  const originalDocument = await vscode.workspace.openTextDocument(fileUri);
  const originalText = originalDocument.getText();
  const lineEnding = detectLineEnding(originalText);

  // 从 diff 结果重建新文件内容（使用原文件换行符）
  const newContent = diffLines
    .filter((line) => line.type !== "old")
    .map((line) => line.line)
    .join(lineEnding);

  // 使用 WorkspaceEdit 写入文件
  const workspaceEdit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(0, 0, 999999, 999999);
  workspaceEdit.replace(fileUri, fullRange, newContent);

  const success = await vscode.workspace.applyEdit(workspaceEdit);

  if (!success) {
    throw new Error(`Failed to apply diff to file: ${workspacePath}`);
  }

  // 保存文件（复用已打开的文档）
  await originalDocument.save();

  // 计算统计
  const added = diffLines.filter((l) => l.type === "new").length;
  const removed = diffLines.filter((l) => l.type === "old").length;

  return added + removed;
}

/**
 * 生成 git style 的 diff 预览文本
 */
export function formatDiffPreview(
  workspacePath: string,
  diffLines: DiffLine[],
): string {
  const added = diffLines.filter((l) => l.type === "new").length;
  const removed = diffLines.filter((l) => l.type === "old").length;

  let result = `--- a/${workspacePath}\n+++ b/${workspacePath}\n`;
  result += `@@ -... +... @@ (${added} insertions, ${removed} deletions)\n\n`;

  let lineNum = 1;
  for (const dl of diffLines) {
    const prefix = dl.type === "new" ? "+" : dl.type === "old" ? "-" : " ";
    result += `${prefix}${dl.line}\n`;
    if (dl.type !== "new") {
      lineNum++;
    }
  }

  return result;
}

// ============================================================
// MCP 工具注册
// ============================================================

export function registerDiffTools(server: McpServer): void {
  // ---- apply_diff ----
  // 核心工具：通过 unified diff 格式精确编辑代码
  server.tool(
    'apply_diff',
    `通过 unified diff 格式精确编辑代码文件。

    这是推荐的代码编辑方式！AI 最擅长生成 unified diff 格式。

    格式要求 (标准 git diff 格式):
    \`\`\`
    @@ -旧起始行,旧行数 +新起始行,新行数 @@
    -要删除的原始行
    +要新增的新行
     上下文行（以空格开头）
    \`\`\`

    示例 - 将 "hello" 改为 "world":
    \`\`\`
    @@ -1,3 +1,3 @@
     const msg = "
    -hello
    +world
     ";
    \`\`\`

    注意事项:
    - ---/+++ 文件头可选
    - 上下文行（空格开头）用于定位，必须精确匹配
    - 所有 hunk 必须都能在源码中找到匹配`,
    {
      path: z.string().describe('要编辑的文件路径（相对工作区根目录）'),
      diff: z.string().describe('unified diff 格式的编辑内容'),
    },
    async ({ path, diff }): Promise<CallToolResult> => {
      console.log(`[apply_diff] Tool called with path=${path}`);

      try {
        // 1. 读取当前文件
        if (!vscode.workspace.workspaceFolders) {
          throw new Error('No workspace folder is open');
        }
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        const fileUri = vscode.Uri.joinPath(workspaceUri, path);

        const document = await vscode.workspace.openTextDocument(fileUri);
        const sourceCode = document.getText();

        // 2. 校验 diff 格式
        if (!isUnifiedDiffFormat(diff)) {
          throw new Error(
            'Invalid unified diff format. Expected format:\n' +
            '@@ -line,count +line,count @@\n' +
            ' context line\n' +
            '-removed line\n' +
            '+added line'
          );
        }

        // 3. 应用 diff
        const diffLines = applyUnifiedDiff(sourceCode, diff);

        // 4. 写回文件
        await applyDiffToFile(path, diffLines);

        // 5. 统计
        const added = diffLines.filter((l) => l.type === "new").length;
        const removed = diffLines.filter((l) => l.type === "old").length;

        const result: CallToolResult = {
          content: [
            {
              type: 'text',
              text: `✅ 成功应用 diff 到 ${path} (${added} 处新增, ${removed} 处删除)`
            }
          ]
        };
        console.log(`[apply_diff] Success: ${added} added, ${removed} removed`);
        return result;
      } catch (error) {
        console.error('[apply_diff] Error:', error);
        throw error;
      }
    }
  );

  // ---- edit_file ----
  // 基于文本匹配的精确编辑工具（类似 filesystem_edit_file）
  server.tool(
    'edit_file',
    `在文件中精确查找文本并替换。

    工作原理：在文件中查找 oldText，精确匹配后替换为 newText。
    不需要行号，不需要正则。

    适用场景：
    - 替换函数/变量名
    - 修改配置项
    - 替换固定的代码片段

    安全特性：
    - 唯一匹配检查：多次匹配直接报错，防止改错位置
    - 返回 diff 详情：Agent 可确认修改内容是否正确
    - 不支持模糊匹配，oldText 必须与原文完全一致
    - 不支持正则表达式（如需正则请用 apply_diff）`,
    {
      path: z.string().describe('要编辑的文件路径（相对工作区根目录）'),
      oldText: z.string().describe('要匹配的原文内容（精确匹配，区分大小写）'),
      newText: z.string().describe('替换后的新内容'),
    },
    async ({ path, oldText, newText }): Promise<CallToolResult> => {
      console.log(`[edit_file] Tool called with path=${path}`);

      try {
        if (!vscode.workspace.workspaceFolders) {
          throw new Error('No workspace folder is open');
        }
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        const fileUri = vscode.Uri.joinPath(workspaceUri, path);

        const document = await vscode.workspace.openTextDocument(fileUri);
        const fullText = document.getText();

        // 换行符归一化
        const lineEnding = detectLineEnding(fullText);
        const normalizedOldText = oldText.replace(/\r?\n/g, lineEnding);
        const normalizedNewText = newText.replace(/\r?\n/g, lineEnding);

        // 统计所有匹配位置
        const matchPositions: number[] = [];
        let searchFrom = 0;
        while (true) {
          const idx = fullText.indexOf(normalizedOldText, searchFrom);
          if (idx === -1) break;
          matchPositions.push(idx);
          searchFrom = idx + normalizedOldText.length;
        }

        const matchCount = matchPositions.length;

        if (matchCount === 0) {
          const preview = fullText.length > 200
            ? fullText.substring(0, 200) + '...'
            : fullText;
          throw new Error(
            `在 ${path} 中未找到匹配的文本。\n` +
            `要查找: "${normalizedOldText.substring(0, 100)}"\n` +
            `文件内容预览:\n${preview}`
          );
        }

        if (matchCount > 1) {
          // 列出所有匹配位置的行号
          const locationLines = matchPositions.map(idx => {
            const pos = document.positionAt(idx);
            const lineText = document.lineAt(pos.line).text;
            return `  第 ${pos.line + 1} 行: ${lineText.substring(0, 120)}`;
          }).join('\n');

          throw new Error(
            `编辑失败：oldText 在 ${path} 中出现了 ${matchCount} 次。\n\n` +
            `匹配位置:\n${locationLines}\n\n` +
            `请使用 apply_diff（通过行号+上下文精确定位），` +
            `或提供更长的 oldText 来唯一匹配目标位置。`
          );
        }

        // === 唯一匹配 ===
        const matchIndex = matchPositions[0];
        const matchStartPos = document.positionAt(matchIndex);
        const matchEndPos = document.positionAt(matchIndex + normalizedOldText.length);
        const matchRange = new vscode.Range(matchStartPos, matchEndPos);
        const lineNum = matchStartPos.line + 1; // 1-based

        // 计算 oldText 跨了多少行
        const oldStartLine = matchStartPos.line;
        const oldEndLine = matchEndPos.line;
        const oldLineCount = oldEndLine - oldStartLine + 1;

        // 提取上下文（前后各 3 行）
        const contextBefore = Math.min(3, oldStartLine);
        const contextAfter = Math.min(3, document.lineCount - oldEndLine - 1);

        // 构建 unified diff 输出
        const oldLines = normalizedOldText.split(lineEnding);
        const newLines = normalizedNewText.split(lineEnding);

        let diffOutput = `--- a/${path}\n+++ b/${path}\n`;
        diffOutput += `@@ -${oldStartLine + 1 - contextBefore},${contextBefore + oldLineCount + contextAfter} `;
        diffOutput += `+${oldStartLine + 1 - contextBefore},${contextBefore + newLines.length + contextAfter} @@\n`;

        // 上下文行（before）
        for (let i = 0; i < contextBefore; i++) {
          diffOutput += ` ${document.lineAt(oldStartLine - contextBefore + i).text}\n`;
        }
        // old lines（删除行）
        for (const l of oldLines) {
          diffOutput += `-${l}\n`;
        }
        // new lines（新增行）
        for (const l of newLines) {
          diffOutput += `+${l}\n`;
        }
        // 上下文行（after）
        for (let i = 0; i < contextAfter; i++) {
          diffOutput += ` ${document.lineAt(oldEndLine + 1 + i).text}\n`;
        }

        // 执行替换
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(fileUri, matchRange, normalizedNewText);
        const success = await vscode.workspace.applyEdit(workspaceEdit);

        if (!success) {
          throw new Error(`编辑失败: ${path}`);
        }

        await document.save();

        const result: CallToolResult = {
          content: [
            {
              type: 'text',
              text: `✅ 已编辑 ${path} (第 ${lineNum} 行, ${oldLines.length} 行↓ ${newLines.length} 行↑)\n\n${diffOutput}`
            }
          ]
        };
        console.log('[edit_file] Success with diff output');
        return result;
      } catch (error) {
        console.error('[edit_file] Error:', error);
        throw error;
      }
    }
  );

  // ---- preview_diff ----
  // 预览工具：在不修改文件的情况下预览 diff 效果
  server.tool(
    'preview_diff',
    `预览 unified diff 应用到文件的结果（只读，不修改文件）。

    在 apply_diff 之前使用，先确认 diff 效果是否正确。

    格式要求同 apply_diff。`,
    {
      path: z.string().describe('要预览的文件路径（相对工作区根目录）'),
      diff: z.string().describe('unified diff 格式的编辑内容'),
    },
    async ({ path, diff }): Promise<CallToolResult> => {
      console.log(`[preview_diff] Tool called with path=${path}`);

      try {
        if (!vscode.workspace.workspaceFolders) {
          throw new Error('No workspace folder is open');
        }
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspaceUri = workspaceFolder.uri;
        const fileUri = vscode.Uri.joinPath(workspaceUri, path);

        const document = await vscode.workspace.openTextDocument(fileUri);
        const sourceCode = document.getText();

        if (!isUnifiedDiffFormat(diff)) {
          throw new Error('Invalid unified diff format.');
        }

        const diffLines = applyUnifiedDiff(sourceCode, diff);

        const preview = formatDiffPreview(path, diffLines);
        const added = diffLines.filter((l) => l.type === "new").length;
        const removed = diffLines.filter((l) => l.type === "old").length;

        const result: CallToolResult = {
          content: [
            {
              type: 'text',
              text: `📋 预览 diff 应用到 ${path}\n${added} 处新增, ${removed} 处删除\n\n${preview}\n\n使用 apply_diff 应用此修改。`
            }
          ]
        };
        return result;
      } catch (error) {
        console.error('[preview_diff] Error:', error);
        throw error;
      }
    }
  );

  const patchOperationSchema = z.object({
    type: z.enum(['add', 'update', 'delete', 'move']),
    path: z.string().describe('File path relative to workspace root'),
    content: z.string().optional().describe('Content for add operations'),
    oldText: z.string().optional().describe('Exact text to replace for update operations'),
    newText: z.string().optional().describe('Replacement text for update operations'),
    targetPath: z.string().optional().describe('Target path for move operations'),
    overwrite: z.boolean().optional().default(false)
  });

  // ---- applySinglePatch (内部函数) ----
  async function applySinglePatch(operation: z.infer<typeof patchOperationSchema>): Promise<void> {
    const fileUri = resolveWorkspacePath(operation.path).uri;

    if (operation.type === 'add') {
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(fileUri, {
        overwrite: operation.overwrite,
        contents: new TextEncoder().encode(operation.content ?? '')
      });
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {throw new Error(`Failed to add file: ${operation.path}`);}
      await vscode.workspace.saveAll(false);
    } else if (operation.type === 'delete') {
      const edit = new vscode.WorkspaceEdit();
      edit.deleteFile(fileUri, { ignoreIfNotExists: false });
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {throw new Error(`Failed to delete file: ${operation.path}`);}
      await vscode.workspace.saveAll(false);
    } else if (operation.type === 'move') {
      if (!operation.targetPath) {throw new Error(`move requires targetPath`);}
      const edit = new vscode.WorkspaceEdit();
      edit.renameFile(fileUri, resolveWorkspacePath(operation.targetPath).uri, { overwrite: operation.overwrite });
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {throw new Error(`Failed to move file: ${operation.path}`);}
      await vscode.workspace.saveAll(false);
    } else {
      if (operation.oldText === undefined || operation.newText === undefined)
        {throw new Error(`update requires oldText and newText`);}
      const document = await vscode.workspace.openTextDocument(fileUri);
      const fullText = document.getText();
      const lineEnding = detectLineEnding(fullText);
      const normalizedOldText = operation.oldText.replace(/\r?\n/g, lineEnding);
      const normalizedNewText = operation.newText.replace(/\r?\n/g, lineEnding);
      const index = fullText.indexOf(normalizedOldText);
      if (index === -1) {throw new Error(`oldText not found in ${operation.path}`);}
      const edit = new vscode.WorkspaceEdit();
      edit.replace(fileUri,
        new vscode.Range(document.positionAt(index), document.positionAt(index + normalizedOldText.length)),
        normalizedNewText
      );
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {throw new Error(`Failed to update file: ${operation.path}`);}
      await document.save();
    }
  }

  // ---- apply_patch (单操作) ----
  server.tool(
    'apply_patch',
    `对单个文件执行一次 patch 操作（add/update/delete/move）。参数已展平，直接传递 type/path/content 等字段即可。`,
    {
      type: z.enum(['add', 'update', 'delete', 'move']),
      path: z.string().describe('File path relative to workspace root'),
      content: z.string().optional().describe('Content for add operations'),
      oldText: z.string().optional().describe('Exact text to replace for update operations'),
      newText: z.string().optional().describe('Replacement text for update operations'),
      targetPath: z.string().optional().describe('Target path for move operations'),
      overwrite: z.boolean().optional().default(false),
      format: z.enum(['text', 'json']).optional().default('text')
    },
    async ({ type, path, content, oldText, newText, targetPath, overwrite = false, format = 'text' }): Promise<CallToolResult> => {
      const operation = { type, path, content, oldText, newText, targetPath, overwrite };
      console.log(`[apply_patch] type=${operation.type} path=${operation.path}`);
      try {
        await applySinglePatch(operation);
        return toolResult({
          ok: true,
          summary: `Applied ${operation.type} on ${operation.path}`,
          data: { operation }
        }, format as ToolFormat);
      } catch (error) {
        console.error('[apply_patch] Error:', error);
        throw error;
      }
    }
  );

  async function previewPatchOperations(operations: z.infer<typeof patchOperationSchema>[]) {
    const previews: Array<{ type: string; path: string; targetPath?: string; summary: string }> = [];
    for (const operation of operations) {
      if (operation.type === 'add') {
        previews.push({
          type: operation.type,
          path: operation.path,
          summary: `add ${operation.path} (${operation.content?.length ?? 0} characters)`
        });
      } else if (operation.type === 'delete') {
        previews.push({ type: operation.type, path: operation.path, summary: `delete ${operation.path}` });
      } else if (operation.type === 'move') {
        previews.push({
          type: operation.type,
          path: operation.path,
          targetPath: operation.targetPath,
          summary: `move ${operation.path} -> ${operation.targetPath}`
        });
      } else {
        const fileUri = resolveWorkspacePath(operation.path).uri;
        const document = await vscode.workspace.openTextDocument(fileUri);
        const fullText = document.getText();
        if (operation.oldText === undefined || operation.newText === undefined) {
          throw new Error(`update operation for ${operation.path} requires oldText and newText`);
        }
        const count = fullText.split(operation.oldText).length - 1;
        previews.push({
          type: operation.type,
          path: operation.path,
          summary: `update ${operation.path}: ${count} match(es), ${operation.oldText.length} -> ${operation.newText.length} characters`
        });
      }
    }
    return previews;
  }

  server.tool(
    'preview_patch',
    `Previews a structured multi-file patch without modifying files.`,
    {
      operations: z.array(patchOperationSchema),
      format: z.enum(['text', 'json']).optional().default('text')
    },
    async ({ operations, format = 'text' }): Promise<CallToolResult> => {
      const previews = await previewPatchOperations(operations);
      return toolResult({
        ok: true,
        summary: `Previewed ${previews.length} patch operation(s)`,
        data: { operations: previews }
      }, format as ToolFormat, previews.map(preview => preview.summary).join('\n'));
    }
  );

  server.tool(
    'apply_patches',
    `Applies a structured multi-file patch (batch operations). Supports add, update, delete, and move operations.`,
    {
      operations: z.array(patchOperationSchema),
      format: z.enum(['text', 'json']).optional().default('text')
    },
    async ({ operations, format = 'text' }): Promise<CallToolResult> => {
      console.log(`[apply_patches] Tool called with ${operations.length} operations`);

      try {
        for (const operation of operations) {
          await applySinglePatch(operation);
        }

        return toolResult({
          ok: true,
          summary: `Applied ${operations.length} patch operation(s)`,
          data: { operations }
        }, format as ToolFormat);
      } catch (error) {
        console.error('[apply_patches] Error:', error);
        throw error;
      }
    }
  );
}
