import { useState, useCallback, useRef, memo, useEffect } from 'react';

/**
 * BoundingBoxOverlay - An overlay for drawing and editing bounding boxes on spectrograms.
 *
 * Coordinates are stored in absolute time (seconds) and frequency (Hz) values,
 * matching the clip's start_time/end_time and frequency_range metadata.
 *
 * Features:
 * - Click and drag to draw a new box
 * - Drag edges or corners of existing box to resize
 * - Double-click to clear box
 * - Click without drag passes through to parent for audio playback
 */

const HANDLE_SIZE = 8; // Size of corner/edge handles in pixels
const EDGE_THRESHOLD = 10; // Distance from edge to trigger resize cursor

const BoundingBoxOverlay = memo(function BoundingBoxOverlay({
  boundingBox,           // Current bounding box: { start_time, end_time, low_freq, high_freq } or null
  onBoundingBoxChange,   // Callback when box changes
  timeRange,             // [start_time, end_time] in seconds
  frequencyRange,        // [low_freq, high_freq] in Hz
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null); // Which handle is being dragged
  const [drawStart, setDrawStart] = useState(null);
  const [currentBox, setCurrentBox] = useState(null);
  const [hoverHandle, setHoverHandle] = useState(null); // For cursor feedback
  const [overlayReady, setOverlayReady] = useState(false); // Track when overlay has rendered
  const overlayRef = useRef(null);
  const didDragRef = useRef(false);

  // Trigger re-render after mount to ensure getBoundingClientRect returns valid dimensions
  useEffect(() => {
    if (overlayRef.current) {
      // Use requestAnimationFrame to wait for layout to complete
      requestAnimationFrame(() => {
        setOverlayReady(true);
      });
    }
  }, []);

  // Convert pixel position to time/frequency coordinates
  const pixelToCoords = useCallback((pixelX, pixelY, rect) => {
    const [timeStart, timeEnd] = timeRange;
    const [freqLow, freqHigh] = frequencyRange;

    const time = timeStart + (pixelX / rect.width) * (timeEnd - timeStart);
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

  // Determine which handle (if any) is at a given pixel position
  const getHandleAtPosition = useCallback((pixelX, pixelY, box, rect) => {
    if (!box) return null;

    const topLeft = coordsToPixel(box.start_time, box.high_freq, rect);
    const bottomRight = coordsToPixel(box.end_time, box.low_freq, rect);

    const left = topLeft.x;
    const top = topLeft.y;
    const right = bottomRight.x;
    const bottom = bottomRight.y;

    // Check corners first (they take priority)
    // Top-left
    if (Math.abs(pixelX - left) < EDGE_THRESHOLD && Math.abs(pixelY - top) < EDGE_THRESHOLD) {
      return 'nw';
    }
    // Top-right
    if (Math.abs(pixelX - right) < EDGE_THRESHOLD && Math.abs(pixelY - top) < EDGE_THRESHOLD) {
      return 'ne';
    }
    // Bottom-left
    if (Math.abs(pixelX - left) < EDGE_THRESHOLD && Math.abs(pixelY - bottom) < EDGE_THRESHOLD) {
      return 'sw';
    }
    // Bottom-right
    if (Math.abs(pixelX - right) < EDGE_THRESHOLD && Math.abs(pixelY - bottom) < EDGE_THRESHOLD) {
      return 'se';
    }

    // Check edges
    // Left edge
    if (Math.abs(pixelX - left) < EDGE_THRESHOLD && pixelY > top && pixelY < bottom) {
      return 'w';
    }
    // Right edge
    if (Math.abs(pixelX - right) < EDGE_THRESHOLD && pixelY > top && pixelY < bottom) {
      return 'e';
    }
    // Top edge
    if (Math.abs(pixelY - top) < EDGE_THRESHOLD && pixelX > left && pixelX < right) {
      return 'n';
    }
    // Bottom edge
    if (Math.abs(pixelY - bottom) < EDGE_THRESHOLD && pixelX > left && pixelX < right) {
      return 's';
    }

    return null;
  }, [coordsToPixel]);

  // Get cursor style based on handle
  const getCursor = useCallback((handle) => {
    if (!handle) return 'crosshair';
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nwse-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      default:
        return 'crosshair';
    }
  }, []);

  // Handle mouse move for hover cursor feedback
  const handleMouseMove = useCallback((e) => {
    if (isDrawing || isResizing) return;
    if (!boundingBox || !overlayRef.current) {
      setHoverHandle(null);
      return;
    }

    const rect = overlayRef.current.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;

    const handle = getHandleAtPosition(pixelX, pixelY, boundingBox, rect);
    setHoverHandle(handle);
  }, [boundingBox, isDrawing, isResizing, getHandleAtPosition]);

  const handleMouseDown = useCallback((e) => {
    if (!onBoundingBoxChange) return;
    if (e.button !== 0) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;

    // Check if clicking on a resize handle
    if (boundingBox) {
      const handle = getHandleAtPosition(pixelX, pixelY, boundingBox, rect);
      if (handle) {
        // Start resizing
        setIsResizing(true);
        setResizeHandle(handle);
        setCurrentBox({ ...boundingBox });
        didDragRef.current = false;
        return;
      }
    }

    // Start drawing a new box
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
  }, [onBoundingBoxChange, boundingBox, getHandleAtPosition, pixelToCoords]);

  // Handle click - stop propagation if we just finished dragging/resizing
  const handleClick = useCallback((e) => {
    if (didDragRef.current) {
      e.stopPropagation();
      didDragRef.current = false;
    }
  }, []);

  // Document-level listeners for drawing
  useEffect(() => {
    if (!isDrawing) return;

    const handleDocumentMouseMove = (e) => {
      if (!drawStart || !overlayRef.current) return;

      const rect = overlayRef.current.getBoundingClientRect();
      const pixelX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const pixelY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

      const coords = pixelToCoords(pixelX, pixelY, rect);
      didDragRef.current = true;

      setCurrentBox({
        start_time: Math.min(drawStart.time, coords.time),
        end_time: Math.max(drawStart.time, coords.time),
        low_freq: Math.min(drawStart.freq, coords.freq),
        high_freq: Math.max(drawStart.freq, coords.freq)
      });
    };

    const handleDocumentMouseUp = () => {
      if (!didDragRef.current) {
        setIsDrawing(false);
        setDrawStart(null);
        setCurrentBox(null);
        return;
      }

      if (currentBox) {
        const [timeStart, timeEnd] = timeRange;
        const [freqLow, freqHigh] = frequencyRange;
        const timeSpan = timeEnd - timeStart;
        const freqSpan = freqHigh - freqLow;

        const boxTimeSpan = currentBox.end_time - currentBox.start_time;
        const boxFreqSpan = currentBox.high_freq - currentBox.low_freq;

        if (boxTimeSpan > timeSpan * 0.02 && boxFreqSpan > freqSpan * 0.02) {
          const roundedBox = {
            start_time: Math.round(currentBox.start_time * 1000) / 1000,
            end_time: Math.round(currentBox.end_time * 1000) / 1000,
            low_freq: Math.round(currentBox.low_freq),
            high_freq: Math.round(currentBox.high_freq)
          };
          onBoundingBoxChange(roundedBox);
        }
      }

      setIsDrawing(false);
      setDrawStart(null);
      setCurrentBox(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isDrawing, drawStart, currentBox, timeRange, frequencyRange, pixelToCoords, onBoundingBoxChange]);

  // Document-level listeners for resizing
  useEffect(() => {
    if (!isResizing || !resizeHandle || !currentBox) return;

    const handleDocumentMouseMove = (e) => {
      if (!overlayRef.current) return;

      const rect = overlayRef.current.getBoundingClientRect();
      const pixelX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const pixelY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

      const coords = pixelToCoords(pixelX, pixelY, rect);
      didDragRef.current = true;

      setCurrentBox(prev => {
        if (!prev) return prev;
        const newBox = { ...prev };

        // Update the appropriate edges based on which handle is being dragged
        switch (resizeHandle) {
          case 'nw':
            newBox.start_time = Math.min(coords.time, prev.end_time - 0.01);
            newBox.high_freq = Math.max(coords.freq, prev.low_freq + 1);
            break;
          case 'ne':
            newBox.end_time = Math.max(coords.time, prev.start_time + 0.01);
            newBox.high_freq = Math.max(coords.freq, prev.low_freq + 1);
            break;
          case 'sw':
            newBox.start_time = Math.min(coords.time, prev.end_time - 0.01);
            newBox.low_freq = Math.min(coords.freq, prev.high_freq - 1);
            break;
          case 'se':
            newBox.end_time = Math.max(coords.time, prev.start_time + 0.01);
            newBox.low_freq = Math.min(coords.freq, prev.high_freq - 1);
            break;
          case 'n':
            newBox.high_freq = Math.max(coords.freq, prev.low_freq + 1);
            break;
          case 's':
            newBox.low_freq = Math.min(coords.freq, prev.high_freq - 1);
            break;
          case 'e':
            newBox.end_time = Math.max(coords.time, prev.start_time + 0.01);
            break;
          case 'w':
            newBox.start_time = Math.min(coords.time, prev.end_time - 0.01);
            break;
          default:
            break;
        }

        return newBox;
      });
    };

    const handleDocumentMouseUp = () => {
      if (didDragRef.current && currentBox) {
        const roundedBox = {
          start_time: Math.round(currentBox.start_time * 1000) / 1000,
          end_time: Math.round(currentBox.end_time * 1000) / 1000,
          low_freq: Math.round(currentBox.low_freq),
          high_freq: Math.round(currentBox.high_freq)
        };
        onBoundingBoxChange(roundedBox);
      }

      setIsResizing(false);
      setResizeHandle(null);
      setCurrentBox(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isResizing, resizeHandle, currentBox, pixelToCoords, onBoundingBoxChange]);

  // Clear box on double-click
  const handleDoubleClick = useCallback((e) => {
    if (!onBoundingBoxChange) return;

    e.preventDefault();
    e.stopPropagation();
    onBoundingBoxChange(null);
  }, [onBoundingBoxChange]);

  // Calculate display box (either current editing or saved)
  const displayBox = currentBox || boundingBox;

  // Calculate pixel coordinates for display
  // Include overlayReady in deps to recalculate after mount when dimensions are available
  const getBoxStyle = useCallback(() => {
    if (!displayBox || !overlayRef.current || !overlayReady) return null;

    const rect = overlayRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const topLeft = coordsToPixel(displayBox.start_time, displayBox.high_freq, rect);
    const bottomRight = coordsToPixel(displayBox.end_time, displayBox.low_freq, rect);

    return {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }, [displayBox, coordsToPixel, overlayReady]);

  const boxStyle = getBoxStyle();

  // Determine cursor based on hover state or active operation
  const cursor = isDrawing ? 'crosshair' : isResizing ? getCursor(resizeHandle) : getCursor(hoverHandle);

  return (
    <div
      ref={overlayRef}
      className="bounding-box-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        cursor: cursor,
        zIndex: 10
      }}
    >
      {boxStyle && (
        <>
          {/* Main bounding box */}
          <div
            className={`bounding-box ${isDrawing || isResizing ? 'drawing' : 'saved'}`}
            style={{
              position: 'absolute',
              left: `${boxStyle.left}px`,
              top: `${boxStyle.top}px`,
              width: `${boxStyle.width}px`,
              height: `${boxStyle.height}px`,
              border: '2px solid #4f5d75',
              backgroundColor: (isDrawing || isResizing) ? 'rgba(79, 93, 117, 0.15)' : 'rgba(79, 93, 117, 0.2)',
              pointerEvents: 'none',
              boxSizing: 'border-box',
              borderRadius: '2px'
            }}
          />
        </>
      )}
    </div>
  );
});

export default BoundingBoxOverlay;
