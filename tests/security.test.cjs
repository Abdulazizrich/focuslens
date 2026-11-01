const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveAsset, validateChat, isAppOrigin } = require('../electron/security.cjs');
test('camera permission recognizes serialized app origins with or without a trailing slash', () => {
  assert.equal(isAppOrigin('focuslens://app'), true);
  assert.equal(isAppOrigin('focuslens://app/'), true);
  for (const origin of ['focuslens://app.attacker/', 'https://app/', 'focuslens://user@app/', 'focuslens://app:99/', 'null', undefined]) assert.equal(isAppOrigin(origin), false);
});
test('static serving stays within the application root', () => {
  const root = path.resolve('out');
  assert.equal(resolveAsset(root,'focuslens://app/stats/'), path.join(root,'stats','index.html'));
  assert.throws(()=>resolveAsset(root,'https://attacker.test/file'));
  assert.throws(()=>resolveAsset(root,'focuslens://app/%2e%2e%5csecret'));
  assert.throws(()=>resolveAsset(root,'focuslens://app/%00'));
});
test('AI payload accepts only bounded aggregate metrics', () => {
  const result = validateChat({message:'help',locale:'uz',summary:{focusMin:42,streak:9,totalFocusMin:1000,frame:'private',name:'private',score:Infinity,key:'secret'}});
  assert.deepEqual(result.summary,{focusMin:42});
  assert.throws(()=>validateChat({message:'x'.repeat(4001)}));
  assert.throws(()=>validateChat({message:''}));
});
