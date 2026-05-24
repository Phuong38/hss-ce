import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFile } from './parser.js';

export async function enrichCodebase(db, rootDir, apiKey, force = false) {
  console.log('\n[Local Enrichment] Extracting summaries from file comments and docstrings...');
  
  const files = db.getAllFiles();
  let enrichedCount = 0;

  for (const file of files) {
    if (file.summary && !force) {
      continue;
    }

    const absPath = path.resolve(rootDir, file.path);
    try {
      if (fs.existsSync(absPath)) {
        const { summary } = parseFile(absPath);
        if (summary) {
          db.updateFileMetadata(file.path, file.layer || 'service', summary);
          enrichedCount++;
        }
      }
    } catch (err) {
      console.warn(`Could not parse summary locally for ${file.path}: ${err.message}`);
    }
  }

  console.log(`Local enrichment completed. Extracted ${enrichedCount} summaries locally.`);
}
