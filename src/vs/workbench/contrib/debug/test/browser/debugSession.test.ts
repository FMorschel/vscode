/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestAccessibilityService } from '../../../../../platform/accessibility/test/common/testAccessibilityService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IExtensionHostDebugService } from '../../../../../platform/debug/common/extensionHostDebug.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { DebugSession, ThreadStatusScheduler } from '../../browser/debugSession.js';
import { RawDebugSession } from '../../browser/rawDebugSession.js';
import { IDebugger, IDebugService, IViewModel } from '../../common/debug.js';
import { MockDebugAdapter } from '../common/mockDebug.js';
import { createTestSession } from './callStack.test.js';
import { createMockDebugModel, mockUriIdentityService } from './mockDebugModel.js';


suite('DebugSession - ThreadStatusScheduler', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	test('cancel base case', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());

		await scheduler.run(Promise.resolve([1]), async (threadId, token) => {
			assert.strictEqual(threadId, 1);
			assert.strictEqual(token.isCancellationRequested, false);
			scheduler.cancel([1]);
			assert.strictEqual(token.isCancellationRequested, true);
		});
	});

	test('cancel global', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());

		await scheduler.run(Promise.resolve([1]), async (threadId, token) => {
			assert.strictEqual(threadId, 1);
			assert.strictEqual(token.isCancellationRequested, false);
			scheduler.cancel(undefined);
			assert.strictEqual(token.isCancellationRequested, true);
		});
	});

	test('cancels when new work comes in', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());
		let innerCalled = false;

		await scheduler.run(Promise.resolve([1]), async (threadId, token1) => {
			assert.strictEqual(threadId, 1);
			assert.strictEqual(token1.isCancellationRequested, false);
			await scheduler.run(Promise.resolve([1]), async (_threadId, token2) => {
				innerCalled = true;
				assert.strictEqual(token1.isCancellationRequested, true);
				assert.strictEqual(token2.isCancellationRequested, false);
			});
		});

		assert.strictEqual(innerCalled, true);
	});

	test('cancels slower lookups when new lookup is made', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());
		const innerCalled1: number[] = [];
		const innerCalled2: number[] = [];

		await Promise.all([
			scheduler.run(Promise.resolve().then(() => { }).then(() => [1, 3]), async threadId => {
				innerCalled1.push(threadId);
			}),
			scheduler.run(Promise.resolve([1, 2]), async threadId => {
				innerCalled2.push(threadId);
			})
		]);

		assert.deepEqual(innerCalled1, [3]);
		assert.deepEqual(innerCalled2, [1, 2]);
	});

	test('allows work with other IDs', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());
		let innerCalled = false;

		await scheduler.run(Promise.resolve([1]), async (threadId, token1) => {
			assert.strictEqual(threadId, 1);
			assert.strictEqual(token1.isCancellationRequested, false);
			await scheduler.run(Promise.resolve([2]), async (_threadId, token2) => {
				innerCalled = true;
				assert.strictEqual(token1.isCancellationRequested, false);
				assert.strictEqual(token2.isCancellationRequested, false);
			});
		});

		assert.strictEqual(innerCalled, true);
	});

	test('cancels when called during reslution', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());
		let innerCalled = false;

		await scheduler.run(Promise.resolve().then(() => scheduler.cancel([1])).then(() => [1]), async () => {
			innerCalled = true;
		});

		assert.strictEqual(innerCalled, false);
	});

	test('global cancels when called during reslution', async () => {
		const scheduler = ds.add(new ThreadStatusScheduler());
		let innerCalled = false;

		await scheduler.run(Promise.resolve().then(() => scheduler.cancel(undefined)).then(() => [1]), async () => {
			innerCalled = true;
		});

		assert.strictEqual(innerCalled, false);
	});
});


