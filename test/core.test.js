import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { AndroidController, parseDevices, parseHierarchy, parseFocus, pngDimensions, shellQuote, resolveConfig, createAdbRunner, KEYS } from '../lib/core.js';
import { createTools } from '../lib/tools.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X8AAAAASUVORK5CYII=','base64');
const xml = '<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0"><node text="Hello &amp; 世界" resource-id="app:id/test" bounds="[0,0][1,1]" enabled="true" clickable="true"/><node text="secret" password="true" bounds="[0,0][0,0]"/></hierarchy>';
function mock(config = {}) {
  const calls = []; let clock = 100000;
  const run = async (argv, { signal }) => {
    signal?.throwIfAborted(); calls.push(argv);
    if (argv[0] === 'devices') return Buffer.from('List of devices attached\nphone1\tdevice product:p model:m\nphone2\tunauthorized\n');
    if (argv.includes('pull')) { await writeFile(argv.at(-1), png); return Buffer.from('1 file pulled'); }
    if (argv.includes('exec-out')) return png;
    const command = argv.at(-1);
    if (command.startsWith("'cat'")) return Buffer.from(xml);
    if (command.startsWith("'settings'")) return Buffer.from('com.android.adbkeyboard/.AdbIME\n');
    if (command.startsWith("'ime' 'list'")) return Buffer.from('com.android.adbkeyboard/.AdbIME\n');
    return Buffer.from('');
  };
  const controller = new AndroidController(config,run,() => clock);
  return { controller,run,calls,advance: ms => { clock += ms; } };
}
const signal = () => new AbortController().signal;

