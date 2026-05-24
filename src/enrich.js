import * as fs from 'node:fs';
import * as path from 'node:path';

export async function enrichCodebase(db, rootDir, apiKey, force = false) {
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable or argument is missing.');
    return;
  }

  const files = db.getAllFiles();
  // Order files by PageRank so we enrich the most important files first
  files.sort((a, b) => b.pagerank - a.pagerank);

  console.log(`\nStarting AI enrichment for ${files.length} files...`);

  for (const file of files) {
    if (file.summary && !force) {
      console.log(`Skipping (already enriched): ${file.path}`);
      continue;
    }

    console.log(`Enriching: ${file.path}...`);
    
    // Get file content & symbols
    const absPath = path.resolve(rootDir, file.path);
    let codeSnippet = '';
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      codeSnippet = content.split('\n').slice(0, 60).join('\n'); // first 60 lines
    } catch (_) {}

    const symbolsList = db.db.prepare(`
      SELECT name, type, signature 
      FROM symbols 
      WHERE file_path = ?;
    `).all(file.path);

    const symbolsText = symbolsList.map(s => `- ${s.type} ${s.name}: ${s.signature}`).join('\n');

    const prompt = `You are a codebase analyzer. Summarize this code file in 1 or 2 plain-English sentences. Describe its main purpose and role in the system. Be concise. Do not include markdown formatting in the output, just raw text.

File: ${file.path}
Layer: ${file.layer}
Exported Symbols:
${symbolsText}

First 60 lines of code:
\`\`\`
${codeSnippet}
\`\`\`

Summary (1-2 sentences):`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 120,
              temperature: 0.1
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const resJson = await response.json();
      const summary = resJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      
      if (summary) {
        // Remove newlines and double spaces to keep it clean
        const cleanSummary = summary.replace(/\s+/g, ' ');
        db.updateFileMetadata(file.path, file.layer || 'service', cleanSummary);
        console.log(`Summary: ${cleanSummary}`);
      } else {
        console.log('Empty response from model.');
      }
    } catch (err) {
      console.error(`Failed to enrich ${file.path}: ${err.message}`);
      // Sleep slightly if rate limited, then continue
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('AI enrichment completed.');
}
