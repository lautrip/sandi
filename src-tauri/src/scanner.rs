use walkdir::WalkDir;
use crate::metadata::get_metadata;
use crate::db::{add_track, DbState, Track};
use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").map_err(|_| "Could not find HOME directory".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Simple fallback for other OS if needed, though user is on Mac
        Ok("/".to_string())
    }
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut entries = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
        for entry in rd.filter_map(|e| e.ok()) {
            let p = entry.path();
            let is_dir = p.is_dir();
            let name = p.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            
            // Ignore hidden files (starting with .)
            if name.starts_with('.') {
                continue;
            }

            if is_dir {
                entries.push(DirEntry { name, path: p.to_string_lossy().to_string(), is_dir });
            } else {
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if ["mp3", "flac", "wav", "m4a"].contains(&ext.as_str()) {

                    entries.push(DirEntry { name, path: p.to_string_lossy().to_string(), is_dir: false });
                }
            }
        }
    }
    
    // Sort: dirs first, then files
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub async fn scan_directory(
    state: tauri::State<'_, DbState>,
    path: String
) -> Result<(), String> {
    use rayon::prelude::*;

    let root = Path::new(&path);
    if !root.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // 1. Collect all valid audio file paths
    let paths: Vec<_> = WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if ["mp3", "flac", "wav", "m4a"].contains(&ext.as_str()) {
                Some(p.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();

    // 2. Extract metadata in parallel
    let tracks: Vec<_> = paths.into_par_iter()
        .filter_map(|p_str| {
            if let Ok(meta) = get_metadata(p_str.clone()) {
                Some(Track {
                    id:           None,
                    path:         p_str,
                    title:        meta.title,
                    artist:       meta.artist,
                    album:        meta.album,
                    year:         meta.year.map(|y| y as i32),
                    duration:     Some(meta.duration as i32),
                    rating:       meta.rating,
                    track_number: meta.track_number,
                    disc_number:  meta.disc_number,
                    genre:        meta.genre,
                    album_artist: meta.album_artist,
                    composer:     meta.composer,
                    comment:      meta.comment,
                    bpm:          meta.bpm,
                    label:        meta.label,
                    encoder:      meta.encoder,
                    copyright:    meta.copyright,
                    bitrate:      meta.bitrate.map(|v| v as i32),
                    sample_rate:  meta.sample_rate.map(|v| v as i32),
                    channels:     meta.channels.map(|v| v as i32),
                    has_artwork:  meta.has_artwork,
                })
            } else {
                None
            }
        })
        .collect();

    // 3. Insert into database (sequentially to avoid locking issues, or let sqlx handle it)
    for track in tracks {
        let _ = crate::db::add_track(state.clone(), track).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn add_folder_to_playlist_recursive(
    state: tauri::State<'_, DbState>,
    playlist_id: i64,
    folder_path: String
) -> Result<i32, String> {

    let root = Path::new(&folder_path);
    if !root.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut track_ids = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let p = entry.path();
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            
            if ["mp3", "flac", "wav", "m4a"].contains(&ext.as_str()) {
                let path_str = p.to_string_lossy().to_string();
                if let Ok(meta) = get_metadata(path_str.clone()) {
                    let track = Track {
                        id:           None,
                        path:         path_str,
                        title:        meta.title,
                        artist:       meta.artist,
                        album:        meta.album,
                        year:         meta.year.map(|y| y as i32),
                        duration:     Some(meta.duration as i32),
                        rating:       meta.rating,
                        track_number: meta.track_number,
                        disc_number:  meta.disc_number,
                        genre:        meta.genre,
                        album_artist: meta.album_artist,
                        composer:     meta.composer,
                        comment:      meta.comment,
                        bpm:          meta.bpm,
                        label:        meta.label,
                        encoder:      meta.encoder,
                        copyright:    meta.copyright,
                        bitrate:      meta.bitrate.map(|v| v as i32),
                        sample_rate:  meta.sample_rate.map(|v| v as i32),
                        channels:     meta.channels.map(|v| v as i32),
                        has_artwork:  meta.has_artwork,
                    };
                    if let Ok(id) = crate::db::add_track(state.clone(), track).await {
                        track_ids.push(id);
                    }
                }
            }
        }
    }

    if !track_ids.is_empty() {
        crate::db::add_tracks_to_playlist(state, playlist_id, track_ids.clone()).await?;
    }

    Ok(track_ids.len() as i32)
}


