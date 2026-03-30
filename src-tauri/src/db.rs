use sqlx::{sqlite::SqlitePool, Pool, Sqlite, Row};
use std::fs;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

pub struct DbState {
    pub pool: Pool<Sqlite>,
}

pub async fn init_db(app_handle: &AppHandle) -> Result<DbState, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("library.db");

    if !db_path.exists() {
        fs::File::create(&db_path).map_err(|e| e.to_string())?;
    }

    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    let pool = SqlitePool::connect(&db_url).await.map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tracks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            path         TEXT    NOT NULL UNIQUE,
            title        TEXT,
            artist       TEXT,
            album        TEXT,
            year         INTEGER,
            duration     INTEGER,
            rating       INTEGER,
            track_number TEXT,
            disc_number  TEXT,
            genre        TEXT,
            album_artist TEXT,
            composer     TEXT,
            comment      TEXT,
            bpm          TEXT,
            label        TEXT,
            encoder      TEXT,
            copyright    TEXT,
            bitrate      INTEGER,
            sample_rate  INTEGER,
            channels     INTEGER,
            has_artwork  INTEGER DEFAULT 0
        )"
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    // Migrate existing DBs: add any column that doesn't exist yet.
    for (col, typ) in [
        ("track_number", "TEXT"),
        ("disc_number",  "TEXT"),
        ("genre",        "TEXT"),
        ("album_artist", "TEXT"),
        ("composer",     "TEXT"),
        ("comment",      "TEXT"),
        ("bpm",          "TEXT"),
        ("label",        "TEXT"),
        ("encoder",      "TEXT"),
        ("copyright",    "TEXT"),
        ("bitrate",      "INTEGER"),
        ("sample_rate",  "INTEGER"),
        ("channels",     "INTEGER"),
        ("has_artwork",  "INTEGER DEFAULT 0"),
    ] {
        let _ = sqlx::query(&format!("ALTER TABLE tracks ADD COLUMN {} {}", col, typ))
            .execute(&pool)
            .await; // silently ignore "duplicate column" error
    }

    // Playlists tables
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS playlists (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT    NOT NULL UNIQUE
        )"
    ).execute(&pool).await.map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_id    INTEGER NOT NULL,
            position    INTEGER NOT NULL,
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE,
            PRIMARY KEY(playlist_id, track_id)
        )"
    ).execute(&pool).await.map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )"
    ).execute(&pool).await.map_err(|e| e.to_string())?;


    Ok(DbState { pool })
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Track {
    pub id:           Option<i64>,
    pub path:         String,
    pub title:        Option<String>,
    pub artist:       Option<String>,
    pub album:        Option<String>,
    pub year:         Option<i32>,
    pub duration:     Option<i32>,
    pub rating:       Option<u8>,
    pub track_number: Option<String>,
    pub disc_number:  Option<String>,
    pub genre:        Option<String>,
    pub album_artist: Option<String>,
    pub composer:     Option<String>,
    pub comment:      Option<String>,
    pub bpm:          Option<String>,
    pub label:        Option<String>,
    pub encoder:      Option<String>,
    pub copyright:    Option<String>,
    pub bitrate:      Option<i32>,
    pub sample_rate:  Option<i32>,
    pub channels:     Option<i32>,
    pub has_artwork: bool,
}

#[tauri::command]
pub async fn add_track(state: tauri::State<'_, DbState>, track: Track) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO tracks
            (path, title, artist, album, year, duration, rating,
             track_number, disc_number, genre, album_artist, composer,
             comment, bpm, label, encoder, copyright, bitrate, sample_rate, channels, has_artwork)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(path) DO UPDATE SET
            title=excluded.title,
            artist=excluded.artist,
            album=excluded.album,
            year=excluded.year,
            duration=excluded.duration,
            rating=excluded.rating,
            track_number=excluded.track_number,
            disc_number=excluded.disc_number,
            genre=excluded.genre,
            album_artist=excluded.album_artist,
            composer=excluded.composer,
            comment=excluded.comment,
            bpm=excluded.bpm,
            label=excluded.label,
            encoder=excluded.encoder,
            copyright=excluded.copyright,
            bitrate=excluded.bitrate,
            sample_rate=excluded.sample_rate,
            channels=excluded.channels,
            has_artwork=excluded.has_artwork
         RETURNING id"
    )
    .bind(track.path)
    .bind(track.title)
    .bind(track.artist)
    .bind(track.album)
    .bind(track.year)
    .bind(track.duration)
    .bind(track.rating)
    .bind(track.track_number)
    .bind(track.disc_number)
    .bind(track.genre)
    .bind(track.album_artist)
    .bind(track.composer)
    .bind(track.comment)
    .bind(track.bpm)
    .bind(track.label)
    .bind(track.encoder)
    .bind(track.copyright)
    .bind(track.bitrate)
    .bind(track.sample_rate)
    .bind(track.channels)
    .bind(track.has_artwork)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.get("id"))
}