test('device states and metadata parse, malicious serial ignored', () => {
  assert.deepEqual(parseDevices('List of devices attached\na\tdevice model:Pixel\nb\toffline\nc\tunauthorized\n;evil\tdevice\n').map(d => [d.serial,d.state]), [['a','device'],['b','offline'],['c','unauthorized']]);
});
test('focus parser extracts package/activity and rotation; key whitelist includes search, paste, paging', () => {
  assert.deepEqual(parseFocus('mCurrentFocus=Window{abc u0 com.example/.Main}\n mCurrentRotation=1'),{currentFocus:'com.example/.Main',packageName:'com.example',activity:'.Main',rotation:1});
  assert.equal(KEYS.SEARCH,84); assert.equal(KEYS.PASTE,279); assert.equal(KEYS.PAGE_DOWN,93); assert.equal(KEYS.MOVE_END,123);
});
test('allowlist filters devices and denies unknown serial', async () => {
  const {controller} = mock({allowedSerials:['phone1']});
  assert.equal((await controller.devices(signal())).length,1);
  await assert.rejects(controller.select('phone2',signal()), { code:'DEVICE_DENIED' });
  await assert.rejects(controller.select('-s evil',signal()), { code:'INVALID_SERIAL' });
});
test('multiple online devices fail closed and explicit serial selects', async () => {
  const c = new AndroidController({},async () => Buffer.from('a device\nb device\n'));
  await assert.rejects(c.select(undefined,signal()),{code:'DEVICE_SELECTION_REQUIRED'});
  assert.equal(await c.select('b',signal()),'b');
});
test('multiple transports with matching Android ID collapse to one physical device',async () => {
  const c=new AndroidController({},async argv=>Buffer.from(argv[0]==='devices'?'List of devices attached\na device product:p\nb device product:p\n':'d612cd8698b9f2c8\n'));
  assert.equal(await c.select(undefined,signal()),'a');
});
test('UI hierarchy decodes entities, redacts passwords, truncates, and compacts by default', () => {
  const full=parseHierarchy(xml,500,false), tree=parseHierarchy(xml); assert.equal(full.nodes[0].text,'Hello & 世界'); assert.equal(full.nodes[1].text,'[redacted]');
  assert.equal(tree.nodes.length,1); assert.equal(tree.truncated,false); assert.equal(tree.filteredNodes,1); assert.equal(parseHierarchy(xml,1,false).truncated,true);
  const shellTree='<hierarchy><node class="android.view.View" bounds="[0,0][0,0]"/><node text="bottom" clickable="true" bounds="[0,900][50,950]"/></hierarchy>';
  assert.deepEqual(parseHierarchy(shellTree,1).nodes.map(n=>n.text),['bottom']);
  for (const bad of ['<!DOCTYPE x><hierarchy></hierarchy>','<hierarchy><node></hierarchy>','<hierarchy><wat/></hierarchy>']) assert.throws(() => parseHierarchy(bad),{code:'INVALID_XML'});
  const broken='<hierarchy rotation="1"><node text="raw " quote" resource-id="ok" clickable="true" bounds="[0,0][1,1]"/></hierarchy>';
  const recovered=parseHierarchy(broken); assert.equal(recovered.nodes.length,1); assert.equal(recovered.nodes[0].resourceId,'ok');
});
test('PNG dimensions and invalid screenshot rejection', () => {
  assert.deepEqual(pngDimensions(png),{width:1,height:1}); assert.throws(() => pngDimensions(Buffer.from('failure')),{code:'INVALID_SCREENSHOT'});
});
test('snapshot then element tap uses screen coordinates and invalidates references',async () => {
  const {controller,calls} = mock(); const s = await controller.snapshot('phone1','owner',true,signal());
  await controller.action('tap',{snapshotId:s.snapshotId,elementId:'n1'},'phone1','owner',signal());
  assert.equal(calls.at(-1).at(-1),"'input' 'tap' '0' '0'");
  await assert.rejects(controller.action('tap',{snapshotId:s.snapshotId,x:0,y:0},'phone1','owner',signal()),{code:'STALE_SNAPSHOT'});
  assert.ok(calls.some(c => c.at(-1).startsWith("'rm' '-f' '/sdcard/dsh-android-use-")));
  assert.ok(calls.some(c => c.at(-1).startsWith("'screencap' '-p' '/sdcard/dsh-android-use-")));
  assert.ok(calls.some(c => c.includes('pull')));
});
test('snapshot owner, device, age, bounds and zero-size elements checked',async () => {
  const {controller,advance} = mock(); const s = await controller.snapshot('phone1','one',true,signal());
  for (const [owner,serial] of [['two','phone1'],['one','phone2']]) await assert.rejects(controller.action('tap',{snapshotId:s.snapshotId,x:0,y:0},serial,owner,signal()),{code:'STALE_SNAPSHOT'});
  await assert.rejects(controller.action('tap',{snapshotId:s.snapshotId,x:1,y:0},'phone1','one',signal()),{code:'INVALID_ARGUMENT'});
  await assert.rejects(controller.action('tap',{snapshotId:s.snapshotId,elementId:'n2'},'phone1','one',signal()),{code:'INVALID_ELEMENT'});
  advance(60001); await assert.rejects(controller.action('tap',{snapshotId:s.snapshotId,x:0,y:0},'phone1','one',signal()),{code:'STALE_SNAPSHOT'});
});
test('new snapshot invalidates older snapshot for device',async () => {
  const {controller} = mock(); const a = await controller.snapshot('phone1','one',false,signal());
  await controller.snapshot('phone1','two',false,signal()); assert.throws(() => controller.getSnapshot(a.snapshotId,'one','phone1'),{code:'STALE_SNAPSHOT'});
});
test('ASCII and automatic clipboard Unicode input plus clear/submit options',async () => {
  const {controller,calls} = mock();
  const text = "a b'; $(reboot) & | < >";
  await controller.action('type',{text},'phone1','one',signal()); assert.equal(calls.at(-1).at(-1),"'input' 'text' " + shellQuote(text.replaceAll(' ','%s')));
  await controller.action('type',{text:'safe text',mode:'auto'},'phone1','one',signal()); assert.equal(calls.at(-1).at(-1),"'input' 'text' 'safe%stext'");
  await assert.rejects(controller.action('type',{text:'a\n'},'phone1','one',signal())); await assert.rejects(controller.action('type',{text:''},'phone1','one',signal()));
  await controller.action('type',{text:'中文🙂',clearFirst:true,submit:true},'phone1','one',signal());
  assert.ok(calls.some(c=>c.at(-1).startsWith("'service' 'call' 'clipboard' '1'")));
  assert.ok(calls.some(c=>c.at(-1)==="'input' 'keyevent' '279'"));
  assert.ok(calls.some(c=>c.at(-1)==="'input' 'keyevent' '66'"));
  await assert.rejects(controller.action('type',{text:'中文',mode:'adbkeyboard'},'phone1','one',signal()),{code:'UNICODE_DISABLED'});
  const unicode = mock({unicodeInput:true}); await unicode.controller.action('type',{text:'中文',mode:'adbkeyboard'},'phone1','one',signal());
  assert.ok(unicode.calls.at(-1).at(-1).includes(Buffer.from('中文').toString('base64')));
});
test('ADB Keyboard mode auto-switches and restores the previous IME',async () => {
  const calls=[], old='com.example/.Ime', adb='com.android.adbkeyboard/.AdbIME';
  const c=new AndroidController({unicodeInput:true},async argv=>{calls.push(argv);const cmd=argv.at(-1);if(cmd.startsWith("'settings'"))return Buffer.from(old);if(cmd.startsWith("'ime' 'list'"))return Buffer.from(adb);return Buffer.from('');});
  await c.action('type',{text:'中文',mode:'adbkeyboard'},'phone','owner',signal());
  assert.ok(calls.some(a=>a.at(-1)===`'ime' 'set' '${adb}'`)); assert.ok(calls.some(a=>a.at(-1)===`'ime' 'set' '${old}'`));
});
test('read-only, arbitrary key and component injection are denied',async () => {
  const ro = mock({readOnly:true}); await assert.rejects(ro.controller.action('key',{key:'HOME'},'phone1','one',signal()),{code:'READ_ONLY'});
  const {controller} = mock(); await assert.rejects(controller.action('key',{key:'REBOOT'},'phone1','one',signal()),{code:'INVALID_ARGUMENT'});
  await assert.rejects(controller.action('launch',{component:'com.android.settings/.Settings;reboot'},'phone1','one',signal()),{code:'INVALID_ARGUMENT'});
  assert.throws(() => resolveConfig({timeoutMs:0}),{code:'INVALID_ARGUMENT'});
});
test('global queue serializes calls and proceeds after rejection',async () => {
  const {controller} = mock(); const order = []; let release; const gate = new Promise(r => {release=r;});
  const a = controller.exclusive(async () => {order.push('a'); await gate; throw Error('expected');},signal());
  const b = controller.exclusive(async () => {order.push('b');},signal());
  await Promise.resolve(); assert.deepEqual(order,['a']); release(); await assert.rejects(a); await b; assert.deepEqual(order,['a','b']);
});
test('tree failure returns screenshot plus warning; cleanup attempted',async () => {
  const calls=[]; const c=new AndroidController({},async a => { calls.push(a); if(a[0]==='pull'){await writeFile(a.at(-1),png);return Buffer.from('ok');} if(a.includes('exec-out'))return png; if(a.at(-1).startsWith("'uiautomator'"))throw Error('no accessibility'); return Buffer.from(''); });
  const s=await c.snapshot('a','owner',true,signal()); assert.equal(s.tree,null); assert.equal(s.treeError,'no accessibility'); assert.deepEqual(s.data,png); assert.ok(calls.some(c=>c.at(-1).startsWith("'rm'")));
});
test('screenshot falls back to exec-out when the device temp file cannot be written',async () => {
  const calls=[]; const c=new AndroidController({},async a => { calls.push(a); if(a.at(-1).startsWith("'screencap'"))throw Error('read-only fs'); if(a.includes('exec-out'))return png; return Buffer.from(''); });
  const s=await c.snapshot('a','owner',false,signal()); assert.deepEqual(s.data,png); assert.ok(calls.some(a=>a.includes('exec-out')));
});
test('package launch resolves the launcher activity instead of relying on monkey',async () => {
  const calls=[]; const c=new AndroidController({},async a => { calls.push(a); const cmd=a.at(-1);
    if(cmd.startsWith("'cmd' 'package' 'resolve-activity'"))return Buffer.from('priority=0\ncom.microsoft.bing/com.microsoft.sapphire.app.main.SapphireMainActivity\n'); return Buffer.from(''); });
  await c.action('launch',{package:'com.microsoft.bing'},'phone','owner',signal());
  assert.equal(calls.at(-1).at(-1),"'am' 'start' '-W' '-n' 'com.microsoft.bing/com.microsoft.sapphire.app.main.SapphireMainActivity'");
  const fallback=[]; const c2=new AndroidController({},async a => { fallback.push(a); return Buffer.from('no matches'); });
  await c2.action('launch',{package:'com.example'},'phone','owner',signal());
  assert.equal(fallback.at(-1).at(-1),"'monkey' '-p' 'com.example' '-c' 'android.intent.category.LAUNCHER' '1'");
});
test('action results never contain undefined values so tool output stays lossless JSON',async () => {
  const {controller}=mock();
  for (const [kind,args] of [['key',{key:'HOME'}],['launch',{package:'com.example.app'}]]) {
    const value=await controller.action(kind,args,'phone1','o',signal());
    assert.equal(Object.values(value).includes(undefined),false,`${kind} emitted an undefined value`);
    assert.deepEqual(JSON.parse(JSON.stringify(value)),value);
  }
  // tap needs its own fresh snapshot: every mutation retires existing references.
  for (const kind of ['tap']) {
    const id=(await controller.snapshot('phone1','o',false,signal())).snapshotId;
    const value=await controller.action(kind,{snapshotId:id,x:0,y:0},'phone1','o',signal());
    assert.equal(Object.values(value).includes(undefined),false,`${kind} emitted an undefined value`);
    assert.deepEqual(JSON.parse(JSON.stringify(value)),value);
  }
  const typed=await controller.action('type',{text:'ok'},'phone1','o',signal()); assert.equal(typed.mode,'auto');
});
test('autoConnect recovers subsequent disconnects without reconnecting online transports',async () => {
  const calls=[]; let online=false;
  const c=new AndroidController({autoConnect:['127.0.0.1:5555']},async a => {
    calls.push(a); if(a[0]==='connect'){online=true; return Buffer.from('connected');}
    return Buffer.from(online?'127.0.0.1:5555\tdevice\n':'');
  });
  await c.devices(signal()); await c.devices(signal());
  assert.equal(calls.filter(a=>a[0]==='connect').length,1);
  online=false; await c.devices(signal());
  assert.equal(calls.filter(a=>a[0]==='connect').length,2);
  for(const endpoint of ['10.0.0.1:5555','localhost:0','127.0.0.1:65536','::1:5555','[::1:5555'])
    assert.throws(() => resolveConfig({autoConnect:[endpoint]}),{code:'INVALID_CONFIG'});
  assert.doesNotThrow(() => resolveConfig({autoConnect:['[::1]:5555']}));
  assert.throws(() => resolveConfig({remoteDir:'relative/path'}),{code:'INVALID_CONFIG'});
});
test('autoConnect respects allowlist and propagates cancellation',async () => {
  const calls=[]; const c=new AndroidController({autoConnect:['127.0.0.1:5555'],allowedSerials:['phone']},async a=>{calls.push(a);return Buffer.from('');});
  await c.devices(signal()); assert.equal(calls.some(a=>a[0]==='connect'),false);
  const abort=new AbortController();
  const c2=new AndroidController({autoConnect:['localhost:5555']},async a=>{if(a[0]==='connect'){abort.abort(Error('cancelled'));throw abort.signal.reason;}return Buffer.from('');});
  await assert.rejects(c2.devices(abort.signal),/cancelled/);
});
function toolContext(outcome='allowed-once') {
  const approvals=[]; const ctx={approval:{request:async r=>{approvals.push(r); return outcome;}},attachments:{saveImage:async ({data})=>({attachmentId:'sha256:'+'a'.repeat(64),mediaType:'image/png',bytes:data.length,width:1,height:1})}};
  return {ctx,approvals};
}
const exec = () => ({agent:{id:'owner'},callId:'test-call',signal:signal()});
test('tools register Android schemas, image output is durable attachment',async () => {
  const {ctx,approvals}=toolContext(), {run}=mock(); const {definitions}=createTools(ctx,{},run);
  assert.ok(definitions.length>=12); const tool=definitions.find(d=>d.name==='android_snapshot'); const value=await tool.execute({},exec());
  assert.equal(approvals.length,1); assert.deepEqual(tool.output.render({},value).map(b=>b.type),['text','image']); assert.equal(value.imageCoordinates.scaleX,1);
});
test('connect is restricted to localhost and package listing is read-only',async () => {
  const {ctx}=toolContext(), {run,calls}=mock(), {definitions}=createTools(ctx,{approvalMode:'none'},run);
  await definitions.find(d=>d.name==='android_connect').execute({port:5555},exec());
  assert.ok(calls.some(c=>c[0]==='connect'&&c[1]==='127.0.0.1:5555'));
  await assert.rejects(definitions.find(d=>d.name==='android_connect').execute({host:'example.com',port:5555},exec()),{code:'INVALID_ARGUMENT'});
  const pkgs=await definitions.find(d=>d.name==='android_packages').execute({filter:'maps'},exec()); assert.deepEqual(pkgs.packages,[]);
  const snapshot=await definitions.find(d=>d.name==='android_snapshot').execute({serial:'phone1'},exec());
  const found=await definitions.find(d=>d.name==='android_find').execute({serial:'phone1',snapshotId:snapshot.snapshotId,query:'hello'},exec()); assert.equal(found.matches[0].text,'Hello & 世界');
});
test('rejected/unavailable approvals never reach ADB',async () => {
  for(const outcome of ['rejected','cancelled','unavailable']) {
    const {ctx}=toolContext(outcome); let called=false; const {definitions}=createTools(ctx,{},async()=>{called=true;});
    await assert.rejects(definitions[0].execute({},exec()),{code:'APPROVAL_DENIED'}); assert.equal(called,false);
  }
});
test('mutation-only approvals skip observation but approve control',async () => {
  const {ctx,approvals}=toolContext(), {run}=mock(); const {definitions}=createTools(ctx,{approvalMode:'mutations'},run);
  await definitions[0].execute({},exec()); assert.equal(approvals.length,0);
  await definitions.find(d=>d.name==='android_key').execute({key:'HOME'},exec()); assert.equal(approvals.length,1);
});
test('runtime tool validation prevents undeclared raw shell inputs',async () => {
  const {ctx}=toolContext(); const {definitions}=createTools(ctx,{},mock().run);
  await assert.rejects(definitions[0].execute({shell:'reboot'},exec()),{code:'INVALID_ARGUMENT'});
  await assert.rejects(definitions[0].execute({}, {signal:signal()}),{code:'AGENT_REQUIRED'});
  await assert.rejects(definitions.find(d=>d.name==='android_wait').execute({milliseconds:10001},exec()),{code:'INVALID_ARGUMENT'});
});
test('pre-aborted tool does not approve or run',async () => {
  const {ctx,approvals}=toolContext();const {definitions}=createTools(ctx,{},mock().run); const ac=new AbortController(); ac.abort();
  await assert.rejects(definitions[0].execute({}, {...exec(),signal:ac.signal})); assert.equal(approvals.length,0);
});
test('swipe, long press and explicit launch use allowlisted commands',async () => {
  const {controller,calls}=mock(); let s=await controller.snapshot('phone1','one',false,signal());
  await controller.action('swipe',{snapshotId:s.snapshotId,x1:0,y1:0,x2:0,y2:0,durationMs:400},'phone1','one',signal());
  assert.equal(calls.at(-1).at(-1),"'input' 'swipe' '0' '0' '0' '0' '400'");
  s=await controller.snapshot('phone1','one',false,signal());
  await controller.action('tap',{snapshotId:s.snapshotId,x:0,y:0,durationMs:800},'phone1','one',signal());
  assert.equal(calls.at(-1).at(-1),"'input' 'swipe' '0' '0' '0' '0' '800'");
  await controller.action('launch',{component:'com.android.settings/.Settings'},'phone1','one',signal());
  assert.equal(calls.at(-1).at(-1),"'am' 'start' '-W' '-n' 'com.android.settings/.Settings'");
  await controller.action('launch',{package:'com.android.settings'},'phone1','one',signal());
  assert.equal(calls.at(-1).at(-1),"'monkey' '-p' 'com.android.settings' '-c' 'android.intent.category.LAUNCHER' '1'");
  await controller.action('launch',{uri:'https://example.org/path?q=1'},'phone1','one',signal());
  assert.ok(calls.at(-1).at(-1).includes("'android.intent.action.VIEW'"));
  await assert.rejects(controller.action('launch',{uri:'file:///etc/passwd'},'phone1','one',signal()),{code:'INVALID_ARGUMENT'});
});
test('coordinate swipe works without snapshot and semantic scroll repeats based on display size',async () => {
  const calls=[], c=new AndroidController({},async argv=>{calls.push(argv);if(argv.at(-1)==="'wm' 'size'")return Buffer.from('Physical size: 1920x1092\\n');return Buffer.from('');});
  await c.action('swipe',{x1:10,y1:20,x2:10,y2:500},'phone','owner',signal());
  assert.equal(calls.at(-1).at(-1),"'input' 'swipe' '10' '20' '10' '500' '350'");
  const result=await c.action('scroll',{direction:'down',repeat:3,intervalMs:0},'phone','owner',signal());
  assert.equal(result.repeat,3); assert.equal(calls.filter(a=>a.at(-1).startsWith("'input' 'swipe'")).length,4);
});
test('failed mutation still invalidates prior snapshot',async () => {
  const {controller,run}=mock();const s=await controller.snapshot('phone1','one',false,signal());
  controller.run=async a=>{if(a.at(-1).startsWith("'input'"))throw Error('lost connection');return run(a,{signal:signal()});};
  await assert.rejects(controller.action('tap',{snapshotId:s.snapshotId,x:0,y:0},'phone1','one',signal()));
  assert.throws(()=>controller.getSnapshot(s.snapshotId,'one','phone1'),{code:'STALE_SNAPSHOT'});
});
test('runner timeout aborts managed child and awaits termination',async () => {
  let terminated=false,waited=false;
  const p={resolveExecutable:async()=>'/adb',spawn(spec){
    const stdout=new Readable({read(){}}),stderr=new Readable({read(){}});
    const done=new Promise(resolve=>spec.signal.addEventListener('abort',()=>{stdout.push(null);stderr.push(null);resolve({exitCode:null,signal:null});},{once:true}));
    return {stdout,stderr,done,terminate(){terminated=true;},waitForExit:async()=>{waited=true;return true;}};
  }};
  await assert.rejects(createAdbRunner(p,{})(['devices'],{signal:signal(),timeoutMs:5,maxBytes:1024}),{code:'ADB_TIMEOUT'});
  assert.ok(terminated && waited);
});
test('plugin disposal cancels in-flight operation and drains queue',async () => {
  const {ctx}=toolContext();let started;
  const ready=new Promise(r=>{started=r;});
  const tools=createTools(ctx,{approvalMode:'none'},async (_a,{signal})=>new Promise((_resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
  const pending=tools.definitions[0].execute({},exec());
  await ready; const rejected=assert.rejects(pending,{code:'PLUGIN_DISPOSED'});await tools.dispose();await rejected;
});
test('aliased transports invalidate all snapshot references on mutation and observation',async () => {
  const {controller}=mock();
  let s=await controller.snapshot('127.0.0.1:5555','one',false,signal());
  await controller.action('key',{key:'HOME'},'127.0.0.1:16384','one',signal());
  assert.throws(()=>controller.getSnapshot(s.snapshotId,'one','127.0.0.1:5555'),{code:'STALE_SNAPSHOT'});
  s=await controller.snapshot('127.0.0.1:5555','one',false,signal());
  await controller.snapshot('127.0.0.1:16384','one',false,signal());
  assert.throws(()=>controller.getSnapshot(s.snapshotId,'one','127.0.0.1:5555'),{code:'STALE_SNAPSHOT'});
});
function subprocess(stdout,stderr='',exitCode=0) {
  const specs=[];
  return {specs,resolveExecutable:async()=>'/adb',spawn:spec=>{specs.push(spec);return {stdout:Readable.from([stdout]),stderr:Readable.from([stderr]),done:Promise.resolve({exitCode,signal:null}),terminate(){},waitForExit:async()=>true};}};
}
test('runner preserves binary screenshot and invokes managed subprocess with argv',async () => {
  const p=subprocess(png); const run=createAdbRunner(p,{}); assert.deepEqual(await run(['devices'],{signal:signal(),timeoutMs:1000,maxBytes:1024}),png);
  assert.deepEqual(p.specs[0].argv,['/adb','devices']); assert.equal(p.specs[0].stdio.stdout,'pipe');
});
test('runner reports nonzero exit and enforces output cap',async () => {
  await assert.rejects(createAdbRunner(subprocess('','unauthorized',1),{})(['devices'],{signal:signal(),timeoutMs:1000,maxBytes:1024}),{code:'ADB_FAILED'});
  await assert.rejects(createAdbRunner(subprocess(Buffer.alloc(20)),{})(['devices'],{signal:signal(),timeoutMs:1000,maxBytes:10}),{code:'OUTPUT_LIMIT'});
});
test('runner auto-discovers ADB from ANDROID_HOME when default adb is not on PATH',async () => {
  const prev=process.env.ANDROID_HOME; process.env.ANDROID_HOME='C:\\CustomAndroidSdk';
  try {
    const tried=[];
    const p={
      async resolveExecutable(candidate){tried.push(candidate);if(candidate.includes('CustomAndroidSdk'))return candidate;throw Error('not found');},
      spawn:spec=>({stdout:Readable.from([Buffer.from('ok')]),stderr:Readable.from([]),done:Promise.resolve({exitCode:0,signal:null}),terminate(){},waitForExit:async()=>true}),
    };
    const out=await createAdbRunner(p,{})(['devices'],{signal:signal(),timeoutMs:1000,maxBytes:1024});
    assert.equal(out.toString(),'ok');
    assert.ok(tried.some(c=>c.includes('CustomAndroidSdk')&&c.includes('platform-tools')));
  } finally {
    if(prev===undefined)delete process.env.ANDROID_HOME; else process.env.ANDROID_HOME=prev;
  }
});
