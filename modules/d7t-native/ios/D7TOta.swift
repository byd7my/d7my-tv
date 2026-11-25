import CryptoKit
import Foundation

/// Updates for the web part of the app without a new IPA.
///
/// The IPA carries a copy of the web app (the `D7TWeb` bundle) plus `ota.json` saying which build it is
/// and which branch of the repository publishes newer web builds. When the app opens (and when it comes
/// back to the front) it reads `manifest.json` from that branch, downloads only the files that changed,
/// checks every file's SHA-256 and keeps the new copy in Application Support. The next launch (or the
/// page's "Reload" button) serves that copy instead of the bundled one.
///
/// Only the web app can change this way. Anything native (Swift, mpv, the tab bar) needs a new IPA, and
/// a web build that needs a newer native shell is skipped (`shell` in the manifest).
final class D7TOta: @unchecked Sendable {
  static let shared = D7TOta()

  /// Bump together with `SHELL` in `scripts/make-ota.js` when the web app starts to need new native code.
  static let shellVersion = 1

  private struct Info: Codable { let repo: String; let channel: String; let version: String }
  private struct State: Codable { var version: String; var base: String; var unconfirmed: Int }
  private struct Manifest: Codable { let version: String; let shell: Int; let files: [Entry] }
  private struct Entry: Codable { let path: String; let sha256: String }
  private struct OtaError: Error, CustomStringConvertible { let description: String }
  private final class Box: @unchecked Sendable { var data: Data?; var failure: String? }

  private let lock = NSLock()
  private let fm = FileManager.default
  private var served: URL?
  private var lastCheck = Date.distantPast
  private var busy = false
  private var confirmed = false

  /// Called (on the main queue) with the version that finished downloading.
  var onReady: ((String) -> Void)?

