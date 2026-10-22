// Explicit opt-in integration check. Requires connected endpoints and a dedicated test emulator.
// Invokes only devices, screencap/UIAutomator, and HOME. Does not change settings or install apps.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
const [packageDir, adbPath, ...serials] = process.argv.slice(2);
if (!packageDir || !adbPath || serials.length !== 2) throw Error('Usage: node test/emulator-smoke.mjs PACKAGE_DIR ADB_PATH SERIAL1 SERIAL2');
const { AndroidController, createAdbRunner } = await import(pathToFileURL(join(resolve(packageDir),'lib/core.js')));
const manifest = JSON.parse(await readFile(join(packageDir,'package.json'),'utf8'));
const subprocess = {
  async resolveExecutable() { return adbPath; },
  spawn(spec) {
    const child = spawn(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});
    const done = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(exitCode,signal)=>resolve({exitCode,signal})); });
    const abort = () => child.kill();
    spec.signal.addEventListener('abort',abort,{once:true});
    done.then(()=>spec.signal.removeEventListener('abort',abort),()=>spec.signal.removeEventListener('abort',abort));
    return {stdout:child.stdout,stderr:child.stderr,done,terminate:abort,waitForExit:async()=>{await done;return true;}};
  },
};
const config={adbPath,allowedSerials:serials};
const controller=new AndroidController(config,createAdbRunner(subprocess,config));
const signal=new AbortController().signal;
const devices=await controller.devices(signal);
assert.ok(serials.every(s=>devices.some(d=>d.serial===s && d.state==='device')));
for (const serial of serials) {
  const s=await controller.snapshot(serial,'integration',true,signal);
  assert.ok(s.width>0 && s.height>0 && s.tree?.nodes.length && s.treeError===null);
  console.log(JSON.stringify({version:manifest.version,serial,width:s.width,height:s.height,nodes:s.tree.nodes.length}));
}
const s=await controller.snapshot(serials[0],'integration',false,signal);
await controller.action('key',{key:'HOME'},serials[1],'integration',signal);
assert.throws(()=>controller.getSnapshot(s.snapshotId,'integration',serials[0]),{code:'STALE_SNAPSHOT'});
console.log('Installed package cross-transport invalidation: PASS');
