use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::Shortcut;
use crate::audio::AudioState;

// ── GlobalAction ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum GlobalAction {
    TogglePlay,
    SeekForward,
    SeekBackward,
    NextTrack,
    PreviousTrack,
    Rate1, Rate2, Rate3, Rate4, Rate5,
}

impl GlobalAction {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "playPause"     => Some(GlobalAction::TogglePlay),
            "seekForward"   => Some(GlobalAction::SeekForward),
            "seekBackward"  => Some(GlobalAction::SeekBackward),
            "nextTrack"     => Some(GlobalAction::NextTrack),
            "previousTrack" => Some(GlobalAction::PreviousTrack),
            "rate1"         => Some(GlobalAction::Rate1),
            "rate2"         => Some(GlobalAction::Rate2),
            "rate3"         => Some(GlobalAction::Rate3),
            "rate4"         => Some(GlobalAction::Rate4),
            "rate5"         => Some(GlobalAction::Rate5),
            _               => None,
        }
    }
}

// ── ShortcutStore ─────────────────────────────────────────────────────────────

pub struct ShortcutStore {
    pub mappings: Arc<Mutex<HashMap<String, GlobalAction>>>,
}

impl ShortcutStore {
    pub fn new() -> Self {
        Self { mappings: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn set_mapping(&self, shortcut_str: String, action: GlobalAction) {
        self.mappings.lock().unwrap().insert(shortcut_str, action);
    }

    pub fn clear(&self) {
        self.mappings.lock().unwrap().clear();
    }

    pub fn get_action(&self, shortcut_str: &str) -> Option<GlobalAction> {
        self.mappings.lock().unwrap().get(shortcut_str).cloned()
    }
}

// ── Rate event payload ────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
struct TrackRatedEvent {
    path:   String,
    rating: u8,
}

// ── Main handler (called for every OS shortcut event) ────────────────────────

// ── Media Command Handler (for tauri-plugin-media) ───────────────────────────

pub fn handle_global_shortcut(app: &AppHandle, shortcut: Shortcut) {
    let shortcut_str = shortcut.to_string();


    let store = app.state::<ShortcutStore>();
    match store.get_action(&shortcut_str) {
        Some(action) => {

            trigger_action(app, action);
        }
        None => {
            let _known: Vec<_> = store.mappings.lock().unwrap().keys().cloned().collect();

        }
    }
}

pub fn handle_media_command(app: &AppHandle, command: &str) {
    let action = match command {
        "play" | "pause" | "toggle" => Some(GlobalAction::TogglePlay),
        "next"     => Some(GlobalAction::NextTrack),
        "previous" => Some(GlobalAction::PreviousTrack),
        _ => None,
    };
    if let Some(action) = action {
        trigger_action(app, action);
    }
}

pub fn handle_device_query_keys(app: &AppHandle, keys: Vec<device_query::Keycode>) {
    use device_query::Keycode::*;
    for key in keys {
        let shortcut_str = match key {
            NumpadAdd      => "NumpadAdd",
            NumpadSubtract => "NumpadSubtract",
            NumpadMultiply => "NumpadMultiply",
            NumpadDivide   => "NumpadDivide",
            NumpadDecimal  => "NumpadDecimal",
            NumpadEnter    => "NumpadEnter",
            Numpad0 => "Numpad0", Numpad1 => "Numpad1", Numpad2 => "Numpad2",
            Numpad3 => "Numpad3", Numpad4 => "Numpad4", Numpad5 => "Numpad5",
            Numpad6 => "Numpad6", Numpad7 => "Numpad7", Numpad8 => "Numpad8",
            Numpad9 => "Numpad9",
            // Alpha digits (main keyboard)
            Key1 => "1", Key2 => "2", Key3 => "3", Key4 => "4", Key5 => "5",
            Space => "Space",
            _ => continue,
        };

        let store = app.state::<ShortcutStore>();
        if let Some(action) = store.get_action(shortcut_str) {

            trigger_action(app, action);
        }
    }
}

pub fn trigger_action(app: &AppHandle, action: GlobalAction) {

    let audio = app.state::<AudioState>();
    match action {
        GlobalAction::TogglePlay => {
            // DEBOUNCE: Ignore fast repeats (under 500ms)
            {
                let mut last_nav = audio.last_nav_at.lock().unwrap();
                if let Some(instant) = *last_nav {
                    if instant.elapsed() < std::time::Duration::from_millis(500) {

                        return;
                    }
                }
                *last_nav = Some(std::time::Instant::now());
            }

            let is_playing = audio.playing_path.lock().unwrap().is_some();
            let is_paused  = audio.sink.lock().unwrap().is_paused();

            if !is_playing {
                // Initial play: tell frontend to start
                let _ = app.emit("playback-status-changed", true);
            } else {
                if is_paused {
                    let _ = audio.do_resume();
                    let _ = app.emit("playback-status-changed", true);
                } else {
                    let _ = audio.do_pause();
                    let _ = app.emit("playback-status-changed", false);
                }
            }

            // Sync playback state to OS Media Controls
            if let Some(controls) = app.try_state::<Arc<Mutex<souvlaki::MediaControls>>>() {
                let mut c = controls.lock().unwrap();
                let state = if !is_playing || is_paused { 
                    souvlaki::MediaPlayback::Playing { progress: None } 
                } else { 
                    souvlaki::MediaPlayback::Paused { progress: None } 
                };
                let _ = c.set_playback(state);
            }
        }

        GlobalAction::SeekForward => {
            let _ = app.emit("execute-action", "seekForward");
        }
        GlobalAction::SeekBackward => {
            let _ = app.emit("execute-action", "seekBackward");
        }

        GlobalAction::NextTrack | GlobalAction::PreviousTrack => {
            // DEBOUNCE: Ignore fast repeats (under 500ms)
            {
                let mut last_nav = audio.last_nav_at.lock().unwrap();
                if let Some(instant) = *last_nav {
                    if instant.elapsed() < std::time::Duration::from_millis(500) {

                        return;
                    }
                }
                *last_nav = Some(std::time::Instant::now());
            }

            let queue     = audio.queue.lock().unwrap();
            let mut index = audio.current_index.lock().unwrap();
            let is_next   = action == GlobalAction::NextTrack;

            let target = if is_next {
                match *index {
                    Some(i) if i + 1 < queue.len() => Some((i + 1, queue[i + 1].clone())),
                    None    if !queue.is_empty()    => Some((0, queue[0].clone())),
                    _                               => None,
                }
            } else {
                match *index {
                    Some(i) if i > 0 => Some((i - 1, queue[i - 1].clone())),
                    None if !queue.is_empty() => {
                        let last = queue.len() - 1;
                        Some((last, queue[last].clone()))
                    }
                    _ => None,
                }
            };
            drop(queue);

            if let Some((new_idx, path)) = target {
                if audio.internal_play(&path, 0).is_ok() {
                    *index = Some(new_idx);
                    drop(index);
                    let _ = app.emit("track-changed", &path);
                    sync_system_metadata(app, &path);
                }
            }
        }

        GlobalAction::Rate1 | GlobalAction::Rate2 | GlobalAction::Rate3
        | GlobalAction::Rate4 | GlobalAction::Rate5 => {
            let rating: u8 = match action {
                GlobalAction::Rate1 => 1, GlobalAction::Rate2 => 2,
                GlobalAction::Rate3 => 3, GlobalAction::Rate4 => 4,
                GlobalAction::Rate5 => 5, _ => unreachable!(),
            };
            let path = audio.playing_path.lock().unwrap().clone();
            let Some(path) = path else { return };

            let path_tag = path.clone();
            std::thread::spawn(move || { let _ = crate::metadata::set_rating(&path_tag, rating); });

            let pool = app.state::<crate::db::DbState>().pool.clone();
            let path_db = path.clone();
            tauri::async_runtime::spawn(async move {
                let _ = sqlx::query("UPDATE tracks SET rating = ? WHERE path = ?")
                    .bind(rating as i32).bind(&path_db).execute(&pool).await;
            });

            let _ = app.emit("track-rated", TrackRatedEvent { path, rating });
        }
    }
}

pub fn sync_system_metadata(app: &AppHandle, path: &str) {
    if let Some(controls) = app.try_state::<Arc<Mutex<souvlaki::MediaControls>>>() {
        if let Ok(meta) = crate::metadata::get_metadata(path.to_string()) {
            let mut c = controls.lock().unwrap();
            let _ = c.set_metadata(souvlaki::MediaMetadata {
                title: meta.title.as_deref(),
                artist: meta.artist.as_deref(),
                album: meta.album.as_deref(),
                duration: Some(std::time::Duration::from_secs(meta.duration)),
                ..Default::default()
            });
            
            let audio = app.state::<AudioState>();
            let state = if audio.sink.lock().unwrap().is_paused() {
                souvlaki::MediaPlayback::Paused { progress: None }
            } else {
                souvlaki::MediaPlayback::Playing { progress: None }
            };
            let _ = c.set_playback(state);
        }
    }
}