#[tauri::command]
pub async fn get_track_id_by_path(state: tauri::State<'_, DbState>, path: String) -> Result<i64, String> {
    let row = sqlx::query("SELECT id FROM tracks WHERE path = ?")
        .bind(path)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    
    match row {
        Some(r) => Ok(r.get("id")),
        None => Err("Track not found in database".to_string()),
    }
}


#[tauri::command]
pub async fn remove_track(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    remove_track_internal(&state.pool, id).await
}

pub async fn remove_track_internal(pool: &Pool<Sqlite>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM tracks WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_track_from_disk(state: tauri::State<'_, DbState>, id: i64, path: String) -> Result<(), String> {
    println!("[backend] delete_track_from_disk requested for: {} (id: {})", path, id);
    // 1. Delete file from disk if it exists
    let p = std::path::Path::new(&path);
    if p.exists() {
        println!("[backend] File exists, removing...");
        std::fs::remove_file(p).map_err(|e| {
            let err = format!("FileSystem error: {}", e);
            eprintln!("[backend] {}", err);
            err
        })?;
        println!("[backend] File removed successfully");
    } else {
        println!("[backend] File not found on disk, proceeding with DB removal only: {}", path);
    }
    
    // 2. Remove from database
    println!("[backend] Removing from database (id: {})", id);
    remove_track_internal(&state.pool, id).await?;
    println!("[backend] Track removed from database");
    
    Ok(())
}

#[tauri::command]
pub async fn save_setting(state: tauri::State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, DbState>) -> Result<HashMap<String, String>, String> {
    let rows = sqlx::query("SELECT key, value FROM settings")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    
    let mut map = HashMap::new();
    for row in rows {
        map.insert(row.get(0), row.get(1));
    }
    Ok(map)
}

#[tauri::command]
pub async fn get_tracks(state: tauri::State<'_, DbState>) -> Result<Vec<Track>, String> {
    let rows = sqlx::query(
        "SELECT id, path, title, artist, album, year, duration, rating,
                track_number, disc_number, genre, album_artist, composer,
                comment, bpm, label, encoder, copyright, bitrate, sample_rate, channels, has_artwork
         FROM tracks"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let tracks = rows
        .into_iter()
        .map(|row| Track {
            id:           row.try_get("id").ok(),
            path:         row.try_get("path").unwrap_or_default(),
            title:        row.try_get("title").ok(),
            artist:       row.try_get("artist").ok(),
            album:        row.try_get("album").ok(),
            year:         row.try_get("year").ok(),
            duration:     row.try_get("duration").ok(),
            rating:       row.try_get("rating").ok(),
            track_number: row.try_get("track_number").ok(),
            disc_number:  row.try_get("disc_number").ok(),
            genre:        row.try_get("genre").ok(),
            album_artist: row.try_get("album_artist").ok(),
            composer:     row.try_get("composer").ok(),
            comment:      row.try_get("comment").ok(),
            bpm:          row.try_get("bpm").ok(),
            label:        row.try_get("label").ok(),
            encoder:      row.try_get("encoder").ok(),
            copyright:    row.try_get("copyright").ok(),
            bitrate:      row.try_get("bitrate").ok(),
            sample_rate:  row.try_get("sample_rate").ok(),
            channels:     row.try_get("channels").ok(),
            has_artwork:  row.try_get::<i32, _>("has_artwork").unwrap_or(0) != 0,
        })
        .collect();

    Ok(tracks)
}

#[tauri::command]
pub async fn delete_tracks_from_disk(state: tauri::State<'_, DbState>, tracks: Vec<(i64, String)>) -> Result<(), String> {
    println!("[backend] move_tracks_to_trash requested for {} tracks", tracks.len());
    
    for (id, path) in tracks {
        println!("[backend] Moving to trash: {} (id: {})", path, id);
        // 1. Send file to trash if it exists
        let p = std::path::Path::new(&path);
        if p.exists() {
            if let Err(e) = trash::delete(p) {
                eprintln!("[backend] Trash error for {}: {}", path, e);
                // If trash fails, we might not want to remove from DB?
                // Actually, if it's not found on disk, we still remove from DB.
                // But if it's a real FS error, we should probably stop?
            } else {
                println!("[backend] File moved to trash: {}", path);
            }
        }
        
        // 2. Remove from database
        if let Err(e) = remove_track_internal(&state.pool, id).await {
            eprintln!("[backend] Database error for id {}: {}", id, e);
        }
    }
    
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
}

#[tauri::command]
pub async fn get_playlists(state: tauri::State<'_, DbState>) -> Result<Vec<Playlist>, String> {
    let rows = sqlx::query("SELECT id, name FROM playlists")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|r| Playlist { 
        id: r.get(0), 
        name: r.get(1) 
    }).collect())
}

