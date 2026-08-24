/* Shared test helpers: a tiny assert kit and a localStorage stub so the store
   module behaves in node exactly as it does in a WebView. */
'use strict';

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    _map: map
  };
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, e });
    console.error('  FAIL ' + name + '\n      ' + (e && e.message));
  }
}

function eq(a, b, msg) {
  if (a !== b) {
    throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
  }
}

function near(a, b, tol, msg) {
  if (Math.abs(a - b) > (tol == null ? 0.001 : tol)) {
    throw new Error((msg || 'near') + ': expected ~' + b + ', got ' + a);
  }
}

function ok(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy, got ' + JSON.stringify(v));
}

function finish() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}

module.exports = { makeLocalStorage, check, eq, near, ok, finish };
