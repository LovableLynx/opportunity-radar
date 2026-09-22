// Unit tests for the Groq provider wrapper. global.fetch is mocked
// throughout, so these never touch the real endpoint or spend quota.
//
// Run with: node --test test/llm-groq.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGroqGenerateContent } from '../src/llm-groq.js';

function withMockedFetch(impl, fn) {
    const original = global.fetch;
    global.fetch = impl;
    return fn().finally(() => {
        global.fetch = original;
    });
}

test('a successful call returns the response shape callers expect', async () => {
    await withMockedFetch(
        async () => ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'hello from groq' } }] }),
        }),
        async () => {
            const generateContentWithRetry = makeGroqGenerateContent('fake-key', { minMsBetweenCalls: 0 });
            const result = await generateContentWithRetry('a prompt');
            assert.equal(result.response.text(), 'hello from groq');
        },
    );
});

test('sends the prompt and API key in the request', async () => {
    let capturedUrl;
    let capturedOptions;
    await withMockedFetch(
        async (url, options) => {
            capturedUrl = url;
            capturedOptions = options;
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
        },
        async () => {
            const generateContentWithRetry = makeGroqGenerateContent('my-secret-key', { minMsBetweenCalls: 0 });
            await generateContentWithRetry('check this prompt');

            assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
            assert.equal(capturedOptions.headers.Authorization, 'Bearer my-secret-key');
            const body = JSON.parse(capturedOptions.body);
            assert.equal(body.messages[0].content, 'check this prompt');
        },
    );
});

test('retries on a 429 and succeeds on the next attempt', async () => {
    let callCount = 0;
    await withMockedFetch(
        async () => {
            callCount += 1;
            if (callCount === 1) {
                return { ok: false, status: 429, text: async () => 'rate limited' };
            }
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'succeeded on retry' } }] }) };
        },
        async () => {
            const generateContentWithRetry = makeGroqGenerateContent('fake-key', { minMsBetweenCalls: 0 });
            const result = await generateContentWithRetry('a prompt', 3);
            assert.equal(result.response.text(), 'succeeded on retry');
            assert.equal(callCount, 2);
        },
    );
});

test('a non-retryable error throws instead of silently returning empty text', async () => {
    await withMockedFetch(
        async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
        async () => {
            const generateContentWithRetry = makeGroqGenerateContent('bad-key', { minMsBetweenCalls: 0 });
            await assert.rejects(() => generateContentWithRetry('a prompt', 1), /401/);
        },
    );
});

test('missing content in the response falls back to an empty string, not a crash', async () => {
    await withMockedFetch(
        async () => ({ ok: true, json: async () => ({ choices: [] }) }),
        async () => {
            const generateContentWithRetry = makeGroqGenerateContent('fake-key');
            const result = await generateContentWithRetry('a prompt');
            assert.equal(result.response.text(), '');
        },
    );
});
