import { useState, useCallback, useRef, memo } from 'react';

/**
 * BoundingBoxOverlay - A simple overlay for drawing bounding boxes on spectrograms.
 *
 * Coordinates are stored in absolute time (seconds) and frequency (Hz) values,
 * matching the clip's start_time/end_time and frequency_range metadata.
 */
const BoundingBoxOverlay = memo(function BoundingBoxOverlay({
  boundingBox,           // Current bounding box: { start_time, end_time, low_freq, high_freq } or null
  onBoundingBoxChange,   // Callback when box changes
  timeRange,             // [start_time, end_time] in seconds
  frequencyRange,        // [low_freq, high_freq] in Hz
  disabled = false       // Disable drawing (e.g., during playback)
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentBox, setCurrentBox] = useState(null);
  const overlayRef = useRef(null);
  const didDragRef = useRef(false);  // Use ref so onClick can read synchronously

  // Convert pixel position to time/frequency coordinates
  const pixelToCoords = useCallback((pixelX, pixelY, rect) => {
    const [timeStart, timeEnd] = timeRange;
    const [freqLow, freqHigh] = frequencyRange;

    // X maps to time
    const time = timeStart + (pixelX / rect.width) * (timeEnd - timeStart);

    // Y maps to frequency (inverted: top = high freq)
    const freq = freqHigh - (pixelY / rect.height) * (freqHigh - freqLow);

    return { time, freq };
  }, [timeRange, frequencyRange]);

  // Convert time/frequency coordinates to pixel position
  const coordsToPixel = useCallback((time, freq, rect) => {
    const [timeStart, timeEnd] = timeRange;
    const [freqLow, freqHigh] = frequencyRange;

    const pixelX = ((time - timeStart) / (timeEnd - timeStart)) * rect.width;
    const pixelY = ((freqHigh - freq) / (freqHigh - freqLow)) * rect.height;

    return { x: pixelX, y: pixelY };
  }, [timeRange, frequencyRange]);

  const handleMouseDown = useCallback((e) => {
    if (disabled || !onBoundingBoxChange) return;

    // Only handle left mouse button
    if (e.button !== 0) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;

    const coords = pixelToCoords(pixelX, pixelY, rect);

    setIsDrawing(true);
    didDragRef.current = false;
    setDrawStart(coords);
    setCurrentBox({
      start_time: coords.time,
      end_time: coords.time,
      low_freq: coords.freq,
      high_freq: coords.freq
    });
  }, [disabled, onBoundingBoxChange, pixelToCoords]);

  const handleMouseMove = useCallback((e) => {
    if (!isDrawing || !drawStart) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const pixelX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pixelY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const coords = pixelToCoords(pixelX, pixelY, rect);

    // Mark that we've moved (dragged)
    didDragRef.current = true;

    // Calculate box with proper min/max for both axes
    setCurrentBox({
      start_time: Math.min(drawStart.time, coords.time),
      end_time: Math.max(drawStart.time, coords.time),
      low_freq: Math.min(drawStart.freq, coords.freq),
      high_freq: Math.max(drawStart.freq, coords.freq)
    });
  }, [isDrawing, drawStart, pixelToCoords]);

  const handleMouseUp = useCallback((e) => {
    if (!isDrawing) {
      return;
    }

    // If we didn't drag, let the click pass through to parent for audio playback
    if (!didDragRef.current) {
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentBox(null);
      return;
    }

    if (!currentBox) {
      setIsDrawing(false);
      setDrawStart(null);
      return;
    }

    // Only save if box has meaningful size (more than 2% of each dimension)
    const [timeStart, timeEnd] = timeRange;
    const [freqLow, freqHigh] = frequencyRange;
    const timeSpan = timeEnd - timeStart;
    const freqSpan = freqHigh - freqLow;

    const boxTimeSpan = currentBox.end_time - currentBox.start_time;
    const boxFreqSpan = currentBox.high_freq - currentBox.low_freq;

    if (boxTimeSpan > timeSpan * 0.02 && boxFreqSpan > freqSpan * 0.02) {
      // Round to reasonable precision
      const roundedBox = {
        start_time: Math.round(currentBox.start_time * 1000) / 1000,
        end_time: Math.round(currentBox.end_time * 1000) / 1000,
        low_freq: Math.round(currentBox.low_freq),
        high_freq: Math.round(currentBox.high_freq)
      };
      onBoundingBoxChange(roundedBox);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBox(null);
  }, [isDrawing, currentBox, timeRange, frequencyRange, onBoundingBoxChange]);

  // Handle click - stop propagation if we just finished dragging
  const handleClick = useCallback((e) => {
    if (didDragRef.current) {
      e.stopPropagation();
      didDragRef.current = false;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (isDrawing) {
      // Cancel drawing if mouse leaves overlay
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentBox(null);
      didDragRef.current = false;
    }
  }, [isDrawing]);

  // Clear box on double-click
  const handleDoubleClick = useCallback((e) => {
    if (disabled || !onBoundingBoxChange) return;

    e.preventDefault();
    e.stopPropagation();
    onBoundingBoxChange(null);
  }, [disabled, onBoundingBoxChange]);

  // Calculate display box (either saved box or current drawing)
  const displayBox = currentBox || boundingBox;

  // Calculate pixel coordinates for display
  const getBoxStyle = useCallback(() => {
    if (!displayBox || !overlayRef.current) return null;

    const rect = overlayRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const topLeft = coordsToPixel(displayBox.start_time, displayBox.high_freq, rect);
    const bottomRight = coordsToPixel(displayBox.end_time, displayBox.low_freq, rect);

    return {
      left: `${topLeft.x}px`,
      top: `${topLeft.y}px`,
      width: `${bottomRight.x - topLeft.x}px`,
      height: `${bottomRight.y - topLeft.y}px`
    };
  }, [displayBox, coordsToPixel]);

  const boxStyle = getBoxStyle();

  return (
    <div
      ref={overlayRef}
      className="bounding-box-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        cursor: disabled ? 'default' : 'crosshair',
        zIndex: 10
      }}
    >
      {boxStyle && (
        <div
          className={`bounding-box ${isDrawing ? 'drawing' : 'saved'}`}
          style={{
            position: 'absolute',
            ...boxStyle,
            border: '2px solid #00ff00',
            backgroundColor: isDrawing ? 'rgba(0, 255, 0, 0.1)' : 'rgba(0, 255, 0, 0.15)',
            pointerEvents: 'none',
            boxSizing: 'border-box'
          }}
        />
      )}
    </div>
  );
});

export default BoundingBoxOverlay;
