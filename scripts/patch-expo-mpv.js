// expo-mpv has no screenshot API. Its setPropertyString goes through `commandAsync("set", ...)` and
// resolves when mpv replies, so we add one special property name that runs any mpv command instead:
//   setPropertyString('d7t-command', ['screenshot-to-file', path, 'video'].join('\u0001'))
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'node_modules', 'expo-mpv', 'ios', 'ExpoMpvView.swift');
let src = fs.readFileSync(file, 'utf8');
let changed = false;
if (!src.includes('d7t-command')) {
const needle = 'func setPropertyStringAsync(_ name: String, _ value: String, completion: @escaping () -> Void) {\n';
if (!src.includes(needle)) {
  console.error('expo-mpv patch: anchor not found (library version changed?)');
  process.exit(1);
}
src = src.replace(
  needle,
  needle +
    '    if name == "d7t-command" {\n' +
    '      let parts = value.components(separatedBy: "\\u{1}")\n' +
    '      commandAsync(parts[0], args: Array(parts.dropFirst()), reportErrors: false, completion: completion)\n' +
    '      return\n' +
    '    }\n'
);
changed = true;
}

// Second patch: remember why the last screenshot failed and hand it to JS through getMediaInfo(),
// because commandAsync(reportErrors: false) hides it and the clock picker otherwise fails silently.
if (!src.includes('d7tLastError')) {
  const stored = '  private var nextCommandID: UInt64 = 1\n';
  const logLine = "      log(\"ERROR: command '\\(command)' failed: \\(errStr) (\\(result))\")\n";
  const okLine = '      log("Command OK: \\(command)")\n';
  const dictEnd = '      "hdrFormat": gamma,\n';
  for (const anchor of [stored, logLine, okLine, dictEnd]) {
    if (!src.includes(anchor)) {
      console.error('expo-mpv patch 2: anchor not found: ' + anchor.trim());
      process.exit(1);
    }
  }
  src = src.replace(stored, stored + '  var d7tLastError: String = ""\n');
  src = src.replace(logLine, '      d7tLastError = "\\(command): \\(errStr)"\n' + logLine);
  src = src.replace(okLine, '      if command.hasPrefix("screenshot") { d7tLastError = "" }\n' + okLine);
  src = src.replace(dictEnd, dictEnd + '      "d7tLastError": d7tLastError,\n');
  changed = true;
}

// Third patch: screenshot-to-file fails on this build ("error running command" for every flag), most
// likely because no image encoder is built in. `screenshot-raw` needs no encoder: it hands back the
// pixels. Run it and store them in a tiny raw file (magic, width, height, BGRA rows) the app reads.
if (!src.includes('d7tRawShot')) {
  const hook = '    if name == "d7t-command" {\n      let parts = value.components(separatedBy: "\\u{1}")\n';
  const hookEnd = '    if name == "d7t-command" {\n      let parts = value.components(separatedBy: "\\u{1}")\n      commandAsync(';
  if (!src.includes(hook)) {
    console.error('expo-mpv patch 3: hook anchor not found');
    process.exit(1);
  }
  src = src.replace(
    hook,
    hook +
      '      if parts[0] == "d7t-raw-shot", parts.count >= 2 {\n' +
      '        d7tRawShot(path: parts[1], flag: parts.count > 2 ? parts[2] : "video")\n' +
      '        completion()\n' +
      '        return\n' +
      '      }\n'
  );
  const fn = `
  /// Take one picture with mpv's screenshot-raw and write it as D7TRAW1: 8-byte magic, UInt32 width,
  /// UInt32 height (little endian), then width*4 bytes per row, BGRA (mpv's bgr0). Sets d7tLastError.
  func d7tRawShot(path: String, flag: String) {
    guard let mpv = mpv else { d7tLastError = "screenshot-raw: no player"; return }
    var node = mpv_node()
    let rc = withCommandArguments("screenshot-raw", args: [flag]) { mpv_command_ret(mpv, $0, &node) }
    if rc < 0 {
      d7tLastError = "screenshot-raw(\\(flag)): " + String(cString: mpv_error_string(rc))
      return
    }
    defer { mpv_free_node_contents(&node) }
    guard node.format == MPV_FORMAT_NODE_MAP, let list = node.u.list?.pointee,
          let values = list.values, let keys = list.keys else {
      d7tLastError = "screenshot-raw: unexpected result"
      return
    }
    var w = 0, h = 0, stride = 0
    var fmt = ""
    var bytes: UnsafeMutableRawPointer?
    var size = 0
    for i in 0..<Int(list.num) {
      guard let keyPtr = keys[i] else { continue }
      let key = String(cString: keyPtr)
      let item = values[i]
      switch key {
      case "w": w = Int(item.u.int64)
      case "h": h = Int(item.u.int64)
      case "stride": stride = Int(item.u.int64)
      case "format": if let s = item.u.string { fmt = String(cString: s) }
      case "data":
        if item.format == MPV_FORMAT_BYTE_ARRAY, let ba = item.u.ba {
          bytes = ba.pointee.data
          size = Int(ba.pointee.size)
        }
      default: break
      }
    }
    guard w > 0, h > 0, stride >= w * 4, let base = bytes, size >= stride * h else {
      d7tLastError = "screenshot-raw: bad picture \\(w)x\\(h) stride \\(stride) format \\(fmt) bytes \\(size)"
      return
    }
    var out = Data("D7TRAW1\\0".utf8)
    var w32 = UInt32(w).littleEndian
    var h32 = UInt32(h).littleEndian
    withUnsafeBytes(of: &w32) { out.append(contentsOf: $0) }
    withUnsafeBytes(of: &h32) { out.append(contentsOf: $0) }
    out.reserveCapacity(16 + w * h * 4)
    for row in 0..<h {
      out.append(Data(bytes: base.advanced(by: row * stride), count: w * 4))
    }
    do {
      try out.write(to: URL(fileURLWithPath: path), options: .atomic)
      d7tLastError = ""
    } catch {
      d7tLastError = "screenshot-raw: cannot write the picture"
    }
  }

`;
  const anchor = '  func getMediaInfo() -> [String: Any] {\n';
  if (!src.includes(anchor)) {
    console.error('expo-mpv patch 3: function anchor not found');
    process.exit(1);
  }
  src = src.replace(anchor, fn + anchor);
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('expo-mpv patched');
} else {
  console.log('expo-mpv already patched');
}
