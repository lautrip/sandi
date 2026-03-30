use std::fs::File;
use std::io::BufReader;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct AudioState {
    pub sink:          Arc<Mutex<rodio::Sink>>,
    pub queue:         Arc<Mutex<Vec<String>>>,
    pub current_index: Arc<Mutex<Option<usize>>>,
    pub playing_path:  Arc<Mutex<Option<String>>>,
    // Position tracking for Rust-side seek (global shortcuts)
    play_started_at:   Arc<Mutex<Option<Instant>>>,
    play_position:     Arc<Mutex<u64>>,
    pub last_nav_at:   Arc<Mutex<Option<Instant>>>,
}

impl AudioState {
    pub fn new(sink: rodio::Sink) -> Self {
        Self {
            sink:            Arc::new(Mutex::new(sink)),
            queue:           Arc::new(Mutex::new(Vec::new())),
            current_index:   Arc::new(Mutex::new(None)),
            playing_path:    Arc::new(Mutex::new(None)),
            play_started_at: Arc::new(Mutex::new(None)),
            play_position:   Arc::new(Mutex::new(0)),
            last_nav_at:     Arc::new(Mutex::new(None)),
        }
    }

    // ── position tracking ────────────────────────────────────────────────────

    fn record_play(&self, offset: u64) {
        *self.play_position.lock().unwrap()   = offset;
        *self.play_started_at.lock().unwrap() = Some(Instant::now());
    }

    fn record_pause(&self) {
        let pos = self.current_secs();
        *self.play_position.lock().unwrap()   = pos;
        *self.play_started_at.lock().unwrap() = None;
    }

    pub fn current_secs(&self) -> u64 {
        let pos = *self.play_position.lock().unwrap();
        match *self.play_started_at.lock().unwrap() {
            Some(t) => pos + t.elapsed().as_secs(),
            None    => pos,
        }
    }

    // ── public helpers (used by shortcut_manager) ────────────────────────────


    pub fn do_pause(&self) -> Result<(), String> {
        self.record_pause();
        self.sink.lock().unwrap().pause();
        Ok(())
    }

    pub fn do_resume(&self) -> Result<(), String> {
        let pos = *self.play_position.lock().unwrap();
        self.record_play(pos);
        self.sink.lock().unwrap().play();
        Ok(())
    }

    pub fn do_stop(&self) {
        self.sink.lock().unwrap().stop();
        *self.playing_path.lock().unwrap()    = None;
        *self.play_started_at.lock().unwrap() = None;
        *self.play_position.lock().unwrap()   = 0;
    }

    /// Clear position tracking state (called when a track ends naturally).
    /// Does NOT stop the sink — use do_stop() for that.
    pub fn clear_playing_state(&self) {
        *self.playing_path.lock().unwrap()    = None;
        *self.play_started_at.lock().unwrap() = None;
        *self.play_position.lock().unwrap()   = 0;
    }

    // ── core playback ─────────────────────────────────────────────────────────

    pub fn internal_play(&self, path: &str, offset_secs: u64) -> Result<(), String> {
        let same_track = self.playing_path.lock().unwrap().as_deref() == Some(path);

        if same_track {
            // Native seek — no file re-open (works for offset == 0 too)
            self.sink.lock().unwrap()
                .try_seek(Duration::from_secs(offset_secs))
                .map_err(|e| e.to_string())?;
            self.record_play(offset_secs);
            return Ok(());
        }

        // Update playing_path and hold the lock while updating the sink
        // to prevent the watcher thread from sparking an auto-advance while we're empty.
        let mut path_guard = self.playing_path.lock().unwrap();
        *path_guard = Some(path.to_string());
        {
            let sink = self.sink.lock().unwrap();
            sink.stop();

            let file   = File::open(path).map_err(|e| format!("File open error: {}", e))?;
            let source = rodio::Decoder::new(BufReader::new(file))
                .map_err(|e| format!("Decoder error: {}", e))?;
            sink.append(source);

            if offset_secs > 0 {
                sink.try_seek(Duration::from_secs(offset_secs))
                    .map_err(|e| e.to_string())?;
            }
            sink.play();
        } // sink lock released
        drop(path_guard); // now watcher thread can continue

        self.record_play(offset_secs);
        Ok(())
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn play_audio(app: tauri::AppHandle, state: tauri::State<'_, AudioState>, path: String) -> Result<(), String> {
    state.internal_play(&path, 0)?;
    crate::shortcut_manager::sync_system_metadata(&app, &path);
    Ok(())
}

#[tauri::command]
pub fn play_audio_at(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioState>,
    path: String,
    offset_secs: u64,
) -> Result<(), String> {
    state.internal_play(&path, offset_secs)?;
    crate::shortcut_manager::sync_system_metadata(&app, &path);
    Ok(())
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    state.do_pause()
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    state.do_resume()
}

#[tauri::command]
pub fn stop_audio(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    state.do_stop();
    Ok(())
}

#[tauri::command]
pub fn set_volume(state: tauri::State<'_, AudioState>, volume: f32) -> Result<(), String> {
    let sink = state.sink.lock().map_err(|e| e.to_string())?;
    sink.set_volume(volume);
    Ok(())
}

#[tauri::command]
pub fn sandi_set_playlist(
    state: tauri::State<'_, AudioState>,
    paths: Vec<String>,
    current_path: Option<String>,
) -> Result<(), String> {
    let mut queue     = state.queue.lock().unwrap();
    let mut index_ref = state.current_index.lock().unwrap();
    *queue = paths;

    if let Some(path) = current_path {
        *index_ref = queue.iter().position(|p| p == &path);
        // No more noisy logs
    } else {
        *index_ref = None;
    }
    Ok(())
}
