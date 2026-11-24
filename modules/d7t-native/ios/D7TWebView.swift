import ExpoModulesCore
import Foundation
import UIKit
import WebKit

/// Keeps WKUserContentController from retaining the view.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
  weak var target: D7TWebView?
  init(_ target: D7TWebView) { self.target = target }
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.handle(message)
  }
}

/// The D7my-TV web app, running inside the phone app.
/// It is served from the app bundle through the custom `d7t://localhost/` scheme, and talks to the phone
/// through `window.d7tNative` (see `bootstrapJS`).
final class D7TWebView: ExpoView, WKURLSchemeHandler {
  let onBridge = EventDispatcher()
  private(set) var webView: WKWebView!

  static let bootstrapJS = """
  (function () {
    window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: 'https://d7t-backend.local' };
    (function () { var f = function () { if (document.documentElement) document.documentElement.classList.add('d7t-ios'); }; f(); document.addEventListener('readystatechange', f); })();
    // d7t:// is not a "secure context", so give the app the few APIs it expects there.
    if (window.crypto && !window.crypto.randomUUID) {
      window.crypto.randomUUID = function () {
        var b = new Uint8Array(16); window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
        return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
      };
    }
    var pending = {}, nextId = 1, listeners = {};
    window.d7tNative = {
      platform: 'ios',
      call: function (method, args) {
        return new Promise(function (resolve, reject) {
          var id = nextId++;
          pending[id] = { resolve: resolve, reject: reject };
          window.webkit.messageHandlers.d7t.postMessage({ id: id, method: method, args: args === undefined ? null : args });
        });
      },
      on: function (event, handler) {
        (listeners[event] = listeners[event] || new Set()).add(handler);
        return function () { listeners[event].delete(handler); };
      }
    };
    window.__d7tResolve = function (id, ok, value) {
      var p = pending[id]; if (!p) return; delete pending[id];
      if (ok) p.resolve(value); else p.reject(new Error(String(value)));
    };
    window.__d7tEmit = function (event, payload) {
      (listeners[event] || []).forEach(function (h) { try { h(payload); } catch (e) {} });
    };
    var realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (url && url.indexOf('https://d7t-backend.local') === 0) {
        return Promise.resolve(new Response(JSON.stringify({ message: 'Not found', status: 404 }),
          { status: 404, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  })();
  """

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(self, forURLScheme: "d7t")
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    let controller = WKUserContentController()
    controller.add(WeakScriptHandler(self), name: "d7t")
    controller.addUserScript(WKUserScript(source: D7TWebView.bootstrapJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController = controller
    let view = WKWebView(frame: .zero, configuration: config)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.backgroundColor = .clear
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.scrollView.bounces = false
    view.scrollView.pinchGestureRecognizer?.isEnabled = false
    // The page must never be zoomed (rotating the phone could leave it ~6 % zoomed in).
    view.scrollView.minimumZoomScale = 1
    view.scrollView.maximumZoomScale = 1
    if #available(iOS 16.4, *) { view.isInspectable = true }
    webView = view
    addSubview(view)
    view.load(URLRequest(url: URL(string: "d7t://localhost/index.html")!))
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    webView.frame = bounds
  }

  // MARK: - Bridge (page -> phone)

  func handle(_ message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let id = body["id"] as? Int,
          let method = body["method"] as? String else { return }
    let args = body["args"] as? [String: Any] ?? [:]
    switch method {
    case "httpGet":
      let url = args["url"] as? String ?? ""
      let headers = args["headers"] as? [String: String] ?? [:]
      let timeout = (args["timeout"] as? Double) ?? 30
      let binary = (args["binary"] as? Bool) ?? false
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        do {
          let result = try D7THttp.request(url, headers: headers, timeout: timeout, binary: binary)
          self?.resolve(id, ok: true, value: result)
        } catch {
          // Provider failures come back as a status the app already knows how to show.
          self?.resolve(id, ok: true, value: ["status": 502, "location": "", "contentType": "", "body": "\(error.localizedDescription)"])
        }
      }
    case "tempDir":
      resolve(id, ok: true, value: NSTemporaryDirectory())
    default:
      // Everything else (mpv etc.) is handled by the React Native side.
      let json = (try? JSONSerialization.data(withJSONObject: ["id": id, "method": method, "args": args])).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
      onBridge(["json": json])
    }
  }

  /// Answers a call made by the page. `value` must be JSON-serialisable.
  func resolve(_ id: Int, ok: Bool, value: Any) {
    let wrapped: [String: Any] = ["v": value]
    guard let data = try? JSONSerialization.data(withJSONObject: wrapped),
          let text = String(data: data, encoding: .utf8) else { return }
    // {"v": X} -> take X out of the wrapper in JS, so strings and numbers need no special casing here.
    let js = "(function(){var w=\(text);window.__d7tResolve(\(id),\(ok ? "true" : "false"),w.v);})();"
    DispatchQueue.main.async { [weak self] in
      self?.webView.evaluateJavaScript(js, completionHandler: nil)
    }
  }

  func emit(_ event: String, json: String) {
    let quoted = (try? JSONSerialization.data(withJSONObject: [event], options: []))
      .flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    let js = "(function(){var e=\(quoted)[0];window.__d7tEmit(e,\(json));})();"
    DispatchQueue.main.async { [weak self] in
      self?.webView.evaluateJavaScript(js, completionHandler: nil)
    }
  }

  // MARK: - d7t://localhost/... served from the app bundle

  private static let webRoot: URL? = {
    guard let bundleURL = Bundle.main.url(forResource: "D7TWeb", withExtension: "bundle") else { return nil }
    let nested = bundleURL.appendingPathComponent("web", isDirectory: true)
    var isDir: ObjCBool = false
    if FileManager.default.fileExists(atPath: nested.path, isDirectory: &isDir), isDir.boolValue { return nested }
    return bundleURL
  }()

  private static func mime(_ ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "webmanifest": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "ico": return "image/x-icon"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "ttf": return "font/ttf"
    case "otf": return "font/otf"
    case "wasm": return "application/wasm"
    case "txt": return "text/plain; charset=utf-8"
    case "xml": return "application/xml"
    default: return "application/octet-stream"
    }
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url, let root = D7TWebView.webRoot else {
      urlSchemeTask.didFailWithError(NSError(domain: "D7T", code: 1, userInfo: [NSLocalizedDescriptionKey: "web bundle missing"]))
      return
    }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    var file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    var isDir: ObjCBool = false
    let exists = FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir)
    let hasExtension = !(path as NSString).pathExtension.isEmpty
    if !file.path.hasPrefix(root.standardizedFileURL.path) || (!exists || isDir.boolValue) {
      if hasExtension && !path.hasSuffix(".html") {
        respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data("not found".utf8))
        return
      }
      file = root.appendingPathComponent("index.html")
    }
    guard let data = try? Data(contentsOf: file) else {
      respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data("not found".utf8))
      return
    }
    respond(urlSchemeTask, url: url, status: 200, mime: D7TWebView.mime(file.pathExtension), data: data)
  }

  private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
    let headers = [
      "Content-Type": mime,
      "Content-Length": String(data.count),
      "Cache-Control": "no-cache",
    ]
    if let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) {
      task.didReceive(response)
      task.didReceive(data)
      task.didFinish()
    } else {
      task.didFailWithError(NSError(domain: "D7T", code: 2))
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
