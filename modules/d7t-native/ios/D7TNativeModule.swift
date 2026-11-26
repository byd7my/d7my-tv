import ExpoModulesCore
import Foundation
import CoreGraphics
import ImageIO
import Vision

struct D7TError: Error, LocalizedError {
  let message: String
  init(_ m: String) { message = m }
  var errorDescription: String? { message }
}

public class D7TNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("D7TNative")

    // Plain-socket HTTP GET. App Transport Security only polices URLSession and friends,
    // not raw TCP, so http:// panels work regardless of how the app was re-signed.
    AsyncFunction("httpGet") { (urlString: String, timeout: Double) -> [String: Any] in
      return try D7THttp.request(urlString, headers: [:], timeout: timeout, binary: false)
    }.runOnQueue(.global(qos: .userInitiated))

    AsyncFunction("frameRGBA") { (path: String, maxWidth: Int) -> [String: Any] in
      return try D7TVision.frameRGBA(path: path, maxWidth: maxWidth)
    }.runOnQueue(.global(qos: .userInitiated))

    // Same as frameRGBA, but only the rectangle x, y, w, h (0...1 of the picture) is returned.
    AsyncFunction("frameCrop") { (path: String, x: Double, y: Double, w: Double, h: Double, maxWidth: Int) -> [String: Any] in
      return try D7TVision.frameRGBA(path: path, maxWidth: maxWidth, crop: CGRect(x: x, y: y, width: w, height: h))
    }.runOnQueue(.global(qos: .userInitiated))

    AsyncFunction("readText") { (path: String, x: Double, y: Double, w: Double, h: Double) -> [String: Any] in
      return try D7TVision.readText(path: path, x: x, y: y, w: w, h: h)
    }.runOnQueue(.global(qos: .userInitiated))

    View(D7TTabBarView.self) {
      Events("onSelectTab")
      Prop("tabs") { (view: D7TTabBarView, tabs: [[String: String]]) in view.tabs = tabs }
      Prop("selected") { (view: D7TTabBarView, selected: String) in view.selected = selected }
      Prop("moreVisible") { (view: D7TTabBarView, visible: Bool) in view.moreVisible = visible }
      Prop("barHidden") { (view: D7TTabBarView, hidden: Bool) in view.barHidden = hidden }
    }

    View(D7TWebView.self) {
      Events("onBridge")

      AsyncFunction("resolve") { (view: D7TWebView, id: Int, ok: Bool, json: String) in
        let value = (try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])) ?? NSNull()
        view.resolve(id, ok: ok, value: value)
      }.runOnQueue(.main)

      AsyncFunction("emit") { (view: D7TWebView, event: String, json: String) in
        view.emit(event, json: json)
      }.runOnQueue(.main)
    }

    Function("tempDir") { () -> String in
      return NSTemporaryDirectory()
    }

    Function("getItem") { (key: String) -> String? in
      return UserDefaults.standard.string(forKey: "d7t." + key)
    }

    Function("setItem") { (key: String, value: String) in
      UserDefaults.standard.set(value, forKey: "d7t." + key)
    }
  }
}

enum D7THttp {
  /// https goes through URLSession (valid certificates, ATS allows it); http uses a raw socket.
  static func request(_ urlString: String, headers: [String: String], timeout: Double, binary: Bool) throws -> [String: Any] {
    if urlString.lowercased().hasPrefix("https://") {
      return try viaURLSession(urlString, headers: headers, timeout: timeout, binary: binary)
    }
    return try get(urlString, headers: headers, timeout: timeout, binary: binary)
  }

  static func viaURLSession(_ urlString: String, headers: [String: String], timeout: Double, binary: Bool) throws -> [String: Any] {
    guard let url = URL(string: urlString) else { throw D7TError("رابط غير صالح") }
    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    if req.value(forHTTPHeaderField: "User-Agent") == nil { req.setValue("D7T/1.0", forHTTPHeaderField: "User-Agent") }
    let sem = DispatchSemaphore(value: 0)
    var outData: Data?
    var outResp: URLResponse?
    var outErr: Error?
    let session = URLSession(configuration: .ephemeral)
    session.dataTask(with: req) { data, resp, err in
      outData = data
      outResp = resp
      outErr = err
      sem.signal()
    }.resume()
    sem.wait()
    session.finishTasksAndInvalidate()
    if let e = outErr { throw e }
    let http = outResp as? HTTPURLResponse
    let data = outData ?? Data()
    var result: [String: Any] = [
      "status": http?.statusCode ?? 0,
      "location": "",
      "contentType": http?.value(forHTTPHeaderField: "Content-Type") ?? "",
      "body": binary ? "" : String(decoding: data, as: UTF8.self),
    ]
    if binary { result["bodyBase64"] = data.base64EncodedString() }
    return result
  }