  private lazy var baseDir: URL = {
    let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory
    let dir = support.appendingPathComponent("d7t-ota", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()
  private var stateURL: URL { baseDir.appendingPathComponent("state.json") }
  private var badURL: URL { baseDir.appendingPathComponent("bad.txt") }

  // MARK: - Which copy is served

  private func bundledRoot() -> URL? {
    guard let bundleURL = Bundle.main.url(forResource: "D7TWeb", withExtension: "bundle") else { return nil }
    let nested = bundleURL.appendingPathComponent("web", isDirectory: true)
    var isDir: ObjCBool = false
    if fm.fileExists(atPath: nested.path, isDirectory: &isDir), isDir.boolValue { return nested }
    return bundleURL
  }

  private func readInfo(_ root: URL) -> Info? {
    guard let data = try? Data(contentsOf: root.appendingPathComponent("ota.json")) else { return nil }
    return try? JSONDecoder().decode(Info.self, from: data)
  }

  private func readState() -> State? {
    guard let data = try? Data(contentsOf: stateURL) else { return nil }
    return try? JSONDecoder().decode(State.self, from: data)
  }

  private func writeState(_ state: State) {
    if let data = try? JSONEncoder().encode(state) { try? data.write(to: stateURL, options: .atomic) }
  }

  private func versionDir(_ version: String) -> URL { baseDir.appendingPathComponent("v-" + version, isDirectory: true) }

  private func badVersions() -> Set<String> {
    guard let text = try? String(contentsOf: badURL, encoding: .utf8) else { return [] }
    return Set(text.split(separator: "\n").map(String.init))
  }

  private func markBad(_ version: String) {
    var all = badVersions()
    all.insert(version)
    try? all.joined(separator: "\n").write(to: badURL, atomically: true, encoding: .utf8)
  }

  /// The folder the page is served from: the downloaded copy for this exact build when there is a good
  /// one, otherwise the app bundle.
  func root() -> URL? {
    lock.lock()
    defer { lock.unlock() }
    if let served = served { return served }
    let chosen = pickRoot()
    served = chosen
    return chosen
  }

  private func pickRoot() -> URL? {
    guard let bundled = bundledRoot() else { return nil }
    var chosen = bundled
    if let info = readInfo(bundled), var state = readState() {
      let dir = versionDir(state.version)
      let complete = fm.fileExists(atPath: dir.appendingPathComponent(".complete").path)
      if state.base != info.version || !complete {
        // A newer IPA was installed, or the copy is unusable: the bundle wins.
        try? fm.removeItem(at: stateURL)
      } else if state.unconfirmed >= 2 {
        // Started twice in a row without the page ever talking to the phone: give this version up.
        markBad(state.version)
        try? fm.removeItem(at: stateURL)
      } else {
        state.unconfirmed += 1
        writeState(state)
        chosen = dir
      }
    }
    cleanup(keeping: chosen)
    return chosen
  }

  private func cleanup(keeping root: URL) {
    guard let names = try? fm.contentsOfDirectory(atPath: baseDir.path) else { return }
    for name in names where name.hasPrefix("v-") || name == "staging" {
      let url = baseDir.appendingPathComponent(name)
      if url.standardizedFileURL.path != root.standardizedFileURL.path {
        try? fm.removeItem(at: url)
      }
    }
  }

  /// The page reached the phone, so the copy being served boots.
  func confirmBoot() {
    lock.lock()
    defer { lock.unlock() }
    if confirmed { return }
    confirmed = true
    if var state = readState(), state.unconfirmed != 0 {
      state.unconfirmed = 0
      writeState(state)
    }
  }

  /// Switches to the newest downloaded copy right now (the caller reloads the page).
  func useLatest() {
    lock.lock()
    served = nil
    confirmed = false
    lock.unlock()
  }

  func describe() -> [String: Any] {
    let bundled = bundledRoot()
    let info = bundled.flatMap { readInfo($0) }
    let state = readState()
    return [
      "bundled": info?.version ?? "",
      "downloaded": state?.version ?? "",
      "channel": info?.channel ?? "",
    ]
  }

  // MARK: - Checking and downloading

  /// Looks for a newer web build in the background. Cheap when nothing changed.
  func check(force: Bool = false) {
    lock.lock()
    if busy || (!force && Date().timeIntervalSince(lastCheck) < 600) {
      lock.unlock()
      return
    }
    busy = true
    lastCheck = Date()
    lock.unlock()
    DispatchQueue.global(qos: .utility).async { [self] in
      do {
        try run()
      } catch {
        NSLog("[D7TOta] check failed: %@", "\(error)")
      }
      lock.lock()
      busy = false
      lock.unlock()
    }
  }

  private func run() throws {
    guard let bundled = bundledRoot(), let info = readInfo(bundled) else { return }
    let base = "https://raw.githubusercontent.com/\(info.repo)/\(info.channel)/"
    let manifestData = try fetch(base + "manifest.json")
    let manifest = try JSONDecoder().decode(Manifest.self, from: manifestData)
    guard manifest.shell <= D7TOta.shellVersion else { return }
    guard manifest.version != info.version, !badVersions().contains(manifest.version) else { return }
    let state = readState()
    if let state = state, state.base == info.version, state.version == manifest.version { return }

    let target = versionDir(manifest.version)
    if !fm.fileExists(atPath: target.appendingPathComponent(".complete").path) {
      // Files that did not change are copied from the copy being served, only the rest is downloaded.
      lock.lock()
      let current = served ?? bundled
      lock.unlock()
      let staging = baseDir.appendingPathComponent("staging", isDirectory: true)
      try? fm.removeItem(at: staging)
      try fm.createDirectory(at: staging, withIntermediateDirectories: true)
      for entry in manifest.files {
        guard !entry.path.hasPrefix("/"), !entry.path.contains("..") else { throw OtaError(description: "unsafe path") }
        let dest = staging.appendingPathComponent(entry.path)
        try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        let local = current.appendingPathComponent(entry.path)
        if let existing = try? Data(contentsOf: local), sha256(existing) == entry.sha256 {
          try existing.write(to: dest)
          continue
        }
        let encoded = entry.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? entry.path
        let data = try fetch(base + encoded)
        guard sha256(data) == entry.sha256 else { throw OtaError(description: "checksum mismatch for \(entry.path)") }
        try data.write(to: dest)
      }
      guard fm.createFile(atPath: staging.appendingPathComponent(".complete").path, contents: Data()) else {
        throw OtaError(description: "could not finish the copy")
      }
      try? fm.removeItem(at: target)
      try fm.moveItem(at: staging, to: target)
    }
    writeState(State(version: manifest.version, base: info.version, unconfirmed: 0))
    let version = manifest.version
    DispatchQueue.main.async { [self] in onReady?(version) }
  }

  private func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private func fetch(_ urlString: String) throws -> Data {
    guard let url = URL(string: urlString) else { throw OtaError(description: "bad url") }
    let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        box.failure = error.localizedDescription
      } else if let http = response as? HTTPURLResponse, http.statusCode != 200 {
        box.failure = "HTTP \(http.statusCode)"
      } else {
        box.data = data
      }
      done.signal()
    }.resume()
    done.wait()
    if let failure = box.failure { throw OtaError(description: failure) }
    guard let data = box.data else { throw OtaError(description: "empty response") }
    return data
  }
}