suite('DebugSession - continued events', () => {
	let session: DebugSession | undefined;

	teardown(async () => {
		await session?.disconnect();
		session = undefined;
	});

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	function createSession() {
		const model = createMockDebugModel(ds);
		session = ds.add(createTestSession(model));
		model.addSession(session);
		const adapter = ds.add(new class extends MockDebugAdapter {
			override sendMessage(message: DebugProtocol.ProtocolMessage): void {
				if (message.type === 'request') {
					const request = message as DebugProtocol.Request;
					if (request.command === 'threads') {
						this.sendResponseBody(request, { threads: [{ id: 1, name: 'first' }, { id: 2, name: 'second' }] });
						return;
					}
					if (request.command === 'stackTrace') {
						this.sendResponseBody(request, { stackFrames: [], totalFrames: 0 });
						return;
					}
				}
				super.sendMessage(message);
			}
		});
		const raw = ds.add(new RawDebugSession(adapter, undefined!, '', '', undefined!, undefined!, undefined!, undefined!));
		session.initializeForTest(raw);
		return { session, adapter };
	}

	for (const allThreadsContinued of [false, true]) {
		test(`preserves a newer stop during ${allThreadsContinued ? 'all-thread' : 'single-thread'} continued cleanup`, async () => {
			const { session, adapter } = createSession();
			const initiallyStopped = Event.toPromise(session.onDidChangeState);
			adapter.sendEventBody('stopped', { reason: 'step', threadId: 1 });
			await initiallyStopped;
			assert.strictEqual(session.getStoppedDetails()?.reason, 'step');

			const stoppedAgain = Event.toPromise(Event.filter(session.onDidChangeState, () => session.getThread(1)?.stopped === true));
			// Adjacent adapter events are dispatched before continued cleanup resumes.
			adapter.sendEventBody('continued', { threadId: 1, allThreadsContinued });
			adapter.sendEventBody('stopped', { reason: 'breakpoint', threadId: 1 });
			await stoppedAgain;

			assert.deepStrictEqual(session.getStoppedDetails(), { reason: 'breakpoint', threadId: 1, totalFrames: 0 });
		});

		test(`clears an earlier stop on ${allThreadsContinued ? 'all-thread' : 'single-thread'} continuation`, async () => {
			const { session, adapter } = createSession();
			const stopped = Event.toPromise(session.onDidChangeState);
			adapter.sendEventBody('stopped', { reason: 'step', threadId: 1 });
			await stopped;

			const continued = Event.toPromise(session.onDidChangeState);
			adapter.sendEventBody('continued', { threadId: 1, allThreadsContinued });
			await continued;

			assert.strictEqual(session.getStoppedDetails(), undefined);
			assert.strictEqual(session.getThread(1)?.stopped, false);
		});
	}

	test('preserves a stopped thread when another thread continues', async () => {
		const { session, adapter } = createSession();
		const stopped = Event.toPromise(session.onDidChangeState);
		adapter.sendEventBody('stopped', { reason: 'breakpoint', threadId: 2 });
		await stopped;

		const continued = Event.toPromise(session.onDidChangeState);
		adapter.sendEventBody('continued', { threadId: 1, allThreadsContinued: false });
		await continued;

		assert.deepStrictEqual(session.getStoppedDetails(), { reason: 'breakpoint', threadId: 2, totalFrames: 0 });
		assert.strictEqual(session.getThread(2)?.stopped, true);
	});

	test('clears a stop without a thread ID when all threads continue', async () => {
		const { session, adapter } = createSession();
		const stopped = Event.toPromise(session.onDidChangeState);
		adapter.sendEventBody('stopped', { reason: 'pause', allThreadsStopped: true });
		await stopped;

		const continued = Event.toPromise(Event.filter(session.onDidChangeState, () => session.getAllThreads().every(thread => !thread.stopped)));
		adapter.sendEventBody('continued', { threadId: 1 });
		await continued;

		assert.strictEqual(session.getStoppedDetails(), undefined);
	});
});

/**
 * Debug adapter that answers the requests a session lifecycle needs and lets
 * the test decide when (or whether) the adapter reports that the debuggee terminated.
 */
class LifecycleDebugAdapter extends MockDebugAdapter {
	readonly requests: string[] = [];

	constructor(
		private readonly capabilities: DebugProtocol.Capabilities,
		private readonly terminatedOnTerminateRequest: boolean,
	) {
		super();
	}

	override sendMessage(message: DebugProtocol.ProtocolMessage): void {
		if (message.type === 'request') {
			const request = message as DebugProtocol.Request;
			this.requests.push(request.command);
			if (request.command === 'initialize') {
				setTimeout(() => this.sendResponseBody(request, this.capabilities), 0);
				return;
			}
			if (request.command === 'terminate') {
				setTimeout(() => {
					this.sendResponseBody(request, {});
					if (this.terminatedOnTerminateRequest) {
						this.sendTerminated();
					}
				}, 0);
				return;
			}
		}
		super.sendMessage(message);
	}

