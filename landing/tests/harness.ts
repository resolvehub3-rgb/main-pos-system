/**
 * Minimal test harness (no dependencies, no network, no database).
 *
 * Tests register themselves with test(); run.ts imports every test file for
 * side effects and then awaits runAll(). A failing run throws at the end,
 * which makes `node tests/run.ts` exit non-zero (safe for CI).
 *
 * Chosen over node:test so the suite needs no @types/node and runs with the
 * exact code the serverless functions use (TypeScript, native Node stripping).
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const registry: TestCase[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  registry.push({name, fn});
}

export function assert(condition: unknown, message = 'assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message ?? 'values differ'}\n    actual:   ${actualJson}\n    expected: ${expectedJson}`,
    );
  }
}

export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: string[] = [];

  for (const testCase of registry) {
    try {
      await testCase.fn();
      passed += 1;
      console.log(`  ok   ${testCase.name}`);
    } catch (error) {
      failures.push(testCase.name);
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${testCase.name}\n       ${detail.replace(/\n/g, '\n       ')}`);
    }
  }

  console.log(`\n${passed}/${registry.length} tests passed`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} test(s) failed: ${failures.join(' | ')}`);
  }
}
