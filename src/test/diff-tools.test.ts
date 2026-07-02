import * as assert from 'assert';
import { isUnifiedDiffFormat, applyUnifiedDiff, formatDiffPreview, DiffLine } from '../tools/diff-tools';

suite('Diff Tools Test Suite', () => {

    test('isUnifiedDiffFormat - 标准 diff 格式应该通过', () => {
        const diff = [
            '@@ -1,3 +1,3 @@',
            ' const msg = "',
            '-hello',
            '+world',
            ' "',
        ].join('\n');
        assert.strictEqual(isUnifiedDiffFormat(diff), true);
    });

    test('isUnifiedDiffFormat - 没有 hunk 头的应该失败', () => {
        const diff = [
            '-old line',
            '+new line',
        ].join('\n');
        assert.strictEqual(isUnifiedDiffFormat(diff), false);
    });

    test('isUnifiedDiffFormat - 空字符串应该失败', () => {
        assert.strictEqual(isUnifiedDiffFormat(''), false);
    });

    test('isUnifiedDiffFormat - 带 ---/+++ 文件头的 diff 应该通过', () => {
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

    test('applyUnifiedDiff - 简单的替换', () => {
        const source = [
            'line1',
            'line2',
            'line3',
        ].join('\n');
        const diff = [
            '@@ -2,2 +2,2 @@',
            ' line1',
            '-line2',
            '+line2_modified',
            ' line3',
        ].join('\n');

        const result = applyUnifiedDiff(source, diff);
        const expected: DiffLine[] = [
            { type: 'same', line: 'line1' },
            { type: 'old',  line: 'line2' },
            { type: 'new',  line: 'line2_modified' },
            { type: 'same', line: 'line3' },
        ];
        assert.deepStrictEqual(result, expected);
    });

    test('applyUnifiedDiff - 新增行', () => {
        const source = [
            'line1',
            'line3',
        ].join('\n');
        const diff = [
            '@@ -1,2 +1,3 @@',
            ' line1',
            '+line2',
            ' line3',
        ].join('\n');

        const result = applyUnifiedDiff(source, diff);
        const expected: DiffLine[] = [
            { type: 'same', line: 'line1' },
            { type: 'new',  line: 'line2' },
            { type: 'same', line: 'line3' },
        ];
        assert.deepStrictEqual(result, expected);
    });

    test('applyUnifiedDiff - 删除行', () => {
        const source = [
            'line1',
            'line2',
            'line3',
        ].join('\n');
        const diff = [
            '@@ -1,3 +1,2 @@',
            ' line1',
            '-line2',
            ' line3',
        ].join('\n');

        const result = applyUnifiedDiff(source, diff);
        const expected: DiffLine[] = [
            { type: 'same', line: 'line1' },
            { type: 'old',  line: 'line2' },
            { type: 'same', line: 'line3' },
        ];
        assert.deepStrictEqual(result, expected);
    });

    test('applyUnifiedDiff - 多 hunk', () => {
        const source = [
            'lineA',
            'lineB',
            'lineC',
            'lineD',
            'lineE',
        ].join('\n');
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
        const expected: DiffLine[] = [
            { type: 'old',  line: 'lineA' },
            { type: 'new',  line: 'lineA_modified' },
            { type: 'same', line: 'lineB' },
            { type: 'same', line: 'lineC' },
            { type: 'same', line: 'lineD' },
            { type: 'old',  line: 'lineE' },
            { type: 'new',  line: 'lineE_modified' },
        ];
        assert.deepStrictEqual(result, expected);
    });

    test('applyUnifiedDiff - CRLF 源码也能正确处理', () => {
        const source = 'line1\r\nline2\r\nline3';
        const diff = [
            '@@ -1,3 +1,3 @@',
            ' line1',
            '-line2',
            '+line2_new',
            ' line3',
        ].join('\n');

        const result = applyUnifiedDiff(source, diff);
        const expected: DiffLine[] = [
            { type: 'same', line: 'line1' },
            { type: 'old',  line: 'line2' },
            { type: 'new',  line: 'line2_new' },
            { type: 'same', line: 'line3' },
        ];
        assert.deepStrictEqual(result, expected);
    });

    test('applyUnifiedDiff - hunk 匹配不到应抛异常', () => {
        const source = 'aaa\nbbb\nccc';
        const diff = [
            '@@ -1,3 +1,3 @@',
            ' xxx',
            '-yyy',
            '+zzz',
            ' www',
        ].join('\n');

        assert.throws(() => {
            applyUnifiedDiff(source, diff);
        }, /Hunk could not be applied/);
    });

    test('formatDiffPreview - 应包含插入和删除统计', () => {
        const diffLines: DiffLine[] = [
            { type: 'same', line: 'line1' },
            { type: 'old',  line: 'line2' },
            { type: 'new',  line: 'line2_new' },
        ];
        const preview = formatDiffPreview('test.ts', diffLines);
        assert.ok(preview.includes('--- a/test.ts'));
        assert.ok(preview.includes('+++ b/test.ts'));
        assert.ok(preview.includes('1 insertions'));
        assert.ok(preview.includes('1 deletions'));
        assert.ok(preview.includes(' line1'));
        assert.ok(preview.includes('-line2'));
        assert.ok(preview.includes('+line2_new'));
    });
});
