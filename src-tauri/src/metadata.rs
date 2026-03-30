use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::config::WriteOptions;
use lofty::tag::{ItemKey, ItemValue, TagItem, TagType};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub duration: u64,
    pub rating: Option<u8>,
    // Extended ID3 / tag fields
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub genre: Option<String>,
    pub album_artist: Option<String>,
    pub composer: Option<String>,
    pub comment: Option<String>,
    pub bpm: Option<String>,
    pub label: Option<String>,
    pub encoder: Option<String>,
    pub copyright: Option<String>,
    // Audio properties
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub has_artwork: bool,
}

#[tauri::command]
pub fn get_metadata(path: String) -> Result<AudioMetadata, String> {
    let tagged_file = Probe::open(&path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let props = tagged_file.properties();
    let duration    = props.duration().as_secs();
    let bitrate     = props.audio_bitrate();
    let sample_rate = props.sample_rate();
    let channels    = props.channels();

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let Some(tag) = tag else {
        return Ok(AudioMetadata { duration, bitrate, sample_rate, channels, ..Default::default() });
    };

    let get = |key: &ItemKey| tag.get_string(key).map(|s| s.to_string());

    let rating = tag
        .items()
        .find(|i| {
            matches!(i.key(), ItemKey::Unknown(ref k) if k == "POPM" || k == "rtng" || k == "RATING")
        })
        .and_then(|i| {
            match i.value() {
                ItemValue::Text(t) => t.parse::<u8>().ok(),
                ItemValue::Binary(b) => if b.len() >= 2 { Some(b[1]) } else { b.get(0).copied() },
                _ => None,
            }
        })
        .map(|r| {
            if r > 5 {
                (r as f32 / 255.0 * 5.0).round() as u8
            } else {
                r
            }
        });

    Ok(AudioMetadata {
        title:        tag.title().map(|s| s.to_string()),
        artist:       tag.artist().map(|s| s.to_string()),
        album:        tag.album().map(|s| s.to_string()),
        year:         tag.year(),
        duration,
        rating,
        track_number: get(&ItemKey::TrackNumber),
        disc_number:  get(&ItemKey::DiscNumber),
        genre:        tag.genre().map(|s| s.to_string()),
        album_artist: get(&ItemKey::AlbumArtist),
        composer:     get(&ItemKey::Composer),
        comment:      tag.comment().map(|s| s.to_string()),
        bpm:          get(&ItemKey::Bpm),
        label:        get(&ItemKey::Label),
        encoder:      get(&ItemKey::EncodedBy),
        copyright:    get(&ItemKey::CopyrightMessage),
        bitrate,
        sample_rate,
        channels,
        has_artwork: !tag.pictures().is_empty(),
    })
}

#[tauri::command]
pub fn get_artwork(path: String) -> Result<Option<String>, String> {
    let tagged_file = Probe::open(&path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let Some(tag) = tag else { return Ok(None); };

    if let Some(pic) = tag.pictures().first() {
        let base64 = data_encoding::BASE64.encode(pic.data());
        let mime = pic.mime_type().unwrap_or(&lofty::picture::MimeType::Jpeg).to_string();
        return Ok(Some(format!("data:{};base64,{}", mime, base64)));
    }

    Ok(None)
}

/// Update only the rating tag in-place (used by global shortcut handler).
pub fn set_rating(path: &str, rating: u8) -> Result<(), String> {
    let mut tagged_file = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "No writable tag".to_string())?;

    match tag.tag_type() {
        TagType::Id3v2 => {
            let id3_val = match rating { 1 => 1, 2 => 64, 3 => 128, 4 => 196, 5 => 255, _ => 0 };
            let mut data = vec![0u8]; // email byte (empty)
            data.push(id3_val);
            tag.insert(TagItem::new(ItemKey::Unknown("POPM".to_string()), ItemValue::Binary(data)));
        }
        TagType::Mp4Ilst => {
            tag.insert(TagItem::new(
                ItemKey::Unknown("rtng".to_string()),
                ItemValue::Binary(vec![rating]),
            ));
        }
        _ => {
            tag.insert(TagItem::new(
                ItemKey::Unknown("RATING".to_string()),
                ItemValue::Text(rating.to_string()),
            ));
        }
    }

    tag.save_to_path(path, WriteOptions::default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_metadata(path: String, metadata: AudioMetadata) -> Result<(), String> {
    let mut tagged_file = Probe::open(&path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "No tag found to update".to_string())?;

    macro_rules! set_str {
        ($method:ident, $val:expr) => {
            if let Some(v) = $val { tag.$method(v.into()); }
        };
    }
    macro_rules! set_item {
        ($key:expr, $val:expr) => {
            if let Some(v) = $val {
                tag.insert(TagItem::new($key, ItemValue::Text(v)));
            }
        };
    }

    set_str!(set_title,  metadata.title);
    set_str!(set_artist, metadata.artist);
    set_str!(set_album,  metadata.album);
    if let Some(y) = metadata.year { tag.set_year(y); }

    set_item!(ItemKey::TrackNumber,      metadata.track_number);
    set_item!(ItemKey::DiscNumber,       metadata.disc_number);
    set_item!(ItemKey::Genre,            metadata.genre);
    set_item!(ItemKey::AlbumArtist,      metadata.album_artist);
    set_item!(ItemKey::Composer,         metadata.composer);
    set_item!(ItemKey::Comment,          metadata.comment);
    set_item!(ItemKey::Bpm,              metadata.bpm);
    set_item!(ItemKey::Label,            metadata.label);
    set_item!(ItemKey::EncodedBy,        metadata.encoder);
    set_item!(ItemKey::CopyrightMessage, metadata.copyright);

    if let Some(rating) = metadata.rating {
        match tag.tag_type() {
            TagType::Id3v2 => {
                let id3_val = match rating { 1 => 1, 2 => 64, 3 => 128, 4 => 196, 5 => 255, _ => 0 };
                let mut popm_data = vec![0u8]; // email (empty)
                popm_data.push(id3_val);
                tag.insert(TagItem::new(
                    ItemKey::Unknown("POPM".to_string()),
                    ItemValue::Binary(popm_data),
                ));
            },
            TagType::Mp4Ilst => {
                tag.insert(TagItem::new(
                    ItemKey::Unknown("rtng".to_string()),
                    ItemValue::Binary(vec![rating]),
                ));
            },
            _ => {
                tag.insert(TagItem::new(
                    ItemKey::Unknown("RATING".to_string()),
                    ItemValue::Text(rating.to_string()),
                ));
            }
        }
    }

    tag.save_to_path(&path, WriteOptions::default()).map_err(|e| e.to_string())?;
    Ok(())
}
