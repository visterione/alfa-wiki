import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    // Между экраном запуска и первым кадром React Native лежит промежуток —
    // JS-бандл ещё грузится, а показывать уже нечего. По умолчанию окно там
    // белое, и старт распадался: синий экран запуска → вспышка белого →
    // снова синий экран загрузки.
    //
    // JavaScript сохраняет начало градиента выбранной темы в UserDefaults.
    // На первом запуске значения ещё нет — используем фирменный синий.
    let savedSplash = UserDefaults.standard.string(forKey: "AlfaWikiLaunchBackgroundColor")
    let splash = UIColor(hex: savedSplash ?? "#0A5BD3")
    window?.backgroundColor = splash

    factory.startReactNative(
      withModuleName: "AlfaWikiMobile",
      in: window,
      launchOptions: launchOptions
    )

    // После startReactNative у окна появился rootViewController — его вид тоже
    // белый по умолчанию и перекрыл бы фон самого окна
    window?.rootViewController?.view.backgroundColor = splash

    return true
  }
}

private extension UIColor {
  convenience init(hex: String) {
    let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var rgb: UInt64 = 0

    guard value.count == 6, Scanner(string: value).scanHexInt64(&rgb) else {
      self.init(red: 10.0 / 255.0, green: 91.0 / 255.0, blue: 211.0 / 255.0, alpha: 1)
      return
    }

    self.init(
      red: CGFloat((rgb >> 16) & 0xFF) / 255,
      green: CGFloat((rgb >> 8) & 0xFF) / 255,
      blue: CGFloat(rgb & 0xFF) / 255,
      alpha: 1
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
