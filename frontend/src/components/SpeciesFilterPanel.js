import React, { useState, useCallback, useEffect, useRef } from 'react';
import { basename } from 'pathe';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { saveFile, selectTextFiles, writeFile, readFile } from '../utils/fileOperations';
import { getBackendUrl } from '../utils/backendConfig';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Which field in a species object is the class label string for each classifier
export const MODEL_CLASS_COL = {
  "BirdNET": "composite",
  "Perch": "ebird_code",
  "Perch2": "scientific_name",
  "Perch2LiteRT": "scientific_name",
  "Perch2ONNX": "scientific_name",
  "BirdSetConvNeXT": "ebird_code",
  "BirdSetEfficientNetB1": "ebird_code",
  "HawkEars": "common_name",
  "HawkEars_Low_Band": "common_name",
};

export function flattenSpeciesForConfig(selected_species, model) {
  const col = MODEL_CLASS_COL[model] || 'scientific_name';
  return selected_species.map(s => s[col] || s.scientific_name);
}

/**
 * SpeciesFilterPanel — full geo-filter + dual-panel species selection UI.
 *
 * Props:
 *   model            {string}   — classifier key (e.g. 'HawkEars')
 *   speciesFilter    {object}   — { enabled, selected_species }
 *   onChange         {fn}       — called with updated speciesFilter object
 *   readOnly         {bool}     — disables all interaction (for locked project classifiers)
 */
