import { useState, useCallback, useEffect } from 'react';
import {
  Box, Tabs, Tab, Chip, CircularProgress, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText,
  OutlinedInput, TextField, Slider,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import StorageIcon from '@mui/icons-material/Storage';
import { getBackendUrl } from '../utils/backendConfig';
import { selectFolder } from '../utils/fileOperations';

// ── helpers ─────────────────────────────────────────────────────────────────

// Module-level log accumulator so any panel can append to the shared log
let _logEntries = [];
let _logListeners = [];
function appendLog(entry) {
  _logEntries = [..._logEntries.slice(-199), { ts: new Date().toLocaleTimeString(), ...entry }];
  _logListeners.forEach(fn => fn(_logEntries));
}
function subscribeLog(fn) { _logListeners.push(fn); return () => { _logListeners = _logListeners.filter(f => f !== fn); }; }

async function ssPost(endpoint, body, logLabel) {
  const url = await getBackendUrl();
  appendLog({ type: 'req', text: `→ POST ${endpoint}` + (logLabel ? ` [${logLabel}]` : '') });
  try {
    const r = await fetch(`${url}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.status === 'error') {
      appendLog({ type: 'error', text: `✗ ${endpoint}: ${data.error}${data.log ? '\n' + data.log : ''}`, log_path: data.log_path });
    } else {
      appendLog({ type: 'ok', text: `✓ ${endpoint} ok` });
    }
    return data;
  } catch (e) {
    appendLog({ type: 'error', text: `✗ ${endpoint} fetch failed: ${e}` });
    return { status: 'error', error: String(e) };
  }
}

function StatusBadge({ ok, children }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 10,
      fontSize: '0.72rem', fontWeight: 600,
      background: ok ? '#e6f4ea' : '#fce8e6',
      color: ok ? '#1e7e34' : '#c62828',
    }}>
      {children}
    </span>
  );
}

function SectionHeader({ children }) {
  return (
    <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--dark, #395756)' }}>
      {children}
    </h3>
  );
}

function ErrorBox({ msg, logPath }) {
  if (!msg) return null;
  const copy = () => navigator.clipboard?.writeText(msg + (logPath ? `\nLog: ${logPath}` : ''));
  return (
    <div style={{
      background: '#fff3f3', border: '1px solid #ffcdd2', borderRadius: 6,
      padding: '8px 12px', marginBottom: 10, fontSize: '0.82rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <pre style={{ margin: 0, color: '#c62828', whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1, fontFamily: 'inherit', fontSize: '0.82rem' }}>
          {msg}
        </pre>
        <button onClick={copy} style={{ border: '1px solid #ffcdd2', borderRadius: 4, padding: '1px 7px', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Copy
        </button>
      </div>
      {logPath && (
        <div style={{ marginTop: 4, fontSize: '0.74rem', color: '#888' }}>
          Log: <span style={{ userSelect: 'all', fontFamily: 'monospace' }}>{logPath}</span>
        </div>
      )}
    </div>
  );
}

function LogPanel() {
  const [entries, setEntries] = useState(_logEntries);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeLog(setEntries), []);

  const text = entries.map(e => `[${e.ts}] ${e.text}${e.log_path ? '\nLog: ' + e.log_path : ''}`).join('\n');

  return (
    <div style={{ borderTop: '1px solid var(--border, #e5e7eb)', flexShrink: 0, background: 'var(--bg-secondary, #f9fafb)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', textAlign: 'left', padding: '4px 14px', fontSize: '0.75rem', color: '#666', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>Debug log ({entries.length} entries)</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 8px', position: 'relative' }}>
          <button
            onClick={() => navigator.clipboard?.writeText(text)}
            style={{ position: 'absolute', top: 4, right: 18, fontSize: '0.72rem', padding: '1px 8px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
          >
            Copy all
          </button>
          <pre style={{
            margin: 0, fontSize: '0.72rem', fontFamily: 'monospace', maxHeight: 180,
            overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            userSelect: 'text', paddingRight: 60,
          }}>
            {entries.map((e, i) => (
              <span key={i} style={{ color: e.type === 'error' ? '#c62828' : e.type === 'ok' ? '#1e7e34' : '#555' }}>
                [{e.ts}] {e.text}{e.log_path ? `\nLog: ${e.log_path}` : ''}{'\n'}
              </span>
            ))}
            {entries.length === 0 && <span style={{ color: '#aaa' }}>No log entries yet.</span>}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

function SongSpaceTab() {
  const [mode, setMode] = useState('open'); // 'open' | 'create'
  // open mode
  const [openPath, setOpenPath] = useState('');
  // create mode
  const [createParent, setCreateParent] = useState('');
  const [createName, setCreateName] = useState('');
  const [featureExtractor, setFeatureExtractor] = useState('perch2');
  const [ssInfo, setSsInfo] = useState(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const [activeTab, setActiveTab] = useState(0);

  const dbPath = mode === 'open'
    ? openPath.trim()
    : (createParent.trim() && createName.trim() ? `${createParent.trim().replace(/\/$/, '')}/${createName.trim()}` : '');

  const handleOpen = async () => {
    if (!dbPath) return;
    setOpening(true);
    setOpenError('');
    const endpoint = mode === 'open' ? '/songspace/open' : '/songspace/create';
    const body = mode === 'open'
      ? { db_path: dbPath }
      : { db_path: dbPath, feature_extractor: featureExtractor };
    const result = await ssPost(endpoint, body, mode);
    if (result.status === 'ok') {
      setSsInfo(result.info);
    } else {
      setOpenError(result.error || 'Unknown error');
    }
    setOpening(false);
  };

  const refreshInfo = useCallback(async () => {
    if (!ssInfo) return;
    const result = await ssPost('/songspace/info', { db_path: ssInfo.db_path });
    if (result.status === 'ok') setSsInfo(result.info);
  }, [ssInfo]);

  // ── not open yet ─────────────────────────────────────────────────────────

  if (!ssInfo) {
    const canSubmit = !opening && !!dbPath;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: 24, maxWidth: 520, flex: 1 }}>
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>SongSpace</h2>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border, #d1d5db)', alignSelf: 'flex-start', marginBottom: 20, width: 'fit-content' }}>
            {[['open', 'Open Existing'], ['create', 'Create New']].map(([v, label]) => (
              <button key={v} onClick={() => { setMode(v); setOpenError(''); }}
                style={{
                  padding: '6px 18px', fontSize: '0.85rem', border: 'none', cursor: 'pointer',
                  background: mode === v ? 'var(--dark, #395756)' : 'transparent',
                  color: mode === v ? '#fff' : 'inherit', fontWeight: mode === v ? 600 : 400,
                }}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'open' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                type="text"
                value={openPath}
                onChange={e => setOpenPath(e.target.value)}
                placeholder="Path to existing SongSpace folder…"
                style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem' }}
                onKeyDown={e => e.key === 'Enter' && handleOpen()}
              />
              <button className="button-secondary" onClick={async () => { try { const f = await selectFolder(); if (f) setOpenPath(f); } catch (_) {} }} style={{ whiteSpace: 'nowrap' }}>
                <FolderOpenIcon style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }} />
                Browse
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>Parent folder</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={createParent}
                    onChange={e => setCreateParent(e.target.value)}
                    placeholder="/path/to/parent/folder"
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem' }}
                  />
                  <button className="button-secondary" onClick={async () => { try { const f = await selectFolder(); if (f) setCreateParent(f); } catch (_) {} }} style={{ whiteSpace: 'nowrap' }}>
                    <FolderOpenIcon style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }} />
                    Browse
                  </button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>New SongSpace name</div>
                <input
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="e.g. my_songspace"
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem', boxSizing: 'border-box' }}
                  onKeyDown={e => e.key === 'Enter' && handleOpen()}
                />
              </div>
              {dbPath && (
                <div style={{ fontSize: '0.78rem', color: '#666', fontFamily: 'monospace', background: 'var(--bg-secondary, #f9fafb)', padding: '4px 8px', borderRadius: 4 }}>
                  Will create: {dbPath}
                </div>
              )}
            </div>
          )}

          {/* Feature extractor (only relevant for Create) */}
          {mode === 'create' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
              <label style={{ fontSize: '0.82rem', minWidth: 120 }}>Feature extractor:</label>
              <select
                value={featureExtractor}
                onChange={e => setFeatureExtractor(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.82rem' }}
              >
                <option value="perch2">Perch 2</option>
                <option value="perch">Perch</option>
                <option value="birdnet">BirdNET</option>
                <option value="bs-convnext">BirdSet ConvNeXT</option>
              </select>
            </div>
          )}

          <ErrorBox msg={openError} />

          <button className="button-primary" onClick={handleOpen} disabled={!canSubmit} style={{ minWidth: 140 }}>
            {opening
              ? <><CircularProgress size={14} sx={{ mr: 1, color: '#fff' }} />{mode === 'open' ? 'Opening…' : 'Creating…'}</>
              : mode === 'open' ? 'Open' : 'Create'}
          </button>
        </div>
        <LogPanel />
      </div>
    );
  }

  // ── open songspace ───────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 24px', boxSizing: 'border-box', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <StorageIcon style={{ color: 'var(--dark, #395756)', fontSize: 20 }} />
        <span style={{ fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {ssInfo.db_path}
        </span>
        <Chip label={ssInfo.feature_extractor} size="small" variant="outlined" />
        <Chip label={`dim ${ssInfo.embedding_dim}`} size="small" variant="outlined" />
        <button className="button-secondary" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => { setSsInfo(null); setDbPath(''); }}>
          Close
        </button>
      </div>

      {/* Tab bar */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label={`Datasets (${ssInfo.datasets.length})`} />
          <Tab label="Ingest Dataset" />
          <Tab label={`Classifiers (${ssInfo.classifiers.length})`} />
          <Tab label="Similarity Search" />
          <Tab label="Train Classifier" />
        </Tabs>
      </Box>

      {/* Tab panels */}
      <div style={{ flex: 1, overflow: 'auto', paddingTop: 16 }}>
        {activeTab === 0 && <DatasetsPanel info={ssInfo} onRefresh={refreshInfo} />}
        {activeTab === 1 && <IngestDatasetPanel info={ssInfo} onRefresh={info => setSsInfo(info)} />}
        {activeTab === 2 && <ClassifiersPanel info={ssInfo} onRefresh={refreshInfo} />}
        {activeTab === 3 && <SimilaritySearchPanel info={ssInfo} />}
        {activeTab === 4 && <TrainClassifierPanel info={ssInfo} onRefresh={refreshInfo} />}
      </div>

      <LogPanel />
    </div>
  );
}

// ── Datasets panel ───────────────────────────────────────────────────────────

function DatasetsPanel({ info }) {
  const [expanded, setExpanded] = useState(null);
  const [samples, setSamples] = useState(null);
  const [loadingSamples, setLoadingSamples] = useState(false);

  const handleExpand = async (ds) => {
    if (expanded === ds.name) { setExpanded(null); setSamples(null); return; }
    setExpanded(ds.name);
    setLoadingSamples(true);
    const r = await ssPost('/songspace/dataset-samples', { db_path: info.db_path, dataset_name: ds.name, max_rows: 200 });
    setLoadingSamples(false);
    if (r.status === 'ok') setSamples(r);
    else setSamples({ error: r.error });
  };

  if (info.datasets.length === 0) {
    return <div style={{ color: 'var(--dark-accent)', fontSize: '0.85rem' }}>No datasets ingested yet. Use the "Ingest Dataset" tab to add audio.</div>;
  }

  return (
    <div>
      <SectionHeader>Datasets</SectionHeader>
      {info.datasets.map(ds => (
        <div key={ds.name} style={{ marginBottom: 8, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, overflow: 'hidden' }}>
          <div
            onClick={() => handleExpand(ds)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: 'var(--bg-secondary, #f9fafb)' }}
          >
            <span style={{ fontWeight: 600, fontSize: '0.88rem', flex: 1 }}>{ds.name}</span>
            <Chip label={`${ds.n_samples} samples`} size="small" />
            {ds.classes.length > 0 && <Chip label={`${ds.n_labeled} labeled`} size="small" color="info" variant="outlined" />}
            <StatusBadge ok={ds.allow_training}>{ds.allow_training ? 'train' : 'eval only'}</StatusBadge>
            {ds.classes.length > 0 && (
              <span style={{ fontSize: '0.75rem', color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ds.classes.join(', ')}
              </span>
            )}
          </div>
          {expanded === ds.name && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
              {loadingSamples ? <CircularProgress size={16} /> : samples?.error ? <ErrorBox msg={samples.error} /> : samples ? (
                <SamplesTable data={samples} />
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SamplesTable({ data }) {
  const cols = data.columns.slice(0, 6); // limit columns shown
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>
        Showing {data.shown} of {data.total} rows
      </div>
      <table style={{ fontSize: '0.78rem', borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '2px 8px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.records.slice(0, 50).map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
              {cols.map(c => (
                <td key={c} style={{ padding: '2px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row[c] !== null && row[c] !== undefined ? String(row[c]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Classifiers panel ────────────────────────────────────────────────────────

function ClassifiersPanel({ info, onRefresh }) {
  const [applyDialog, setApplyDialog] = useState(null); // classifier name
  const [applyDataset, setApplyDataset] = useState('');
  const [outputCsv, setOutputCsv] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [applyError, setApplyError] = useState('');
  const [expandedClf, setExpandedClf] = useState(null);

  const openApplyDialog = (clf) => {
    setApplyDialog(clf.name);
    setApplyDataset(info.datasets[0]?.name || '');
    setOutputCsv('');
    setApplyResult(null);
    setApplyError('');
  };

  const handleApply = async () => {
    if (!applyDataset || !outputCsv) return;
    setApplying(true);
    setApplyError('');
    const r = await ssPost('/songspace/predict', {
      db_path: info.db_path,
      classifier_name: applyDialog,
      dataset_name: applyDataset,
      output_csv: outputCsv,
    });
    setApplying(false);
    if (r.status === 'ok') {
      setApplyResult(r);
    } else {
      setApplyError(r.error || 'Unknown error');
    }
  };

  const handleOpenInReview = async () => {
    if (!applyResult?.csv_path) return;
    const url = await getBackendUrl();
    await fetch(`${url}/review/load-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_path: applyResult.csv_path, mode: 'wide' }),
    });
    window.dispatchEvent(new CustomEvent('changeTab', { detail: { tabId: 'review' } }));
  };

  if (info.classifiers.length === 0) {
    return <div style={{ color: 'var(--dark-accent)', fontSize: '0.85rem' }}>No classifiers trained yet. Use the "Train Classifier" tab.</div>;
  }

  return (
    <div>
      <SectionHeader>Classifiers</SectionHeader>
      {info.classifiers.map(clf => (
        <div key={clf.name} style={{ marginBottom: 8, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--bg-secondary, #f9fafb)' }}>
            <span
              style={{ fontWeight: 600, fontSize: '0.88rem', flex: 1, cursor: 'pointer' }}
              onClick={() => setExpandedClf(expandedClf === clf.name ? null : clf.name)}
            >
              {clf.name}
            </span>
            <Chip label={`${clf.n_classes} classes`} size="small" />
            <button className="button-primary" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => openApplyDialog(clf)}>
              Apply to dataset…
            </button>
          </div>
          {expandedClf === clf.name && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border, #e5e7eb)', fontSize: '0.82rem' }}>
              <strong>Classes:</strong> {clf.classes.join(', ') || '—'}
            </div>
          )}
        </div>
      ))}

      {/* Apply dialog */}
      <Dialog open={!!applyDialog} onClose={() => setApplyDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Apply "{applyDialog}" to dataset</DialogTitle>
        <DialogContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Dataset</InputLabel>
              <Select value={applyDataset} onChange={e => setApplyDataset(e.target.value)} label="Dataset">
                {info.datasets.map(ds => <MenuItem key={ds.name} value={ds.name}>{ds.name} ({ds.n_samples} samples)</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Output CSV path"
              size="small"
              value={outputCsv}
              onChange={e => setOutputCsv(e.target.value)}
              placeholder="/path/to/predictions.csv"
              fullWidth
            />
            <ErrorBox msg={applyError} />
            {applyResult && (
              <div style={{ background: '#e6f4ea', padding: '8px 12px', borderRadius: 6, fontSize: '0.82rem' }}>
                ✓ Saved {applyResult.n_predictions} predictions to {applyResult.csv_path}
                <br />
                <button className="button-primary" style={{ marginTop: 8, fontSize: '0.8rem' }} onClick={handleOpenInReview}>
                  Open in Review tab
                </button>
              </div>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleApply} disabled={applying || !applyDataset || !outputCsv}>
            {applying ? <><CircularProgress size={14} sx={{ mr: 1 }} />Applying…</> : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// ── Similarity search panel ──────────────────────────────────────────────────

function SimilaritySearchPanel({ info }) {
  const [dataset, setDataset] = useState(info.datasets[0]?.name || '');
  const [k, setK] = useState(20);
  const [exactSearch, setExactSearch] = useState(false);
  const [sampleIndices, setSampleIndices] = useState('0');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    const indices = sampleIndices.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (!indices.length) { setError('Enter at least one sample index'); return; }
    setSearching(true);
    setError('');
    const r = await ssPost('/songspace/similarity-search', {
      db_path: info.db_path,
      dataset_name: dataset,
      sample_indices: indices,
      k,
      exact_search: exactSearch,
    });
    setSearching(false);
    if (r.status === 'ok') setResults(r.results);
    else setError(r.error || 'Unknown error');
  };

  return (
    <div>
      <SectionHeader>Similarity Search</SectionHeader>
      <p style={{ fontSize: '0.82rem', color: 'var(--dark-accent)', marginTop: 0, marginBottom: 14 }}>
        Find clips in the database most similar to selected query samples.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <FormControl size="small" style={{ minWidth: 200 }}>
          <InputLabel>Query dataset</InputLabel>
          <Select value={dataset} onChange={e => setDataset(e.target.value)} label="Query dataset">
            {info.datasets.map(ds => <MenuItem key={ds.name} value={ds.name}>{ds.name}</MenuItem>)}
          </Select>
        </FormControl>

        <div>
          <div style={{ fontSize: '0.75rem', marginBottom: 2, color: '#555' }}>Query sample indices (comma-sep)</div>
          <input
            type="text"
            value={sampleIndices}
            onChange={e => setSampleIndices(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.82rem', width: 180 }}
            placeholder="0, 1, 2"
          />
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', marginBottom: 2, color: '#555' }}>k results</div>
          <input
            type="number"
            value={k}
            onChange={e => setK(parseInt(e.target.value) || 20)}
            min={1} max={200}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.82rem', width: 70 }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem' }}>
          <input type="checkbox" checked={exactSearch} onChange={e => setExactSearch(e.target.checked)} />
          Exact search
        </label>

        <button className="button-primary" onClick={handleSearch} disabled={searching || !dataset || info.datasets.length === 0}>
          {searching ? <><CircularProgress size={14} sx={{ mr: 1, color: '#fff' }} />Searching…</> : 'Search'}
        </button>
      </div>

      <ErrorBox msg={error} />

      {results && (
        <div>
          <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: 6 }}>{results.length} results</div>
          <table style={{ fontSize: '0.78rem', borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['file', 'start_time', 'end_time', 'score'].map(c => (
                  <th key={c} style={{ textAlign: 'left', padding: '3px 10px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                  <td style={{ padding: '2px 10px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Tooltip title={r.file}><span>{r.file.split('/').pop()}</span></Tooltip>
                  </td>
                  <td style={{ padding: '2px 10px' }}>{r.start_time?.toFixed(2)}</td>
                  <td style={{ padding: '2px 10px' }}>{r.end_time?.toFixed(2)}</td>
                  <td style={{ padding: '2px 10px' }}>{r.score?.toFixed(4) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Ingest dataset panel ─────────────────────────────────────────────────────

const DEPLOYMENT_FN_OPTIONS = [
  { value: 'parent_folder_name', label: 'Parent folder name' },
  { value: 'two_parents_name', label: 'Grandparent + parent folder' },
  { value: 'second_parent_name', label: 'Grandparent folder name' },
  { value: 'filename_first_part', label: 'Filename (before first underscore)' },
];

function IngestDatasetPanel({ info, onRefresh }) {
  const [samplesPath, setSamplesPath] = useState('');
  const [samplesMode, setSamplesMode] = useState('folder'); // 'folder' | 'csv'
  const [datasetMode, setDatasetMode] = useState('new'); // 'new' | 'existing'
  const [newDatasetName, setNewDatasetName] = useState('');
  const [existingDataset, setExistingDataset] = useState(info.datasets[0]?.name || '');
  const [allowTraining, setAllowTraining] = useState(true);
  const [deploymentFn, setDeploymentFn] = useState('parent_folder_name');
  const [embeddingExistsMode, setEmbeddingExistsMode] = useState('skip');
  const [useAugmentations, setUseAugmentations] = useState(false);
  const [audioRoot, setAudioRoot] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const datasetName = datasetMode === 'new' ? newDatasetName.trim() : existingDataset;

  const handleBrowse = async () => {
    try {
      if (samplesMode === 'folder') {
        const folder = await selectFolder();
        if (folder) setSamplesPath(folder);
      } else {
        const { invoke } = await import('@tauri-apps/api/core');
        const files = await invoke('select_csv_files');
        if (files?.length) setSamplesPath(files[0]);
      }
    } catch (e) {
      // fall back to manual input in server mode
    }
  };

  const handleIngest = async () => {
    if (!samplesPath.trim() || !datasetName) return;
    setIngesting(true);
    setError('');
    setResult(null);
    const r = await ssPost('/songspace/ingest', {
      db_path: info.db_path,
      samples: samplesPath.trim(),
      dataset_name: datasetName,
      allow_training: datasetMode === 'new' ? allowTraining : undefined,
      file_to_deployment: deploymentFn,
      embedding_exists_mode: embeddingExistsMode,
      bypass_augmentations: !useAugmentations,
      audio_root: audioRoot.trim() || null,
    }, 'ingest');
    setIngesting(false);
    if (r.status === 'ok') {
      setResult(r.info);
      onRefresh(r.info);
    } else {
      setError(r.error || 'Unknown error');
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionHeader>Ingest Dataset</SectionHeader>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Source type toggle */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border, #d1d5db)', alignSelf: 'flex-start' }}>
          {[['folder', 'Audio folder'], ['csv', 'Annotation CSV']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => { setSamplesMode(v); setSamplesPath(''); }}
              style={{
                padding: '5px 14px', fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                background: samplesMode === v ? 'var(--dark, #395756)' : 'transparent',
                color: samplesMode === v ? '#fff' : 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Path input */}
        <div>
          <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>
            {samplesMode === 'folder' ? 'Audio folder path' : 'Annotation CSV path (must have file, start_time, end_time columns)'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={samplesPath}
              onChange={e => setSamplesPath(e.target.value)}
              placeholder={samplesMode === 'folder' ? '/path/to/audio/' : '/path/to/annotations.csv'}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem' }}
            />
            <button className="button-secondary" onClick={handleBrowse} style={{ whiteSpace: 'nowrap' }}>
              <FolderOpenIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 3 }} />
              Browse
            </button>
          </div>
        </div>

        {/* Dataset: new or existing */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border, #d1d5db)', alignSelf: 'flex-start' }}>
          {[['new', 'New dataset'], ['existing', 'Add to existing']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setDatasetMode(v)}
              style={{
                padding: '5px 14px', fontSize: '0.82rem', border: 'none', cursor: 'pointer',
                background: datasetMode === v ? 'var(--dark, #395756)' : 'transparent',
                color: datasetMode === v ? '#fff' : 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {datasetMode === 'new' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TextField
              label="Dataset name"
              size="small"
              value={newDatasetName}
              onChange={e => setNewDatasetName(e.target.value)}
              placeholder="e.g. survey_2024"
              fullWidth
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={allowTraining} onChange={e => setAllowTraining(e.target.checked)} />
              Allow training on this dataset
            </label>
          </div>
        ) : (
          <FormControl size="small" fullWidth>
            <InputLabel>Existing dataset</InputLabel>
            <Select value={existingDataset} onChange={e => setExistingDataset(e.target.value)} label="Existing dataset">
              {info.datasets.map(ds => <MenuItem key={ds.name} value={ds.name}>{ds.name} ({ds.n_samples} samples)</MenuItem>)}
            </Select>
          </FormControl>
        )}

        {/* Deployment function */}
        <FormControl size="small" fullWidth>
          <InputLabel>Deployment name from file path</InputLabel>
          <Select value={deploymentFn} onChange={e => setDeploymentFn(e.target.value)} label="Deployment name from file path">
            {DEPLOYMENT_FN_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>

        {/* Embedding exists mode */}
        <FormControl size="small" style={{ maxWidth: 260 }}>
          <InputLabel>If embedding already exists</InputLabel>
          <Select value={embeddingExistsMode} onChange={e => setEmbeddingExistsMode(e.target.value)} label="If embedding already exists">
            <MenuItem value="skip">Skip (default)</MenuItem>
            <MenuItem value="add">Add (for augmented variants)</MenuItem>
          </Select>
        </FormControl>

        {/* Augmentations */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={useAugmentations} onChange={e => setUseAugmentations(e.target.checked)} />
          Use audio / spectrogram augmentations during ingestion
        </label>

        {/* Optional audio root */}
        <div>
          <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>Audio root (optional, for resolving relative paths in CSV)</div>
          <input
            type="text"
            value={audioRoot}
            onChange={e => setAudioRoot(e.target.value)}
            placeholder="/path/to/audio/root"
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem', boxSizing: 'border-box' }}
          />
        </div>

        <ErrorBox msg={error} />

        {result && (
          <div style={{ background: '#e6f4ea', padding: '10px 14px', borderRadius: 6, fontSize: '0.83rem' }}>
            ✓ Ingestion complete — dataset <strong>{datasetName}</strong> updated
            <div style={{ marginTop: 4, color: '#555' }}>
              {result.datasets.find(d => d.name === datasetName)?.n_samples ?? '?'} samples total
            </div>
          </div>
        )}

        <div>
          <button
            className="button-primary"
            onClick={handleIngest}
            disabled={ingesting || !samplesPath.trim() || !datasetName}
            style={{ minWidth: 160 }}
          >
            {ingesting ? <><CircularProgress size={14} sx={{ mr: 1, color: '#fff' }} />Ingesting…</> : 'Start Ingest'}
          </button>
          {ingesting && (
            <div style={{ fontSize: '0.78rem', color: '#555', marginTop: 8 }}>
              Embedding extraction can take a while for large datasets.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Train classifier panel ───────────────────────────────────────────────────

function TrainClassifierPanel({ info, onRefresh }) {
  const [clfName, setClfName] = useState('');
  const [classes, setClasses] = useState([]);
  const [trainDatasets, setTrainDatasets] = useState([]);
  const [valDataset, setValDataset] = useState('');
  const [weakNeg, setWeakNeg] = useState(2.0);
  const [steps, setSteps] = useState(500);
  const [batchSize, setBatchSize] = useState(128);
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // collect all available classes from train datasets
  const allClasses = [...new Set(
    info.datasets
      .filter(ds => trainDatasets.includes(ds.name))
      .flatMap(ds => ds.classes)
  )];

  const handleTrain = async () => {
    if (!clfName.trim() || !trainDatasets.length) return;
    setTraining(true);
    setError('');
    setResult(null);
    const r = await ssPost('/songspace/fit-classifier', {
      db_path: info.db_path,
      classifier_name: clfName.trim(),
      classes: classes.length ? classes : [],
      train_datasets: trainDatasets,
      validation_dataset: valDataset || null,
      weak_negatives_proportion: weakNeg,
      steps,
      batch_size: batchSize,
    });
    setTraining(false);
    if (r.status === 'ok') {
      setResult(r.classifier);
      onRefresh();
    } else {
      setError(r.error || 'Unknown error');
    }
  };

  const trainableDatasets = info.datasets.filter(ds => ds.allow_training);
  const evalDatasets = info.datasets;

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionHeader>Train New Classifier</SectionHeader>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextField
          label="Classifier name"
          size="small"
          value={clfName}
          onChange={e => setClfName(e.target.value)}
          placeholder="e.g. rana_round1"
          fullWidth
        />

        <FormControl size="small" fullWidth>
          <InputLabel>Training datasets</InputLabel>
          <Select
            multiple
            value={trainDatasets}
            onChange={e => setTrainDatasets(e.target.value)}
            input={<OutlinedInput label="Training datasets" />}
            renderValue={sel => sel.join(', ')}
          >
            {trainableDatasets.map(ds => (
              <MenuItem key={ds.name} value={ds.name}>
                <Checkbox checked={trainDatasets.includes(ds.name)} size="small" />
                <ListItemText primary={`${ds.name} (${ds.n_samples} samples)`} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth>
          <InputLabel>Validation dataset (optional)</InputLabel>
          <Select value={valDataset} onChange={e => setValDataset(e.target.value)} label="Validation dataset (optional)">
            <MenuItem value=""><em>None</em></MenuItem>
            {evalDatasets.map(ds => <MenuItem key={ds.name} value={ds.name}>{ds.name}</MenuItem>)}
          </Select>
        </FormControl>

        {allClasses.length > 0 && (
          <FormControl size="small" fullWidth>
            <InputLabel>Classes (optional, defaults to all)</InputLabel>
            <Select
              multiple
              value={classes}
              onChange={e => setClasses(e.target.value)}
              input={<OutlinedInput label="Classes (optional, defaults to all)" />}
              renderValue={sel => sel.join(', ')}
            >
              {allClasses.map(c => (
                <MenuItem key={c} value={c}>
                  <Checkbox checked={classes.includes(c)} size="small" />
                  <ListItemText primary={c} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>Training steps</div>
            <input
              type="number"
              value={steps}
              onChange={e => setSteps(parseInt(e.target.value) || 500)}
              min={10} max={10000}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>Batch size</div>
            <input
              type="number"
              value={batchSize}
              onChange={e => setBatchSize(parseInt(e.target.value) || 128)}
              min={1} max={2048}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 3 }}>
              Weak negatives ×{weakNeg.toFixed(1)}
            </div>
            <Slider
              value={weakNeg}
              onChange={(_, v) => setWeakNeg(v)}
              min={0} max={10} step={0.5}
              size="small"
              sx={{ color: 'var(--dark, #395756)' }}
            />
          </div>
        </div>

        <ErrorBox msg={error} />

        {result && (
          <div style={{ background: '#e6f4ea', padding: '10px 14px', borderRadius: 6, fontSize: '0.83rem' }}>
            ✓ Classifier <strong>{result.name}</strong> trained — {result.n_classes} classes: {result.classes.join(', ')}
            {result.last_val_metrics && (
              <div style={{ marginTop: 4, color: '#555' }}>
                Validation mAP: {result.last_val_metrics?.macro_average_precision?.toFixed(3) ?? '—'}
              </div>
            )}
          </div>
        )}

        <div>
          <button
            className="button-primary"
            onClick={handleTrain}
            disabled={training || !clfName.trim() || !trainDatasets.length}
            style={{ minWidth: 160 }}
          >
            {training ? <><CircularProgress size={14} sx={{ mr: 1, color: '#fff' }} />Training…</> : 'Train Classifier'}
          </button>
          {training && (
            <div style={{ fontSize: '0.78rem', color: '#555', marginTop: 8 }}>
              Training can take a few minutes. The UI will update when complete.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SongSpaceTab;
