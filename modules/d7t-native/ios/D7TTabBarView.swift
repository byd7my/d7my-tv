import ExpoModulesCore
import UIKit

/// The real system tab bar (UITabBarController), laid over the web app.
///
/// Built with the iOS 26 SDK it is drawn by the system as Liquid Glass: the floating glass bar, the
/// sliding selection lens, press and drag feedback, and the minimise/expand behaviour are Apple's own,
/// not CSS. The tab pages themselves stay in the web view underneath: every tab here is an empty,
/// transparent page, and touches anywhere outside the bar pass straight through to the web view.
final class D7TTabBarView: ExpoView, UITabBarControllerDelegate {
  let onSelectTab = EventDispatcher()
  private let controller = UITabBarController()
  private var ids: [String] = []
  private var applyingFromWeb = false

  /// [{ id, title, icon? }]: the tabs, in Lume's order. A tab without an icon is text only, as in Lume.
  var tabs: [[String: String]] = [] {
    didSet { if tabs != oldValue { rebuild() } }
  }

  var selected: String = "" {
    didSet { select(selected) }
  }

  /// The glass "More" button (top trailing): everything that does not fit in five tabs.
  var moreVisible: Bool = false {
    didSet { UIView.animate(withDuration: 0.2) { self.moreButton.alpha = self.moreVisible && !self.barHidden ? 1 : 0 } }
  }
  private let moreButton = UIButton(type: .system)

  var barHidden: Bool = false {
    didSet {
      UIView.animate(withDuration: 0.25) {
        self.controller.view.alpha = self.barHidden ? 0 : 1
        self.moreButton.alpha = self.moreVisible && !self.barHidden ? 1 : 0
      }
      controller.tabBar.isUserInteractionEnabled = !barHidden
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isOpaque = false
    controller.delegate = self
    controller.view.backgroundColor = .clear
    controller.view.isOpaque = false
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(controller.view)

    // Real glass button on iOS 26; a plain tinted one before.
    if #available(iOS 26.0, *) {
      var config = UIButton.Configuration.glass()
      config.image = UIImage(systemName: "ellipsis")
      moreButton.configuration = config
    } else {
      var config = UIButton.Configuration.tinted()
      config.image = UIImage(systemName: "ellipsis")
      config.cornerStyle = .capsule
      moreButton.configuration = config
    }
    moreButton.accessibilityLabel = "More"
    moreButton.alpha = 0
    moreButton.addAction(UIAction { [weak self] _ in self?.onSelectTab(["id": "more"]) }, for: .touchUpInside)
    addSubview(moreButton)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // UIKit needs the controller in the responder chain to lay the bar out against the safe area.
    if window != nil, let parent = parentViewController(), controller.parent == nil {
      parent.addChild(controller)
      controller.didMove(toParent: parent)
    }
  }

  private func parentViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let vc = next as? UIViewController { return vc }
      responder = next
    }
    return nil
  }

  private func rebuild() {
    ids = tabs.compactMap { $0["id"] }
    let pages: [UIViewController] = tabs.map { tab in
      let page = UIViewController()
      page.view.backgroundColor = .clear
      page.view.isOpaque = false
      let title = tab["title"] ?? ""
      let image = tab["icon"].flatMap { UIImage(systemName: $0) }
      page.tabBarItem = UITabBarItem(title: title, image: image, selectedImage: nil)
      return page
    }
    controller.setViewControllers(pages, animated: false)
    clearBackgrounds(controller.view)
    select(selected)
  }

  private func select(_ id: String) {
    guard let index = ids.firstIndex(of: id), controller.selectedIndex != index else { return }
    applyingFromWeb = true
    controller.selectedIndex = index
    applyingFromWeb = false
  }

  /// The controller's own containers are opaque by default and would cover the web page.
  private func clearBackgrounds(_ view: UIView) {
    for sub in view.subviews where !(sub is UITabBar) {
      sub.backgroundColor = .clear
      sub.isOpaque = false
      clearBackgrounds(sub)
    }
  }

  func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
    guard !applyingFromWeb, let index = tabBarController.viewControllers?.firstIndex(of: viewController),
          index < ids.count else { return }
    onSelectTab(["id": ids[index]])
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    controller.view.frame = bounds
    clearBackgrounds(controller.view)
    let side: CGFloat = 44
    moreButton.frame = CGRect(x: bounds.width - 16 - side, y: safeAreaInsets.top + 8, width: side, height: side)
  }

  /// Only the bar itself takes touches; everything else belongs to the web page below.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if barHidden { return nil }
    if moreButton.alpha > 0.5, moreButton.frame.contains(point) { return moreButton }
    let bar = controller.tabBar
    let local = convert(point, to: bar)
    guard bar.bounds.contains(local), let hit = bar.hitTest(local, with: event) else { return nil }
    return hit
  }
}
