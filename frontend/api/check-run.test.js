// Unit tests for the /api/check-run handler, particularly the ownership
// check added after a real finding: this endpoint accepted any runId with
// no verification that it actually belonged to this Actor. global.fetch is
// mocked throughout, so these never touch the real Apify API.
//
// Run with: node --test api/check-run.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APIFY_API_TOKEN = 'fake-token';

function withMockedFetch(routes, fn) {
    const original = global.fetch;
    global.fetch = async (url) => {
        for (const [pattern, response] of routes) {
            if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
                return response;
            }
        }
        throw new Error(`Unmocked fetch call: ${url}`);
    };
    return fn().finally(() => {
        global.fetch = original;
    });
}

function fakeReqRes(query) {
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    return { req: { query }, res };
}

// The module caches this Actor's own resolved ID at module scope
// (cachedActorId) so it isn't re-fetched on every request — that means
// tests need a fresh module instance per test to avoid one test's mocked
// actor-lookup response leaking into another's assertions.
async function freshHandler() {
    const mod = await import(`./check-run.js?t=${Date.now()}-${Math.random()}`);
    return mod.default;
}

test('missing runId is rejected with 400', async () => {
    const handler = await freshHandler();
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    assert.equal(res.statusCode, 400);
});

test('a runId with invalid characters is rejected with 400', async () => {
    const handler = await freshHandler();
    const { req, res } = fakeReqRes({ runId: '../../etc/passwd' });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
});

test('a run belonging to this Actor returns its status', async () => {
    await withMockedFetch(
        [
            ['/v2/acts/lovablelynx~opportunity-radar', { ok: true, json: async () => ({ data: { id: 'THIS_ACTOR_ID' } }) }],
            ['/v2/actor-runs/', { ok: true, json: async () => ({ data: { actId: 'THIS_ACTOR_ID', status: 'RUNNING' } }) }],
        ],
        async () => {
            const handler = await freshHandler();
            const { req, res } = fakeReqRes({ runId: 'someRealRunId' });
            await handler(req, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.status, 'RUNNING');
        },
    );
});

test('a run belonging to a DIFFERENT Actor on the same account is rejected as not found, not detailed', async () => {
    // The actual regression case: someone with a valid Apify run ID from
    // some other Actor on this account should not be able to pull its
    // status/results through this endpoint.
    await withMockedFetch(
        [
            ['/v2/acts/lovablelynx~opportunity-radar', { ok: true, json: async () => ({ data: { id: 'THIS_ACTOR_ID' } }) }],
            ['/v2/actor-runs/', { ok: true, json: async () => ({ data: { actId: 'SOME_OTHER_ACTORS_ID', status: 'SUCCEEDED', defaultDatasetId: 'other-dataset' } }) }],
        ],
        async () => {
            const handler = await freshHandler();
            const { req, res } = fakeReqRes({ runId: 'someoneElsesRunId' });
            await handler(req, res);
            assert.equal(res.statusCode, 404);
            // Confirms it fails BEFORE fetching or returning that other
            // run's dataset contents.
            assert.equal(res.body.results, undefined);
        },
    );
});

test('if this Actor\'s own ID cannot be resolved, the check fails closed (404), not open', async () => {
    await withMockedFetch(
        [
            ['/v2/acts/lovablelynx~opportunity-radar', { ok: false, status: 500 }],
            ['/v2/actor-runs/', { ok: true, json: async () => ({ data: { actId: 'ANYTHING', status: 'SUCCEEDED' } }) }],
        ],
        async () => {
            const handler = await freshHandler();
            const { req, res } = fakeReqRes({ runId: 'someRunId' });
            await handler(req, res);
            assert.equal(res.statusCode, 404);
        },
    );
});

test('a SUCCEEDED run for this Actor fetches and returns its dataset results', async () => {
    await withMockedFetch(
        [
            ['/v2/acts/lovablelynx~opportunity-radar', { ok: true, json: async () => ({ data: { id: 'THIS_ACTOR_ID' } }) }],
            ['/v2/actor-runs/', { ok: true, json: async () => ({ data: { actId: 'THIS_ACTOR_ID', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } }) }],
            ['/v2/datasets/ds1/items', { ok: true, json: async () => ([{ title: 'A listing' }]) }],
        ],
        async () => {
            const handler = await freshHandler();
            const { req, res } = fakeReqRes({ runId: 'someRunId' });
            await handler(req, res);
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body.results, [{ title: 'A listing' }]);
        },
    );
});

test('raw Apify error details are not leaked to the caller on a network failure', async () => {
    await withMockedFetch(
        [
            ['/v2/acts/lovablelynx~opportunity-radar', { ok: true, json: async () => ({ data: { id: 'THIS_ACTOR_ID' } }) }],
        ],
        async () => {
            global.fetch = async (url) => {
                if (url.includes('/v2/acts/')) return { ok: true, json: async () => ({ data: { id: 'THIS_ACTOR_ID' } }) };
                throw new Error('ECONNRESET: internal network detail nobody outside should see');
            };
            const handler = await freshHandler();
            const { req, res } = fakeReqRes({ runId: 'someRunId' });
            await handler(req, res);
            assert.equal(res.statusCode, 500);
            assert.ok(!res.body.error.includes('ECONNRESET'));
        },
    );
});
