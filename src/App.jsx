import { useState, useEffect, useRef, useCallback, useMemo } from "react";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";

const ALL_COLS = [
  { key: "title",        label: "Title" },
  { key: "artist",       label: "Artist" },
  { key: "album_artist", label: "Album Artist" },
  { key: "album",        label: "Album" },
  { key: "year",         label: "Year" },
  { key: "track_number", label: "Track #" },
  { key: "disc_number",  label: "Disc #" },
  { key: "genre",        label: "Genre" },
  { key: "composer",     label: "Composer" },
  { key: "comment",      label: "Comment" },
  { key: "bpm",          label: "BPM" },
  { key: "label",        label: "Label" },
  { key: "encoder",      label: "Encoder" },
  { key: "copyright",    label: "Copyright" },
  { key: "rating",       label: "Rating" },
  { key: "duration",     label: "Duration" },
  { key: "bitrate",      label: "Bitrate" },
  { key: "sample_rate",  label: "Sample Rate" },
  { key: "channels",     label: "Channels" },
  { key: "cover",        label: "Cover" },
];

function FileTreeItem({ name, path, is_dir, onPlay, onContextMenu }) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  async function toggle(e) {
    e.stopPropagation();
    if (!is_dir) {
      onPlay(path);
      return;
    }
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState && children.length === 0) {
      setLoading(true);
      try {
        const items = await invoke("list_directory", { path });
        setChildren(items);
      } catch (e) {
        console.error("Tree error:", e);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="tree-item" style={{ 
      userSelect: "none", 
      borderLeft: is_dir && isOpen ? "1px solid rgba(255,255,255,0.03)" : "none",
      transition: "all 0.2s ease"
    }}>
      <div 
        className={`tree-row ${!is_dir ? "file" : "folder"}`}
        onClick={toggle}
        onDoubleClick={(e) => {
          if (!is_dir) onPlay(path);
        }}
        onContextMenu={(e) => onContextMenu && onContextMenu(e, { name, path, is_dir })}
        title={path}
        style={{ 
          display: "flex", 
          alignItems: "center", 
          cursor: "pointer", 
          padding: "4px 8px 4px 6px",
          gap: "8px",
          fontSize: "12px",
          color: is_dir ? "var(--text-primary)" : "var(--text-secondary)",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          transition: "background 0.15s ease, color 0.15s ease",
          opacity: 0.85
        }}
      >
        <span style={{ 
          fontSize: "8px", 
          width: "12px", 
          textAlign: "center", 
          opacity: is_dir ? 0.6 : 0, 
          transition: "transform 0.2s ease",
          transform: isOpen ? "rotate(90deg)" : "rotate(0deg)"
        }}>
          ▶
        </span>
        <span style={{ fontSize: "14px", display: "flex", alignItems: "center" }}>
          {is_dir ? (isOpen ? "📂" : "📁") : "🎵"}
        </span>
        <span style={{ 
          overflow: "hidden", 
          textOverflow: "ellipsis", 
          fontWeight: is_dir ? "500" : "400",
          letterSpacing: "0.2px"
        }}>
          {name}
        </span>
        {loading && <span className="loading-dots" style={{ fontSize: "10px", opacity: 0.4 }}>...</span>}
      </div>
      {isOpen && is_dir && (
        <div className="tree-children" style={{ marginLeft: "14px" }}>
          {children.length > 0 ? (
            children.map((child, i) => (
              <FileTreeItem key={i} {...child} onPlay={onPlay} onContextMenu={onContextMenu} />
            ))
          ) : !loading ? (
            <div style={{ padding: "4px 28px", fontSize: "10.5px", opacity: 0.3, fontStyle: "italic" }}>Empty</div>
          ) : null}
        </div>
      )}
    </div>
  );
}



const Artwork = ({ track }) => {
  const [src, setSrc] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!track.has_artwork) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "50px" } // Load slightly before it comes into view
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [track.path, track.has_artwork]);

  useEffect(() => {
    if (!isVisible || !track.has_artwork || src) return;
    
    const load = async () => {
      try {
        const data = await invoke("get_artwork", { path: track.path });
        if (data) setSrc(data);
      } catch (e) {
        console.error("Failed to load artwork:", e);
      }
    };
    
    load();
  }, [isVisible, track.path, track.has_artwork, src]);

  if (!track.has_artwork) {
    return <div className="artwork-placeholder">♫</div>;
  }

  return (
    <div ref={containerRef} className={`artwork-container ${loaded ? "loaded" : ""}`}>
      {src ? (
        <img 
          src={src} 
          alt="Cover" 
          onLoad={() => setLoaded(true)} 
          style={{ opacity: loaded ? 1 : 0 }}
        />
      ) : (
        <div className="artwork-placeholder">{isVisible ? "..." : ""}</div>
      )}
    </div>
  );
};

const VolumeIcon = ({ volume, isMuted }) => {
  const color = "var(--accent-color)";
  if (isMuted || volume === 0) return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/>
    </svg>
  );
  if (volume < 0.5) return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  );
};

const MiniPlayer = () => {
  const [track, setTrack] = useState(null);
  const [artwork, setArtwork] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    // Initial sync
    invoke("get_current_playing_path").then(async (path) => {
      if (path) {
        const meta = await invoke("get_metadata", { path });
        setTrack({ ...meta, path });
        const art = await invoke("get_artwork", { path });
        setArtwork(art);
        const pos = await invoke("get_playback_position");
        setCurrentTime(pos);
      }
    });

    const unlistenTrack = listen("track-changed", async (event) => {
      const path = event.payload;
      const meta = await invoke("get_metadata", { path });
      setTrack({ ...meta, path });
      const art = await invoke("get_artwork", { path });
      setArtwork(art);
      setCurrentTime(0);
    });

    const unlistenRated = listen("track-rated", (event) => {
      const { path, rating } = event.payload;
      setTrack(prev => prev?.path === path ? { ...prev, rating } : prev);
    });

    const interval = setInterval(async () => {
      try {
        const pos = await invoke("get_playback_position");
        setCurrentTime(pos);
      } catch (e) {
        console.error("Mini sync error:", e);
      }
    }, 1000);

    return () => {
      unlistenTrack.then(f => f());
      unlistenRated.then(f => f());
      clearInterval(interval);
    };
  }, []);

  if (!track) {
    return (
      <div className="mini-player-container">
        <div className="mini-artist">No track playing</div>
      </div>
    );
  }

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      className="mini-player-container" 
      data-tauri-drag-region 
      style={{ flexDirection: "column", padding: "10px", gap: "8px" }}
    >
      <button 
        onClick={() => getCurrentWebviewWindow().close()}
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          background: "rgba(255,255,255,0.05)",
          border: "none",
          color: "rgba(255,255,255,0.4)",
          cursor: "pointer",
          fontSize: "10px",
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10
        }}
      >
        ✕
      </button>

      <div style={{ display: "flex", flexDirection: "row", gap: "12px", width: "100%", alignItems: "center" }} data-tauri-drag-region>
        {artwork ? (
          <img src={artwork} className="mini-artwork" alt="Cover" data-tauri-drag-region style={{ width: "50px", height: "50px", minWidth: "50px" }} />
        ) : (
          <div className="mini-artwork" style={{ background: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", width: "50px", height: "50px", minWidth: "50px" }} data-tauri-drag-region>🎵</div>
        )}
        <div className="mini-info" data-tauri-drag-region>
          <div className="mini-title" title={track.title} data-tauri-drag-region style={{ fontSize: "14px" }}>{track.title || "Unknown Title"}</div>
          <div className="mini-artist" title={track.artist} data-tauri-drag-region style={{ fontSize: "11px" }}>{track.artist || "Unknown Artist"}</div>
          <div className="mini-rating" data-tauri-drag-region style={{ fontSize: "12px", marginTop: "2px" }}>
            {track.rating > 0 ? "★".repeat(track.rating) : "☆☆☆☆☆"}
          </div>
        </div>
      </div>

      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px" }} data-tauri-drag-region>
        <span style={{ fontSize: "10px", color: "var(--text-secondary)", minWidth: "25px", fontFamily: "monospace" }}>{formatTime(currentTime)}</span>
        <div className="progress-container" style={{ flex: 1, height: "3px", margin: 0 }} data-tauri-drag-region>
          <div 
            className="progress-bar" 
            style={{ width: `${(currentTime / (track.duration || 1)) * 100}%` }} 
          />
        </div>
        <span style={{ fontSize: "10px", color: "var(--text-secondary)", minWidth: "25px", textAlign: "right", fontFamily: "monospace" }}>{formatTime(track.duration || 0)}</span>
      </div>
    </div>
  );
};

