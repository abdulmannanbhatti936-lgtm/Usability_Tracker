#!/usr/bin/env node
/**
 * Build script — minifies tracker.js and heatmap.js using esbuild.
 * Output: public/tracker.min.js, public/heatmap.min.js
 */
'use strict';

const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const builds = [
    { in: 'tracker.js', out: 'tracker.min.js' },
    { in: 'heatmap.js', out: 'heatmap.min.js' },
];

let ok = true;
for (const { in: inFile, out: outFile } of builds) {
    const inPath = path.join(PUBLIC, inFile);
    const outPath = path.join(PUBLIC, outFile);
    try {
        const result = buildSync({
            entryPoints: [inPath],
            bundle: false,
            minify: true,
            target: ['es2017'],
            outfile: outPath,
            logLevel: 'silent',
        });
        const inSize = fs.statSync(inPath).size;
        const outSize = fs.statSync(outPath).size;
        console.log(`✅ ${inFile} → ${outFile}  (${(inSize / 1024).toFixed(1)}KB → ${(outSize / 1024).toFixed(1)}KB, ${Math.round((1 - outSize / inSize) * 100)}% smaller)`);
    } catch (e) {
        console.error(`❌ Failed to build ${inFile}:`, e.message);
        ok = false;
    }
}

process.exit(ok ? 0 : 1);
