import test from 'node:test';
import assert from 'node:assert/strict';
import sanitizeHtml from 'sanitize-html';
test(
  'discarded iframe fallback cannot overflow the stack or reset the configured nesting limit',
  { timeout: 5000 },
  () => {
    // GHSA-c9rx-x947-fp3h: exercise the upstream attack input, not a version string.
    assert.doesNotThrow(() => sanitizeHtml('<iframe>'.repeat(20000)));
    const output = sanitizeHtml(('<iframe>' + '<b>'.repeat(3)).repeat(50) + 'safe', {
      allowedTags: ['b'],
      nestingLimit: 3,
    });
    let depth = 0,
      max = 0;
    for (const [tag] of output.matchAll(/<\/?b>/g)) {
      depth += tag === '<b>' ? 1 : -1;
      max = Math.max(max, depth);
    }
    assert.ok(max <= 3, 'discarded fallback must retain the outer nesting budget');
  },
);
