import React, { useState, useEffect, useCallback } from 'react';
import { FormControl, Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Button, Stepper, Step, StepLabel, Chip } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import SpeciesFilterPanel, { MODEL_CLASS_COL } from './SpeciesFilterPanel';
import { selectFolder, writeFile, readFile } from '../utils/fileOperations';
import { getBackendUrl } from '../utils/backendConfig';

function isTauriAvailable() {
  return typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__);
}

async function getDocumentsDir() {
  if (isTauriAvailable()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('get_documents_dir');
  }
  const backendUrl = await getBackendUrl();
  const resp = await fetch(`${backendUrl}/system/documents-dir`);
  const result = await resp.json();
  return result.documents_dir;
}

async function mkdirViaBackend(path) {
  const backendUrl = await getBackendUrl();
  const resp = await fetch(`${backendUrl}/files/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) throw new Error(`mkdir failed: ${resp.statusText}`);
}

async function mkdirProject(path) {
  if (isTauriAvailable()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('mkdir', { path });
  } else {
    await mkdirViaBackend(path);
  }
}

const PROJECT_FILE = '.dipper_project.json';

const CLASSIFIERS = [
  { value: 'Perch2', label: 'Perch V2 Global Classifier' },
  { value: 'Perch2LiteRT', label: 'Perch V2 (LiteRT)' },
  { value: 'Perch2ONNX', label: 'Perch V2 (ONNX)' },
  { value: 'HawkEars', label: 'HawkEars N. American Bird Classifier (V1.0.8)' },
  { value: 'HawkEars_Low_Band', label: 'Ruffed & Spruce Grouse (HawkEars Low-band)' },
  { value: 'Perch', label: 'Perch (V1) Global Classifier' },
  { value: 'BirdNET', label: 'BirdNET Global bird classifier (V2.4)' },
  { value: 'BirdSetEfficientNetB1', label: 'BirdSet-EfficientNetB1 Global bird classifier' },
  { value: 'BirdSetConvNeXT', label: 'BirdSet-ConvNeXT Global bird classifier' },
];

const STATUS_OPTIONS = ['unstarted', 'in_progress', 'complete'];
const STATUS_COLORS = { unstarted: '#9e9e9e', in_progress: '#1976d2', complete: '#388e3c' };

async function readProjectFile(folder) {
  const content = await readFile(`${folder}/${PROJECT_FILE}`);
  return JSON.parse(content);
}

async function writeProjectFile(folder, data) {
  await writeFile(`${folder}/${PROJECT_FILE}`, JSON.stringify(data, null, 2));
}

async function listDir(folder) {
  const backendUrl = await getBackendUrl();
  const resp = await fetch(`${backendUrl}/files/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folder }),
  });
  if (!resp.ok) return [];
  const result = await resp.json();
  return result.data || [];
}

// Find CSV files one level deep: directly in folder or inside job subdirs
// Backend returns type: "folder" for dirs, "file" for files; id is the full path, value is basename
async function listJobFiles(folder, exts) {
  const entries = await listDir(folder);
  const direct = entries.filter(f => f.type === 'file' && exts.some(e => f.value.endsWith(e)));
  const subdirEntries = await Promise.all(
    entries.filter(f => f.type === 'folder').map(d => listDir(d.id))
  );
  const fromSubdirs = subdirEntries.flat().filter(f => f.type === 'file' && exts.some(e => f.value.endsWith(e)));
  return [...direct, ...fromSubdirs];
}

// List immediate subdirectories (job folders), excluding hidden files
async function listJobDirs(folder) {
  const entries = await listDir(folder);
  return entries.filter(f => f.type === 'folder' && !f.value.startsWith('.'));
}

function buildOpenProject(folder, data) {
  return {
    folder,
    name: data.name,
    classifier: data.classifier,
    species_filter: data.species_filter || { selected_species: [] },
    predictionsDir: `${folder}/classifier_predictions`,
    reviewTasksDir: `${folder}/review_tasks`,
  };
}

