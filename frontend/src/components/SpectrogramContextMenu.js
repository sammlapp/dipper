import { useEffect, useRef } from 'react';

/**
 * Right-click context menu for spectrogram / audio widgets.
 * Props:
 *   x, y              – page coordinates where the menu should appear
 *   onClose           – called when the menu should dismiss
 *   filePath          – raw path from CSV (may be relative)
 *   audioRootPath     – root audio folder to prepend if filePath is relative
 *   audioBase64       – base64 WAV string (may be null)
 *   spectrogramBase64 – base64 PNG string (may be null)
 *   clipLabel         – short label used in download filenames
 *   isDesktop         – true when running in Tauri desktop mode
 */
function SpectrogramContextMenu({ x, y, onClose, filePath, audioRootPath, audioBase64, spectrogramBase64, clipLabel, isDesktop }) {
  const menuRef = useRef(null);

  // Resolve absolute path: prepend root only if path is relative
  const absolutePath = (() => {
    if (!filePath) return '';
    const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(filePath);
    if (!isAbsolute && audioRootPath) {
      return `${audioRootPath}/${filePath}`;
    }
    return filePath;
  })();

  // Close on outside click or Escape
  useEffect(() => {
    const handleDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const menuStyle = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
    background: 'var(--panel-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: '7px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
    padding: '4px 0',
    minWidth: '210px',
    fontFamily: 'var(--app-font)',
    fontSize: '0.88rem',
  };

  const itemStyle = (disabled) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 14px',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--border-color)' : 'var(--text-primary)',
    background: 'none',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  });

  const handleCopyPath = async () => {
    if (!absolutePath) return;
    try {
      await navigator.clipboard.writeText(absolutePath);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = absolutePath;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    onClose();
  };

  const handleDownloadAudio = () => {
    if (!audioBase64) return;
    const a = document.createElement('a');
    a.href = `data:audio/wav;base64,${audioBase64}`;
    a.download = `${clipLabel || 'clip'}.wav`;
    a.click();
    onClose();
  };

  const handleDownloadSpectrogram = () => {
    if (!spectrogramBase64) return;
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${spectrogramBase64}`;
    a.download = `${clipLabel || 'clip'}.png`;
    a.click();
    onClose();
  };

  const handleOpenFile = async () => {
    if (!absolutePath) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_file', { filePath: absolutePath });
    } catch (err) {
      console.error('Failed to open file:', err);
    }
    onClose();
  };

  const items = [
    {
      icon: '📋',
      label: 'Copy audio file path',
      disabled: !absolutePath,
      onClick: handleCopyPath,
    },
    {
      icon: '🔊',
      label: 'Download audio clip',
      disabled: !audioBase64,
      onClick: handleDownloadAudio,
    },
    {
      icon: '🖼',
      label: 'Download spectrogram',
      disabled: !spectrogramBase64,
      onClick: handleDownloadSpectrogram,
    },
    ...(isDesktop ? [{
      icon: '📂',
      label: 'Open file',
      disabled: !absolutePath,
      onClick: handleOpenFile,
    }] : []),
  ];

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <button
          key={i}
          style={itemStyle(item.disabled)}
          disabled={item.disabled}
          onClick={item.disabled ? undefined : item.onClick}
          onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = 'var(--light-gray, #f3f3f3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default SpectrogramContextMenu;
