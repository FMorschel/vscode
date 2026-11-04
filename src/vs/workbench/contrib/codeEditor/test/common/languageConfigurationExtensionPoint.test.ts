/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageConfiguration, LanguageConfigurationFileHandler } from '../../common/languageConfigurationExtensionPoint.js';

suite('LanguageConfigurationFileHandler - onDeleteRules', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function extract(configuration: ILanguageConfiguration) {
		return LanguageConfigurationFileHandler.extractValidConfig('test', configuration).onDeleteRules;
	}

	test('undefined when not specified', () => {
		assert.strictEqual(extract({}), undefined);
	});

	test('parses string and object regular expressions', () => {
		const rules = extract({
			onDeleteRules: [
				{ afterText: '^\\s*///' },
				{ beforeText: { pattern: '^\\s*//', flags: 'i' }, afterText: { pattern: '^\\s*//', flags: 'i' } }
			]
		});
		assert.strictEqual(rules?.length, 2);
		assert.ok(rules[0].afterText.test('  /// x'));
		assert.ok(!rules[0].afterText.test('x ///'));
		assert.strictEqual(rules[0].beforeText, undefined);
		assert.strictEqual(rules[1].beforeText?.flags, 'i');
		assert.strictEqual(rules[1].afterText.flags, 'i');
	});

	test('skips invalid rules', () => {
		const warn = console.warn;
		console.warn = () => { };
		try {
			const rules = extract({
				onDeleteRules: [
					...([null, {}] as unknown as NonNullable<ILanguageConfiguration['onDeleteRules']>),
					{ afterText: '(' },
					{ afterText: '^#', beforeText: '(' },
					{ afterText: '^//' }
				]
			});
			// an invalid `beforeText` only drops the optional field, the rule itself stays
			assert.strictEqual(rules?.length, 2);
			assert.ok(rules[0].afterText.test('# x'));
			assert.strictEqual(rules[0].beforeText, undefined);
			assert.ok(rules[1].afterText.test('// x'));
		} finally {
			console.warn = warn;
		}
	});

	test('ignores non-array value', () => {
		const warn = console.warn;
		console.warn = () => { };
		try {
			assert.strictEqual(extract({ onDeleteRules: {} as unknown as ILanguageConfiguration['onDeleteRules'] }), undefined);
		} finally {
			console.warn = warn;
		}
	});
});
