import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

test('real Schemastery Config and Cordis plugin registration/disposal', { skip: !process.env.DSH_TEST_SCHEMA_URL }, async () => {
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/schemastery') return { url: process.env.DSH_TEST_SCHEMA_URL, shortCircuit: true };
    return next(specifier,context);
  } });
  try {
    const plugin = await import('../lib/index.js');
    const defaults = plugin.Config({});
    assert.equal(defaults.approvalMode,'all'); assert.equal(defaults.adbPath,'adb');
    assert.throws(() => plugin.Config({approvalMode:'bad'}));
    const registered = new Map(), disposers = [];
    const ctx = { tools: { register(d) { registered.set(d.name,d); return () => registered.delete(d.name); } },
      effect(factory) { const dispose = factory(); disposers.push(dispose); },
      approval: { request: async () => 'rejected' }, attachments: {}, subprocess: {},
    };
    plugin.apply(ctx,defaults);
    assert.equal(registered.size,12); assert.deepEqual(plugin.inject,['tools','attachments','approval','subprocess']);
    const devices = registered.get('android_devices');
    for (const dispose of disposers.reverse()) await dispose();
    assert.equal(registered.size,0);
    await assert.rejects(devices.execute({}, {agent:{id:'a'},signal:new AbortController().signal}),{code:'PLUGIN_DISPOSED'});
  } finally { hook.deregister(); }
});
