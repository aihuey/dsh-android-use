import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, rm } from 'node:fs/promises';

export class AndroidUseError extends Error {
  constructor(code, message) { super(message); this.name = 'AndroidUseError'; this.code = code; }
}
const fail = (code, message) => { throw new AndroidUseError(code, message); };
export function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_ARGUMENT', `${name} must be an integer in ${min}..${max}`);
  return value;
}
export function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function string8Parcel(value) {
  const bytes=Buffer.from(value,'utf8'), padded=Buffer.alloc(Math.ceil((bytes.length+1)/4)*4); bytes.copy(padded);
  const args=['i32',String(bytes.length)];
  for(let i=0;i<padded.length;i+=4) args.push('i32',String(padded.readInt32LE(i)));
  return args;
}
function clipboardArgs(text) {
  return ['service','call','clipboard','1','i32','1','i32','1',...string8Parcel('dsh'),'i32','1','s16','text/plain','i32','-1','i64','0','i32','0','i32','1','i32','0','i32','0','i32','1','i32','1',...string8Parcel(text),'i32','-1','i32','0','i32','0','s16','com.android.shell','i32','0'];
}
export function parseFocus(text) {
  const component=/mCurrentFocus=Window\{[^}]*?\bu\d+\s+([^\s}]+)/.exec(text)?.[1] ?? /mFocusedApp=ActivityRecord\{[^}]*?\bu\d+\s+([^\s}]+)/.exec(text)?.[1] ?? null;
  const rotation=Number(/mCurrentRotation=(\d+)/.exec(text)?.[1] ?? /mRotation=(\d+)/.exec(text)?.[1] ?? NaN);
  const [packageName,activity]=component?.split('/',2) ?? [];
  return { currentFocus:component, packageName:packageName??null, activity:activity??null, rotation:Number.isFinite(rotation)?rotation:null };
}
export const KEYS = { HOME: 3, BACK: 4, ENTER: 66, SEARCH: 84, DEL: 67, TAB: 61, ESCAPE: 111, APP_SWITCH: 187, SPACE: 62, DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, PAGE_UP: 92, PAGE_DOWN: 93, MOVE_HOME: 122, MOVE_END: 123, PASTE: 279, WAKEUP: 224, VOLUME_UP: 24, VOLUME_DOWN: 25 };
const serialPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:\-\[\]]{0,199}$/;
export function validateSerial(serial) {
  if (typeof serial !== 'string' || !serialPattern.test(serial)) fail('INVALID_SERIAL', 'Invalid ADB serial');
  return serial;
}
export function parseDevices(text) {
  return text.split(/\r?\n/).flatMap(line => {
    const match = /^([^\s]+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions)(?:\s|$)(.*)$/.exec(line.trim());
    if (!match || !serialPattern.test(match[1])) return [];
    const metadata = Object.fromEntries([...match[3].matchAll(/(\w+):([^\s]+)/g)].map(m => [m[1], m[2]]));
    return [{ serial: match[1], state: match[2], ...metadata }];
  });
}
function entity(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) => {
    if (key[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key.toLowerCase()];
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
}
// Restricted parser for Android UIAutomator's fixed hierarchy/node dialect, not general XML.
export function parseHierarchy(xml, maxNodes = 500, compact = true) {
  if (typeof xml !== 'string' || xml.length > 4 * 1024 * 1024 || /<!/.test(xml)) fail('INVALID_XML', 'Unsupported or oversized UI hierarchy');
  const start = xml.indexOf('<hierarchy');
  if (start < 0 || !xml.trimEnd().endsWith('</hierarchy>')) fail('INVALID_XML', 'Missing UI hierarchy');
  const source = xml.slice(start), tokens = [];
  // Walk tags while respecting quoted values: WebView text can contain a literal >.
  for (let pos = 0; pos < source.length;) {
    const lt = source.indexOf('<', pos); if (lt < 0) break;
    let quote = '', end = lt + 1;
    for (; end < source.length; end++) {
      const c=source[end];
      if(quote){ if(c===quote && /^(?:\s+[A-Za-z_:][\w:.-]*\s*=|\s*\/?\s*>)/.test(source.slice(end+1))) quote=''; }
      else if(c==='"'||c==="'") quote=c;
      else if(c==='>') break;
    }
    if (end >= source.length) fail('INVALID_XML', 'Unterminated hierarchy tag');
    tokens.push(source.slice(lt, end + 1)); pos = end + 1;
  }
  const stack = [], nodes = [];
  let total = 0, rotation = 0, rootSeen = false;
  for (const token of tokens) {
    if (!token.startsWith('<')) { if (token.trim()) fail('INVALID_XML', 'Unexpected node text'); continue; }
    const m = /^<(\/?)(hierarchy|node)([\s\S]*?)?(\/?)>$/.exec(token);
    if (!m) fail('INVALID_XML', 'Unexpected hierarchy markup');
    const [, closing, tag, attributes = '', self] = m;
    if (closing) { if (attributes.trim() || self || stack.pop() !== tag) fail('INVALID_XML', 'Unbalanced hierarchy'); continue; }
    if ((tag === 'hierarchy' && (stack.length || rootSeen || self)) || (tag === 'node' && !stack.length)) fail('INVALID_XML', 'Invalid hierarchy nesting');
    if (tag === 'hierarchy') rootSeen = true;
    const attrs = {};
    // Recover each attribute independently; an unescaped quote in one value must
    // not discard otherwise useful siblings in a WebView-heavy hierarchy.
    const attrRe = /(?:^|\s)([\w:-]+)\s*=\s*"([\s\S]*?)"(?=\s+[\w:-]+\s*=\s*"|\s*$)/g;
    for (const a of attributes.matchAll(attrRe)) if (!Object.hasOwn(attrs,a[1])) attrs[a[1]] = entity(a[2]);
    if (tag === 'hierarchy') rotation = Number(attrs.rotation ?? 0);
    else {
      total++;
      {
        const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attrs.bounds ?? '');
        const box = bounds ? bounds.slice(1).map(Number) : null;
        const node = { id: `n${total}`, parentDepth: stack.length - 1, text: attrs.password === 'true' ? '[redacted]' : (attrs.text ?? ''), description: attrs.password === 'true' ? '[redacted]' : (attrs['content-desc'] ?? ''), resourceId: attrs['resource-id'] ?? '', className: attrs.class ?? '', packageName: attrs.package ?? '', clickable: attrs.clickable === 'true', enabled: attrs.enabled !== 'false', focused: attrs.focused === 'true', scrollable: attrs.scrollable === 'true', password: attrs.password === 'true', bounds: box };
        const visible = !box || (box[2] > box[0] && box[3] > box[1]) || node.focused;
        const useful = Boolean(node.text || node.description || node.resourceId || node.clickable || node.scrollable || node.focused || node.password);
        if (!compact || (visible && useful)) nodes.push(node);
      }
    }
    if (!self) stack.push(tag);
  }
  if (stack.length) fail('INVALID_XML', 'Unclosed hierarchy');
  const retainedBeforeCap=nodes.length, filteredNodes=Math.max(0,total-retainedBeforeCap);
  const truncated=retainedBeforeCap>maxNodes;
  if (nodes.length > maxNodes) {
    const priority = n => (n.focused ? 12 : 0) + (n.clickable ? 8 : 0) + (n.scrollable ? 5 : 0) + (n.text ? 3 : 0) + (n.description ? 3 : 0) + (n.resourceId ? 2 : 0) + (n.bounds ? 1 : 0);
    const chosen = nodes.map((node,index) => ({ node,index,score:priority(node) })).sort((a,b) => b.score-a.score || a.index-b.index).slice(0,maxNodes).sort((a,b) => a.index-b.index);
    nodes.splice(0,nodes.length,...chosen.map(x => x.node));
  }
  return { rotation, nodes, totalNodes: total, filteredNodes, retainedNodes: nodes.length, compact, truncated };
}
export function pngDimensions(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 24 || !b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b.toString('ascii',12,16) !== 'IHDR') fail('INVALID_SCREENSHOT', 'ADB did not return a PNG');
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  if (!width || !height || width > 32768 || height > 32768) fail('INVALID_SCREENSHOT', 'Invalid PNG dimensions');
  return { width, height };
}
export function resolveConfig(raw = {}) {
  const config = { adbPath: 'adb', serial: '', allowedSerials: [], approvalMode: 'all', readOnly: false, timeoutMs: 15000, snapshotTtlMs: 60000, maxNodes: 500, maxOutputBytes: 16 * 1024 * 1024, unicodeInput: false, remoteDir: '/sdcard', autoConnect: [], ...raw };
  if (typeof config.adbPath !== 'string' || !config.adbPath || /[\r\n\0]/.test(config.adbPath)) fail('INVALID_CONFIG', 'Invalid adbPath');
  if (typeof config.remoteDir !== 'string' || !/^\/[^\r\n\0\s]*$/.test(config.remoteDir)) fail('INVALID_CONFIG', 'Invalid remoteDir');
  if (!Array.isArray(config.autoConnect)) fail('INVALID_CONFIG', 'autoConnect must be an array');
  config.autoConnect.forEach(a => {
    const match = typeof a === 'string' && /^(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(a);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) fail('INVALID_CONFIG', `Invalid autoConnect entry ${a}`);
  });
  if (!['all','mutations','none'].includes(config.approvalMode)) fail('INVALID_CONFIG', 'Invalid approvalMode');
  if (!Array.isArray(config.allowedSerials)) fail('INVALID_CONFIG', 'allowedSerials must be an array');
  config.allowedSerials.forEach(validateSerial); if (config.serial) validateSerial(config.serial);
  for (const name of ['readOnly','unicodeInput']) if (typeof config[name] !== 'boolean') fail('INVALID_CONFIG', `${name} must be boolean`);
  integer(config.timeoutMs, 'timeoutMs', 1000, 120000); integer(config.snapshotTtlMs, 'snapshotTtlMs', 1000, 300000);
  integer(config.maxNodes, 'maxNodes', 1, 2000); integer(config.maxOutputBytes, 'maxOutputBytes', 1024 * 1024, 64 * 1024 * 1024);
  return config;
}
export class AndroidController {
  constructor(config, run, now = Date.now) { this.config = resolveConfig(config); this.run = run; this.now = now; this.snapshots = new Map(); this.tail = Promise.resolve(); }
  async exclusive(operation, signal) {
    const previous = this.tail; let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { signal?.throwIfAborted(); return await operation(); } finally { release(); }
  }
  async adb(args, signal) { return this.run(args, { signal, timeoutMs: this.config.timeoutMs, maxBytes: this.config.maxOutputBytes }); }
  // Windows text-mode pipes can rewrite binary payloads, so pull the PNG through a
  // device file instead of trusting `exec-out` bytes. The device file is always removed.
  async pullFile(serial, remote, local, signal) {
    try {
      await this.adb(['-s',serial,'pull',remote,local], signal);
      signal?.throwIfAborted();
      const file = await open(local, 'r');
      try {
        const size = (await file.stat()).size;
        if (size > this.config.maxOutputBytes) fail('OUTPUT_LIMIT','Pulled screenshot exceeded limit');
        const data = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          signal?.throwIfAborted();
          const { bytesRead } = await file.read(data, offset, size - offset, offset);
          if (!bytesRead) fail('INVALID_SCREENSHOT','Incomplete pulled screenshot');
          offset += bytesRead;
        }
        return data;
      } finally { await file.close(); }
    } finally { await rm(local,{force:true}).catch(() => {}); }
  }
  async shell(serial, args, signal) { return this.adb(['-s', serial, 'shell', args.map(shellQuote).join(' ')], signal); }
  permitted(serial) { return !this.config.allowedSerials.length || this.config.allowedSerials.includes(serial); }
  // Connections belong to the ADB server, not a shell. Reconnect missing/offline
  // configured transports after a server restart without replaying device inputs.
  async devices(signal) {
    const list = async () => parseDevices(Buffer.from(await this.adb(['devices','-l'], signal)).toString('utf8')).filter(d => this.permitted(d.serial));
    let devices = await list(), attempted = false;
    for (const endpoint of this.config.autoConnect) {
      if (!this.permitted(endpoint) || devices.some(d => d.serial === endpoint && d.state === 'device')) continue;
      signal?.throwIfAborted();
      attempted = true;
      try { await this.adb(['connect',endpoint],signal); }
      catch (error) { if (signal?.aborted) throw error; }
    }
    if (attempted) devices = await list();
    return devices;
  }
  async select(requested, signal) {
    const list = await this.devices(signal), serial = requested ?? (this.config.serial || undefined);
    if (serial) {
      validateSerial(serial); if (!this.permitted(serial)) fail('DEVICE_DENIED', 'Device is not in allowedSerials');
      const d = list.find(d => d.serial === serial); if (!d || d.state !== 'device') fail('DEVICE_UNAVAILABLE', `Device ${serial} is missing, offline, or unauthorized`);
      return serial;
    }
    const ready = list.filter(d => d.state === 'device');
    if (ready.length === 1) return ready[0].serial;
    if (ready.length > 1) {
      const ids = await Promise.all(ready.map(async d => {
        try { return Buffer.from(await this.shell(d.serial,['settings','get','secure','android_id'],signal)).toString('utf8').trim(); } catch { return ''; }
      }));
      if (/^[a-f0-9]{8,32}$/i.test(ids[0]) && ids.every(id => id === ids[0])) return [...ready].sort((a,b) => a.serial.localeCompare(b.serial))[0].serial;
      const choices = ready.map(d => d.serial).join(', ');
      fail('DEVICE_SELECTION_REQUIRED', `Multiple Android devices are online (${choices}); specify serial`);
    }
    fail('DEVICE_UNAVAILABLE','No online Android device is available');
  }
  prune() { for (const [id, s] of this.snapshots) if (this.now() - s.at > this.config.snapshotTtlMs) this.snapshots.delete(id); }
  // ADB serials are transport names, not physical identities: emulator ports may alias.
  // Conservatively retire all references on every snapshot/mutation across transports.
  invalidate(_serial) { this.snapshots.clear(); }
  getSnapshot(id, owner, serial) {
    this.prune(); const s = this.snapshots.get(id);
    if (!s || s.owner !== owner || s.serial !== serial) fail('STALE_SNAPSHOT', 'Take a fresh snapshot in this session for this device');
    return s;
  }
  async snapshot(serial, owner, includeTree, signal, compact = true) {
    const remote = `${this.config.remoteDir}/dsh-android-use-${randomUUID()}.png`, local = join(tmpdir(), `dsh-android-use-${randomUUID()}.png`);
    let data;
    try {
      await this.shell(serial, ['screencap','-p',remote], signal);
      data = await this.pullFile(serial, remote, local, signal);
      pngDimensions(data);
    } catch (error) {
      if (signal?.aborted || error.code === 'OUTPUT_LIMIT') throw error;
      // Older devices may lack a writable remoteDir; fall back to exec-out bytes.
      data = await this.adb(['-s',serial,'exec-out','screencap','-p'], signal);
    } finally { try { await this.shell(serial,['rm','-f',remote], AbortSignal.timeout(2000)); } catch { /* best effort cleanup */ } }
    const size = pngDimensions(data);
    let tree = null, treeError = null, focusInfo = null;
    if (includeTree) {
      const path = `${this.config.remoteDir}/dsh-android-use-${randomUUID()}.xml`;
      try {
        await this.shell(serial, ['uiautomator','dump','--compressed',path], signal);
        const xml = Buffer.from(await this.shell(serial,['cat',path],signal)).toString('utf8');
        tree = parseHierarchy(xml, this.config.maxNodes, compact);
      } catch (error) { if (signal?.aborted) throw error; treeError = String(error.message).slice(0,500); }
      finally { try { await this.shell(serial,['rm','-f',path], AbortSignal.timeout(2000)); } catch { /* best effort cleanup */ } }
    }
    try {
      const windowDump=Buffer.from(await this.shell(serial,['dumpsys','window','displays'],signal)).toString('utf8');
      focusInfo=parseFocus(windowDump);
      if(focusInfo.rotation===null) focusInfo.rotation=tree?.rotation??null;
    } catch (error) { if (signal?.aborted) throw error; focusInfo={currentFocus:null,packageName:null,activity:null,rotation:tree?.rotation??null,focusError:String(error.message).slice(0,200)}; }
    this.prune(); this.invalidate(serial);
    while (this.snapshots.size >= 64) this.snapshots.delete(this.snapshots.keys().next().value);
    const snapshotId = randomUUID(), at = this.now();
    this.snapshots.set(snapshotId, { owner, serial, at, ...size, nodes: tree?.nodes ?? [] });
    return { snapshotId, serial, capturedAt: new Date(at).toISOString(), ...size, ...focusInfo, tree, treeError, data };
  }
  point(x, y, snapshot) { integer(x,'x',0,snapshot.width-1); integer(y,'y',0,snapshot.height-1); }
  async action(kind, args, serial, owner, signal) {
    if (this.config.readOnly && !['packages'].includes(kind)) fail('READ_ONLY', 'Device mutations are disabled');
    let command, commands;
    if (kind === 'tap') {
      const s = this.getSnapshot(args.snapshotId,owner,serial); let x = args.x, y = args.y;
      if (args.elementId !== undefined) {
        if (x !== undefined || y !== undefined) fail('INVALID_ARGUMENT', 'Use elementId OR x/y');
        const node = s.nodes.find(n => n.id === args.elementId), b = node?.bounds;
        if (!node?.enabled || !b || b[2] <= b[0] || b[3] <= b[1]) fail('INVALID_ELEMENT', 'Element has no enabled, non-empty bounds');
        x = Math.floor((b[0]+b[2])/2); y = Math.floor((b[1]+b[3])/2);
      }
      this.point(x,y,s);
      const duration = args.durationMs ?? 0; integer(duration,'durationMs',0,5000);
      command = duration ? ['input','swipe',x,y,x,y,duration] : ['input','tap',x,y];
    } else if (kind === 'swipe') {
      const s = args.snapshotId ? this.getSnapshot(args.snapshotId,owner,serial) : null;
      if (s) { this.point(args.x1,args.y1,s); this.point(args.x2,args.y2,s); }
      else for (const [name,value] of [['x1',args.x1],['y1',args.y1],['x2',args.x2],['y2',args.y2]]) integer(value,name,0,32767);
      command = ['input','swipe',args.x1,args.y1,args.x2,args.y2,integer(args.durationMs ?? 350,'durationMs',1,5000)];
    } else if (kind === 'scroll') {
      const direction=args.direction;
      if(!['up','down','left','right'].includes(direction)) fail('INVALID_ARGUMENT','direction must be up, down, left, or right');
      const repeat=integer(args.repeat??1,'repeat',1,10), duration=integer(args.durationMs??350,'durationMs',1,5000), interval=integer(args.intervalMs??150,'intervalMs',0,5000);
      const sizeText=Buffer.from(await this.shell(serial,['wm','size'],signal)).toString('utf8'), size=/([0-9]+)x([0-9]+)/.exec(sizeText);
      if(!size) fail('DISPLAY_SIZE','Could not determine display size');
      const w=Number(size[1]),h=Number(size[2]),cx=Math.floor(w/2),cy=Math.floor(h/2),dx=Math.max(100,Math.floor(w*.4)),dy=Math.max(100,Math.floor(h*.4));
      const points={down:[cx,Math.floor(h*.75),cx,Math.floor(h*.25)],up:[cx,Math.floor(h*.25),cx,Math.floor(h*.75)],left:[Math.floor(w*.75),cy,Math.floor(w*.25),cy],right:[Math.floor(w*.25),cy,Math.floor(w*.75),cy]}[direction];
      const results=[]; this.invalidate(serial);
      for(let i=0;i<repeat;i++){ signal?.throwIfAborted(); results.push(Buffer.from(await this.shell(serial,['input','swipe',...points,duration],signal)).toString('utf8')); if(i+1<repeat&&interval) await new Promise((resolve,reject)=>{const t=setTimeout(resolve,interval);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason)},{once:true});}); }
      return {serial,action:kind,direction,repeat,display:{width:w,height:h},output:results.join('').slice(0,1000),next:'Take a fresh android_snapshot to verify the outcome.'};
    } else if (kind === 'key') {
      if (!Object.hasOwn(KEYS,args.key)) fail('INVALID_ARGUMENT','Unsupported key');
      command = ['input','keyevent',KEYS[args.key]];
    } else if (kind === 'type') {
      if (typeof args.text !== 'string' || !args.text.length || args.text.length > 2000 || /[\u0000-\u001f\u007f]/.test(args.text)) fail('INVALID_ARGUMENT','text must contain 1..2000 printable characters');
      const prefix=args.clearFirst?[['input','keycombination','113','29'],['input','keyevent',KEYS.DEL]]:[];
      const asciiSafe=/^[\x20-\x7e]+$/.test(args.text)&&!args.text.includes('%');
      if (args.mode === 'adbkeyboard') {
        if (!this.config.unicodeInput) fail('UNICODE_DISABLED','Enable unicodeInput before ADB Keyboard mode');
        const ime=Buffer.from(await this.shell(serial,['settings','get','secure','default_input_method'],signal)).toString('utf8').trim(),adbIme='com.android.adbkeyboard/.AdbIME';
        const installed=Buffer.from(await this.shell(serial,['ime','list','-a','-s'],signal)).toString('utf8');
        if(!installed.includes(adbIme)) fail('IME_NOT_INSTALLED','ADB Keyboard is not installed on this device');
        try {
          if(ime!==adbIme){await this.shell(serial,['ime','enable',adbIme],signal);await this.shell(serial,['ime','set',adbIme],signal);}
          for(const c of prefix) await this.shell(serial,c,signal);
          const result=Buffer.from(await this.shell(serial,['am','broadcast','-a','ADB_INPUT_B64','--es','msg',Buffer.from(args.text).toString('base64')],signal)).toString('utf8');
          if(args.submit) await this.shell(serial,['input','keyevent',KEYS.ENTER],signal);
          return {serial,action:kind,mode:'adbkeyboard',cleared:Boolean(args.clearFirst),submitted:Boolean(args.submit),ok:true,output:result.slice(0,2000),next:'Take a fresh android_snapshot to verify the outcome.'};
        } finally { if(ime&&ime!==adbIme) try { await this.shell(serial,['ime','set',ime],signal); } catch {} }
      } else if (args.mode === 'clipboard' || ((args.mode === 'auto' || args.mode === undefined) && !asciiSafe)) {
        commands = [...prefix,clipboardArgs(args.text), ['input','keyevent',KEYS.PASTE]];
        if(args.submit) commands.push(['input','keyevent',KEYS.ENTER]);
      } else {
        if (args.mode !== undefined && !['ascii','auto'].includes(args.mode)) fail('INVALID_ARGUMENT','Unsupported input mode');
        if (!asciiSafe) fail('UNSUPPORTED_TEXT','ASCII mode accepts printable ASCII except literal %s; use adbkeyboard for Unicode');
        command = ['input','text',args.text.replaceAll(' ','%s')];
        if(args.clearFirst||args.submit){commands=[...prefix,command];if(args.submit)commands.push(['input','keyevent',KEYS.ENTER]);command=null;}
      }
    } else if (kind === 'launch') {
      if(args.component){if(!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+\/(?:\.)?[A-Za-z_$][\w.$]*$/.test(args.component)||args.component.length>300)fail('INVALID_ARGUMENT','Invalid component');command=['am','start','-W','-n',args.component];}
      else if(args.package){
        if(!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(args.package))fail('INVALID_ARGUMENT','Invalid package');
        // `monkey` is absent on many production builds; resolve the launcher activity
        // through the package manager and start it directly with `am start`.
        const resolved=Buffer.from(await this.shell(serial,['cmd','package','resolve-activity','--brief',args.package],signal)).toString('utf8');
        const component=[...resolved.matchAll(/^\s*([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)\/([.A-Za-z_$][\w.$]*)\s*$/gm)].map(m=>m[0].trim()).at(-1);
        if(component){command=['am','start','-W','-n',component];}
        else command=['monkey','-p',args.package,'-c','android.intent.category.LAUNCHER','1'];
      }
      else if(args.uri){if(!/^https?:\/\//i.test(args.uri)||args.uri.length>4096)fail('INVALID_ARGUMENT','Only http(s) URI is allowed');command=['am','start','-W','-a','android.intent.action.VIEW','-d',args.uri];if(args.targetPackage){if(!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(args.targetPackage))fail('INVALID_ARGUMENT','Invalid targetPackage');command.push(args.targetPackage);}}
      else fail('INVALID_ARGUMENT','Provide component, package, or uri');
    } else if(kind==='packages') {
      const argsList=['pm','list','packages',...(args.thirdPartyOnly===false?[]:['-3'])],output=Buffer.from(await this.shell(serial,argsList,signal)).toString('utf8');
      return {serial,packages:output.split(/\r?\n/).map(x=>x.replace(/^package:/,'').trim()).filter(x=>x&&(!args.filter||x.toLowerCase().includes(args.filter.toLowerCase()))).slice(0,1000)};
    } else fail('INVALID_ARGUMENT','Unsupported action');
    signal?.throwIfAborted();
    // Invalidate before dispatch: even a failed/aborted command may have changed the screen.
    this.invalidate(serial);
    let result;
    if(commands){const out=[];for(const c of commands){const part=Buffer.from(await this.shell(serial,c,signal)).toString('utf8');if(/^\s*(Error:|Exception|Security exception|Broadcast completed: result=-\d)/mi.test(part)||/Parcel\(ffffffff/i.test(part))fail('ANDROID_COMMAND_FAILED',part.slice(0,1000));out.push(part);}result=out.join('');}
    else result=Buffer.from(await this.shell(serial,command,signal)).toString('utf8');
    if (/^\s*(Error:|Exception|Security exception|Broadcast completed: result=-\d)/mi.test(result)) fail('ANDROID_COMMAND_FAILED', result.slice(0,1000));
    // Tool results must stay lossless JSON: never emit keys whose value is undefined.
    const report = { serial, action: kind, ok: true, cleared: Boolean(args.clearFirst), submitted: Boolean(args.submit), output: result.slice(0,2000), next: 'Take a fresh android_snapshot to verify the outcome.' };
    if (kind === 'type') report.mode = args.mode ?? 'auto';
    return report;
  }
}

export function createAdbRunner(subprocess, config) {
  const resolved = resolveConfig(config);
  return async (args, options) => {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal?.throwIfAborted(); options.signal?.addEventListener('abort',abort,{ once: true });
    const timer = setTimeout(() => controller.abort(new AndroidUseError('ADB_TIMEOUT','ADB command timed out')), options.timeoutMs);
    let handle;
    try {
      let executable;
      const candidates = [resolved.adbPath];
      if (resolved.adbPath === 'adb') {
        const win = process.platform === 'win32', bin = win ? 'adb.exe' : 'adb';
        for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
          if (root) candidates.push(join(root, 'platform-tools', bin));
        }
        const home = process.env.USERPROFILE || process.env.HOME || homedir();
        if (win) {
          for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
            if (!base) continue;
            candidates.push(
              join(base, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
              join(base, 'Netease', 'MuMu', 'nx_main', 'adb.exe'),
              join(base, 'Netease', 'MuMuPlayer-12.0', 'shell', 'adb.exe'),
              join(base, 'LDPlayer', 'LDPlayer9', 'adb.exe'),
              join(base, 'BlueStacks_nxt', 'HD-Adb.exe'),
              join(base, 'BlueStacks', 'HD-Adb.exe'),
              join(base, 'Nox', 'bin', 'nox_adb.exe'),
              join(base, 'Microvirt', 'MEmu', 'adb.exe'),
            );
          }
        } else if (home) {
          candidates.push(
            join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
            join(home, 'Android', 'Sdk', 'platform-tools', 'adb'),
            '/opt/homebrew/bin/adb',
            '/usr/local/bin/adb',
            '/usr/bin/adb',
          );
        }
      }
      let lastError;
      for (const candidate of new Set(candidates)) { try { executable = await subprocess.resolveExecutable(candidate, undefined, controller.signal); break; } catch (error) { lastError = error; } }
      if(!executable) throw lastError ?? new AndroidUseError('ADB_NOT_FOUND','ADB executable not found');
      controller.signal.throwIfAborted();
      handle = subprocess.spawn({ argv: [executable,...args], cwd: process.cwd(), stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 500, signal: controller.signal });
      async function collect(stream, max) {
        const chunks = []; let size = 0;
        for await (const chunk of stream) {
          const b = Buffer.from(chunk); size += b.length;
          if (size > max) { controller.abort(new AndroidUseError('OUTPUT_LIMIT','ADB output exceeded limit')); fail('OUTPUT_LIMIT','ADB output exceeded limit'); }
          chunks.push(b);
        }
        return Buffer.concat(chunks);
      }
      const outcomes = await Promise.allSettled([collect(handle.stdout,options.maxBytes), collect(handle.stderr,65536), handle.done]);
      controller.signal.throwIfAborted();
      const rejected = outcomes.find(o => o.status === 'rejected'); if (rejected) throw rejected.reason;
      const [stdout,stderr,outcome] = outcomes.map(o => o.value);
      if (outcome.exitCode !== 0) fail('ADB_FAILED', `ADB exit ${outcome.exitCode}: ${stderr.toString('utf8').slice(0,1000)}`);
      return stdout;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort',abort);
      if (handle && controller.signal.aborted) { handle.terminate(); await handle.waitForExit(); }
    }
  };
}
