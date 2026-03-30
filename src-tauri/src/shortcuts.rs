use tauri_plugin_global_shortcut::{Shortcut, GlobalShortcutExt};
use crate::shortcut_manager::{ShortcutStore, GlobalAction};
use tauri::Manager;

// Default bindings registered at Rust startup, before the webview loads.
// The frontend's syncGlobalShortcuts() will override these once it loads.
// If the frontend has no global shortcuts, sandi_restore_defaults() re-applies these.
const DEFAULTS: &[(&str, &str)] = &[
    ("CommandOrControl+Shift+Space",      "playPause"),
    ("CommandOrControl+Shift+N",          "nextTrack"),
    ("CommandOrControl+Shift+P",          "previousTrack"),
    ("CommandOrControl+Shift+ArrowRight", "seekForward"),
    ("CommandOrControl+Shift+ArrowLeft",  "seekBackward"),
    ("CommandOrControl+Shift+1",          "rate1"),
    ("CommandOrControl+Shift+2",          "rate2"),
    ("CommandOrControl+Shift+3",          "rate3"),
    ("CommandOrControl+Shift+4",          "rate4"),
    ("CommandOrControl+Shift+5",          "rate5"),
];

/// Register default shortcuts from Rust at startup so they work immediately,
/// independently of whether the webview has loaded yet.
pub fn register_defaults(app: &tauri::AppHandle) {
    let store = app.state::<ShortcutStore>();
    for &(s, a) in DEFAULTS {
        if let Ok(sc) = s.parse::<Shortcut>() {
            if let Some(action) = GlobalAction::from_str(a) {
                store.set_mapping(sc.to_string(), action);
                let _ = app.global_shortcut().register(sc);
            }
        }
    }

}

#[tauri::command]
pub fn sandi_list_shortcuts(app: tauri::AppHandle) -> Vec<String> {
    let store = app.state::<ShortcutStore>();
    let map = store.mappings.lock().unwrap();
    map.iter().map(|(k, v)| format!("{} → {:?}", k, v)).collect()
}

#[tauri::command]
pub fn sandi_unregister_all_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<ShortcutStore>();
    store.clear();
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())
}

/// Called by the frontend after syncGlobalShortcuts if no user global shortcuts
/// were registered. Restores the built-in defaults so at least something works.
#[tauri::command]
pub fn sandi_restore_defaults(app: tauri::AppHandle) -> Result<(), String> {

    register_defaults(&app);
    Ok(())
}

#[tauri::command]
pub fn sandi_register_global_action(app: tauri::AppHandle, shortcut_str: String, action_str: String) -> Result<(), String> {

    let action = crate::shortcut_manager::GlobalAction::from_str(&action_str)
        .ok_or_else(|| "Invalid action name".to_string())?;

    let store = app.state::<ShortcutStore>();
    
    // Always store the mapping (even if it's a polling-only key like "Numpad1")
    store.set_mapping(shortcut_str.clone(), action.clone());

    // Try to register with the OS (only works if it's a valid 'system' shortcut with mods)
    if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
        let normalized = shortcut.to_string();

        
        // Also ensure normalized version is mapped in case OS fires that instead
        store.set_mapping(normalized.clone(), action);

        let _ = app.global_shortcut().register(shortcut);
    } else {

    }

    Ok(())
}