	sendTerminated(): void {
		this.sendEventBody('terminated', {});
	}
}

suite('DebugSession - restart without restart request', () => {
	let session: DebugSession | undefined;

	teardown(async () => {
		await session?.disconnect();
		session = undefined;
	});

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	function createSession(adapters: LifecycleDebugAdapter[]) {
		const model = createMockDebugModel(ds);
		const instantiationService = ds.add(new TestInstantiationService());
		instantiationService.stub(IExtensionHostDebugService, {});
		instantiationService.stub(IOpenerService, {});
		instantiationService.stub(INotificationService, {});
		instantiationService.stub(IDialogService, {});

		const debugService = upcastPartial<IDebugService>({
			getModel: () => model,
			getViewModel: () => upcastPartial<IViewModel>({ updateViews: () => { } }),
			setExceptionBreakpointsForSession: () => { },
			focusStackFrame: async () => { },
		});
		const productService = upcastPartial<IProductService>({ nameLong: 'Test' });
		session = ds.add(new DebugSession(generateUuid(), { resolved: { name: 'restartSession', type: 'mock', request: 'launch' }, unresolved: undefined }, undefined, model, undefined, debugService, undefined!, undefined!, new TestConfigurationService({ debug: { console: { collapseIdenticalLines: true } } }), undefined!, undefined!, productService, undefined!, undefined!, mockUriIdentityService, instantiationService, undefined!, undefined!, new NullLogService(), undefined!, undefined!, new TestAccessibilityService()));
		model.addSession(session);

		const pending = adapters.slice();
		for (const adapter of adapters) {
			ds.add(adapter);
		}
		const dbgr = upcastPartial<IDebugger>({
			type: 'mock',
			createDebugAdapter: async () => pending.shift()!,
		});

		let endedAdapters = 0;
		ds.add(session.onDidEndAdapter(() => endedAdapters++));

		return { session, dbgr, endedAdapters: () => endedAdapters };
	}

	// DebugService.restartSession does this for adapters without supportsRestartRequest:
	// `await session.terminate(true)`, a short fixed delay, then `session.initialize()` on the same session.

	test('reports the end of the previous run when the adapter is disconnected', async () => {
		const first = new LifecycleDebugAdapter({}, false);
		const second = new LifecycleDebugAdapter({}, false);
		const { session, dbgr, endedAdapters } = createSession([first, second]);
		await session.initialize(dbgr);

		await session.terminate(true);
		assert.deepStrictEqual(first.requests, ['initialize', 'disconnect']);
		assert.strictEqual(endedAdapters(), 1);

		await session.initialize(dbgr);
		assert.strictEqual(endedAdapters(), 1);
	});

	test('reports the end of the previous run when the adapter terminates before the relaunch', async () => {
		const first = new LifecycleDebugAdapter({ supportsTerminateRequest: true }, true);
		const second = new LifecycleDebugAdapter({ supportsTerminateRequest: true }, true);
		const { session, dbgr, endedAdapters } = createSession([first, second]);
		await session.initialize(dbgr);

		const ended = Event.toPromise(session.onDidEndAdapter);
		await session.terminate(true);
		await ended;
		assert.deepStrictEqual(first.requests, ['initialize', 'terminate', 'disconnect']);
		assert.strictEqual(endedAdapters(), 1);

		await session.initialize(dbgr);
		assert.strictEqual(endedAdapters(), 1);
	});

	test('reports the end of the previous run when the relaunch happens before the adapter terminates (#246811)', async () => {
		const first = new LifecycleDebugAdapter({ supportsTerminateRequest: true }, false);
		const second = new LifecycleDebugAdapter({ supportsTerminateRequest: true }, false);
		const { session, dbgr, endedAdapters } = createSession([first, second]);
		await session.initialize(dbgr);

		// The adapter acknowledged 'terminate' but has not sent 'terminated' yet.
		await session.terminate(true);
		assert.deepStrictEqual(first.requests, ['initialize', 'terminate']);
		assert.strictEqual(endedAdapters(), 0);

		await session.initialize(dbgr);
		assert.strictEqual(endedAdapters(), 1, 'the previous run must report its end before the session is reused, as it does when the adapter terminates first');

		// A late 'terminated' from the previous adapter must not end the new run.
		first.sendTerminated();
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.strictEqual(endedAdapters(), 1);
		assert.deepStrictEqual(second.requests, ['initialize']);
	});
});