  static func get(_ urlString: String, headers: [String: String] = [:], timeout: Double, binary: Bool = false) throws -> [String: Any] {
    guard let comps = URLComponents(string: urlString), let host = comps.host else {
      throw D7TError("رابط غير صالح")
    }
    let port = comps.port ?? 80
    var path = comps.percentEncodedPath.isEmpty ? "/" : comps.percentEncodedPath
    if let q = comps.percentEncodedQuery { path += "?" + q }

    var readRef: Unmanaged<CFReadStream>?
    var writeRef: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocketToHost(kCFAllocatorDefault, host as CFString, UInt32(port), &readRef, &writeRef)
    guard let r = readRef?.takeRetainedValue(), let w = writeRef?.takeRetainedValue() else {
      throw D7TError("تعذر فتح الاتصال")
    }
    let input: InputStream = r as InputStream
    let output: OutputStream = w as OutputStream
    input.open()
    output.open()
    defer {
      input.close()
      output.close()
    }
    let deadline = Date().addingTimeInterval(timeout)
    let hostHeader = comps.port != nil ? "\(host):\(port)" : host
    var lower: [String: String] = [:]
    for (k, v) in headers { lower[k.lowercased()] = v }
    var request = "GET \(path) HTTP/1.1\r\nHost: \(hostHeader)\r\n"
    if lower["user-agent"] == nil { request += "User-Agent: D7T/1.0\r\n" }
    if lower["accept"] == nil { request += "Accept: */*\r\n" }
    for (k, v) in headers where k.lowercased() != "host" && k.lowercased() != "connection" && k.lowercased() != "accept-encoding" {
      request += "\(k): \(v)\r\n"
    }
    request += "Accept-Encoding: identity\r\nConnection: close\r\n\r\n"
    let bytes = Array(request.utf8)
    var sent = 0
    while sent < bytes.count {
      if Date() > deadline { throw D7TError("انتهت مهلة الاتصال") }
      if output.streamStatus == .error { throw output.streamError ?? D7TError("فشل الإرسال") }
      if output.hasSpaceAvailable {
        let n = bytes.withUnsafeBufferPointer { p in
          output.write(p.baseAddress!.advanced(by: sent), maxLength: bytes.count - sent)
        }
        if n < 0 { throw output.streamError ?? D7TError("فشل الإرسال") }
        sent += n
      } else {
        usleep(5000)
      }
    }

    var buffer = [UInt8](repeating: 0, count: 65536)
    var data = Data()
    readLoop: while true {
      if Date() > deadline { throw D7TError("انتهت مهلة الاستلام") }
      if input.hasBytesAvailable {
        let n = input.read(&buffer, maxLength: buffer.count)
        if n > 0 {
          data.append(buffer, count: n)
        } else if n == 0 {
          break readLoop
        } else {
          throw input.streamError ?? D7TError("فشل الاستلام")
        }
      } else {
        switch input.streamStatus {
        case .atEnd, .closed:
          break readLoop
        case .error:
          throw input.streamError ?? D7TError("فشل الاتصال")
        default:
          usleep(5000)
        }
      }
    }

    guard let split = data.range(of: Data([13, 10, 13, 10])) else {
      throw D7TError("رد غير مفهوم من السيرفر")
    }
    let head = String(decoding: data[data.startIndex..<split.lowerBound], as: UTF8.self)
    var body = Data(data[split.upperBound...])
    let lines = head.components(separatedBy: "\r\n")
    let statusParts = (lines.first ?? "").split(separator: " ")
    let status = statusParts.count > 1 ? (Int(statusParts[1]) ?? 0) : 0
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      if let idx = line.firstIndex(of: ":") {
        let k = line[line.startIndex..<idx].lowercased()
        let v = line[line.index(after: idx)...].trimmingCharacters(in: .whitespaces)
        headers[k] = v
      }
    }
    if (headers["transfer-encoding"] ?? "").lowercased().contains("chunked") {
      body = dechunk(body)
    }
    if let enc = headers["content-encoding"], enc.lowercased().contains("gzip") {
      throw D7TError("السيرفر رد بضغط gzip")
    }
    var result: [String: Any] = [
      "status": status,
      "location": headers["location"] ?? "",
      "contentType": headers["content-type"] ?? "",
      "body": binary ? "" : String(decoding: body, as: UTF8.self),
    ]
    if binary { result["bodyBase64"] = body.base64EncodedString() }
    return result
  }

  static func dechunk(_ d: Data) -> Data {
    var out = Data()
    var i = d.startIndex
    let crlf = Data([13, 10])
    while i < d.endIndex {
      guard let r = d.range(of: crlf, options: [], in: i..<d.endIndex) else { break }
      let sizeLine = String(decoding: d[i..<r.lowerBound], as: UTF8.self)
      let sizeText = (sizeLine.split(separator: ";").first.map(String.init) ?? "").trimmingCharacters(in: .whitespaces)
      guard let size = Int(sizeText, radix: 16) else { break }
      if size == 0 { break }
      let start = r.upperBound
      let end = start + size
      if end > d.endIndex {
        out.append(d[start..<d.endIndex])
        break
      }
      out.append(d[start..<end])
      i = end + 2
    }
    return out
  }
}