function App() {
  const [windowLabel] = useState(() => getCurrentWebviewWindow().label);

  if (windowLabel === "mini") {
    return <MiniPlayer />;
  }

  const [tracks, setTracks] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("sandi-volume");
    return saved !== null ? parseFloat(saved) : 0.5;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(0.5);
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem("sandi-active-tab") || "library";
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [seekAmount, setSeekAmount] = useState(() => {
    const saved = localStorage.getItem("sandi-seek-amount");
    return saved !== null ? parseInt(saved, 10) : 10;
  });
  const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'asc' });
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = localStorage.getItem("sandi-col-widths");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      title: 250, artist: 150, album: 150, rating: 100, duration: 80,
      year: 70, track_number: 60, disc_number: 60, genre: 120,
      album_artist: 150, composer: 150, comment: 200, bpm: 60,
      label: 120, encoder: 140, copyright: 150, bitrate: 80,
      sample_rate: 90, channels: 70, cover: 60,
    };
  });
  const [showSidebar, setShowSidebar] = useState(() => {
    const saved = localStorage.getItem("sandi-show-sidebar");
    return saved !== null ? saved === "true" : true;
  });
  const [midiDevices, setMidiDevices] = useState([]);
  const [selectedMidiDevice, setSelectedMidiDevice] = useState(() => {
    try {
      const saved = localStorage.getItem("sandi-midi-device");
      if (saved !== null) return parseInt(saved, 10);
    } catch (e) {}
    return null;
  });
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiMappings, setMidiMappings] = useState(() => {
    try {
      const saved = localStorage.getItem("sandi-midi-mappings");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });
  const [midiLearnTarget, setMidiLearnTarget] = useState(null);
  const [midiLog, setMidiLog] = useState([]);
  const [accessibilityOk, setAccessibilityOk] = useState(true); // assume ok until checked
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem("sandi-visible-cols");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      cover: true, artist: true, album: false, year: true, rating: true, duration: true,
      track_number: false, disc_number: false, genre: false, album_artist: false,
      composer: false, comment: false, bpm: false, label: false, encoder: false,
      copyright: false, bitrate: false, sample_rate: false, channels: false,
    };
  });
  const [showColMenu, setShowColMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [homePath, setHomePath] = useState(() => localStorage.getItem("sandi-explorer-root") || "");


  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [playlistSubmenu, setPlaylistSubmenu] = useState(null);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isResizing, setIsResizing] = useState(null);

  const colMenuRef = useRef(null);

  const currentQueueRef = useRef([]);



  const contextMenuRef = useRef(null);
  const [colOrder, setColOrder] = useState(() => {
    const requestedKeys = ["cover", "rating", "title", "artist", "year", "duration"];
    const otherKeys = ALL_COLS.map(c => c.key).filter(k => !requestedKeys.includes(k));
    const defaultOrder = [...requestedKeys, ...otherKeys];

    try {
      const saved = localStorage.getItem("sandi-col-order");
      if (saved) {
        let parsed = JSON.parse(saved);
        if (!parsed.includes("title")) parsed = ["title", ...parsed];
        const newKeys = ALL_COLS.map(c => c.key).filter(k => !parsed.includes(k));
        return [...parsed, ...newKeys];
      }
    } catch (e) {}
    return defaultOrder;
  });
  const startResizing = (col, e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(col);
    const startX = e.clientX;
    const startWidth = colWidths[col] || 100;
    
    const onMouseMove = (moveE) => {
      const delta = moveE.clientX - startX;
      const newWidth = Math.max(1, startWidth + delta);
      setColWidths(prev => ({ ...prev, [col]: newWidth }));
    };
    const onMouseUp = () => {
      setIsResizing(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      saveSetting("col-widths", colWidthsRef.current);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };
  const [keyBindings, setKeyBindings] = useState(() => {
    const defaults = {
      playPause: [{ key: "Space", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      seekForward: [{ key: "+", global: false, modifiers: [] }, { key: "=", global: false, modifiers: [] }, { key: "ArrowRight", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      seekBackward: [{ key: "-", global: false, modifiers: [] }, { key: "_", global: false, modifiers: [] }, { key: "ArrowLeft", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      nextTrack: [{ key: "]", global: false, modifiers: [] }, { key: "N", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      previousTrack: [{ key: "[", global: false, modifiers: [] }, { key: "P", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      rate1: [{ key: "1", global: false, modifiers: [] }, { key: "1", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      rate2: [{ key: "2", global: false, modifiers: [] }, { key: "2", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      rate3: [{ key: "3", global: false, modifiers: [] }, { key: "3", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      rate4: [{ key: "4", global: false, modifiers: [] }, { key: "4", global: true, modifiers: ["CommandOrControl", "Shift"] }],
      rate5: [{ key: "5", global: false, modifiers: [] }, { key: "5", global: true, modifiers: ["CommandOrControl", "Shift"] }],
    };
    try {
      const saved = localStorage.getItem("sandi-key-bindings");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Deep merge: start from defaults, overlay saved values.
        // For each binding, backfill missing 'global' from the matching default
        // so that old localStorage data (without 'global' field) still gets
        // the correct global flag.
        const merged = { ...defaults };
        for (const action in parsed) {
          if (defaults[action]) {
            merged[action] = parsed[action].map((savedBinding) => {
              if (!('global' in savedBinding)) {
                const matchDefault = defaults[action].find(
                  d => d.key === savedBinding.key &&
                    JSON.stringify((d.modifiers || []).slice().sort()) ===
                    JSON.stringify((savedBinding.modifiers || []).slice().sort())
                );
                return { ...savedBinding, global: matchDefault?.global ?? false };
              }
              return savedBinding;
            });
            // Append any default bindings that aren't in saved (new defaults added in updates)
            for (const def of defaults[action]) {
              const exists = merged[action].some(
                b => b.key === def.key &&
                  JSON.stringify((b.modifiers || []).slice().sort()) ===
                  JSON.stringify((def.modifiers || []).slice().sort())
              );
              if (!exists) merged[action] = [...merged[action], def];
            }
          } else {
            merged[action] = parsed[action];
          }
        }
        return merged;
      }
    } catch (e) {
      console.error("Failed to parse key bindings:", e);
    }
    return defaults;
  });
  const [isListening, setIsListening] = useState(null); // action key is for
  const [editingTrack, setEditingTrack] = useState(null);
  const [isPinned, setIsPinned] = useState(() => {
    try {
      const saved = localStorage.getItem("sandi-is-pinned");
      return saved === "true";
    } catch (e) {
      return false;
    }
  });
  const seekTimeoutRef = useRef(null);
  const syncShortcutsRunning = useRef(false);
  
  const isPlayingRef = useRef(isPlaying);
  const currentTrackRef = useRef(currentTrack);
  const seekAmountRef = useRef(seekAmount);
  const currentTimeRef = useRef(currentTime);
  const tracksRef = useRef(tracks);
  const selectedIdsRef = useRef(selectedIds);
  const sortConfigRef = useRef(sortConfig);
  const colWidthsRef = useRef(colWidths);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { seekAmountRef.current = seekAmount; }, [seekAmount]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { sortConfigRef.current = sortConfig; }, [sortConfig]);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // --- SETTINGS PERSISTENCE ---

  const saveSetting = useCallback(async (key, value) => {
    try {
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      await invoke("save_setting", { key, value: valStr });
      // Keep localStorage as a synchronous fallback
      localStorage.setItem(`sandi-${key}`, valStr);
    } catch (e) {
      console.error(`[settings] save error for ${key}:`, e);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await invoke("get_settings");
      if (!settings || Object.keys(settings).length === 0) return;
      
      console.log("[settings] loaded from backend:", settings);
      
      if (settings["volume"]) setVolume(parseFloat(settings["volume"]));
      if (settings["active-tab"]) setActiveTab(settings["active-tab"]);
      if (settings["seek-amount"]) setSeekAmount(parseInt(settings["seek-amount"], 10));
      if (settings["show-sidebar"]) setShowSidebar(settings["show-sidebar"] === "true");
      if (settings["is-pinned"]) setIsPinned(settings["is-pinned"] === "true");
      if (settings["col-widths"]) setColWidths(JSON.parse(settings["col-widths"]));
      if (settings["col-order"]) setColOrder(JSON.parse(settings["col-order"]));
      if (settings["visible-cols"]) setVisibleCols(JSON.parse(settings["visible-cols"]));
      if (settings["key-bindings"]) setKeyBindings(JSON.parse(settings["key-bindings"]));
      if (settings["midi-device"]) setSelectedMidiDevice(parseInt(settings["midi-device"], 10));
      if (settings["midi-mappings"]) setMidiMappings(JSON.parse(settings["midi-mappings"]));
      if (settings["explorer-root"]) setHomePath(settings["explorer-root"]);
      if (settings["sort-config"]) setSortConfig(JSON.parse(settings["sort-config"]));
    } catch (e) {
      console.error("[settings] load error:", e);
    }
  }, []);

  // --- CORE FUNCTIONS ---

  async function loadTracks() {
    try {
      const data = await invoke("get_tracks");
      setTracks(data);
    } catch (e) {
      console.error("Load tracks error:", e);
    }
  }

  const handleContextMenu = (e, track) => {
    e.preventDefault();
    console.log("Context menu triggered for:", track.title);
    
    // If the track is part of the selection, we offer bulk delete
    // If it's not, we might want to select it first? 
    // Usually, right-clicking a non-selected item selects it exclusively.
    if (!selectedIds.includes(track.id)) {
      setSelectedIds([track.id]);
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track
    });
  };

  const deleteSelectedTracksFromDisk = async () => {
    const toDelete = tracks.filter(t => selectedIds.includes(t.id));
    if (toDelete.length === 0) return;

    const msg = toDelete.length === 1 
      ? `MOVE TO TRASH: Are you sure you want to move "${toDelete[0].title}" to the system trash?`
      : `MOVE TO TRASH: Are you sure you want to move ${toDelete.length} tracks to the system trash?`;
    
    const confirmed = await window.confirm(msg);
    if (!confirmed) return;

    if (toDelete.length > 5) {
      const secondConfirmed = await window.confirm(`CAUTION: You are about to move ${toDelete.length} files to the trash. Are you absolutely sure?`);
      if (!secondConfirmed) return;
    } else if (toDelete.length > 1) {
       const secondConfirmed = await window.confirm(`Confirm: Move these ${toDelete.length} tracks to the system trash?`);
       if (!secondConfirmed) return;
    }

    try {
      const payload = toDelete.map(t => [t.id, t.path]);
      await invoke("delete_tracks_from_disk", { tracks: payload });
      
      const deletedIds = toDelete.map(t => t.id);
      setTracks(prev => prev.filter(t => !deletedIds.includes(t.id)));
      setSelectedIds([]);
      
      if (currentTrack && deletedIds.includes(currentTrack.id)) {
        await invoke("stop_audio");
        setCurrentTrack(null);
      }
      setContextMenu(null);
    } catch (err) {
      console.error("Trash error:", err);
      alert("Error moving to trash: " + err);
    }
  };

  async function playTrack(track, queue = null) {
    try {
      if (queue) {
        currentQueueRef.current = queue;
      } else if (currentQueueRef.current.length === 0) {
        // Default to library if none set
        currentQueueRef.current = tracksRef.current;
      }
      
      await invoke("play_audio", { path: track.path });

      setCurrentTrack(track);
      setCurrentTime(0);
      setIsPlaying(true);
    } catch (e) {
      console.error("Playback error:", e);
    }
  }

  async function playTrackFromPath(path) {
    try {
      await invoke("play_audio", { path });
      // Fetch metadata for the explorer track
      const meta = await invoke("get_metadata", { path });
      setCurrentTrack({ ...meta, path, id: Date.now() }); 
      setIsPlaying(true);
      setCurrentTime(0);
    } catch (e) {
      console.error("Explorer playback error:", e);
    }
  }

  async function togglePlay() {
    try {
      if (isPlayingRef.current) {
        await invoke("pause_audio");
      } else {
        await invoke("resume_audio");
      }
      setIsPlaying(!isPlayingRef.current);
    } catch (e) {
      console.error("Toggle play error:", e);
    }
  }

  async function rateTrack(track, rating) {
    if (!track) return;
    try {
      const updatedTrack = { ...track, rating };
      await invoke("update_metadata", { path: track.path, metadata: updatedTrack });
      await invoke("add_track", { track: updatedTrack });
      if (currentTrackRef.current?.path === track.path) {
        setCurrentTrack(updatedTrack);
      }
      const normPath = track.path.normalize();
      setTracks(prev => prev.map(t => t.path.normalize() === normPath ? updatedTrack : t));
      setPlaylistTracks(prev => prev.map(t => t.path.normalize() === normPath ? updatedTrack : t));
      loadTracks();
    } catch (e) {
      console.error("Rating error:", e);
    }
  }

  async function seek(offset) {
    const track = currentTrackRef.current;
    if (!track) return;
    const newTime = Math.max(0, Math.min(track.duration || 9999, currentTimeRef.current + offset));
    currentTimeRef.current = newTime;
    setCurrentTime(newTime);
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("play_audio_at", { path: track.path, offsetSecs: Math.floor(currentTimeRef.current) });
        // Immediate sync after seek to confirm position
        const pos = await invoke("get_playback_position");
        setCurrentTime(pos);
        currentTimeRef.current = pos;
      } catch (e) {
        console.error("Seek error:", e);
      } finally {
        seekTimeoutRef.current = null;
      }
    }, 200);
  }

  async function deleteSelectedTracks() {
    if (selectedIds.length === 0) return;
    try {
      for (const id of selectedIds) {
        await invoke("remove_track", { id });
      }
      setSelectedIds([]);
      loadTracks();
    } catch (e) {
      console.error("Delete error:", e);
    }
  }

  async function updateMetadata() {
    if (!editingTrack) return;
    try {
      await invoke("update_metadata", { path: editingTrack.path, metadata: editingTrack });
      await invoke("add_track", { track: editingTrack });
      setEditingTrack(null);
      loadTracks();
    } catch (e) {
      console.error("Update metadata error:", e);
    }
  }

  const playNext = useCallback(async () => {
    const current = currentTrackRef.current;
    const all = currentQueueRef.current.length > 0 ? currentQueueRef.current : tracksRef.current;
    
    console.log("playNext triggered. Current:", current?.path, "Queue size:", all.length);
    if (all.length === 0) return;
    const sorted = getSortedTracks(all, sortConfigRef.current);


    
    let nextTrack;
    if (!current) {
      nextTrack = sorted[0];
    } else {
      const index = sorted.findIndex(t => t.id === current.id);
      if (index !== -1 && index < sorted.length - 1) {
        nextTrack = sorted[index + 1];
      } else {
        nextTrack = sorted[0]; // Wrap around to first
      }
    }
    
    if (nextTrack) {
      console.log("Switching to next:", nextTrack.path);
      playTrack(nextTrack);
    }
  }, []); // uses refs internally — no stale-closure risk

  const playPrev = useCallback(async () => {
    const current = currentTrackRef.current;
    const all = currentQueueRef.current.length > 0 ? currentQueueRef.current : tracksRef.current;
    
    console.log("playPrev triggered. Current:", current?.path, "Queue size:", all.length);
    if (all.length === 0) return;
    const sorted = getSortedTracks(all, sortConfigRef.current);


    
    let prevTrack;
    if (!current) {
      prevTrack = sorted[sorted.length - 1];
    } else {
      const index = sorted.findIndex(t => t.id === current.id);
      if (index > 0) {
        prevTrack = sorted[index - 1];
      } else {
        prevTrack = sorted[sorted.length - 1]; // Wrap around to last
      }
    }
    
    if (prevTrack) {
      console.log("Switching to previous:", prevTrack.path);
      playTrack(prevTrack);
    }
  }, []); // uses refs internally — no stale-closure risk

  const togglePlayRef = useRef(togglePlay);
  const seekRef = useRef(seek);
  const playNextRef = useRef(playNext);
  const playPrevRef = useRef(playPrev);
  const rateTrackRef = useRef(rateTrack);

  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);
  useEffect(() => { seekRef.current = seek; }, [seek]);
  useEffect(() => { playNextRef.current = playNext; }, [playNext]);
  useEffect(() => { playPrevRef.current = playPrev; }, [playPrev]);
  useEffect(() => { rateTrackRef.current = rateTrack; }, [rateTrack]);

  const triggerAction = useCallback((action) => {
    if (action === "playPause") togglePlayRef.current();
    if (action === "seekForward") seekRef.current(seekAmountRef.current);
    if (action === "seekBackward") seekRef.current(-seekAmountRef.current);
    if (action === "nextTrack") playNextRef.current();
    if (action === "previousTrack") playPrevRef.current();
    if (action.startsWith("rate") && currentTrackRef.current) {
      rateTrackRef.current(currentTrackRef.current, parseInt(action.replace("rate", "")));
    }
  }, []); // Truly stable triggerAction

  // --- EFFECTS ---

  useEffect(() => {
    loadTracks();
    loadSettings();
    // Sync current (possibly restored) volume to backend
    invoke("set_volume", { volume }).catch(e => console.error("Volume init error:", e));
    const unlisten = listen("midi-event", (event) => {
      const [status, data1, data2] = event.payload;
      setMidiLog(prev => [`[${status}] d1=${data1} d2=${data2}`, ...prev].slice(0, 50));
      if (status === 144 && data2 > 0 && data1 >= 60 && data1 <= 64) {
        const rating = data1 - 59;
        window.dispatchEvent(new CustomEvent("midi-rate", { detail: rating }));
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(async () => {
        try {
          const pos = await invoke("get_playback_position");
          // Only update if not currently seeking to avoid jumping
          if (!seekTimeoutRef.current) {
            setCurrentTime(pos);
            currentTimeRef.current = pos;
          }
        } catch (e) {
          console.error("Sync error:", e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    const unlistenAction = listen("execute-action", (event) => {
      triggerAction(event.payload);
    });
    return () => { unlistenAction.then(f => f()); };
  }, [triggerAction]);

  // Global shortcut events — all actions handled in Rust, frontend just syncs state
  useEffect(() => {
    const unlistenSeek = listen("seek-changed", (event) => {
      const newTime = event.payload;
      currentTimeRef.current = newTime;
      setCurrentTime(newTime);
    });
    const unlistenRated = listen("track-rated", (event) => {
      const { path, rating } = event.payload;
      const normPath = path.normalize();
      
      setTracks(prev => prev.map(t => t.path.normalize() === normPath ? { ...t, rating } : t));
      setPlaylistTracks(prev => prev.map(t => t.path.normalize() === normPath ? { ...t, rating } : t));
      setCurrentTrack(prev => prev?.path.normalize() === normPath ? { ...prev, rating } : prev);
    });
    return () => {
      unlistenSeek.then(f => f());
      unlistenRated.then(f => f());
    };
  }, []);

  useEffect(() => {
    const unlistenStatus = listen("playback-status-changed", (event) => {
      setIsPlaying(event.payload);
    });
    const unlistenTrack = listen("track-changed", (event) => {
      const path = event.payload;
      const track = tracksRef.current.find(t => t.path === path);
      if (track) {
        setCurrentTrack(track);
        setCurrentTime(0);
        setIsPlaying(true);
      }
    });
    // Emitted by Rust when a track ends and there is no next track in the queue
    const unlistenFinished = listen("track-finished", () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });
    return () => {
      unlistenStatus.then(f => f());
      unlistenTrack.then(f => f());
      unlistenFinished.then(f => f());
    };
  }, []);

  const syncPlaylistToBackend = useCallback(async () => {
    try {
      const sorted = activeTab === "playlist" ? playlistSortedTracks : sortedTracks;
      const paths = sorted.map(t => t.path);
      console.log("Syncing playlist to backend. Paths:", paths.length, "Current:", currentTrack?.path);
      await invoke("sandi_set_playlist", { paths, currentPath: currentTrack?.path || null });
    } catch (e) {
      console.error("Playlist sync error:", e);
    }
  }, [tracks, sortConfig, currentTrack]);

  useEffect(() => {
    syncPlaylistToBackend();
  }, [syncPlaylistToBackend]);

  useEffect(() => {
    saveSetting("key-bindings", keyBindings);
    syncGlobalShortcuts();
  }, [keyBindings]);

  // Immediate audio update
  useEffect(() => {
    // Apply logarithmic curve (v = x^2) for more natural feel
    const audioVolume = isMuted ? 0 : volume * volume;
    invoke("set_volume", { volume: audioVolume });
  }, [volume, isMuted]);

  // Debounced persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      saveSetting("volume", volume.toString());
      localStorage.setItem("sandi-volume", volume.toString());
    }, 300);
    return () => clearTimeout(timer);
  }, [volume]);

  useEffect(() => {
    saveSetting("show-sidebar", showSidebar.toString());
  }, [showSidebar]);

  useEffect(() => {
    saveSetting("visible-cols", visibleCols);
  }, [visibleCols]);

  useEffect(() => {
    saveSetting("seek-amount", seekAmount.toString());
  }, [seekAmount]);

  useEffect(() => {
    saveSetting("active-tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedPlaylist) {
      saveSetting("selected-playlist-id", selectedPlaylist.id.toString());
    }
  }, [selectedPlaylist]);

  useEffect(() => {
    saveSetting("col-order", colOrder);
  }, [colOrder]);

  useEffect(() => {
    if (selectedMidiDevice !== null) {
      saveSetting("midi-device", selectedMidiDevice.toString());
    } else {
      // We don't have a clearSetting backend command yet, so just leave it
      localStorage.removeItem("sandi-midi-device");
    }
  }, [selectedMidiDevice]);


  useEffect(() => {
    if (!showColMenu && !contextMenu) return;
    const handle = (e) => {
      // Close column menu if click is outside
      if (showColMenu && colMenuRef.current && !colMenuRef.current.contains(e.target)) {
        setShowColMenu(false);
      }
      
      // Close context menu if click is outside
      if (contextMenu && contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      } else if (contextMenu && !contextMenuRef.current) {
        // Fallback if ref is not yet set
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showColMenu, contextMenu]);

  // Redundant explorer sync removed (moved to recursive FileTreeItem)


  useEffect(() => {
    if (!homePath) {
      invoke("get_home_dir").then(setHomePath).catch(err => console.error("Home dir error:", err));
    }
    loadPlaylists();
  }, []);


  async function loadPlaylists() {
    try {
      const p = await invoke("get_playlists");
      setPlaylists(p);
      const savedId = localStorage.getItem("sandi-selected-playlist-id");
      if (savedId) {
        const idNum = parseInt(savedId, 10);
        const match = p.find(pl => pl.id === idNum);
        if (match) setSelectedPlaylist(match);
      }
    } catch (e) {
      console.error("Folder playlist error:", e);
    }
  };

  const createPlaylistFromFolder = async (folderName, folderPath) => {
    try {
      console.log("[frontend] createPlaylistFromFolder", { folderName, folderPath });
      const playlistId = await invoke("create_playlist", { name: folderName });
      await invoke("add_folder_to_playlist_recursive", { playlistId, folderPath });
      loadPlaylists();
    } catch (e) {
      console.error("Create playlist from folder error:", e);
      alert(`Error: ${e}`);
    }
  };

  useEffect(() => {
    if (activeTab === "playlist" && selectedPlaylist) {
      invoke("get_playlist_tracks", { playlistId: selectedPlaylist.id })
        .then(setPlaylistTracks)
        .catch(e => console.error("Load playlist tracks error:", e));
    }
  }, [activeTab, selectedPlaylist]);

  async function createPlaylist() {
    console.log("[frontend] createPlaylist triggered");
    setShowSidebar(true);
    setIsCreatingPlaylist(true);
    setNewPlaylistName("");
  }


  async function handleCreatePlaylistConfirm() {
    if (!newPlaylistName.trim()) return;
    try {
      await invoke("create_playlist", { name: newPlaylistName.trim() });
      setIsCreatingPlaylist(false);
      loadPlaylists();
    } catch (e) {
      console.error("Create playlist error:", e);
      alert(`Error creating playlist: ${e}`);
    }
  }


  async function addSelectedToPlaylist(playlistId) {
    try {
      await invoke("add_tracks_to_playlist", { playlistId, trackIds: selectedIds });
      if (selectedPlaylist && selectedPlaylist.id === playlistId) {

        // Refresh if we are viewing it
        const p = await invoke("get_playlist_tracks", { playlistId });
        setPlaylistTracks(p);
      }
    } catch (e) {
      console.error("Add to playlist error:", e);
    }
  }


  async function syncGlobalShortcuts() {
    if (syncShortcutsRunning.current) return;
    syncShortcutsRunning.current = true;
    try {
      await invoke("sandi_unregister_all_shortcuts").catch(() => {});
      let registeredCount = 0;
      for (const action in keyBindings) {
        for (const binding of keyBindings[action]) {
          if (binding.global) {
            const mods = binding.modifiers.join("+");
            const shortcutStr = mods ? `${mods}+${binding.key}` : binding.key;
            try {
              await invoke("sandi_register_global_action", { shortcutStr, actionStr: action });
              registeredCount++;

            } catch (e) {
              console.error(`[shortcuts] FAILED '${shortcutStr}':`, e);
            }
          }
        }
      }
      // Fallback: if no user global shortcuts, restore built-in defaults
      if (registeredCount === 0) {

        await invoke("sandi_restore_defaults").catch(e => console.error("[shortcuts] restore defaults error:", e));
      }
    } finally {
      syncShortcutsRunning.current = false;
    }
  }

  async function refreshMidiDevices() {
    try {
      const devices = await invoke("list_midi_devices");
      setMidiDevices(devices);
      return devices;
    } catch (e) {
      console.error("[midi] list_midi_devices error:", e);
      return [];
    }
  }

  // Refresh device list on mount
  useEffect(() => {
    refreshMidiDevices();
  }, []);

  // Connect/disconnect when selectedMidiDevice changes
  useEffect(() => {
    if (selectedMidiDevice === null) {
      invoke("disconnect_midi_device").catch(() => {});
      setMidiConnected(false);
      return;
    }
    invoke("connect_midi_device", { deviceIndex: selectedMidiDevice })
      .then(() => {
        setMidiConnected(true);
        saveSetting("midi-device", String(selectedMidiDevice));
      })
      .catch(e => {
        console.error("[midi] connect error:", e);
        setMidiConnected(false);
      });
    return () => {
      invoke("disconnect_midi_device").catch(() => {});
      setMidiConnected(false);
    };
  }, [selectedMidiDevice]);

  // Persist midiMappings and sync to Rust
  useEffect(() => {
    saveSetting("midi-mappings", midiMappings);
    // Convert { action: "note:N" } to { "note:N": action } for Rust
    const rustMap = {};
    for (const [action, key] of Object.entries(midiMappings)) {
      if (key) rustMap[key] = action;
    }
    invoke("set_midi_mappings", { mappings: rustMap }).catch(e => console.error("[midi] set_midi_mappings error:", e));
  }, [midiMappings]);

  // MIDI learn: capture next note/CC from device
  useEffect(() => {
    if (!midiLearnTarget) return;
    const unlisten = listen("midi-event", (event) => {
      const msg = event.payload;
      if (!msg || msg.length < 2) return;
      const status = msg[0] & 0xF0;
      const data1  = msg[1];
      let key = null;
      if (status === 0x90 && msg.length >= 3 && msg[2] > 0) key = `note:${data1}`;
      else if (status === 0xB0) key = `cc:${data1}`;
      if (!key) return;
      // Assign to learn target, clear any other action that had the same key
      setMidiMappings(prev => {
        const next = { ...prev };
        for (const a in next) { if (next[a] === key) next[a] = null; }
        next[midiLearnTarget] = key;
        return next;
      });
      setMidiLearnTarget(null);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [midiLearnTarget]);

  const togglePin = async () => {
    try {
      const newState = !isPinned;
      await invoke("toggle_pin", { pinned: newState });
      setIsPinned(newState);
      saveSetting("is-pinned", newState.toString());
    } catch (e) {
      console.error("Toggle pin error:", e);
    }
  };

  useEffect(() => {
    invoke("toggle_pin", { pinned: isPinned })
      .catch(e => console.error("Initial pin sync error:", e));
  }, []);

  useEffect(() => {
    invoke("check_accessibility").then(ok => setAccessibilityOk(ok));
  }, []);

  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === "INPUT") return;
      for (const action in keyBindings) {
        for (const binding of keyBindings[action]) {
          // EXPLICIT BLINDING: If global is true, JS MUST NOT HANDLE IT. 
          // This prevents the "Double Trigger" (e.g. Play-then-Pause instantly).
          if (binding.global) continue;

          // Match against e.key OR e.code for maximum compatibility
          const keyMatch = 
            e.key.toLowerCase() === binding.key.toLowerCase() || 
            e.code.toLowerCase() === binding.key.toLowerCase();
            
          const modMatch = (binding.modifiers || []).every(m => {
            if (m === "Shift") return e.shiftKey;
            if (m === "CommandOrControl") return e.metaKey || e.ctrlKey;
            if (m === "Alt") return e.altKey;
            return true;
          });
          
          // Also ensure NO extra modifiers are pressed
          const noExtraMods = ["Shift", "CommandOrControl", "Alt"].every(m => {
            if (binding.modifiers.includes(m)) return true;
            if (m === "Shift") return !e.shiftKey;
            if (m === "CommandOrControl") return !e.metaKey && !e.ctrlKey;
            if (m === "Alt") return !e.altKey;
            return true;
          });

          if (keyMatch && modMatch && noExtraMods) {
            e.preventDefault();
            console.log("[trigger-js] matched local:", action);
            triggerAction(action);
            return;
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setSelectedIds(tracksRef.current.map(t => t.id));
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIdsRef.current.length > 0) {
        deleteSelectedTracks();
      }
    };
    const handleMidiRate = (e) => { if (currentTrackRef.current) rateTrack(currentTrackRef.current, e.detail); };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("midi-rate", handleMidiRate);
    const handleCapture = (e) => {
      if (!isListening) return;
      e.preventDefault();
      
      // Don't capture naked modifier keys
      if (["Control", "Shift", "Alt", "Meta", "Command"].includes(e.key)) return;

      const modifiers = [];
      if (e.ctrlKey || e.metaKey) modifiers.push("CommandOrControl");
      if (e.altKey) modifiers.push("Alt");
      
      let key;
      // Numpad keys are special — always use e.code to distinguish them (e.g. NumpadAdd vs +)
      if (e.code.startsWith("Numpad")) {
        key = e.code;
      } else if (e.code === "Space") {
        key = "Space";
      } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey) {
        // For printable single characters (e.g. j, k, 1) store e.key directly.
        key = e.key;
      } else {
        if (e.shiftKey) modifiers.push("Shift");
        key = e.code.replace("Key", "").replace("Digit", "");
        if (key === "Space") key = "Space"; // redundant safety
      }

      setKeyBindings(prev => {
        const action = isListening.action;
        // Avoid duplicates for the same action
        const exists = (prev[action] || []).some(b => 
          b.key === key && 
          JSON.stringify(b.modifiers.slice().sort()) === JSON.stringify(modifiers.slice().sort())
        );
        if (exists) return prev;
        return { ...prev, [action]: [...(prev[action] || []), { key, global: false, modifiers }] };
      });
      setIsListening(null);
    };
    if (isListening) window.addEventListener("keydown", handleCapture);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("midi-rate", handleMidiRate);
      window.removeEventListener("keydown", handleCapture);
    };
  }, [keyBindings, triggerAction, isListening]);


  async function browseFiles() {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "m4a", "mp4"] }]
      });

      if (selected && Array.isArray(selected)) {
        for (const path of selected) {
          const meta = await invoke("get_metadata", { path });
          await invoke("add_track", { track: { ...meta, path } });
        }
        loadTracks();
      }
    } catch (e) {
      console.error("File browsing error:", e);
    }
  }

  async function browseFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false
      });

      if (selected) {
        // Since selected could be a string or array in v2 depending on options
        const path = Array.isArray(selected) ? selected[0] : selected;
        await invoke("scan_directory", { path });
        loadTracks();
        console.log("Scan complete from frontend");

      }
    } catch (e) {
      console.error("Folder browsing error:", e);
    }
  }

  useEffect(() => {
    setLastSelectedIndex(null);
  }, [activeTab, selectedPlaylist]);

  function handleTrackClick(t, index, e) {
    const currentList = activeTab === "playlist" ? playlistSortedTracks : sortedTracks;
    
    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(index, lastSelectedIndex);
      const end = Math.max(index, lastSelectedIndex);
      const range = currentList.slice(start, end + 1).map(tr => tr.id);
      setSelectedIds(Array.from(new Set([...selectedIds, ...range])));
    } else if (e.metaKey || e.ctrlKey) {
      if (selectedIds.includes(t.id)) {
        setSelectedIds(selectedIds.filter(id => id !== t.id));
      } else {
        setSelectedIds([...selectedIds, t.id]);
      }
    } else {
      setSelectedIds([t.id]);
    }
    setLastSelectedIndex(index);
  }

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    const newConfig = { key, direction };
    setSortConfig(newConfig);
    saveSetting("sort-config", JSON.stringify(newConfig));
  };

  const getSortedTracks = useCallback((tracksToSort, config) => {
    if (!config || !tracksToSort) return tracksToSort || [];
    return [...tracksToSort].sort((a, b) => {
      let aVal = a[config.key] || '';
      let bVal = b[config.key] || '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return config.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return config.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, []);

  const sortedTracks = useMemo(() => getSortedTracks(tracks, sortConfig), [tracks, sortConfig, getSortedTracks]);

  const playlistSortedTracks = useMemo(() => {
    if (activeTab === "playlist") {
      return getSortedTracks(playlistTracks, sortConfig);
    }
    return [];
  }, [playlistTracks, sortConfig, activeTab, getSortedTracks]);

  // Ordered + filtered columns (respects drag-reorder and visibility toggles)
  const activeCols = useMemo(() => colOrder
    .map(k => ALL_COLS.find(c => c.key === k))
    .filter(c => c && (c.key === 'title' || visibleCols[c.key])), [colOrder, visibleCols]);

  const totalTableWidth = useMemo(() => {
    const colsSum = activeCols.reduce((sum, col) => sum + (colWidths[col.key] || 100), 0);
    return colsSum + 40; // 40px for the "+" control column
  }, [activeCols, colWidths]);

  const visibleColCount = useMemo(() => activeCols.length + 1, [activeCols]);



  const handleFolderContextMenu = (e, dirEntry) => {
    e.preventDefault();
    console.log("[frontend] Folder Context Menu for:", dirEntry.path);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isFolder: true,
      folderPath: dirEntry.path,
      folderName: dirEntry.name
    });
  };

  const addFolderRecursiveToPlaylist = async (playlistId, folderPath) => {
    try {
      console.log("[frontend] addFolderRecursiveToPlaylist", { playlistId, folderPath });
      const count = await invoke("add_folder_to_playlist_recursive", { playlistId, folderPath });
      console.log(`[frontend] Added ${count} tracks recursively`);
      loadTracks(); // Refresh library
      if (activeTab === "playlist" && selectedPlaylist?.id === playlistId) {
        invoke("get_playlist_tracks", { playlistId }).then(setPlaylistTracks);
      }
    } catch (err) {
      console.error("Recursive add error:", err);
    }
  };

  const changeExplorerRoot = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Explorer Root Folder"
      });
      if (selected) {
        setHomePath(selected);
        saveSetting("explorer-root", selected);
      }
    } catch (err) {
      console.error("Change explorer root error:", err);
    }
  };

  const handleRemoveSelectedFromPlaylist = async () => {
    if (!selectedPlaylist) return;
    try {
      console.log("[frontend] handleRemoveSelectedFromPlaylist", { playlistId: selectedPlaylist.id, trackIds: selectedIds });
      await invoke("remove_tracks_from_playlist", { playlistId: selectedPlaylist.id, trackIds: selectedIds });
      // Refresh current playlist view
      const updated = await invoke("get_playlist_tracks", { playlistId: selectedPlaylist.id });
      setPlaylistTracks(updated);
      setContextMenu(null);
    } catch (err) {
      console.error("Remove from playlist error:", err);
    }
  };

  const renderCell = (key, t) => {
    const content = (() => {
      switch (key) {
        case "cover":
          return <Artwork track={t} />;
        case "rating":
          return (
            <div 
              className="rating-stars-clickable" 
              style={{ display: "flex", gap: "2px" }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const starWidth = rect.width / 5;
                const rating = Math.ceil(x / starWidth);
                rateTrack(t, rating);
              }}
            >
              {[1, 2, 3, 4, 5].map(r => (
                <span 
                  key={r} 
                  style={{ color: r <= (t.rating || 0) ? "var(--accent-color)" : "rgba(255,255,255,0.1)" }}
                >
                  {r <= (t.rating || 0) ? "★" : "☆"}
                </span>
              ))}
            </div>
          );
        case "duration":
          return <span>{t.duration ? `${Math.floor(t.duration/60)}:${(t.duration%60).toString().padStart(2,"0")}` : "--:--"}</span>;
        case "bitrate":
          return <span>{t.bitrate ? `${t.bitrate} kbps` : "-"}</span>;
        case "sample_rate":
          return <span>{t.sample_rate ? `${(t.sample_rate/1000).toFixed(1)} kHz` : "-"}</span>;
        case "channels":
          return <span>{t.channels === 1 ? "Mono" : t.channels === 2 ? "Stereo" : t.channels || "-"}</span>;
        default:
          return <span>{t[key] || "-"}</span>;
      }
    })();

    return (
      <td key={key} className={key === "cover" ? "artwork-cell" : ""} title={t[key] || "-"}>
        <div style={{ padding: "12px", width: "100%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {content}
        </div>
      </td>
    );
  };

  return (
    <div className={`app-container ${isResizing ? "is-resizing" : ""}`}>
      <div className="main-layout">
        {["sidebar", "main", "info"].map((colId) => {
          if (colId === "sidebar") {
            return (
              <aside 
                key="sidebar"
                className={`sidebar glass ${!showSidebar ? "collapsed" : ""}`}
              >
                <div className="logo">LUNAR AUDIO</div>
                <nav>
                  <div className={`nav-item ${activeTab === "library" ? "active" : ""}`} onClick={() => setActiveTab("library")}>
                    Library
                  </div>

                  <div className="sidebar-section-title" style={{ marginTop: "16px", color: "var(--text-secondary)", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Playlists</span>
                    <button 
                      className="ctrl-btn"
                      onClick={(e) => { e.stopPropagation(); setIsCreatingPlaylist(true); }}
                      style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "var(--accent-color)", cursor: "pointer", fontSize: "14px", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}
                      title="New Playlist"
                    >
                      +
                    </button>
                  </div>
                  {isCreatingPlaylist && (
                    <div style={{ padding: "0 16px 8px", display: "flex", gap: "4px" }}>
                      <input 
                        autoFocus
                        value={newPlaylistName}
                        onChange={(e) => setNewPlaylistName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreatePlaylistConfirm();
                          if (e.key === "Escape") setIsCreatingPlaylist(false);
                        }}
                        style={{ background: "#222", border: "1px solid #444", color: "#fff", fontSize: "11px", padding: "4px", flex: 1, borderRadius: "2px", outline: "none" }}
                        placeholder="Name..."
                      />
                      <button onClick={handleCreatePlaylistConfirm} style={{ background: "var(--accent-color)", color: "#000", border: "none", borderRadius: "2px", padding: "0 8px", cursor: "pointer" }}>✔</button>
                    </div>
                  )}


                  <div style={{ maxHeight: "150px", overflow: "auto", marginBottom: "16px" }}>
                    {playlists.map(p => (
                      <div 
                        key={p.id} 
                        className={`nav-item ${activeTab === "playlist" && selectedPlaylist?.id === p.id ? "active" : ""}`}
                        style={{ padding: "8px 16px", fontSize: "13px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                        onClick={() => { setSelectedPlaylist(p); setActiveTab("playlist"); }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                        <button 
                          onClick={(e) => { e.stopPropagation(); if(confirm(`Delete ${p.name}?`)) invoke("delete_playlist", { id: p.id }).then(loadPlaylists); }}
                          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "10px" }}
                        >✕</button>
                      </div>
                    ))}
                    {playlists.length === 0 && <div style={{ padding: "8px 16px", fontSize: "11px", opacity: 0.3 }}>No playlists</div>}
                  </div>

                  <div className={`nav-item ${activeTab === "mapping" ? "active" : ""}`} onClick={() => setActiveTab("mapping")}>
                    Settings
                  </div>

                  
                  <div className="sidebar-section-title" style={{ 
                    marginTop: "24px", 
                    color: "var(--text-secondary)", 
                    fontSize: "10px", 
                    fontWeight: "bold", 
                    textTransform: "uppercase", 
                    padding: "0 16px 8px", 
                    borderBottom: "1px solid rgba(255,255,255,0.05)", 
                    marginBottom: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}>
                    <span>Files Explorer</span>
                    <button 
                      onClick={changeExplorerRoot}
                      style={{ 
                        background: "none", border: "none", color: "var(--accent-color)", 
                        cursor: "pointer", fontSize: "14px", padding: "0 4px",
                        opacity: 0.6
                      }}
                      title="Change Explorer Root Folder"
                    >
                      📁
                    </button>
                  </div>
                  <div style={{ flex: 1, overflow: "auto", paddingRight: "4px" }}>
                    {homePath ? (
                      <FileTreeItem 
                        name={homePath.split(/[\\/]/).pop() || "Root"} 
                        path={homePath} 
                        is_dir={true} 
                        onPlay={playTrackFromPath} 
                        onContextMenu={handleFolderContextMenu}
                      />
                    ) : (
                      <div style={{ padding: "16px", fontSize: "11px", opacity: 0.5 }}>Loading folders...</div>
                    )}
                  </div>
                </nav>
              </aside>
            );
          }

          if (colId === "main") {
            return (
              <main 
                key="main"
                className="main-content"
              >
                {!accessibilityOk && (
                  <div style={{
                    background: "#3a1a00", borderBottom: "1px solid #ff9500",
                    padding: "8px 16px", display: "flex", alignItems: "center",
                    gap: "12px", fontSize: "13px", color: "#ff9500"
                  }}>
                    <span>⚠ Global shortcuts need Accessibility permission to work system-wide.</span>
                    <button
                      onClick={() => invoke("open_accessibility_settings")}
                      style={{
                        background: "#ff9500", color: "#000", border: "none",
                        borderRadius: "4px", padding: "3px 10px", cursor: "pointer",
                        fontSize: "12px", fontWeight: "bold"
                      }}
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => invoke("check_accessibility").then(ok => setAccessibilityOk(ok))}
                      style={{
                        background: "none", color: "#ff9500", border: "1px solid #ff9500",
                        borderRadius: "4px", padding: "3px 10px", cursor: "pointer", fontSize: "12px"
                      }}
                    >
                      Re-check
                    </button>
                  </div>
                )}
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <button 
                      className="ctrl-btn" 
                      style={{ fontSize: "20px", background: "none", border: "none", padding: "0", cursor: "pointer" }}
                      onClick={() => setShowSidebar(!showSidebar)}
                    >
                      {showSidebar ? "⇠" : "⇢"}
                    </button>
                    <h1>{activeTab === "mapping" ? "Settings" : activeTab === "playlist" ? (selectedPlaylist?.name || "Playlist") : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
                    <button 
                      className={`pin-btn ${isPinned ? "active" : ""}`}
                      onClick={togglePin}
                      title={isPinned ? "Unpin UI" : "Pin UI (Always on Top)"}
                    >
                      {isPinned ? "📌" : "📍"}
                    </button>
                  </div>
                  {(activeTab === "library" || activeTab === "playlist") && (
                    <span style={{ color: "var(--text-secondary)", fontSize: "12px", fontWeight: "500", letterSpacing: "0.5px", marginRight: "16px" }}>
                      {(activeTab === "library" ? tracks : playlistTracks).length.toLocaleString()} TRACKS
                    </span>
                  )}

                </header>

                <section className="content-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
                  <div style={{ flex: 1, overflow: "auto" }}>
                    {(activeTab === "library" || activeTab === "playlist") && (
                      <table 
                        className="track-list" 
                        style={{ 
                          tableLayout: "fixed",
                          width: totalTableWidth
                        }}
                      >
                        <thead>
                          <tr>
                            {activeCols.map(({ key, label }) => (
                              <th
                                key={key}
                                onClick={() => { requestSort(key); }}
                                 style={{
                                   width: colWidths[key] ?? 100,
                                   minWidth: 0,
                                   maxWidth: colWidths[key] ?? 100,
                                   position: "relative",
                                   zIndex: 1
                                 }}
                              >
                                <div style={{ display: "flex", alignItems: "center", width: "100%", height: "100%", padding: "0 12px", minWidth: 0 }}>
                                  <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                                    {label} {sortConfig.key === key && (sortConfig.direction === "asc" ? "↑" : "↓")}
                                  </span>
                                  </div>
                                <div 
                                    className={`resizer ${isResizing === key ? "active" : ""}`}
                                    draggable={false} 
                                    onMouseDown={(e) => { e.stopPropagation(); startResizing(key, e); }}
                                    style={{ pointerEvents: "auto" }} 
                                  />
                              </th>
                            ))}
                            <th style={{ width: "40px", position: "relative" }} ref={colMenuRef}>
                              <button
                                className="ctrl-btn"
                                style={{ fontSize: "13px", padding: "2px 4px", opacity: 0.6 }}
                                title="Toggle columns"
                                onClick={(e) => { e.stopPropagation(); setShowColMenu(v => !v); }}
                              >
                                <span>+</span>
                              </button>
                              {showColMenu && (
                                <div className="column-menu glass">
                                  {ALL_COLS.filter(c => c.key !== 'title').map(({ key, label }) => (
                                    <label key={key} style={{
                                      display: "flex", alignItems: "center", gap: "10px",
                                      padding: "7px 16px", cursor: "pointer",
                                      color: visibleCols[key] ? "var(--text-primary)" : "var(--text-secondary)",
                                      fontSize: "13px", userSelect: "none"
                                    }}>
                                      <input
                                        type="checkbox"
                                        checked={!!visibleCols[key]}
                                        onChange={(e) => {
                                          const next = { ...visibleCols, [key]: e.target.checked };
                                          setVisibleCols(next);
                                          saveSetting("visible-cols", next);
                                        }}
                                        style={{ accentColor: "var(--accent-color)" }}
                                      />
                                      {label}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeTab === "library" ? sortedTracks : playlistSortedTracks).length > 0 ? (
                            (activeTab === "library" ? sortedTracks : playlistSortedTracks).map((t, index) => (


                              <tr 
                                key={t.id} 
                                className={`track-item ${currentTrack?.id === t.id ? "active" : ""} ${selectedIds.includes(t.id) ? "selected" : ""}`} 
                                onClick={(e) => handleTrackClick(t, index, e)}
                                onDoubleClick={() => playTrack(t, activeTab === "playlist" ? playlistTracks : tracks)}
                                onContextMenu={(e) => handleContextMenu(e, t)}
                              >

                                {activeCols.map(({ key }) => renderCell(key, t))}
                                <td>
                                  <div style={{ display: "flex", gap: "8px" }}>
                                  <button 
                                    className="ctrl-btn" 
                                    style={{ fontSize: "16px" }} 
                                    onClick={(e) => { e.stopPropagation(); setEditingTrack(t); }}
                                  >
                                    ✎
                                  </button>
                                  {activeTab === "playlist" && (
                                    <button 
                                      className="ctrl-btn" 
                                      style={{ fontSize: "14px", opacity: 0.5 }} 
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        invoke("remove_tracks_from_playlist", { playlistId: selectedPlaylist.id, trackIds: [t.id] })
                                          .then(() => invoke("get_playlist_tracks", { playlistId: selectedPlaylist.id }).then(setPlaylistTracks));
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={visibleColCount} style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
                                {activeTab === "library" ? "Library is empty." : "Playlist is empty."} Add some tracks to get started!
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}


                    {activeTab === "mapping" && (
                      <div className="glass" style={{ padding: "24px", borderRadius: "0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                          <h3 style={{ margin: 0 }}>Column Order</h3>
                          <button
                            className="ctrl-btn"
                            style={{ fontSize: "11px", padding: "4px 10px", border: "1px solid var(--accent-color)", borderRadius: "4px" }}
                            onClick={() => {
                              const requestedKeys = ["cover", "rating", "title", "artist", "year", "duration"];
                              const otherKeys = ALL_COLS.map(c => c.key).filter(k => !requestedKeys.includes(k));
                              setColOrder([...requestedKeys, ...otherKeys]);
                            }}
                          >
                            Reset to Default
                          </button>
                        </div>

                        <div className="column-order-list">
                          {colOrder.map((key, index) => {
                            const col = ALL_COLS.find(c => c.key === key);
                            if (!col) return null;
                            return (
                              <div key={key} className="column-order-item glass">
                                <span style={{ flex: 1, fontSize: "13px" }}>{col.label}</span>
                                <div style={{ display: "flex", gap: "4px" }}>
                                  <button 
                                    className="ctrl-btn move-btn"
                                    disabled={index === 0}
                                    onClick={() => {
                                      const next = [...colOrder];
                                      [next[index], next[index - 1]] = [next[index - 1], next[index]];
                                      setColOrder(next);
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button 
                                    className="ctrl-btn move-btn"
                                    disabled={index === colOrder.length - 1}
                                    onClick={() => {
                                      const next = [...colOrder];
                                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                                      setColOrder(next);
                                    }}
                                  >
                                    ↓
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", marginTop: "40px" }}>
                          <h3 style={{ margin: 0 }}>Shortcuts & MIDI Mapping</h3>
                          <button
                            className="ctrl-btn"
                            style={{ fontSize: "11px", padding: "4px 10px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px", color: "rgba(255,255,255,0.6)" }}
                            onClick={() => {
                              localStorage.removeItem("sandi-key-bindings");
                              window.location.reload();
                            }}
                            title="Clear saved shortcuts and reload defaults"
                          >
                            Reset to Defaults
                          </button>
                        </div>
                        
                        <div className="shortcuts-manager">
                          {Object.entries(keyBindings).map(([action, bindings]) => {
                            return (
                            <div key={action} style={{ marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "16px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                <span style={{ fontWeight: "bold", textTransform: "uppercase", fontSize: "12px", color: "var(--accent-color)" }}>
                                  {action.replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                                <button 
                                  className="ctrl-btn" 
                                  style={{ fontSize: "11px", padding: "4px 8px", border: "1px solid var(--accent-color)", borderRadius: "4px" }}
                                  onClick={() => setIsListening({ action })}
                                >
                                  {isListening?.action === action ? "Listening..." : "+ Add Key"}
                                </button>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {bindings.map((b, i) => {
                                  const displayKey = b.key
                                    .replace("NumpadAdd", "Numpad +")
                                    .replace("NumpadSubtract", "Numpad -")
                                    .replace("NumpadMultiply", "Numpad *")
                                    .replace("NumpadDivide", "Numpad /")
                                    .replace("NumpadDecimal", "Numpad .")
                                    .replace("Numpad", "Numpad ");
                                  
                                  return (
                                  <div key={i} className="glass" style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "11px", display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span>
                                      {b.global && <span style={{ color: "#ffab00", marginRight: "4px" }}>●</span>}
                                      {b.modifiers.join("+")}{b.modifiers.length > 0 ? "+" : ""}{displayKey}
                                    </span>
                                    <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", marginLeft: "4px" }}>
                                      <input 
                                        type="checkbox" 
                                        checked={b.global} 
                                        onChange={(e) => {
                                          const newBindings = [...bindings];
                                          newBindings[i] = { ...b, global: e.target.checked };
                                          setKeyBindings({ ...keyBindings, [action]: newBindings });
                                        }}
                                        title="Global Toggle"
                                      />
                                      <span style={{ fontSize: "10px", opacity: 0.7 }}>Global</span>
                                    </label>
                                    <button 
                                      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}
                                      onClick={() => {
                                        const newBindings = bindings.filter((_, idx) => idx !== i);
                                        setKeyBindings({ ...keyBindings, [action]: newBindings });
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                            )
                          })}
                        </div>

                        <h3 style={{ marginTop: "32px" }}>MIDI Device</h3>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
                          <select
                            className="metadata-input"
                            style={{ flex: 1, padding: "8px 12px", fontSize: "13px" }}
                            value={selectedMidiDevice ?? ""}
                            onChange={e => setSelectedMidiDevice(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                          >
                            <option value="">— No device —</option>
                            {midiDevices.map((name, i) => (
                              <option key={i} value={i}>{name}</option>
                            ))}
                          </select>
                          <button
                            className="ctrl-btn"
                            style={{ padding: "8px 14px", fontSize: "12px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}
                            onClick={async () => {
                              const devices = await refreshMidiDevices();
                              if (selectedMidiDevice !== null && selectedMidiDevice >= devices.length) {
                                setSelectedMidiDevice(null);
                              }
                            }}
                          >
                            Refresh
                          </button>
                          <span style={{ fontSize: "12px", color: midiConnected ? "#4caf50" : "var(--text-secondary)", whiteSpace: "nowrap" }}>
                            {midiConnected ? "● Connected" : "○ Disconnected"}
                          </span>
                        </div>

                        <h3 style={{ marginTop: "8px", marginBottom: "12px" }}>MIDI Mapping</h3>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                          Click <strong>Learn</strong> then press a note or move a CC on your device to assign it.
                        </p>
                        <div className="shortcuts-manager">
                          {Object.keys(keyBindings).map(action => {
                            const assignedKey = midiMappings[action] || null;
                            const isLearning = midiLearnTarget === action;
                            return (
                              <div key={action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "4px" }}>
                                <span style={{ fontWeight: "bold", textTransform: "uppercase", fontSize: "12px", color: "var(--accent-color)", minWidth: "120px" }}>
                                  {action.replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  {assignedKey && !isLearning && (
                                    <span className="glass" style={{ padding: "3px 10px", borderRadius: "4px", fontSize: "12px", color: "#ffab00" }}>
                                      {assignedKey}
                                    </span>
                                  )}
                                  <button
                                    className="ctrl-btn"
                                    style={{
                                      fontSize: "11px", padding: "4px 10px",
                                      border: `1px solid ${isLearning ? "#ff5722" : "var(--accent-color)"}`,
                                      borderRadius: "4px",
                                      background: isLearning ? "rgba(255,87,34,0.15)" : "transparent",
                                      color: isLearning ? "#ff5722" : "inherit",
                                      animation: isLearning ? "pulse 1s infinite" : "none",
                                    }}
                                    onClick={() => setMidiLearnTarget(isLearning ? null : action)}
                                  >
                                    {isLearning ? "Listening..." : "Learn"}
                                  </button>
                                  {assignedKey && (
                                    <button
                                      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: "14px" }}
                                      title="Clear MIDI binding"
                                      onClick={() => setMidiMappings(prev => ({ ...prev, [action]: null }))}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </main>
            );
          }

          if (colId === "info" && editingTrack) {
            return (
              <div 
                key="info"
                className="glass"
                style={{ width: "320px", padding: "24px", borderLeft: "2px solid var(--accent-color)", height: "auto", overflowY: "auto", display: "flex", flexDirection: "column" }}
              >
                <h3>Edit Info</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>TITLE</label>
                  <input 
                    className="glass" 
                    style={{ padding: "8px", borderRadius: "4px", color: "var(--text-primary)", border: "1px solid #444", background: "transparent" }}
                    value={editingTrack.title || ""} 
                    onChange={(e) => setEditingTrack({...editingTrack, title: e.target.value})}
                  />
                  
                  <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>ARTIST</label>
                  <input 
                    className="glass" 
                    style={{ padding: "8px", borderRadius: "4px", color: "var(--text-primary)", border: "1px solid #444", background: "transparent" }}
                    value={editingTrack.artist || ""} 
                    onChange={(e) => setEditingTrack({...editingTrack, artist: e.target.value})}
                  />

                  <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>ALBUM</label>
                  <input 
                    className="glass" 
                    style={{ padding: "8px", borderRadius: "4px", color: "var(--text-primary)", border: "1px solid #444", background: "transparent" }}
                    value={editingTrack.album || ""} 
                    onChange={(e) => setEditingTrack({...editingTrack, album: e.target.value})}
                  />
                  
                  <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>RATING</label>
                  <div style={{ display: "flex", gap: "5px", fontSize: "20px", cursor: "pointer" }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span 
                        key={star}
                        onClick={() => setEditingTrack({ ...editingTrack, rating: star })}
                        style={{ color: star <= (editingTrack.rating || 0) ? "var(--accent-color)" : "rgba(255,255,255,0.1)" }}
                      >
                        {star <= (editingTrack.rating || 0) ? "★" : "☆"}
                      </span>
                    ))}
                    {(editingTrack.rating || 0) > 0 && (
                      <span 
                        onClick={() => setEditingTrack({ ...editingTrack, rating: 0 })}
                        style={{ fontSize: "12px", marginLeft: "10px", opacity: 0.5, alignSelf: "center" }}
                      >
                        Clear
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                    <button 
                      className="ctrl-btn" 
                      style={{ flex: 1, padding: "10px", background: "var(--accent-color)", color: "black", fontSize: "12px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px" }}
                      onClick={updateMetadata}
                    >
                      Save Changes
                    </button>
                    <button 
                      className="ctrl-btn" 
                      style={{ flex: 1, padding: "10px", border: "1px solid var(--border-color)", color: "var(--text-primary)", fontSize: "12px", textTransform: "uppercase" }}
                      onClick={() => setEditingTrack(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      <footer className="player-bar glass">
        <div className="current-track-info" style={{ width: "300px" }}>
          <div className="track-name" style={{ fontWeight: "bold", fontSize: "16px", color: "#0099cc" }}>
            {currentTrack?.title || "No track selected"}
          </div>
          <div className="artist-name" style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            {currentTrack?.artist || "Select a song from library"}
          </div>
          <div 
            className={`rating-stars ${currentTrack?.rating > 0 ? "rating-highlight" : "rating-empty"}`} 
            style={{ marginTop: "4px", fontSize: "14px" }}
          >
            {currentTrack?.rating > 0 ? "★".repeat(currentTrack.rating) : "☆☆☆☆☆"}
          </div>
        </div>

        <div className="player-controls">
          <button className="ctrl-btn" onClick={playPrev}>⏮</button>
          <button id="play-pause-btn" className="ctrl-btn play-btn" onClick={togglePlay}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button className="ctrl-btn" onClick={playNext}>⏭</button>
        </div>

        <div className="progress-container-wrapper" style={{ display: "flex", alignItems: "center", flex: 1, maxLength: "600px", gap: "10px", margin: "0 20px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-secondary)", width: "40px", textAlign: "right", fontFamily: "monospace" }}>
            {Math.floor(currentTime / 60)}:{(currentTime % 60).toString().padStart(2, '0')}
          </span>
          <div
            className="progress-container"
            style={{ margin: 0 }}
            onClick={(e) => {
              if (!currentTrack) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              const target = Math.floor(pct * (currentTrack.duration || 0));
              seek(target - currentTimeRef.current);
            }}
          >
            <div
              className="progress-bar"
              style={{ width: `${(currentTime / (currentTrack?.duration || 1)) * 100}%` }}
            ></div>
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-secondary)", width: "40px", fontFamily: "monospace" }}>
            {currentTrack?.duration ? `${Math.floor(currentTrack.duration / 60)}:${(currentTrack.duration % 60).toString().padStart(2, '0')}` : "0:00"}
          </span>
        </div>

        <div className="volume-control" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginRight: "10px", padding: "4px 8px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ fontSize: "9px", fontWeight: "bold", color: "var(--text-secondary)", letterSpacing: "1px" }}>SEEK</span>
            <input 
              type="number" 
              value={seekAmount} 
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setSeekAmount(val);
                seekAmountRef.current = val; // Synchronous update to avoid race conditions
              }}
              style={{ width: "35px", background: "transparent", border: "none", color: "var(--accent-color)", fontSize: "13px", fontWeight: "bold", textAlign: "center", outline: "none" }}
            />
            <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>s</span>
          </div>
          <div 
            onClick={() => {
              if (isMuted) {
                const targetVolume = prevVolume > 0 ? prevVolume : 0.5;
                setVolume(targetVolume);
                setIsMuted(false);
              } else {
                if (volume > 0) {
                  setPrevVolume(volume);
                  setVolume(0);
                  setIsMuted(true);
                } else {
                  setVolume(0.5);
                  setIsMuted(false);
                }
              }
            }}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", opacity: 0.8 }}
          >
            <VolumeIcon volume={volume} isMuted={isMuted} />
          </div>

          <div 
            className="progress-container"
            style={{ width: "100px", margin: 0, height: "4px" }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setVolume(pct);
              setIsMuted(false);
            }}
          >
            <div 
              className="progress-bar"
              style={{ width: `${volume * 100}%` }}
            />
          </div>

          <button 
            className="ctrl-btn" 
            title="Open Mini Player"
            onClick={() => invoke("open_mini_player")}
            style={{ fontSize: "18px", marginLeft: "10px", opacity: 0.6 }}
          >
            📺
          </button>
        </div>
      </footer>

      {contextMenu && (
        <div 
          ref={contextMenuRef}
          className="context-menu glass"
          style={{ 
            position: "fixed", 
            top: contextMenu.y, 
            left: contextMenu.x, 
            zIndex: 1000,
            padding: "4px",
            minWidth: "180px",
            borderRadius: "4px",
            background: "#0a0a0a",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
          }}
          onMouseLeave={() => setPlaylistSubmenu(null)}
        >
          {contextMenu.isFolder ? (
            /* Folder Context Menu */
            <>
              <div 
                className="context-menu-item"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPlaylistSubmenu({ x: rect.right, y: rect.top });
                }}
                style={{ 
                  padding: "8px 12px", 
                  cursor: "pointer", 
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  position: "relative",
                  borderRadius: "4px"
                }}
              >
                <span>➕ Add Folder to Playlist</span>
                <span style={{ opacity: 0.5, fontSize: "10px" }}>▶</span>
                
                {playlistSubmenu && (
                  <div className="glass" style={{
                    position: "fixed",
                    left: playlistSubmenu.x,
                    top: playlistSubmenu.y,
                    background: "#0a0a0a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    padding: "4px",
                    borderRadius: "4px",
                    minWidth: "150px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
                  }}>
                    <div 
                      className="context-menu-item" 
                      style={{ padding: "8px 12px", fontSize: "13px", color: "var(--accent-color)", borderRadius: "4px" }}
                      onClick={(e) => { e.stopPropagation(); createPlaylist(); setContextMenu(null); }}
                    >
                      + New Playlist...
                    </div>

                    <div 
                      className="context-menu-item" 
                      style={{ 
                        padding: "8px 12px", 
                        fontSize: "13px", 
                        color: "var(--accent-color)", 
                        borderRadius: "4px",
                        borderBottom: playlists.length > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                        marginBottom: playlists.length > 0 ? "4px" : "0"
                      }}
                      onClick={(e) => { e.stopPropagation(); createPlaylistFromFolder(contextMenu.folderName, contextMenu.folderPath); setContextMenu(null); }}
                    >
                      ✨ Create playlist '{contextMenu.folderName}'
                    </div>
                    {playlists.map(p => (
                      <div 
                        key={p.id} 
                        className="context-menu-item" 
                        style={{ padding: "8px 12px", fontSize: "13px", borderRadius: "4px" }}
                        onClick={(e) => { e.stopPropagation(); addFolderRecursiveToPlaylist(p.id, contextMenu.folderPath); setContextMenu(null); }}
                      >
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div 
                className="context-menu-item" 
                onClick={(e) => { e.stopPropagation(); revealItemInDir(contextMenu.folderPath); setContextMenu(null); }}
                style={{ 
                  padding: "8px 12px", 
                  cursor: "pointer", 
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  borderRadius: "4px",
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  marginTop: "4px"
                }}
              >
                <span>📂</span> Show in Finder
              </div>
            </>
          ) : (
            /* Track Context Menu */
            <>
              <div 
                className="context-menu-item"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPlaylistSubmenu({ x: rect.right, y: rect.top });
                }}
                style={{ 
                  padding: "8px 12px", 
                  cursor: "pointer", 
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  position: "relative",
                  borderRadius: "4px"
                }}
              >
                <span>➕ Add to Playlist</span>
                <span style={{ opacity: 0.5, fontSize: "10px" }}>▶</span>
                
                {playlistSubmenu && (
                  <div className="glass" style={{
                    position: "fixed",
                    left: playlistSubmenu.x,
                    top: playlistSubmenu.y,
                    background: "#0a0a0a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    padding: "4px",
                    borderRadius: "4px",
                    minWidth: "150px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
                  }}>
                    <div 
                      className="context-menu-item" 
                      style={{ padding: "8px 12px", fontSize: "13px", color: "var(--accent-color)", borderRadius: "4px" }}
                      onClick={(e) => { e.stopPropagation(); createPlaylist(); setContextMenu(null); }}
                    >
                      + New Playlist...
                    </div>
                    {playlists.map(p => (
                      <div 
                        key={p.id} 
                        className="context-menu-item" 
                        style={{ padding: "8px 12px", fontSize: "13px", borderRadius: "4px" }}
                        onClick={(e) => { e.stopPropagation(); addSelectedToPlaylist(p.id); setContextMenu(null); }}
                      >
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {activeTab === "playlist" && (
                <div 
                  className="context-menu-item" 
                  onClick={(e) => { e.stopPropagation(); handleRemoveSelectedFromPlaylist(); }}
                  style={{ 
                    padding: "8px 12px", 
                    cursor: "pointer", 
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    borderRadius: "4px",
                    color: "#ff8800"
                  }}
                >
                  <span>❌</span> {selectedIds.length > 1 ? `Remove ${selectedIds.length} tracks from Playlist` : "Remove from Playlist"}
                </div>
              )}

              <div 
                className="context-menu-item" 
                onClick={(e) => { e.stopPropagation(); revealItemInDir(contextMenu.track.path); setContextMenu(null); }}
                style={{ 
                  padding: "8px 12px", 
                  cursor: "pointer", 
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  borderRadius: "4px",
                  borderTop: activeTab !== "playlist" ? "1px solid rgba(255,255,255,0.05)" : "none",
                  marginTop: activeTab !== "playlist" ? "4px" : "0"
                }}
              >
                <span>📂</span> Show in Finder
              </div>

              <div 
                className="context-menu-item" 
                onClick={(e) => { e.stopPropagation(); setEditingTrack(contextMenu.track); setContextMenu(null); }}
                style={{ 
                  padding: "8px 12px", 
                  cursor: "pointer", 
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  borderRadius: "4px"
                }}
              >
                <span>✎</span> Edit Metadata
              </div>


              <div 
                className="context-menu-item delete" 
                onClick={(e) => { e.stopPropagation(); deleteSelectedTracksFromDisk(); setContextMenu(null); }}
                style={{ 
                  padding: "8px 12px", 
                  cursor: "pointer", 
                  color: "#ff4444", 
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  marginTop: "4px",
                  borderRadius: "4px"
                }}
              >
                <span>🗑</span> {selectedIds.length > 1 ? `Move ${selectedIds.length} tracks to Trash` : "Move to Trash"}
              </div>
            </>
          )}
        </div>
      )}


    </div>
  );
}

export default App;
