import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  Chip,
  Stack
} from '@mui/material';
import {
  DEFAULT_POLYGON_POINTS,
  MIN_POLYGON_POINTS,
  MAX_POLYGON_POINTS,
  normalizeIgnoreZones,
  buildIgnoreZonePayload,
  ignoreZoneFromBirdBox,
  maxIgnoreZonesFromBirdBoxes,
  maxIgnoreZonesFromZones,
  updatePointAtIndex,
  insertPointOnEdge,
  removePointAtIndex,
  hitTestVertexIndex,
  hitTestEdge
} from '../utils/ignoreZone';

const updatePt = updatePointAtIndex;
const insertPt = insertPointOnEdge;
const removePt = removePointAtIndex;
const hitVertex = hitTestVertexIndex;
const hitEdge = hitTestEdge;

const HANDLE_SIZE = 12;
const SELECTED_HANDLE_SIZE = 14;
const VERTEX_HIT_PX = 20;
const EDGE_HIT_PX = 14;
const ZONE_FILL = 'rgba(244, 67, 54, 0.28)';
const ZONE_STROKE = 'rgba(198, 40, 40, 0.95)';

function seedPoints() {
  return DEFAULT_POLYGON_POINTS.map((p) => ({ ...p }));
}

/**
 * Edit ignore zones for one route point. Zones are polygons in normalized 0–1 image space.
 * Optional birdBoxes: [{ label, bird, imageSize }] for one-click zone-from-detection.
 */
