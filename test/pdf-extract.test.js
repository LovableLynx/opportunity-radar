// Unit tests for server-side PDF CV text extraction (the Actor's own cvFile
// input field — Apify Console upload, direct API, MCP — a separate entry
// point from the website's browser-side pdf.js extraction). Uses the same
// real PDF fixture the Playwright tests use, no network calls.
//
// Run with: node --test test/pdf-extract.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { looksLikePdf, extractPdfText } from '../src/pdf-extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PDF_PATH = join(__dirname, '..', 'frontend', 'tests', 'fixtures', 'test-cv.pdf');

test('looksLikePdf accepts a buffer starting with the real PDF signature', () => {
    const buffer = readFileSync(TEST_PDF_PATH);
    assert.equal(looksLikePdf(buffer), true);
});

test('looksLikePdf rejects plain text pretending to be a PDF', () => {
    const buffer = Buffer.from('This is not a PDF file, just plain text.');
    assert.equal(looksLikePdf(buffer), false);
});

test('looksLikePdf rejects an empty or too-short buffer without crashing', () => {
    assert.equal(looksLikePdf(Buffer.from('')), false);
    assert.equal(looksLikePdf(Buffer.from('%PD')), false);
    assert.equal(looksLikePdf(null), false);
    assert.equal(looksLikePdf(undefined), false);
});

test('extractPdfText extracts real text from a genuine PDF', async () => {
    const buffer = readFileSync(TEST_PDF_PATH);
    const { text, error } = await extractPdfText(buffer);

    assert.equal(error, null);
    assert.ok(text.length > 0);
});

test('extractPdfText rejects a non-PDF file before attempting to parse it', async () => {
    const buffer = Buffer.from('Definitely not a PDF, just some text pretending.');
    const { text, error } = await extractPdfText(buffer);

    assert.equal(text, '');
    assert.match(error, /doesn't look like a real PDF/);
});

test('extractPdfText rejects a corrupt file that has a valid signature but garbage content', async () => {
    // A real PDF signature followed by bytes that aren't a real PDF
    // structure — the header check passes, but pdfjs itself should fail
    // to actually parse it.
    const buffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage garbage garbage not a real pdf structure at all')]);
    const { text, error } = await extractPdfText(buffer);

    assert.equal(text, '');
    assert.ok(error);
});

test('extractPdfText never throws, even on completely malformed input', async () => {
    await assert.doesNotReject(() => extractPdfText(Buffer.from([0, 1, 2, 3, 4, 5])));
    await assert.doesNotReject(() => extractPdfText(Buffer.from('')));
});
