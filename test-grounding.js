// Standalone, isolated test: does gemini-2.5-flash grounding actually work
// on this key? Run directly with node, not through the Actor, to get a fast
// answer without spending quota on the rest of the pipeline.
//
// Usage: GOOGLE_API_KEY=your_key node test-grounding.js

import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    console.error('Set GOOGLE_API_KEY as an environment variable first.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

try {
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        tools: [{ googleSearch: {} }],
    });

    console.log('Calling gemini-2.5-flash with Google Search grounding...');

    const result = await model.generateContent(
        'Search for information about the "Erasmus+ Grants for study mobility" scholarship. Is it a real, documented opportunity?',
    );

    console.log('\n--- Response text ---');
    console.log(result.response.text());

    const groundingChunks = result.response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
    console.log('\n--- Grounding chunks found ---');
    console.log(groundingChunks ? JSON.stringify(groundingChunks, null, 2) : 'None (grounding metadata missing)');

    console.log('\n✅ SUCCESS: grounding call completed without error.');
} catch (err) {
    console.log('\n❌ FAILED');
    console.log('Status:', err.status);
    console.log('Message:', err.message);
    process.exit(1);
}
