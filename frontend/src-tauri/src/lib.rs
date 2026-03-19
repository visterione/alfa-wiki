use tauri::Manager;
use tauri::Emitter;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder, MenuItemBuilder};

#[tauri::command]
async fn bring_to_front(webview_window: tauri::WebviewWindow) {
    let _ = webview_window.show();
    let _ = webview_window.unminimize();
    let _ = webview_window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![bring_to_front])
    .setup(|app| {
      // Меню трея
      let open_item = MenuItemBuilder::new("Открыть Альфа Вики").id("open").build(app)?;
      let quit_item  = MenuItemBuilder::new("Выход").id("quit").build(app)?;
      let menu = MenuBuilder::new(app)
          .item(&open_item)
          .separator()
          .item(&quit_item)
          .build()?;

      // Иконка в системном трее
      let _tray = TrayIconBuilder::new()
          .icon(app.default_window_icon().unwrap().clone())
          .tooltip("Альфа Вики")
          .menu(&menu)
          // Пункты меню
          .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| match event.id().as_ref() {
              "open" => {
                  if let Some(w) = app.get_webview_window("main") {
                      let _ = w.show();
                      let _ = w.unminimize();
                      let _ = w.set_focus();
                  }
              }
              "quit" => app.exit(0),
              _ => {}
          })
          // Левый клик по иконке трея → открыть окно
          .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
              if let TrayIconEvent::Click {
                  button: MouseButton::Left,
                  button_state: MouseButtonState::Up, ..
              } = event {
                  let app = tray.app_handle();
                  if let Some(w) = app.get_webview_window("main") {
                      let _ = w.show();
                      let _ = w.unminimize();
                      let _ = w.set_focus();
                  }
              }
          })
          .build(app)?;

      // События главного окна
      let main_window = app.get_webview_window("main").unwrap();
      let app_handle = app.handle().clone();
      main_window.on_window_event(move |event| {
          match event {
              // Нативный фокус → сообщаем в JS для навигации к чату
              tauri::WindowEvent::Focused(true) => {
                  let _ = app_handle.emit("window-native-focus", ());
              }
              // Закрытие → скрыть в трей вместо выхода
              tauri::WindowEvent::CloseRequested { api, .. } => {
                  api.prevent_close();
                  if let Some(w) = app_handle.get_webview_window("main") {
                      let _ = w.hide();
                  }
              }
              _ => {}
          }
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
