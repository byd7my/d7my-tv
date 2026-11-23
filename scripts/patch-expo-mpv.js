// expo-mpv has no screenshot API. Its setPropertyString goes through `commandAsync("set", ...)` and
// resolves when mpv replies, so we add one special property name that runs any mpv command instead:
//   setPropertyString('d7t-command', ['screenshot-to-file', path, 'video'].join('\u0001'))
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'node_modules', 'expo-mpv', 'ios', 'ExpoMpvView.swift');
let src = fs.readFileSync(file, 'utf8');
if (src.includes('d7t-command')) {
  console.log('expo-mpv already patched');
  process.exit(0);
}
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
fs.writeFileSync(file, src);
console.log('expo-mpv patched');
