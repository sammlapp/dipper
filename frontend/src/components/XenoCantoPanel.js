import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Modal, Box, FormControl, Select, MenuItem } from '@mui/material';
import { useBackendUrl } from '../hooks/useBackendUrl';

function getVizSettings() {
  try {
    const saved = localStorage.getItem('visualization_settings');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

const PAGE_SIZE = 6;

function XCClipCard({ recording, backendUrl }) {
  const [spectrogram, setSpectrogram] = useState(null);
  const [audio, setAudio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  const loadedRef = useRef(false);
  const viz = useMemo(() => getVizSettings(), []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);

    const audioUrl = recording.file.startsWith('//') ? `https:${recording.file}` : recording.file;
    const params = new URLSearchParams({
      url: audioUrl,
      spec_window_size: viz?.spec_window_size || 512,
      spectrogram_colormap: viz?.spectrogram_colormap || 'greys_r',
      dB_range: JSON.stringify(viz?.dB_range || [-80, -20]),
      use_bandpass: 'false',
      resize_images: 'true',
      image_width: 224,
      image_height: 224,
      normalize_audio: 'true',
    });

    fetch(`${backendUrl}/xeno-canto/clip?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setSpectrogram(data.spectrogram_base64);
        setAudio(data.audio_base64);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const xcUrl = `https://xeno-canto.org/${recording.id}`;

  return (
    <div className="xc-clip-card">
      <div className="xc-clip-spectrogram" onClick={togglePlay}>
        {loading && <div className="xc-clip-loading"><span className="material-symbols-outlined">hourglass_empty</span></div>}
        {error && <div className="xc-clip-error"><span className="material-symbols-outlined">error</span><small>{error}</small></div>}
        {spectrogram && !loading && (
          <>
            <img src={`data:image/png;base64,${spectrogram}`} alt="Spectrogram" className="annotation-spectrogram" />
            <div className={`xc-play-icon${isPlaying ? ' playing' : ''}`}>
              <span className="material-symbols-outlined">{isPlaying ? 'pause' : 'play_arrow'}</span>
            </div>
          </>
        )}
      </div>
      {audio && (
        <audio
          ref={audioRef}
          src={`data:audio/wav;base64,${audio}`}
          onEnded={() => setIsPlaying(false)}
        />
      )}
      <div className="xc-clip-meta">
        <div className="xc-clip-name" title={`${recording.gen} ${recording.sp}`}>
          <em>{recording.gen} {recording.sp}</em>
          {recording.en && <span className="xc-clip-en"> · {recording.en}</span>}
        </div>
        <div className="xc-clip-details">
          {recording.type && <span className="xc-tag">{recording.type}</span>}
          {recording.q && <span className="xc-tag xc-quality">Q:{recording.q}</span>}
          {recording.cnt && <span className="xc-clip-loc">{recording.cnt}</span>}
        </div>
        <a href={xcUrl} target="_blank" rel="noreferrer" className="xc-link">
          <span className="material-symbols-outlined" style={{ fontSize: '13px', verticalAlign: 'middle' }}>open_in_new</span>
          {' '}XC{recording.id}
        </a>
      </div>
    </div>
  );
}

export default function XenoCantoPanel({ open, onClose }) {
  const backendUrl = useBackendUrl();

  const [genus, setGenus] = useState('');
  const [species, setSpecies] = useState('');
  const [englishName, setEnglishName] = useState('');
  const [recType, setRecType] = useState('any');
  const [minQuality, setMinQuality] = useState('C');
  const [page, setPage] = useState(1);

  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Which slice of results to display (offset within the XC page)
  const [offset, setOffset] = useState(0);

  const search = useCallback(async (xcPage, newOffset) => {
    const hasName = englishName.trim() || genus.trim() || species.trim();
    if (!hasName) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: xcPage, per_page: 100 });
    if (englishName.trim()) {
      params.set('en', englishName.trim());
    } else {
      if (genus.trim()) params.set('genus', genus.trim());
      if (species.trim()) params.set('species', species.trim());
    }
    if (recType !== 'any') params.set('type', recType);
    // q:">X" = strictly better than X (A best, E worst).
    // "at least B" = A or B = q:">C" (one grade worse than B used as threshold).
    // "at least A" = q:A (exact, since nothing is better than A).
    // "at least E" = all grades = omit filter.
    const qualOrder = ['A', 'B', 'C', 'D', 'E'];
    if (minQuality && minQuality !== 'none') {
      const idx = qualOrder.indexOf(minQuality);
      if (idx === 0) {
        params.set('quality', 'A');
      } else if (idx < qualOrder.length - 1) {
        // threshold = one grade worse than minQuality
        params.set('quality', `>${qualOrder[idx + 1]}`);
      }
      // idx === 4 (E) means all grades → omit filter
    }

    try {
      const r = await fetch(`${backendUrl}/xeno-canto/search?${params}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setResults(data);
      setOffset(newOffset ?? 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, genus, species, englishName, recType, minQuality]);

  const handleSearch = useCallback(() => {
    setPage(1);
    search(1, 0);
  }, [search]);

  // Navigate within current XC page
  const visibleRecordings = results?.recordings?.slice(offset, offset + PAGE_SIZE) ?? [];
  const totalInPage = results?.recordings?.length ?? 0;
  const canNextInPage = offset + PAGE_SIZE < totalInPage;
  const canNextXcPage = results && page < parseInt(results.numPages || 1, 10);
  const canPrev = offset > 0 || page > 1;

  const handleNext = useCallback(() => {
    if (canNextInPage) {
      setOffset(o => o + PAGE_SIZE);
    } else if (canNextXcPage) {
      const nextPage = page + 1;
      setPage(nextPage);
      search(nextPage, 0);
    }
  }, [canNextInPage, canNextXcPage, page, search]);

  const handlePrev = useCallback(() => {
    if (offset > 0) {
      setOffset(o => Math.max(0, o - PAGE_SIZE));
    } else if (page > 1) {
      const prevPage = page - 1;
      setPage(prevPage);
      search(prevPage, 0);
    }
  }, [offset, page, search]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  const totalRecordings = results ? parseInt(results.numRecordings || 0, 10) : 0;
  const globalStart = (page - 1) * 100 + offset + 1;
  const globalEnd = (page - 1) * 100 + offset + visibleRecordings.length;
  const totalSubPages = totalRecordings > 0 ? Math.ceil(totalRecordings / PAGE_SIZE) : 1;
  const currentSubPage = Math.floor(((page - 1) * 100 + offset) / PAGE_SIZE) + 1;

  return (
    <Modal open={open} onClose={onClose}>
      <Box className="xc-panel-modal">
        <div className="xc-panel-header">
          <div className="xc-panel-title">
            <img src="/assets/xc_logo.svg" alt="XC" style={{ width: 20, height: 20, borderRadius: 3 }} />
            Xeno-Canto Reference
          </div>
          <button className="toolbar-btn" onClick={onClose} title="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="xc-panel-controls">
          <div className="xc-search-row">
            <input
              className="xc-input"
              placeholder="Genus"
              value={genus}
              onChange={e => setGenus(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!!englishName.trim()}
            />
            <input
              className="xc-input"
              placeholder="Species"
              value={species}
              onChange={e => setSpecies(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!!englishName.trim()}
            />
            <span className="xc-or">or</span>
            <input
              className="xc-input xc-input-wide"
              placeholder="English name"
              value={englishName}
              onChange={e => setEnglishName(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!!(genus.trim() || species.trim())}
            />
          </div>

          <div className="xc-filter-row">
            <label className="xc-filter-label">Type</label>
            <FormControl size="small">
              <Select
                value={recType}
                onChange={e => setRecType(e.target.value)}
                sx={{ fontSize: '0.82rem', minWidth: 100 }}
              >
                <MenuItem value="any"><em>Any</em></MenuItem>
                <MenuItem value="song">Song</MenuItem>
                <MenuItem value="call">Call</MenuItem>
                <MenuItem value="alarm call">Alarm call</MenuItem>
                <MenuItem value="flight call">Flight call</MenuItem>
                <MenuItem value="begging call">Begging call</MenuItem>
                <MenuItem value="drumming">Drumming</MenuItem>
              </Select>
            </FormControl>

            <label className="xc-filter-label" style={{ marginLeft: 12 }}>Min quality</label>
            <FormControl size="small">
              <Select
                value={minQuality}
                onChange={e => setMinQuality(e.target.value)}
                sx={{ fontSize: '0.82rem', minWidth: 80 }}
              >
                <MenuItem value="none"><em>Any</em></MenuItem>
                <MenuItem value="A">A</MenuItem>
                <MenuItem value="B">B</MenuItem>
                <MenuItem value="C">C</MenuItem>
                <MenuItem value="D">D</MenuItem>
              </Select>
            </FormControl>

            <button
              className="toolbar-btn xc-search-btn"
              onClick={handleSearch}
              disabled={loading || (!genus.trim() && !species.trim() && !englishName.trim()) || (!!englishName.trim() && !!(genus.trim() || species.trim()))}
            >
              {loading
                ? <span className="material-symbols-outlined xc-spin">progress_activity</span>
                : <span className="material-symbols-outlined">search</span>}
              Search
            </button>
          </div>
        </div>

        {error && <div className="xc-error">{error}</div>}

        {results && !loading && (
          <div className="xc-results-header">
            {totalRecordings > 0
              ? `Showing ${globalStart}–${Math.min(globalEnd, totalRecordings)} of ${totalRecordings} recordings`
              : 'No recordings found'}
          </div>
        )}

        <div className="xc-grid">
          {visibleRecordings.map(rec => (
            <XCClipCard
              key={`${rec.id}-${offset}`}
              recording={rec}
              backendUrl={backendUrl}
            />
          ))}
          {!loading && results && visibleRecordings.length === 0 && (
            <div className="xc-empty">No results. Try a different query.</div>
          )}
        </div>

        {results && visibleRecordings.length > 0 && (
          <div className="xc-pagination">
            <button className="toolbar-btn" onClick={handlePrev} disabled={!canPrev}>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="xc-page-info">Page {currentSubPage} of {totalSubPages}</span>
            <button className="toolbar-btn" onClick={handleNext} disabled={!canNextInPage && !canNextXcPage}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        )}
      </Box>
    </Modal>
  );
}