#[tauri::command]
pub async fn create_playlist(state: tauri::State<'_, DbState>, name: String) -> Result<i64, String> {
    let res = sqlx::query("INSERT INTO playlists (name) VALUES (?)")
        .bind(name)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.last_insert_rowid())
}

#[tauri::command]
pub async fn delete_playlist(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM playlists WHERE id = ?").bind(id).execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_tracks_to_playlist(state: tauri::State<'_, DbState>, playlist_id: i64, track_ids: Vec<i64>) -> Result<(), String> {
    for tid in track_ids {
        // Find max position
        let row: (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?")
            .bind(playlist_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
        
        // Ignore if already in playlist (primary key constraint)
        let _ = sqlx::query("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
            .bind(playlist_id)
            .bind(tid)
            .bind(row.0 + 1)
            .execute(&state.pool)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_playlist_tracks(state: tauri::State<'_, DbState>, playlist_id: i64) -> Result<Vec<Track>, String> {
    let rows = sqlx::query(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.year, t.duration, t.rating,
                t.track_number, t.disc_number, t.genre, t.album_artist, t.composer,
                t.comment, t.bpm, t.label, t.encoder, t.copyright, t.bitrate, t.sample_rate, t.channels, t.has_artwork
         FROM tracks t
         JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ?
         ORDER BY pt.position ASC"
    )
    .bind(playlist_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let tracks = rows
        .into_iter()
        .map(|row| Track {
            id:           row.try_get("id").ok(),
            path:         row.try_get("path").unwrap_or_default(),
            title:        row.try_get("title").ok(),
            artist:       row.try_get("artist").ok(),
            album:        row.try_get("album").ok(),
            year:         row.try_get("year").ok(),
            duration:     row.try_get("duration").ok(),
            rating:       row.try_get("rating").ok(),
            track_number: row.try_get("track_number").ok(),
            disc_number:  row.try_get("disc_number").ok(),
            genre:        row.try_get("genre").ok(),
            album_artist: row.try_get("album_artist").ok(),
            composer:     row.try_get("composer").ok(),
            comment:      row.try_get("comment").ok(),
            bpm:          row.try_get("bpm").ok(),
            label:        row.try_get("label").ok(),
            encoder:      row.try_get("encoder").ok(),
            copyright:    row.try_get("copyright").ok(),
            bitrate:      row.try_get("bitrate").ok(),
            sample_rate:  row.try_get("sample_rate").ok(),
            channels:     row.try_get("channels").ok(),
            has_artwork:  row.try_get::<i32, _>("has_artwork").unwrap_or(0) != 0,
        })
        .collect();

    Ok(tracks)
}

#[tauri::command]
pub async fn remove_tracks_from_playlist(state: tauri::State<'_, DbState>, playlist_id: i64, track_ids: Vec<i64>) -> Result<(), String> {
    for tid in track_ids {
        let _ = sqlx::query("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?")
            .bind(playlist_id)
            .bind(tid)
            .execute(&state.pool)
            .await;
    }
    Ok(())
}

