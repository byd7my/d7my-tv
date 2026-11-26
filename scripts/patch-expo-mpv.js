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
if (changed) {
  fs.writeFileSync(file, src);
  console.log('expo-mpv patched');
} else {
  console.log('expo-mpv already patched');
}
