/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IMarker, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { Range } from '../../../../common/core/range.js';
import { IModelDecoration } from '../../../../common/model.js';
import { withTestCodeEditor } from '../../../../test/browser/testCodeEditor.js';
import { MarkerHoverParticipant } from '../../browser/markerHoverParticipant.js';
import { HoverRangeAnchor, IEditorHoverRenderContext } from '../../browser/hoverTypes.js';
import { ICodeEditor } from '../../../../browser/editorBrowser.js';

suite('Marker Hover Participant', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createMarker(severity: MarkerSeverity, message: string, startColumn: number, endColumn: number): IMarker {
		return {
			owner: 'test',
			resource: URI.file('/test.dart'),
			severity,
			message,
			startLineNumber: 1,
			startColumn,
			endLineNumber: 1,
			endColumn
		};
	}

	function createParticipant(editor: ICodeEditor, markers: IMarker[]) {
		const decorations = markers.map((marker, i) => ({ id: String(i), range: new Range(1, marker.startColumn, 1, marker.endColumn) }) as IModelDecoration);
		const markerDecorationsService = {
			getMarker: (_uri: URI, decoration: IModelDecoration) => markers[Number(decoration.id)]
		};
		const menuService = { getMenuActions: () => [] };
		// eslint-disable-next-line local/code-no-any-casts
		const participant = new MarkerHoverParticipant(editor, markerDecorationsService as any, undefined!, undefined!, menuService as any, undefined!);
		return { participant, decorations };
	}

	const anchor = new HoverRangeAnchor(0, new Range(1, 10, 1, 10), undefined, undefined);

	test('issue #247250: sorts markers by severity, then by position', () => {
		withTestCodeEditor('void foo(List<(baz)> l) {}', { readOnly: true }, editor => {
			const markers = [
				createMarker(MarkerSeverity.Info, 'info late', 12, 14),
				createMarker(MarkerSeverity.Warning, 'warning', 10, 14),
				createMarker(MarkerSeverity.Error, 'error', 14, 15),
				createMarker(MarkerSeverity.Info, 'info early', 10, 14),
				createMarker(MarkerSeverity.Hint, 'hint', 10, 14),
			];
			const { participant, decorations } = createParticipant(editor, markers);
			const result = participant.computeSync(anchor, decorations);
			assert.deepStrictEqual(
				result.map(r => r.marker.message),
				['error', 'warning', 'info early', 'info late', 'hint']
			);
		});
	});

	test('issue #247250: renders a severity icon for error, warning and info only', () => {
		withTestCodeEditor('void foo(List<(baz)> l) {}', { readOnly: true }, editor => {
			const markers = [
				createMarker(MarkerSeverity.Error, 'error', 14, 15),
				createMarker(MarkerSeverity.Warning, 'warning', 10, 14),
				createMarker(MarkerSeverity.Info, 'info', 10, 14),
				createMarker(MarkerSeverity.Hint, 'hint', 10, 14),
			];
			const { participant, decorations } = createParticipant(editor, markers);
			const hoverParts = participant.computeSync(anchor, decorations);
			const fragment = document.createDocumentFragment();
			const context = {
				fragment,
				statusBar: { addAction: () => { }, append: (e: HTMLElement) => e },
				hide: () => { }
			};
			// eslint-disable-next-line local/code-no-any-casts
			const rendered = participant.renderHoverParts(context as any as IEditorHoverRenderContext, hoverParts);
			store.add(rendered);

			const icons = Array.from(fragment.querySelectorAll('.marker')).map(marker => marker.querySelector('.marker-severity-icon')?.className ?? '');
			assert.strictEqual(icons.length, 4);
			assert.ok(icons[0].includes('codicon-error'), icons[0]);
			assert.ok(icons[1].includes('codicon-warning'), icons[1]);
			assert.ok(icons[2].includes('codicon-info'), icons[2]);
			assert.strictEqual(icons[3], '');
			// rendering must not reorder the parts it was given
			assert.deepStrictEqual(hoverParts.map(p => p.marker.message), ['error', 'warning', 'info', 'hint']);
		});
	});
});