export default function SpeciesFilterPanel({ model, speciesFilter, onChange, readOnly = false }) {
  const [geoLat, setGeoLat] = useState('');
  const [geoLon, setGeoLon] = useState('');
  const [geoWeek, setGeoWeek] = useState(1);
  const [geoMinProb, setGeoMinProb] = useState(0.05);
  const [speciesLoading, setSpeciesLoading] = useState(false);
  const [speciesError, setSpeciesError] = useState('');
  const [classifierLabels, setClassifierLabels] = useState([]);
  const [geoFilteredClasses, setGeoFilteredClasses] = useState(null);
  const [availableSearch, setAvailableSearch] = useState('');
  const [selectedSearch, setSelectedSearch] = useState('');
  const [addSearchInput, setAddSearchInput] = useState('');
  const addSearchRef = useRef(null);

  const modelKeyField = MODEL_CLASS_COL[model] || 'scientific_name';

  const getSpeciesKey = (sp) => sp[modelKeyField] || sp.scientific_name || sp.common_name || sp.ebird_code || '';

  const updateFilter = (patch) => onChange({ ...speciesFilter, ...patch });

  useEffect(() => {
    setClassifierLabels([]);
    setGeoFilteredClasses(null);
    onChange({ ...speciesFilter, selected_species: [] });
    if (!model) return;
    let cancelled = false;
    getBackendUrl().then(backendUrl =>
      fetch(`${backendUrl}/geomodel/classifier_labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classifier: model }),
      })
    ).then(r => r.json()).then(result => {
      if (!cancelled && result.status === 'success') setClassifierLabels(result.labels);
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [model]); // eslint-disable-line

  const handleMapClick = useCallback((lat, lon) => {
    setGeoLat(lat.toFixed(5));
    setGeoLon(lon.toFixed(5));
  }, []);

  const handleLoadSpecies = async () => {
    const lat = parseFloat(geoLat);
    const lon = parseFloat(geoLon);
    const week = parseInt(geoWeek);
    if (isNaN(lat) || isNaN(lon) || isNaN(week)) {
      setSpeciesError('Please enter valid lat, lon, and week values.');
      return;
    }
    if (!model) { setSpeciesError('Selected model does not support species filtering.'); return; }
    setSpeciesLoading(true);
    setSpeciesError('');
    try {
      const backendUrl = await getBackendUrl();
      const response = await fetch(`${backendUrl}/geomodel/species_list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, week, min_probability: geoMinProb, classifier: model }),
      });
      const result = await response.json();
      if (result.status === 'success') setGeoFilteredClasses(result.species);
      else setSpeciesError(result.error || 'Failed to load species list.');
    } catch (err) {
      setSpeciesError('Error contacting backend: ' + err.message);
    } finally {
      setSpeciesLoading(false);
    }
  };

  const handleAddSpecies = (sp) => {
    if (!sp) return;
    const key = getSpeciesKey(sp);
    if (speciesFilter.selected_species.some(s => getSpeciesKey(s) === key)) { setAddSearchInput(''); return; }
    updateFilter({ selected_species: [sp, ...speciesFilter.selected_species] });
    setAddSearchInput('');
  };

  const handleRemoveSpecies = (key) => {
    updateFilter({ selected_species: speciesFilter.selected_species.filter(s => getSpeciesKey(s) !== key) });
  };

  const handleClearAllSpecies = () => updateFilter({ selected_species: [] });

  const handleSaveSpeciesList = async () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filePath = await saveFile(`species_list_${timestamp}.txt`);
      if (!filePath) return;
      const lines = speciesFilter.selected_species.map(s => getSpeciesKey(s)).join('\n');
      await writeFile(filePath, lines);
    } catch (err) { console.error('Failed to save species list: ' + err.message); }
  };

  const handleLoadSpeciesList = async () => {
    try {
      const files = await selectTextFiles();
      if (!files || files.length === 0) return;
      const content = await readFile(files[0]);
      const loaded = content.split('\n').map(l => l.trim()).filter(Boolean)
        .map(label => ({ ebird_code: '', scientific_name: '', common_name: '', [modelKeyField]: label, probability: null }));
      updateFilter({ selected_species: loaded });
      console.log(`Loaded ${loaded.length} species from ${basename(files[0])}`);
    } catch (err) { console.error('Failed to load species list: ' + err.message); }
  };

  const selectedKeys = new Set(speciesFilter.selected_species.map(s => getSpeciesKey(s)));
  const availablePool = geoFilteredClasses !== null ? geoFilteredClasses : classifierLabels;
  const searchLower = availableSearch.trim().toLowerCase();
  const availableFiltered = availablePool.filter(sp => {
    if (selectedKeys.has(getSpeciesKey(sp))) return false;
    if (!searchLower) return true;
    return ['ebird_code', 'scientific_name', 'common_name', 'alpha'].some(f => sp[f] && sp[f].toLowerCase().includes(searchLower));
  });
  const selSearchLower = selectedSearch.trim().toLowerCase();
  const selectedFiltered = speciesFilter.selected_species.filter(sp => {
    if (!selSearchLower) return true;
    return ['ebird_code', 'scientific_name', 'common_name', 'alpha'].some(f => sp[f] && sp[f].toLowerCase().includes(selSearchLower));
  });
  const allExtraCols = ['scientific_name', 'common_name', 'ebird_code', 'alpha'].filter(f => f !== modelKeyField);
  const hasExtraData = (pool) => allExtraCols.some(f => pool.some(sp => sp[f] && sp[f] !== sp[modelKeyField]));
  const availHasExtra = hasExtraData(availablePool);
  const selHasExtra = hasExtraData(speciesFilter.selected_species);

  const tableStyle = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.8rem' };
  const thStyle = { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap', background: 'var(--surface-secondary)', position: 'sticky', top: 0, boxShadow: 'inset 0 -1px 0 var(--border-color)' };
  const tdStyle = { padding: '3px 8px', borderTop: '1px solid var(--border-color)' };
  const panelStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: 4, overflow: 'hidden' };
  const colLabel = { scientific_name: 'Scientific Name', common_name: 'Common Name', ebird_code: 'eBird Code', alpha: 'Alpha' };
  const isItalic = (f) => f === 'scientific_name';

  const renderRow = (sp, onClick, showExtra, extraCols) => {
    const key = getSpeciesKey(sp);
    return (
      <tr key={key} style={{ cursor: readOnly ? 'default' : 'pointer' }}
        onClick={readOnly ? undefined : onClick}
        onMouseEnter={readOnly ? undefined : e => e.currentTarget.style.background = 'var(--hover-bg, #f0f0f0)'}
        onMouseLeave={readOnly ? undefined : e => e.currentTarget.style.background = ''}
      >
        <td style={{ ...tdStyle, fontStyle: isItalic(modelKeyField) ? 'italic' : 'normal' }}>{sp[modelKeyField] || '—'}</td>
        {showExtra && extraCols.map(f => (
          <td key={f} style={{ ...tdStyle, color: 'var(--medium-gray)', fontStyle: isItalic(f) ? 'italic' : 'normal' }}>
            {sp[f] && sp[f] !== sp[modelKeyField] ? sp[f] : '—'}
          </td>
        ))}
        {sp.probability != null && <td style={{ ...tdStyle, color: 'var(--medium-gray)', whiteSpace: 'nowrap' }}>{sp.probability.toFixed(3)}</td>}
      </tr>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Geo location picker */}
      {model ? (
        <>
          <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Load species list by location &amp; week</div>
          <div style={{ height: 220, maxWidth: '700px', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <MapContainer center={[geoLat || 40, geoLon || -95]} zoom={3} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              {!readOnly && <MapClickHandler onMapClick={handleMapClick} />}
              {geoLat !== '' && geoLon !== '' && <Marker position={[parseFloat(geoLat), parseFloat(geoLon)]} />}
            </MapContainer>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[
              { label: 'Latitude', value: geoLat, set: setGeoLat, min: -90, max: 90, step: 0.0001, placeholder: 'e.g. 40.71', width: 100 },
              { label: 'Longitude', value: geoLon, set: setGeoLon, min: -180, max: 180, step: 0.0001, placeholder: 'e.g. -74.01', width: 100 },
              { label: 'Week (1–52)', value: geoWeek, set: v => setGeoWeek(parseInt(v)), min: 1, max: 52, step: 1, width: 60 },
              { label: 'Min probability', value: geoMinProb, set: v => setGeoMinProb(parseFloat(v)), min: 0, max: 1, step: 0.01, width: 70 },
            ].map(({ label, value, set, ...rest }) => (
              <div key={label} className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>{label}</label>
                <input className="compact-input" type="number" value={value} onChange={e => set(e.target.value)} disabled={readOnly} style={{ width: rest.width }} {...{ min: rest.min, max: rest.max, step: rest.step, placeholder: rest.placeholder }} />
              </div>
            ))}
            {!readOnly && (
              <button type="button" onClick={handleLoadSpecies} disabled={speciesLoading} style={{ alignSelf: 'flex-end', marginBottom: 1 }}>
                {speciesLoading ? 'Loading…' : 'Get Species List'}
              </button>
            )}
          </div>
          {speciesError && <div style={{ fontSize: '0.8rem', color: 'var(--error-color, #c00)' }}>{speciesError}</div>}
        </>
      ) : (
        <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)' }}>Select a model to enable geo-based species filtering.</div>
      )}

      {/* Two-panel class list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!readOnly && (
          <div style={{ fontSize: '0.75rem', color: 'var(--medium-gray)', fontStyle: 'italic' }}>
            Tip: Save the selected list as a plain text file (one class per line), edit it, and reload with Load List.
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          {/* Available */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 4, minHeight: '1.6rem' }}>
              {geoFilteredClasses !== null && !readOnly && (
                <button type="button" className="button-secondary" style={{ fontSize: '0.8rem', padding: '2px 8px' }} onClick={() => setGeoFilteredClasses(null)}>Reset to All Classes</button>
              )}
            </div>
            <div style={{ ...panelStyle, flex: 1 }}>
              <div style={{ padding: '4px 8px', background: 'var(--surface-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  Available
                  {geoFilteredClasses !== null && <span style={{ fontWeight: 400, color: 'var(--medium-gray)', marginLeft: 6 }}>(geo-filtered to {geoFilteredClasses.length} species)</span>}
                </span>
                {!readOnly && (
                  <button type="button" className="button-secondary" style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => updateFilter({ selected_species: [...speciesFilter.selected_species, ...availableFiltered] })}
                    title="Add all visible available classes to selected">
                    Add All →
                  </button>
                )}
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                <div style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1, padding: '4px', borderBottom: '1px solid var(--border-color)' }}>
                  <input type="text" value={availableSearch} onChange={e => setAvailableSearch(e.target.value)} placeholder="Filter…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '3px 6px', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 3 }} />
                </div>
                <table style={tableStyle}>
                  {availHasExtra && <thead><tr><th style={thStyle}>{colLabel[modelKeyField]}</th>{allExtraCols.map(f => <th key={f} style={thStyle}>{colLabel[f]}</th>)}{availablePool.some(sp => sp.probability != null) && <th style={thStyle}>Prob.</th>}</tr></thead>}
                  <tbody>
                    {availableFiltered.map(sp => renderRow(sp, () => handleAddSpecies(sp), availHasExtra, allExtraCols))}
                    {availableFiltered.length === 0 && (
                      <tr><td colSpan={99} style={{ ...tdStyle, color: 'var(--medium-gray)' }}>
                        {availablePool.length === 0 ? 'No classes available — select a model or run geo filter' : 'All classes selected'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Selected */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 4, minHeight: '1.6rem' }}>
              {!readOnly && (
                <>
                  <button type="button" className="button-secondary" style={{ fontSize: '0.8rem', padding: '2px 8px' }} onClick={handleSaveSpeciesList}>Save List (.txt)</button>
                  <button type="button" className="button-secondary" style={{ fontSize: '0.8rem', padding: '2px 8px' }} onClick={handleLoadSpeciesList}>Load List (.txt)</button>
                </>
              )}
            </div>
            <div style={panelStyle}>
              <div style={{ padding: '4px 8px', background: 'var(--surface-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Selected ({speciesFilter.selected_species.length})</span>
                {!readOnly && (
                  <button type="button" className="button-clear" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={handleClearAllSpecies} title="Remove all selected classes">← Remove All</button>
                )}
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                <div style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1, padding: '4px', borderBottom: '1px solid var(--border-color)' }}>
                  <input type="text" value={selectedSearch} onChange={e => setSelectedSearch(e.target.value)} placeholder="Filter…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '3px 6px', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 3 }} />
                </div>
                <table style={tableStyle}>
                  {selHasExtra && <thead><tr><th style={thStyle}>{colLabel[modelKeyField]}</th>{allExtraCols.map(f => <th key={f} style={thStyle}>{colLabel[f]}</th>)}{speciesFilter.selected_species.some(sp => sp.probability != null) && <th style={thStyle}>Prob.</th>}</tr></thead>}
                  <tbody>
                    {selectedFiltered.map(sp => renderRow(sp, () => handleRemoveSpecies(getSpeciesKey(sp)), selHasExtra, allExtraCols))}
                    {selectedFiltered.length === 0 && (
                      <tr><td colSpan={99} style={{ ...tdStyle, color: 'var(--medium-gray)' }}>
                        {speciesFilter.selected_species.length === 0 ? 'No classes selected' : 'No matches'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Search-to-add */}
        {!readOnly && classifierLabels.length > 0 && (() => {
          const q = addSearchInput.trim().toLowerCase();
          const filtered = q.length > 0
            ? classifierLabels.filter(sp =>
              !selectedKeys.has(getSpeciesKey(sp)) &&
              ['common_name', 'scientific_name', 'ebird_code', 'alpha', modelKeyField].some(f => sp[f] && sp[f].toLowerCase().includes(q))
            ).slice(0, 50)
            : [];
          return (
            <div style={{ position: 'relative' }} ref={addSearchRef}>
              <input type="text" value={addSearchInput} onChange={e => setAddSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setAddSearchInput('');
                  if (e.key === 'Enter' && filtered.length > 0) { handleAddSpecies(filtered[0]); setAddSearchInput(''); }
                }}
                placeholder="Search full model class list to add…"
                style={{ width: '100%', maxWidth: 360, padding: '3px 6px', fontSize: '0.8rem' }}
              />
              {filtered.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 4, maxHeight: 200, overflowY: 'auto', width: '100%', maxWidth: 360, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                  {filtered.map(sp => {
                    const key = getSpeciesKey(sp);
                    const secondary = ['common_name', 'scientific_name', 'ebird_code'].filter(f => f !== modelKeyField && sp[f] && sp[f] !== sp[modelKeyField]);
                    return (
                      <div key={key} onClick={() => { handleAddSpecies(sp); setAddSearchInput(''); }}
                        style={{ padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, #f0f0f0)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <span style={{ fontStyle: isItalic(modelKeyField) ? 'italic' : 'normal' }}>{sp[modelKeyField]}</span>
                        {secondary.length > 0 && <span style={{ color: 'var(--medium-gray)', marginLeft: 6, fontSize: '0.75rem', fontStyle: isItalic(secondary[0]) ? 'italic' : 'normal' }}>{sp[secondary[0]]}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
