// Server-side CV PDF text extraction for the Actor's own cvFile input field
// (Apify Console upload, direct API calls, MCP) — a separate entry point
// from the website, which extracts PDF text client-side via pdf.js in the
// browser (frontend/app.js). This mirrors that same logic (signature check,
// page-by-page text extraction, minimum-length check) using pdfjs-dist's
// Node-compatible legacy build, so a CV uploaded directly to the Actor gets
// the same real extraction the website gives it, not silently ignored.

// Loaded lazily inside extractPdfText, not as a static top-level import.
// pdfjs-dist pulls in an optional native canvas package that isn't always
// resolvable in every build environment (seen on a teammate's fresh Apify
// build: "Cannot find module '@napi-rs/canvas'"). We only use pdfjs-dist for
// text extraction, never rendering, so we don't need canvas at all — but a
// static import still fails at module-load time before our own try/catch
// exists, crashing the whole Actor before it does any work. A dynamic
// import() inside the function keeps that failure local and recoverable.
let pdfjsLibPromise;
function loadPdfjsLib() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    return pdfjsLibPromise;
}

// Mirrors frontend/app.js's looksLikePdf: checks the actual file signature
// (a real PDF always starts with the literal bytes "%PDF-"), not a
// filename or content-type header, both of which are trivially wrong.
export function looksLikePdf(buffer) {
    if (!buffer || buffer.length < 5) return false;
    const signature = String.fromCharCode(...buffer.subarray(0, 5));
    return signature === '%PDF-';
}

// Mirrors frontend/app.js's MIN_EXTRACTED_PDF_TEXT_LENGTH: a scanned/image
// PDF extracts to little or no text, which is a real, distinct failure mode
// worth telling apart from "the file just isn't a PDF at all".
const MIN_EXTRACTED_PDF_TEXT_LENGTH = 30;

/**
 * Extracts plain text from a PDF file's raw bytes. Returns { text, error }:
 * text is the extracted string (empty if extraction failed), error is a
 * human-readable message if something went wrong (null on success).
 * Never throws — a bad/corrupt/scanned PDF degrades to an error message,
 * same as the rest of this codebase's pattern for optional-input failures.
 */
export async function extractPdfText(buffer) {
    if (!looksLikePdf(buffer)) {
        return { text: '', error: "That doesn't look like a real PDF file (missing PDF file signature)." };
    }

    let pdfjsLib;
    try {
        pdfjsLib = await loadPdfjsLib();
    } catch (err) {
        return { text: '', error: `PDF extraction isn't available right now: ${err.message}` };
    }

    let pdf;
    try {
        const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(buffer),
            // No canvas/DOM in Node — text extraction only, images/fonts
            // are irrelevant to what we're pulling out of the file.
            isEvalSupported: false,
            useSystemFonts: true,
        });
        pdf = await loadingTask.promise;
    } catch (err) {
        return { text: '', error: `Could not open that PDF (it may be corrupt): ${err.message}` };
    }

    try {
        const pageTexts = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            pageTexts.push(content.items.map((item) => item.str).join(' '));
        }
        const text = pageTexts.join('\n').trim();

        if (!text || text.length < MIN_EXTRACTED_PDF_TEXT_LENGTH) {
            return { text: '', error: "Couldn't find enough readable text in that PDF (it may be a scanned image)." };
        }

        return { text, error: null };
    } catch (err) {
        return { text: '', error: `Could not extract text from that PDF: ${err.message}` };
    } finally {
        await pdf.cleanup();
    }
}
