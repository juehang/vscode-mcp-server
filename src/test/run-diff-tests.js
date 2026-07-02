/**
 * 手动测试 diff-tools.ts 中的纯函数
 * 不依赖 VS Code API，只测试逻辑函数
 */
const assert = require('assert');

// 直接从编译后的 JS 中导入纯函数
const { isUnifiedDiffFormat, applyUnifiedDiff, formatDiffPreview } = require('../../out/tools/diff-tools');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

console.log('\n📋 isUnifiedDiffFormat 测试\n');

test('标准 diff 格式应该通过', () => {
    const diff = [
        '@@ -1,3 +1,3 @@',
        ' const msg = "',
        '-hello',
        '+world',
        ' "',
    ].join('\n');
    assert.strictEqual(isUnifiedDiffFormat(diff), true);
});

test('没有 hunk 头的应该失败', () => {
    const diff = [
        '-old line',
        '+new line',
    ].join('\n');
    assert.strictEqual(isUnifiedDiffFormat(diff), false);
});

test('空字符串应该失败', () => {
    assert.strictEqual(isUnifiedDiffFormat(''), false);
});

test('带 ---/+++ 文件头的 diff 应该通过', () => {
    const diff = [
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -10,7 +10,7 @@',
        ' line1',
        ' line2',
        '-old',
        '+new',
        ' line4',
    ].join('\n');
    assert.strictEqual(isUnifiedDiffFormat(diff), true);
});

console.log('\n📋 applyUnifiedDiff 测试\n');

test('简单的替换', () => {
    const source = ['line1', 'line2', 'line3'].join('\n');
    const diff = [
        '@@ -2,2 +2,2 @@',
        ' line1',
        '-line2',
        '+line2_modified',
        ' line3',
    ].join('\n');
    const result = applyUnifiedDiff(source, diff);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0].type, 'same');
    assert.strictEqual(result[0].line, 'line1');
    assert.strictEqual(result[1].type, 'old');
    assert.strictEqual(result[1].line, 'line2');
    assert.strictEqual(result[2].type, 'new');
    assert.strictEqual(result[2].line, 'line2_modified');
    assert.strictEqual(result[3].type, 'same');
    assert.strictEqual(result[3].line, 'line3');
});

test('新增行', () => {
    const source = ['line1', 'line3'].join('\n');
    const diff = [
        '@@ -1,2 +1,3 @@',
        ' line1',
        '+line2',
        ' line3',
    ].join('\n');
    const result = applyUnifiedDiff(source, diff);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].type, 'new');
    assert.strictEqual(result[1].line, 'line2');
});

test('删除行', () => {
    const source = ['line1', 'line2', 'line3'].join('\n');
    const diff = [
        '@@ -1,3 +1,2 @@',
        ' line1',
        '-line2',
        ' line3',
    ].join('\n');
    const result = applyUnifiedDiff(source, diff);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].type, 'old');
});

test('多 hunk', () => {
    const source = ['lineA', 'lineB', 'lineC', 'lineD', 'lineE'].join('\n');
    const diff = [
        '@@ -1,2 +1,2 @@',
        '-lineA',
        '+lineA_modified',
        ' lineB',
        '@@ -4,2 +4,2 @@',
        ' lineD',
        '-lineE',
        '+lineE_modified',
    ].join('\n');
    const result = applyUnifiedDiff(source, diff);
    assert.strictEqual(result.length, 7);
});

test('CRLF 源码也能正确处理', () => {
    const source = 'line1\r\nline2\r\nline3';
    const diff = [
        '@@ -1,3 +1,3 @@',
        ' line1',
        '-line2',
        '+line2_new',
        ' line3',
    ].join('\n');
    const result = applyUnifiedDiff(source, diff);
    assert.strictEqual(result[1].line, 'line2');
    assert.strictEqual(result[2].line, 'line2_new');
});

test('hunk 匹配不到应抛异常', () => {
    const source = 'aaa\nbbb\nccc';
    const diff = [
        '@@ -1,3 +1,3 @@',
        ' xxx',
        '-yyy',
        '+zzz',
        ' www',
    ].join('\n');
    assert.throws(() => applyUnifiedDiff(source, diff), /Hunk could not be applied/);
});

console.log('\n📋 formatDiffPreview 测试\n');

test('应包含插入和删除统计', () => {
    const diffLines = [
        { type: 'same', line: 'line1' },
        { type: 'old', line: 'line2' },
        { type: 'new', line: 'line2_new' },
    ];
    const preview = formatDiffPreview('test.ts', diffLines);
    assert.ok(preview.includes('--- a/test.ts'));
    assert.ok(preview.includes('+++ b/test.ts'));
    assert.ok(preview.includes('1 insertions'));
    assert.ok(preview.includes('1 deletions'));
});

console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 个测试\n`);
process.exit(failed > 0 ? 1 : 0);