export default function ProjectTab({ openProject, onProjectOpen, onProjectClose, onOpenReviewTask }) {
  const [predictions, setPredictions] = useState([]);
  const [reviewTasks, setReviewTasks] = useState([]);
  const [taskStatuses, setTaskStatuses] = useState({});
  const [loadError, setLoadError] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardParentFolder, setWizardParentFolder] = useState('');
  const [wizardName, setWizardName] = useState('');
  const [wizardClassifier, setWizardClassifier] = useState('Perch2');
  const [wizardSpeciesFilter, setWizardSpeciesFilter] = useState({ selected_species: [] });
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshLists = useCallback(async () => {
    if (!openProject) return;
    try {
      const [preds, tasks] = await Promise.all([
        listJobDirs(openProject.predictionsDir),
        listJobFiles(openProject.reviewTasksDir, ['.csv']),
      ]);
      setPredictions(preds);
      setReviewTasks(tasks);
    } catch (e) {
      console.error('Failed to list project dirs:', e);
    }
  }, [openProject]);

  useEffect(() => {
    if (openProject) {
      setLoadError('');
      // Load task statuses from project file
      readProjectFile(openProject.folder).then(data => {
        setTaskStatuses(data.review_task_status || {});
      }).catch(() => { });
      refreshLists();
    } else {
      setPredictions([]);
      setReviewTasks([]);
      setTaskStatuses({});
    }
  }, [openProject, refreshKey, refreshLists]);

  const handleOpenProject = async () => {
    try {
      const folder = await selectFolder();
      if (!folder) return;
      setLoadError('');
      const data = await readProjectFile(folder);
      onProjectOpen(buildOpenProject(folder, data));
    } catch (e) {
      setLoadError('No valid Dipper project found in selected folder. Create a new project instead.');
    }
  };

  const handleWizardFinish = async () => {
    if (!wizardName.trim()) return;
    let parentFolder = wizardParentFolder;
    if (!parentFolder) {
      try { parentFolder = await getDocumentsDir(); } catch { return; }
    }
    const safeName = wizardName.trim().replace(/[/\\:*?"<>|]/g, '_');
    const projectFolder = `${parentFolder}/${safeName}`;
    await mkdirProject(projectFolder);
    const data = {
      version: 1,
      name: wizardName.trim(),
      classifier: wizardClassifier,
      species_filter: { selected_species: wizardSpeciesFilter.selected_species || [] },
      review_task_status: {},
    };
    await writeProjectFile(projectFolder, data);
    setWizardOpen(false);
    onProjectOpen(buildOpenProject(projectFolder, data));
  };

  const handleStatusChange = async (filename, status) => {
    const next = { ...taskStatuses, [filename]: status };
    setTaskStatuses(next);
    // Persist to project file
    try {
      const data = await readProjectFile(openProject.folder);
      await writeProjectFile(openProject.folder, { ...data, review_task_status: next });
    } catch (e) { console.error('Failed to save status:', e); }
  };

  const handleOpenReviewTask = (filePath) => {
    onOpenReviewTask({ path: filePath, ts: Date.now() });
  };

  const sectionStyle = { marginBottom: 24 };
  const sectionHeaderStyle = { fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const fileRowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' };
  const fileNameStyle = { flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h2 style={{ marginTop: 0, color: 'var(--text-primary)' }}>Project</h2>

      {/* Project open/create controls */}
      {!openProject ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={handleOpenProject} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FolderOpenIcon fontSize="small" /> Open Project
          </button>
          <button onClick={async () => {
            setWizardStep(0); setWizardName(''); setWizardClassifier('Perch2'); setWizardSpeciesFilter({ selected_species: [] });
            try { setWizardParentFolder(await getDocumentsDir()); } catch { setWizardParentFolder(''); }
            setWizardOpen(true);
          }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AddIcon fontSize="small" /> New Project
          </button>
          {loadError && <div style={{ color: 'var(--alert)', fontSize: '0.85rem', alignSelf: 'center' }}>{loadError}</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20, padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>{openProject.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', marginTop: 2 }}>{openProject.folder}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', marginTop: 2 }}>
              Classifier: <strong>{openProject.classifier}</strong>
              {openProject.species_filter?.selected_species?.length > 0 && (
                <span> · {openProject.species_filter.selected_species.length} species</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button-secondary" onClick={() => setRefreshKey(k => k + 1)}>Refresh</button>
            <button className="button-clear" onClick={onProjectClose}>Close Project</button>
          </div>
        </div>
      )}

      {openProject && (
        <>
          {/* Classifier Predictions */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <span>Classifier Predictions ({predictions.length})</span>
            </div>
            {predictions.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--medium-gray)' }}>No prediction files yet. Run an inference job to populate this list.</div>
            ) : (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 4, overflow: 'hidden' }}>
                {predictions.map(f => (
                  <div key={f.id} style={fileRowStyle}>
                    <span style={fileNameStyle} title={f.id}>{f.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Review Tasks */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <span>Review Tasks ({reviewTasks.length})</span>
            </div>
            {reviewTasks.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--medium-gray)' }}>No review tasks yet. Run an extraction job to populate this list.</div>
            ) : (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 4, overflow: 'hidden' }}>
                {reviewTasks.map(f => {
                  const filename = f.value;
                  const status = taskStatuses[filename] || 'unstarted';
                  return (
                    <div key={f.id} style={fileRowStyle}>
                      <span style={fileNameStyle} title={f.id}>{filename}</span>
                      <FormControl size="small" sx={{ minWidth: 120 }}>
                        <Select
                          value={status}
                          onChange={e => handleStatusChange(filename, e.target.value)}
                          sx={{ fontSize: '0.78rem', color: STATUS_COLORS[status] }}
                        >
                          {STATUS_OPTIONS.map(s => (
                            <MenuItem key={s} value={s} sx={{ fontSize: '0.78rem', color: STATUS_COLORS[s] }}>{s.replace('_', ' ')}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <button className="button-secondary" style={{ fontSize: '0.78rem', padding: '3px 10px', whiteSpace: 'nowrap' }}
                        onClick={() => handleOpenReviewTask(f.id)}>
                        Open in Review
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* New Project Wizard */}
      <Dialog open={wizardOpen} onClose={() => setWizardOpen(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx: { width: '95vw', maxWidth: '95vw' } }}>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <Stepper activeStep={wizardStep} sx={{
            mb: 3, mt: 1,
            '& .MuiStepLabel-label': { color: 'var(--text-primary)' },
            '& .MuiStepLabel-label.Mui-active': { color: 'var(--text-primary)', fontWeight: 600 },
            '& .MuiStepLabel-label.Mui-completed': { color: 'var(--text-primary)' },
          }}>
            <Step><StepLabel>Name &amp; Folder</StepLabel></Step>
            <Step><StepLabel>Classifier</StepLabel></Step>
            <Step><StepLabel>Species Filter</StepLabel></Step>
          </Stepper>

          {wizardStep === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Project Name</label>
                <input type="text" value={wizardName} onChange={e => setWizardName(e.target.value)}
                  placeholder="e.g. Marsh Bird Survey 2026" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Project Location</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" onClick={async () => { const f = await selectFolder(); if (f) setWizardParentFolder(f); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CreateNewFolderIcon fontSize="small" /> Set Project Location
                  </button>
                  <span style={{ fontSize: '0.85rem', color: 'var(--medium-gray)' }}>{wizardParentFolder || '(Documents)'}</span>
                </div>
                {wizardName.trim() && wizardParentFolder && (
                  <div style={{ marginTop: 6, fontSize: '0.82rem', color: 'var(--medium-gray)', fontFamily: 'monospace' }}>
                    Will create: {wizardParentFolder}/{wizardName.trim().replace(/[/\\:*?"<>|]/g, '_')}
                  </div>
                )}
                <small style={{ color: 'var(--medium-gray)' }}>A new folder named after the project will be created here. Defaults to your Documents folder.</small>
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Classifier</label>
              <FormControl size="small" sx={{ mt: 0.5, minWidth: 320 }}>
                <Select value={wizardClassifier} onChange={e => setWizardClassifier(e.target.value)}>
                  {CLASSIFIERS.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </div>
          )}

          {wizardStep === 2 && (
            <SpeciesFilterPanel
              model={wizardClassifier}
              speciesFilter={wizardSpeciesFilter}
              onChange={setWizardSpeciesFilter}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWizardOpen(false)}>Cancel</Button>
          {wizardStep > 0 && <Button onClick={() => setWizardStep(s => s - 1)}>Back</Button>}
          {wizardStep < 2 && (
            <Button variant="contained" onClick={() => setWizardStep(s => s + 1)}
              disabled={wizardStep === 0 && !wizardName.trim()}>
              Next
            </Button>
          )}
          {wizardStep === 2 && (
            <Button variant="contained" onClick={handleWizardFinish}>
              Create Project
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </div>
  );
}
