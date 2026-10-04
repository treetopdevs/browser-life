/** Deliberately small synthetic agent: receives metadata, never resolver access or host credentials. */
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const lines = createInterface({ input: process.stdin });
let phase = 0; let operation: unknown; const results: unknown[] = [];
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (phase === 0) { operation = message; process.stdout.write(JSON.stringify(operation) + '\n'); phase++; }
    else {
      results.push(message);
      if (phase === 1) { process.stdout.write(JSON.stringify(operation) + '\n'); phase++; }
      else { writeFileSync('result.json', JSON.stringify({ results, env: process.env, argv: process.argv }), { mode: 0o600 }); lines.close(); process.stdin.destroy(); }
    }
  } catch { process.exitCode = 1; lines.close(); process.stdin.destroy(); }
});
