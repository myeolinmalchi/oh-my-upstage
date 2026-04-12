// Trajectory analysis script — run automatically after opencode completes
import { readFileSync } from 'fs';

const logFile = process.argv[2];
if (!logFile) { console.log("No log file"); process.exit(0); }

try {
  const log = readFileSync(logFile, 'utf-8');
  const lines = log.split('\n');

  // 1. Planning
  const planLines = lines.filter(l => /^(Plan|계획|1\.\s+src\/|2\.\s+src\/)/.test(l.replace(/\x1b\[[0-9;]*m/g, '').trim()));
  const hasPlanning = planLines.length >= 2;

  // 2. File writes
  const writes = lines.filter(l => l.includes('Wrote file successfully'));
  const writeFiles = lines.filter(l => l.includes('← ') && l.includes('Write ')).map(l => {
    const m = l.replace(/\x1b\[[0-9;]*m/g, '').match(/Write\s+(.+)/);
    return m ? m[1].trim() : '';
  }).filter(Boolean);
  const uniqueFiles = [...new Set(writeFiles)];

  // 3. Write loops (same file 3+ times)
  const fileCounts = {};
  writeFiles.forEach(f => { fileCounts[f] = (fileCounts[f] || 0) + 1; });
  const loops = Object.entries(fileCounts).filter(([_, c]) => c >= 3);

  // 4. Build
  const buildRun = lines.some(l => l.includes('npm run build') || l.includes('vite build'));
  const buildPass = lines.some(l => l.includes('built in') || l.includes('Build passed'));
  const buildFail = lines.some(l => l.includes('BUILD FAILED') || l.includes('Build failed'));

  // 5. Hook messages
  const hookMsgs = lines.filter(l => l.includes('[OMU]') || l.includes('🛑'));

  // 6. Errors
  const errors = lines.filter(l => l.includes('Error:') || l.includes('error'));

  // 7. Code fences in writes
  const hasFences = lines.some(l => l.includes('```'));

  // Report
  console.log('=== TRAJECTORY ANALYSIS ===');
  console.log(`Planning: ${hasPlanning ? 'YES' : 'NO'}`);
  console.log(`Total writes: ${writes.length}, Unique files: ${uniqueFiles.length}`);
  console.log(`Files: ${uniqueFiles.join(', ') || 'NONE'}`);
  if (loops.length > 0) {
    console.log(`⚠ WRITE LOOPS: ${loops.map(([f,c]) => `${f}(${c}x)`).join(', ')}`);
  }
  console.log(`Build: ${buildRun ? (buildPass ? 'PASS' : (buildFail ? 'FAIL' : 'RAN')) : 'NOT RUN'}`);
  console.log(`Hook messages: ${hookMsgs.length}`);
  console.log(`Errors: ${errors.length}`);
  if (hasFences) console.log(`⚠ Code fences detected in output`);
  console.log(`Lines: ${lines.length}`);

  // Verdict
  const issues = [];
  if (!hasPlanning) issues.push('NO_PLANNING');
  if (uniqueFiles.length === 0) issues.push('NO_FILES_CREATED');
  if (loops.length > 0) issues.push('WRITE_LOOP');
  if (!buildRun) issues.push('NO_BUILD');
  if (buildFail) issues.push('BUILD_FAILED');
  if (hasFences) issues.push('CODE_FENCES');

  if (issues.length === 0) {
    console.log('VERDICT: PASS');
  } else {
    console.log(`VERDICT: FAIL — ${issues.join(', ')}`);
  }
  console.log('=== END ANALYSIS ===');
} catch(e) {
  console.log(`Analysis error: ${e.message}`);
}
