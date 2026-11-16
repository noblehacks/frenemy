'use strict';
// JSON text spaced and escaped the way the earlier writers of these files wrote it: ", " and
// ": " between parts, and every character outside plain ASCII written as \uXXXX. Files written
// before and after this version then look the same, and read correctly in any text encoding.

function quote(text) {
  // After JSON.stringify every character is either plain printable ASCII or above it.
  return JSON.stringify(text).replace(/[^ -~]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function pyJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return String(value);
    return Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
  }
  if (Array.isArray(value)) return '[' + value.map(pyJson).join(', ') + ']';
  const parts = [];
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue;
    parts.push(quote(key) + ': ' + pyJson(value[key]));
  }
  return '{' + parts.join(', ') + '}';
}

module.exports = { pyJson };
