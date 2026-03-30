use midir::{Ignore, MidiInput};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Emitter};

pub struct MidiState {
    pub input_connection: Arc<Mutex<Option<midir::MidiInputConnection<()>>>>,
    pub mappings: Arc<Mutex<HashMap<String, String>>>,
}

impl MidiState {
    pub fn new() -> Self {
        Self {
            input_connection: Arc::new(Mutex::new(None)),
            mappings: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Convert a raw MIDI message to a mapping key string.
/// Note On  → "note:N"   (ignores Note Off and zero-velocity notes)
/// CC       → "cc:N"
fn midi_message_to_key(message: &[u8]) -> Option<String> {
    if message.len() < 2 { return None; }
    let status = message[0] & 0xF0;
    let data1  = message[1];
    match status {
        0x90 if message.len() >= 3 && message[2] > 0 => Some(format!("note:{}", data1)),
        0xB0 => Some(format!("cc:{}", data1)),
        _ => None,
    }
}

#[tauri::command]
pub fn list_midi_devices() -> Result<Vec<String>, String> {
    let midi_in = MidiInput::new("LunarAudio MIDI").map_err(|e| e.to_string())?;
    let ports = midi_in.ports();
    let mut names = Vec::new();
    for port in &ports {
        names.push(midi_in.port_name(port).map_err(|e| e.to_string())?);
    }
    Ok(names)
}

#[tauri::command]
pub fn connect_midi_device(app_handle: AppHandle, device_index: usize) -> Result<(), String> {
    // Clone Arcs before the blocking connect call
    let (conn_arc, mappings_arc) = {
        let state = app_handle.state::<MidiState>();
        (Arc::clone(&state.input_connection), Arc::clone(&state.mappings))
    };

    // Drop any existing connection
    *conn_arc.lock().map_err(|e| e.to_string())? = None;

    let mut midi_in = MidiInput::new("LunarAudio MIDI").map_err(|e| e.to_string())?;
    midi_in.ignore(Ignore::None);

    let ports = midi_in.ports();
    let port  = ports.get(device_index).ok_or("Device index out of range")?.clone();

    let handle_clone = app_handle.clone();

    let conn = midi_in.connect(&port, "lunar-midi", move |_stamp, message, _| {
        // Always emit raw bytes so the frontend learn-mode can capture them
        let _ = handle_clone.emit("midi-event", message.to_vec());

        // Look up mapping and trigger action
        if let Some(key) = midi_message_to_key(message) {
            let action_str = {
                let map = mappings_arc.lock().unwrap();
                map.get(&key).cloned()
            };
            if let Some(action_str) = action_str {
                if let Some(action) = crate::shortcut_manager::GlobalAction::from_str(&action_str) {
                    crate::shortcut_manager::trigger_action(&handle_clone, action);
                }
            }
        }
    }, ()).map_err(|e| e.to_string())?;

    *conn_arc.lock().map_err(|e| e.to_string())? = Some(conn);
    println!("[midi] connected to device index {}", device_index);
    Ok(())
}

#[tauri::command]
pub fn disconnect_midi_device(app_handle: AppHandle) -> Result<(), String> {
    let state = app_handle.state::<MidiState>();
    *state.input_connection.lock().map_err(|e| e.to_string())? = None;
    println!("[midi] disconnected");
    Ok(())
}

/// Replace the entire MIDI→action mapping table.
/// Keys are "note:N" or "cc:N"; values are action strings (same as GlobalAction::from_str).
#[tauri::command]
pub fn set_midi_mappings(app_handle: AppHandle, mappings: HashMap<String, String>) -> Result<(), String> {
    let state = app_handle.state::<MidiState>();
    *state.mappings.lock().map_err(|e| e.to_string())? = mappings;
    Ok(())
}