enum D7TVision {
  /// D7TRAW1 pictures come from mpv's screenshot-raw (see scripts/patch-expo-mpv.js):
  /// 8-byte magic, UInt32 width, UInt32 height (little endian), then BGRA rows.
  static func loadRaw(_ path: String) -> CGImage? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe),
          data.count > 16, data.prefix(8) == Data("D7TRAW1\0".utf8) else { return nil }
    let w = Int(data.subdata(in: 8..<12).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian)
    let h = Int(data.subdata(in: 12..<16).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian)
    guard w > 0, h > 0, data.count >= 16 + w * h * 4 else { return nil }
    let pixels = data.subdata(in: 16..<(16 + w * h * 4))
    guard let provider = CGDataProvider(data: pixels as CFData) else { return nil }
    return CGImage(
      width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
      provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
    )
  }

  static func loadImage(_ path: String) throws -> CGImage {
    if let raw = loadRaw(path) { return raw }
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
      throw D7TError("تعذر قراءة اللقطة")
    }
    return img
  }

  static func frameRGBA(path: String, maxWidth: Int, crop: CGRect? = nil) throws -> [String: Any] {
    var img = try loadImage(path)
    if let c = crop {
      let fw = Double(img.width), fh = Double(img.height)
      let rect = CGRect(x: max(0, c.origin.x * fw), y: max(0, c.origin.y * fh), width: max(1, c.size.width * fw), height: max(1, c.size.height * fh))
        .intersection(CGRect(x: 0, y: 0, width: fw, height: fh))
      if !rect.isNull, let part = img.cropping(to: rect.integral) { img = part }
    }
    let scale = min(1.0, Double(maxWidth) / Double(img.width))
    let w = max(1, Int(Double(img.width) * scale))
    let h = max(1, Int(Double(img.height) * scale))
    var data = Data(count: w * h * 4)
    let ok: Bool = data.withUnsafeMutableBytes { ptr -> Bool in
      guard let ctx = CGContext(
        data: ptr.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      ) else { return false }
      ctx.interpolationQuality = .medium
      ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    if !ok { throw D7TError("تعذر تجهيز اللقطة") }
    return ["width": w, "height": h, "base64": data.base64EncodedString()]
  }

  /// x, y, w, h are 0...1 of the frame (top-left origin).
  static func readText(path: String, x: Double, y: Double, w: Double, h: Double) throws -> [String: Any] {
    let img = try loadImage(path)
    let fw = Double(img.width), fh = Double(img.height)
    let rect = CGRect(x: max(0, x * fw), y: max(0, y * fh), width: max(1, w * fw), height: max(1, h * fh))
      .intersection(CGRect(x: 0, y: 0, width: fw, height: fh))
    guard !rect.isNull, let crop = img.cropping(to: rect.integral) else {
      return ["text": "", "confidence": 0.0]
    }
    // Vision reads small clocks better when they are big: grow to at least 120 px tall, on a white-padded canvas.
    let grow = max(1.0, 120.0 / Double(crop.height))
    let pad = Int(Double(crop.height) * grow * 0.25)
    let cw = Int(Double(crop.width) * grow) + pad * 2
    let ch = Int(Double(crop.height) * grow) + pad * 2
    var input: CGImage = crop
    if let ctx = CGContext(
      data: nil, width: cw, height: ch, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) {
      ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
      ctx.fill(CGRect(x: 0, y: 0, width: cw, height: ch))
      ctx.interpolationQuality = .high
      ctx.draw(crop, in: CGRect(x: pad, y: pad, width: cw - pad * 2, height: ch - pad * 2))
      if let made = ctx.makeImage() { input = made }
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    let handler = VNImageRequestHandler(cgImage: input, options: [:])
    try handler.perform([request])
    let observations = request.results ?? []
    var texts: [String] = []
    var conf = 0.0
    for o in observations {
      if let top = o.topCandidates(1).first {
        texts.append(top.string)
        conf += Double(top.confidence)
      }
    }
    return ["text": texts.joined(separator: "\n"), "confidence": observations.isEmpty ? 0.0 : conf / Double(observations.count)]
  }
}