const IgnoreZoneEditor = ({
  open,
  onClose,
  image,
  ignoreZones,
  routePointIndex,
  birdBoxes = [],
  onSave
}) => {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [zones, setZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState(0);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const dragRef = useRef(null);

  const points = zones[selectedZone]?.points || seedPoints();

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeIgnoreZones(ignoreZones);
    if (normalized.length) {
      setZones(normalized.map((z) => ({ points: z.points.map((p) => ({ ...p })) })));
      setSelectedZone(0);
    } else {
      setZones([{ points: seedPoints() }]);
      setSelectedZone(0);
    }
    setSelectedIndex(null);
  }, [open, ignoreZones]);

  const getCanvasBounds = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    return bounds;
  }, []);

  const clientToNormRaw = useCallback((clientX, clientY) => {
    const bounds = getCanvasBounds();
    if (!bounds) return null;
    return {
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height
    };
  }, [getCanvasBounds]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingIndex(null);
    const canvas = canvasRef.current;
    if (canvas && drag?.pointerId != null && canvas.hasPointerCapture(drag.pointerId)) {
      try {
        canvas.releasePointerCapture(drag.pointerId);
      } catch {
        // ignore
      }
    }
  }, []);

  const setPointsForSelected = useCallback((nextPoints) => {
    setZones((prev) => {
      const copy = prev.map((z) => ({ points: z.points.map((p) => ({ ...p })) }));
      if (!copy[selectedZone]) return prev;
      copy[selectedZone].points = nextPoints;
      return copy;
    });
  }, [selectedZone]);

  const measureLayout = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.complete || img.naturalWidth === 0) return;
    const aspect = img.naturalWidth / img.naturalHeight;
    let width = container.clientWidth;
    let height = width / aspect;
    const maxHeight = 480;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    setLayout({ width, height });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(measureLayout, 50);
    window.addEventListener('resize', measureLayout);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measureLayout);
    };
  }, [open, image, measureLayout]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || layout.width === 0) return;
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toPx = (nx, ny) => ({ x: nx * canvas.width, y: ny * canvas.height });

    zones.forEach((zone, zi) => {
      const pts = zone.points || [];
      if (pts.length < MIN_POLYGON_POINTS) return;
      ctx.beginPath();
      pts.forEach((point, index) => {
        const p = toPx(point.x, point.y);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = zi === selectedZone ? ZONE_FILL : 'rgba(244, 67, 54, 0.12)';
      ctx.fill();
      ctx.strokeStyle = ZONE_STROKE;
      ctx.lineWidth = zi === selectedZone ? 2.5 : 1.5;
      ctx.stroke();
    });

    const active = zones[selectedZone]?.points || [];
    active.forEach((point, index) => {
      const p = toPx(point.x, point.y);
      const isSelected = index === selectedIndex || index === draggingIndex;
      const size = isSelected ? SELECTED_HANDLE_SIZE : HANDLE_SIZE;
      const half = size / 2;
      ctx.fillStyle = isSelected ? '#ffcdd2' : '#fff';
      ctx.strokeStyle = ZONE_STROKE;
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.fillRect(p.x - half, p.y - half, size, size);
      ctx.strokeRect(p.x - half, p.y - half, size, size);
    });
  }, [zones, selectedZone, layout, selectedIndex, draggingIndex]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointIndex == null) return;
      const norm = clientToNormRaw(event.clientX, event.clientY);
      if (!norm) return;
      setPointsForSelected(updatePt(points, drag.pointIndex, norm.x, norm.y));
    };
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [clientToNormRaw, endDrag, points, setPointsForSelected]);

  const handlePointerDown = (event) => {
    const bounds = getCanvasBounds();
    if (!bounds) return;
    const vertexIndex = hitVertex(points, bounds, event.clientX, event.clientY, VERTEX_HIT_PX);
    if (vertexIndex >= 0) {
      if (event.button === 2) {
        event.preventDefault();
        setPointsForSelected(removePt(points, vertexIndex));
        setSelectedIndex(null);
        return;
      }
      dragRef.current = { pointIndex: vertexIndex, pointerId: event.pointerId };
      setDraggingIndex(vertexIndex);
      setSelectedIndex(vertexIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button === 0) {
      const edge = hitEdge(points, bounds, event.clientX, event.clientY, EDGE_HIT_PX);
      if (edge && points.length < MAX_POLYGON_POINTS) {
        setPointsForSelected(insertPt(points, edge.edgeIndex, edge.x, edge.y));
        setSelectedIndex(edge.edgeIndex + 1);
        event.preventDefault();
      }
    }
  };

  const handleAddZone = () => {
    setZones((prev) => [...prev, { points: seedPoints() }]);
    setSelectedZone(zones.length);
    setSelectedIndex(null);
  };

  const handleDeleteZone = () => {
    if (zones.length <= 1) {
      setZones([{ points: seedPoints() }]);
      setSelectedZone(0);
      return;
    }
    setZones((prev) => prev.filter((_, i) => i !== selectedZone));
    setSelectedZone((i) => Math.max(0, Math.min(i, zones.length - 2)));
    setSelectedIndex(null);
  };

  const handleAddFromBird = (birdBox) => {
    const zone = ignoreZoneFromBirdBox(birdBox.bird, birdBox.imageSize, 0);
    if (!zone) return;
    setZones((prev) => {
      const next = [...prev.map((z) => ({ points: z.points.map((p) => ({ ...p })) })), { points: zone.points }];
      setSelectedZone(next.length - 1);
      return next;
    });
    setSelectedIndex(null);
  };

  /** One max-box per spatial cluster of detections (e.g. shoe + planter → 2 zones). */
  const handleMaxBoxFromDetections = () => {
    const next = maxIgnoreZonesFromBirdBoxes(birdBoxes, 0, 0.1);
    if (!next.length) return;
    setZones(next.map((z) => ({ points: z.points.map((p) => ({ ...p })) })));
    setSelectedZone(0);
    setSelectedIndex(null);
  };

  /** Cluster current polygons → one max-box each (nearby merge, distant stay separate). */
  const handleMaxBoxFromZones = () => {
    const next = maxIgnoreZonesFromZones(zones, 0, 0.1);
    if (!next.length) return;
    setZones(next.map((z) => ({ points: z.points.map((p) => ({ ...p })) })));
    setSelectedZone(0);
    setSelectedIndex(null);
  };

  const handleSave = () => {
    const payload = zones
      .map((z) => buildIgnoreZonePayload(z.points))
      .filter(Boolean);
    onSave(payload);
  };

  const handleClearAll = () => {
    onSave([]);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Ignore-Zonen
        {routePointIndex != null ? ` — Position ${routePointIndex + 1}` : ''}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Boxen in diesen Zonen werden weder gespeichert noch beschossen (Master &amp; Slave).
          Punkte ziehen · Kante = Punkt hinzufügen · Rechtsklick = Punkt entfernen.
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {zones.map((_, i) => (
            <Chip
              key={i}
              label={`Zone ${i + 1}`}
              color={i === selectedZone ? 'error' : 'default'}
              variant={i === selectedZone ? 'filled' : 'outlined'}
              onClick={() => { setSelectedZone(i); setSelectedIndex(null); }}
              size="small"
            />
          ))}
          <Button size="small" onClick={handleAddZone}>+ Zone</Button>
          <Button size="small" color="error" onClick={handleDeleteZone}>Zone löschen</Button>
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={handleMaxBoxFromZones}
            disabled={zones.length < 1}
          >
            Max-Boxen aus Zonen
          </Button>
        </Stack>

        {birdBoxes.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Aus Detection anlegen:
              </Typography>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={handleMaxBoxFromDetections}
              >
                Max-Boxen aus Detections ({birdBoxes.length})
              </Button>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {birdBoxes.slice(0, 24).map((bb, i) => (
                <Button
                  key={i}
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => handleAddFromBird(bb)}
                >
                  {bb.label || `Box ${i + 1}`}
                </Button>
              ))}
            </Stack>
          </Box>
        )}

        {!image && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Kein Routenbild für diesen Punkt.
          </Alert>
        )}
        {image && (
          <Box
            ref={containerRef}
            sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              maxHeight: 480,
              userSelect: 'none'
            }}
          >
            <Box sx={{ position: 'relative', width: layout.width || '100%', height: layout.height || 'auto' }}>
              <Box
                ref={imgRef}
                component="img"
                src={image}
                alt="Route snapshot"
                onLoad={measureLayout}
                sx={{
                  width: layout.width || '100%',
                  height: layout.height || 'auto',
                  display: 'block',
                  borderRadius: 1
                }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: layout.width || '100%',
                  height: layout.height || '100%',
                  cursor: draggingIndex != null ? 'grabbing' : 'crosshair',
                  touchAction: 'none'
                }}
                onPointerDown={handlePointerDown}
                onContextMenu={(e) => e.preventDefault()}
              />
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClearAll} color="warning" disabled={!image}>
          Alle Zonen entfernen
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Abbrechen</Button>
        <Button onClick={handleSave} variant="contained" color="error" disabled={!image}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IgnoreZoneEditor;
