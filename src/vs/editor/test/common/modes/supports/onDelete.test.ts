/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OnDeleteRule } from '../../../../common/languages/languageConfiguration.js';
import { ResolvedLanguageConfiguration } from '../../../../common/languages/languageConfigurationRegistry.js';

suite('OnDelete', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function createSupport(onDeleteRules?: OnDeleteRule[]) {
		const config = new ResolvedLanguageConfiguration('test', { onDeleteRules });
		return { getTextToStrip: (currentLineText: string, nextLineText: string) => config.getOnDeleteTextToStrip(currentLineText, nextLineText) };
	}

	test('no rules strips nothing', () => {
		const support = createSupport();
		assert.strictEqual(support.getTextToStrip('/// a', '/// b'), 0);
	});

	test('afterText match is stripped', () => {
		const support = createSupport([{ afterText: /^\s*\/\/\// }]);
		assert.strictEqual(support.getTextToStrip('/// a', '/// b'), 3);
		assert.strictEqual(support.getTextToStrip('/// a', '  /// b'), 5);
		assert.strictEqual(support.getTextToStrip('/// a', 'b'), 0);
		assert.strictEqual(support.getTextToStrip('/// a', ''), 0);
	});

	test('beforeText must match the first line', () => {
		const support = createSupport([{ beforeText: /^\s*\/\/\//, afterText: /^\s*\/\/\// }]);
		assert.strictEqual(support.getTextToStrip('/// a', '/// b'), 3);
		assert.strictEqual(support.getTextToStrip('foo', '/// b'), 0);
	});

	test('match not at the start of the line is ignored', () => {
		const support = createSupport([{ afterText: /\/\/\// }]);
		assert.strictEqual(support.getTextToStrip('/// a', 'x /// b'), 0);
		assert.strictEqual(support.getTextToStrip('/// a', '/// b'), 3);
	});

	test('empty matches are ignored', () => {
		const support = createSupport([{ afterText: /^\s*/ }]);
		assert.strictEqual(support.getTextToStrip('a', 'b'), 0);
	});

	test('first matching rule wins and falls through on mismatch', () => {
		const support = createSupport([
			{ beforeText: /^\s*#/, afterText: /^\s*#/ },
			{ beforeText: /^\s*\/\//, afterText: /^\s*\/\// }
		]);
		assert.strictEqual(support.getTextToStrip('# a', '# b'), 1);
		assert.strictEqual(support.getTextToStrip('// a', '// b'), 2);
		assert.strictEqual(support.getTextToStrip('// a', '# b'), 0);
	});

	test('global flag does not leak state between calls', () => {
		const support = createSupport([{ beforeText: /^\s*\/\/\//g, afterText: /^\s*\/\/\//g }]);
		for (let i = 0; i < 4; i++) {
			assert.strictEqual(support.getTextToStrip('/// a', '/// b'), 3);
		}
	});
});
