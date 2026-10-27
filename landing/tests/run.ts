/**
 * SamTill commerce — local unit test entry point.
 *
 * Run:  pnpm test   (node tests/run.ts)
 *
 * Pure logic only: no network calls, no database, no file writes, no POS
 * process. Safe to run at any time.
 */

import './signature.test.ts';
import './session.test.ts';
import './commerce-logic.test.ts';
import {runAll} from './harness.ts';

console.log('SamTill commerce — local unit tests\n');
await runAll();
