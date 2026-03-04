import { useRef, useEffect } from 'react';

/**
 * Canvas-based overlay for rendering bounding boxes on spectrograms.
 * Handles drawing the box and resize handles.
 */
function BboxOverlay({
  currentBbox,
  coordinatesToPixel,
  getSpectrogramDimensions,
  isDrawing,
  editingHandle
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dims = getSpectrogramDimensions();
    if (!dims) return;

    const ctx = canvas.getContext('2d');

    // Set canvas size to match container (with device pixel ratio for sharpness)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.rect.width * dpr;
    canvas.height = dims.rect.height * dpr;
    canvas.style.width = `${dims.rect.width}px`;
    canvas.style.height = `${dims.rect.height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, dims.rect.width, dims.rect.height);

    if (!currentBbox) return;

    // Convert bbox coordinates to pixels
    const topLeft = coordinatesToPixel(currentBbox.start_time, currentBbox.high_freq);
    const bottomRight = coordinatesToPixel(currentBbox.end_time, currentBbox.low_freq);

    if (!topLeft || !bottomRight) return;

    const x = topLeft.x;
    const y = topLeft.y;
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    // Draw semi-transparent fill
    ctx.fillStyle = isDrawing ? 'rgba(0, 255, 0, 0.1)' : 'rgba(255, 102, 0, 0.1)';
    ctx.fillRect(x, y, width, height);

    // Draw bbox rectangle border
    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ff6600';
    ctx.lineWidth = 2;
    ctx.setLineDash(isDrawing ? [5, 5] : []);
    ctx.strokeRect(x, y, width, height);

    // Draw resize handles if not currently drawing
    if (!isDrawing) {
      const handleSize = 8;
      ctx.fillStyle = '#ff6600';
      ctx.setLineDash([]);

      // Define handle positions: corners and edge midpoints
      const handles = [
        // Corners
        { x: x, y: y, cursor: 'nw-resize' },
        { x: x + width, y: y, cursor: 'ne-resize' },
        { x: x, y: y + height, cursor: 'sw-resize' },
        { x: x + width, y: y + height, cursor: 'se-resize' },
        // Edge midpoints
        { x: x + width / 2, y: y, cursor: 'n-resize' },
        { x: x + width / 2, y: y + height, cursor: 's-resize' },
        { x: x, y: y + height / 2, cursor: 'w-resize' },
        { x: x + width, y: y + height / 2, cursor: 'e-resize' }
      ];

      handles.forEach(handle => {
        // Draw handle background (white for contrast)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(
          handle.x - handleSize / 2 - 1,
          handle.y - handleSize / 2 - 1,
          handleSize + 2,
          handleSize + 2
        );
        // Draw handle fill
        ctx.fillStyle = '#ff6600';
        ctx.fillRect(
          handle.x - handleSize / 2,
          handle.y - handleSize / 2,
          handleSize,
          handleSize
        );
      });
    }

    // Draw time/frequency labels near the box corners
    if (!isDrawing && currentBbox) {
      ctx.font = '11px Rokkitt, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;

      // Top-left label (time start, freq high)
      const label1 = `${currentBbox.start_time.toFixed(2)}s, ${currentBbox.high_freq.toFixed(0)}Hz`;
      ctx.strokeText(label1, x + 4, y - 4);
      ctx.fillText(label1, x + 4, y - 4);

      // Bottom-right label (time end, freq low)
      const label2 = `${currentBbox.end_time.toFixed(2)}s, ${currentBbox.low_freq.toFixed(0)}Hz`;
      const textWidth = ctx.measureText(label2).width;
      ctx.strokeText(label2, x + width - textWidth - 4, y + height + 14);
      ctx.fillText(label2, x + width - textWidth - 4, y + height + 14);
    }

  }, [currentBbox, coordinatesToPixel, getSpectrogramDimensions, isDrawing, editingHandle]);

  return (
    <canvas
      ref={canvasRef}
      className="focus-bbox-canvas"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}
    />
  );
}

export default BboxOverlay;
