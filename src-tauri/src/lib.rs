mod audio;
mod metadata;
mod db;
mod midi;
mod scanner;
mod shortcuts;
mod shortcut_manager;

use audio::{AudioState, play_audio, play_audio_at, pause_audio, resume_audio, stop_audio, set_volume, sandi_set_playlist};
use metadata::{get_metadata, get_artwork, update_metadata};
use db::{init_db, add_track, get_tracks, remove_track, delete_track_from_disk, delete_tracks_from_disk, get_playlists, create_playlist, delete_playlist, add_tracks_to_playlist, get_playlist_tracks, remove_tracks_from_playlist, get_track_id_by_path, save_setting, get_settings};


use midi::{MidiState, list_midi_devices, connect_midi_device, disconnect_midi_device, set_midi_mappings};
use scanner::{scan_directory, list_directory, get_home_dir, add_folder_to_playlist_recursive};

use shortcuts::{sandi_unregister_all_shortcuts, sandi_register_global_action, sandi_list_shortcuts, sandi_restore_defaults};
use std::sync::{Arc, Mutex};
use tauri::{Manager, Emitter};
use rodio::{OutputStream, Sink};
use tauri_plugin_global_shortcut::ShortcutState;
use crate::shortcut_manager::{ShortcutStore, handle_global_shortcut};

#[tauri::command]
fn toggle_pin(window: tauri::Window, pinned: bool) -> Result<(), String> {
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}

/// Returns true if the process already has Accessibility trust.
/// On macOS, CGEventTap (media keys) requires this. Carbon hotkeys don't,
/// but granting it also improves reliability of system-wide shortcuts.
#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        // AXIsProcessTrusted() — no dialog, just checks the current status.
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" { fn AXIsProcessTrusted() -> bool; }
        let trusted = unsafe { AXIsProcessTrusted() };
        trusted
    }
    #[cfg(not(target_os = "macos"))]
    { true }
}

/// Opens System Settings → Privacy & Security → Accessibility so the user
/// can add this app to the allowed list.
#[tauri::command]
async fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        handle_global_shortcut(app, shortcut.clone());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let (stream, handle_raw) = OutputStream::try_default().expect("Failed to get output stream");
            std::mem::forget(stream); // Keep alive
            let sink = Sink::try_new(&handle_raw).expect("Failed to create sink");
            app.manage(AudioState::new(sink));
            app.manage(MidiState::new());
            app.manage(ShortcutStore::new());

            // ── Default global shortcuts (Carbon hotkeys, work system-wide) ──
            shortcuts::register_defaults(app.handle());
            // ──────────────────────────────────────────────────────────────────

            // ── souvlaki: media-key integration (macOS Remote Command Center) ─
            #[cfg(target_os = "macos")]
            {
                use souvlaki::{MediaControls, PlatformConfig};
                let config = PlatformConfig {
                    dbus_name: "sandi",
                    display_name: "Sandi",
                    hwnd: None,
                };
                let mut controls = MediaControls::new(config)
                    .expect("Failed to create MediaControls");
                let handle = app.handle().clone();
                controls.attach(move |event| {
                    use souvlaki::MediaControlEvent::*;
                    let cmd = match event {
                        Play | Pause | Toggle => "toggle",
                        Next                 => "next",
                        Previous             => "previous",
                        _                    => return,
                    };
                    crate::shortcut_manager::handle_media_command(&handle, cmd);
                }).expect("Failed to attach MediaControls");
                app.manage(Arc::new(Mutex::new(controls)));
            }
            // ──────────────────────────────────────────────────────────────────

            // ── device_query: safe global polling for single-key shortcuts (no hooks)
            {
                let handle = app.handle().clone();
                std::thread::spawn::<_, ()>(move || {
                    use device_query::{DeviceQuery, DeviceState};
                    let device_state = DeviceState::new();
                    let mut last_keys: Vec<device_query::Keycode> = Vec::new();

                    loop {
                        let keys = device_state.get_keys();

                        // SKIP if any modifier is pressed (those should be handled by system shortcuts plugin)
                        let has_modifier = keys.iter().any(|k| match k {
                            device_query::Keycode::LControl | device_query::Keycode::RControl |
                            device_query::Keycode::LShift   | device_query::Keycode::RShift   |
                            device_query::Keycode::LAlt     | device_query::Keycode::RAlt     |
                            device_query::Keycode::Command  | device_query::Keycode::LMeta    |
                            device_query::Keycode::RMeta    => true,
                            _ => false,
                        });

                        if !has_modifier {
                            // Only trigger for keys that were newly pressed (KeyDown)
                            let newly_pressed: Vec<_> = keys.iter()
                                .filter(|k| !last_keys.contains(k))
                                .cloned()
                                .collect();

                            if !newly_pressed.is_empty() {
                                crate::shortcut_manager::handle_device_query_keys(&handle, newly_pressed);
                            }
                        }

                        last_keys = keys;
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                });
            }
            // ──────────────────────────────────────────────────────────────────

            // ── track-end watcher: detect natural end of playback & auto-advance ──
            {
                let handle = app.handle().clone();
                std::thread::spawn::<_, ()>(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(500));

                        let audio = handle.state::<AudioState>();

                        // Only act when something was playing and the sink is now empty
                        let is_playing_path = audio.playing_path.lock().unwrap().is_some();
                        if !is_playing_path {
                            continue;
                        }
                        let sink_empty = audio.sink.lock().unwrap().empty();
                        if !sink_empty {
                            continue;
                        }

                        // Track finished naturally — clear position state
                        audio.clear_playing_state();

                        // Try to advance to the next track in the queue
                        let target = {
                            let queue = audio.queue.lock().unwrap();
                            let mut index = audio.current_index.lock().unwrap();
                            match *index {
                                Some(i) if i + 1 < queue.len() => {
                                    let next_path = queue[i + 1].clone();
                                    *index = Some(i + 1);
                                    Some(next_path)
                                }
                                _ => {
                                    // End of queue — no wrap, just stop
                                    *index = None;
                                    None
                                }
                            }
                        };

                        if let Some(path) = target {
                            if audio.internal_play(&path, 0).is_ok() {
                                let _ = handle.emit("track-changed", &path);
                                crate::shortcut_manager::sync_system_metadata(&handle, &path);
                            }
                        } else {
                            // Nothing to advance to — notify frontend to reset UI
                            let _ = handle.emit("track-finished", ());
                        }
                    }
                });
            }
            // ──────────────────────────────────────────────────────────────────

            let db_handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let db_state = init_db(&db_handle).await.expect("Failed to initialize database");
                db_handle.manage(db_state);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_pin,
            play_audio,
            play_audio_at,
            pause_audio,
            resume_audio,
            stop_audio,
            set_volume,
            get_metadata,
            get_artwork,
            update_metadata,
            add_track,
            get_tracks,
            remove_track,
            delete_track_from_disk,
            delete_tracks_from_disk,
            get_playlists,
            create_playlist,
            delete_playlist,
            add_tracks_to_playlist,
            get_playlist_tracks,
            remove_tracks_from_playlist,
            list_midi_devices,

            connect_midi_device,
            disconnect_midi_device,
            set_midi_mappings,
            scan_directory,
            list_directory,
            get_home_dir,
            sandi_unregister_all_shortcuts,
            sandi_register_global_action,
            sandi_list_shortcuts,
            sandi_restore_defaults,
            sandi_set_playlist,
            check_accessibility,
            open_accessibility_settings,
            add_folder_to_playlist_recursive,
            get_track_id_by_path,
            save_setting,
            get_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
