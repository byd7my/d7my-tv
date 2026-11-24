import SwiftUI
import UIKit

/// A menu the page asks the phone to show: grouped rows in the system's own sheet.
/// Built with the iOS 26 SDK the sheet, its list rows and its close button are drawn by the system
/// as Liquid Glass: nothing here imitates it.
struct D7TSheetModel {
  struct Item: Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let icon: String?
    let checked: Bool
  }
  struct Group: Identifiable {
    let id: Int
    let heading: String?
    let items: [Item]
  }
  let title: String
  let groups: [Group]

  init?(_ args: [String: Any]) {
    guard let rawGroups = args["groups"] as? [[String: Any]] else { return nil }
    title = args["title"] as? String ?? ""
    groups = rawGroups.enumerated().map { index, group in
      let items = (group["items"] as? [[String: Any]] ?? []).compactMap { item -> Item? in
        guard let id = item["id"] as? String, let title = item["title"] as? String else { return nil }
        return Item(id: id, title: title, subtitle: item["subtitle"] as? String,
                    icon: item["icon"] as? String, checked: item["checked"] as? Bool ?? false)
      }
      return Group(id: index, heading: group["heading"] as? String, items: items)
    }
  }
}

private struct D7TSheetView: View {
  let model: D7TSheetModel
  let onPick: (String) -> Void
  let onClose: () -> Void

  var body: some View {
    NavigationStack {
      List {
        ForEach(model.groups) { group in
          Section {
            ForEach(group.items) { item in
              Button { onPick(item.id) } label: {
                HStack(spacing: 12) {
                  if let icon = item.icon {
                    Image(systemName: icon)
                      .font(.system(size: 17))
                      .frame(width: 28)
                      .foregroundStyle(Color.accentColor)
                  }
                  VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).foregroundStyle(.primary)
                    if let subtitle = item.subtitle {
                      Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                    }
                  }
                  Spacer(minLength: 8)
                  if item.checked {
                    Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                  }
                }
              }
            }
          } header: {
            if let heading = group.heading { Text(heading) }
          }
        }
      }
      .navigationTitle(model.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          if #available(iOS 26.0, *) {
            Button(role: .close) { onClose() }
          } else {
            Button { onClose() } label: { Image(systemName: "xmark.circle.fill") }
          }
        }
      }
    }
  }
}

/// Presents the sheet and reports the chosen row (nil if it was dismissed).
final class D7TSheetPresenter: NSObject, UIAdaptivePresentationControllerDelegate {
  private var finish: ((String?) -> Void)?
  private static var current: D7TSheetPresenter?

  static func present(_ args: [String: Any], completion: @escaping (String?) -> Void) {
    DispatchQueue.main.async {
      guard let model = D7TSheetModel(args), let top = topViewController() else { completion(nil); return }
      let presenter = D7TSheetPresenter()
      presenter.finish = completion
      current = presenter

      var host: UIHostingController<D7TSheetView>!
      host = UIHostingController(rootView: D7TSheetView(
        model: model,
        onPick: { id in host.dismiss(animated: true) { presenter.complete(id) } },
        onClose: { host.dismiss(animated: true) { presenter.complete(nil) } }
      ))
      host.modalPresentationStyle = .pageSheet
      if let sheet = host.sheetPresentationController {
        sheet.detents = [.medium(), .large()]
        sheet.prefersGrabberVisible = true
      }
      host.presentationController?.delegate = presenter
      top.present(host, animated: true)
    }
  }

  private func complete(_ id: String?) {
    finish?(id)
    finish = nil
    D7TSheetPresenter.current = nil
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    complete(nil)
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive } ??
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}
