#!/usr/bin/env tsx
/**
 * Automated script to add temporal support (skipBars) to all indicators
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const filepath = join(process.cwd(), 'server', 'bigidea', 'indicators.ts');
const content = readFileSync(filepath, 'utf-8');

// Indicators that already have skipBars - don't modify
const SKIP_IDS = ['PA-12', 'PA-13', 'PA-18', 'MA-1', 'MA-2', 'MA-3'];

// Pattern to match indicator definitions
const indicatorPattern = /(\{[\s\S]*?id:\s*"([A-Z]+-\d+)"[\s\S]*?params:\s*\[)([\s\S]*?)(\],[\s\S]*?evaluate:\s*\(candles,\s*params)(,\s*_?benchmarkCandles\??,?\s*upstreamData\??)?\)/g;

let modifiedContent = content;
let modCount = 0;

// Find all indicator definitions
const matches = [...content.matchAll(indicatorPattern)];

console.log(`Found ${matches.length} indicators to check`);

for (const match of matches) {
  const fullMatch = match[0];
  const beforeParams = match[1];
  const indicatorId = match[2];
  const paramsContent = match[3];
  const beforeEvaluate = match[4];
  const existingUpstreamParam = match[5];
  
  if (SKIP_IDS.includes(indicatorId)) {
    console.log(`⏭️  ${indicatorId}: Already has temporal support`);
    continue;
  }
  
  // Check if skipBars already exists in params
  if (paramsContent.includes('name: "skipBars"')) {
    console.log(`⏭️  ${indicatorId}: Already has skipBars param`);
    continue;
  }
  
  // Add skipBars as first param
  const skipBarsParam = `\n      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },`;
  const newParamsContent = skipBarsParam + paramsContent;
  
  // Update evaluate signature to include upstreamData if not present
  let newEvaluateSignature = beforeEvaluate;
  if (!existingUpstreamParam) {
    newEvaluateSignature = beforeEvaluate + ', _benchmarkCandles, upstreamData';
  } else {
    newEvaluateSignature = beforeEvaluate + existingUpstreamParam;
  }
  
  const newIndicatorDef = beforeParams + newParamsContent + '],\n    evaluate: (candles, params' + newEvaluateSignature + ')';
  
  modifiedContent = modifiedContent.replace(fullMatch, newIndicatorDef);
  modCount++;
  console.log(`✓ ${indicatorId}: Added skipBars param and upstreamData support`);
}

console.log(`\n✅ Modified ${modCount} indicators`);
console.log('⚠️  Note: This script adds skipBars params but does NOT update evaluate logic to use them.`);
console.log('    You must manually update each evaluate() function to:');
console.log('    1. Extract skip from upstreamData');
console.log('    2. Slice candles array');
console.log('    3. Return evaluationStartBar/EndBar/patternEndBar');

// Write the modified content
writeFileSync(filepath, modifiedContent, 'utf-8');
console.log(`\n📝 Written to ${filepath}`);
