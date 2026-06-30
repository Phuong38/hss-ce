import { collapseStackTraces, crushLog } from '../src/log-crusher.js';
import * as assert from 'node:assert';

function testJsStackCollapse() {
  console.log('Testing JS Stack Trace Collapsing...');
  
  const rawLog = `Error: Something failed
    at Context.<anonymous> (tests/my_test.js:12:9)
    at callFn (node_modules/mocha/lib/runnable.js:366:21)
    at Test.Runnable.run (node_modules/mocha/lib/runnable.js:354:15)
    at Runner.runTest (node_modules/mocha/lib/runner.js:666:10)
    at Runner.runTests (node_modules/mocha/lib/runner.js:777:12)
    at processImmediate (node:internal/timers:476:21)`;

  const collapsed = collapseStackTraces(rawLog);
  console.log('Collapsed output:\n', collapsed);

  assert.ok(collapsed.includes('tests/my_test.js:12:9'), 'Should preserve project stack line');
  assert.ok(collapsed.includes('[... 5 internal stack frames elided]'), 'Should collapse mocha lines');
  assert.ok(!collapsed.includes('processImmediate'), 'Should elide internal details like processImmediate');
}

function testPyStackCollapse() {
  console.log('Testing Python Stack Trace Collapsing...');
  
  const rawLog = `Traceback (most recent call last):
  File "app/main.py", line 45, in index
    do_something()
  File "/usr/lib/python3.10/unittest/case.py", line 549, in run
    self._callTestMethod(testMethod)
  File "/usr/lib/python3.10/unittest/case.py", line 500, in _callTestMethod
    method()
  File ".venv/lib/python3.10/site-packages/pytest/runner.py", line 120, in run
    result = test()`;

  const collapsed = collapseStackTraces(rawLog);
  console.log('Collapsed output:\n', collapsed);

  assert.ok(collapsed.includes('app/main.py'), 'Should preserve project python file');
  assert.ok(collapsed.includes('[... 3 internal stack frames elided]'), 'Should group Python/pytest internal paths');
}

function testTokenPruning() {
  console.log('Testing Token Budget Pruning...');
  
  // Create a log with 200 lines
  const lines = [];
  for (let i = 0; i < 200; i++) {
    if (i === 100) {
      lines.push(`Line ${i}: fatal error: compilation failed`);
    } else {
      lines.push(`Line ${i}: normal output text that repeats info`);
    }
  }
  
  const rawLog = lines.join('\n');
  
  // Set budget low (e.g. 300 tokens, which is ~1200 characters)
  const crushed = crushLog(rawLog, '.', 300);
  console.log('Crushed log snippet:\n', crushed.slice(0, 500), '\n...\n', crushed.slice(-300));
  
  assert.ok(crushed.includes('compilation failed'), 'Should preserve error line');
  assert.ok(crushed.includes('[...'), 'Should elide non-essential parts');
  assert.ok(crushed.split('\n').length < 100, 'Should significantly reduce total lines');
}

try {
  testJsStackCollapse();
  console.log('✅ JS Stack Collapse Pass');
  testPyStackCollapse();
  console.log('✅ Python Stack Collapse Pass');
  testTokenPruning();
  console.log('✅ Token Pruning Pass');
  console.log('All Log Crusher tests completed successfully!');
  process.exit(0);
} catch (err) {
  console.error('❌ Test failed:', err);
  process.exit(1);
}
