// Hand-writes a minimal, valid, single-page PDF containing plain text, so
// the CV-upload Playwright test has a real PDF fixture to exercise pdf.js
// against without adding a PDF-generation library as a project dependency.
// Run once with `node tests/fixtures/make-test-cv.js` to (re)generate
// test-cv.pdf; the file itself is committed, this script is only needed if
// the fixture text ever needs to change.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const text = 'Jane Student Curriculum Vitae Research Assistant Computer Science University of Lagos';

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];

const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
const streamObj = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

const parts = [...objects, streamObj];

let pdf = '%PDF-1.4\n';
const offsets = [0];
parts.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefStart = pdf.length;
pdf += `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= parts.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

writeFileSync(join(__dirname, 'test-cv.pdf'), pdf, 'latin1');
console.log('Wrote test-cv.pdf');
