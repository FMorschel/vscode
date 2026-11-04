/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/336145

	/**
	 * Describes a rule to be evaluated when two lines are joined by deleting the line break between them,
	 * i.e. by pressing `Delete` at the end of a line or `Backspace` at the start of one.
	 */
	export interface OnDeleteRule {
		/**
		 * This rule will only execute if the text of the first line (the one that stays above) matches this regular expression.
		 */
		beforeText?: RegExp;

		/**
		 * This rule will only execute if the text of the second line (the one that is merged up) matches this
		 * regular expression at its start. The matched text is removed when the lines are joined, for example
		 * a comment leader like `///`.
		 */
		afterText: RegExp;
	}

	export interface LanguageConfiguration {
		/**
		 * The language's rules to be evaluated when two lines are joined by deleting the line break between them.
		 * The first rule that matches wins.
		 */
		onDeleteRules?: OnDeleteRule[];
	}
}
