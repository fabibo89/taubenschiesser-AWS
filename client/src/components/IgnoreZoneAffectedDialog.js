import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  LinearProgress,
  Stack,
  Chip
} from '@mui/material';
import axios from 'axios';
import { toast } from 'react-toastify';
import { affectedBirdOverlays, normalizeIgnoreZones } from '../utils/ignoreZone';

/**
 * Select detections that fall into ignore zones and bulk-update (no_pigeon) or delete.
 */
export default function IgnoreZoneAffectedDialog({
  open,
  onClose,
  detections = [],
  ignoreZones = [],
  onApplied
}) {
  const ids = useMemo(
    () => detections.map((d) => String(d._id)).filter(Boolean),
    [detections]
  );
  const zones = useMemo(() => normalizeIgnoreZones(ignoreZones), [ignoreZones]);
  const [selected, setSelected] = useState(() => new Set(ids));
  /** id -> { url, sizeHint: 'original'|'zoomed', detail } */
  const [thumbs, setThumbs] = useState({});
  const [busy, setBusy] = useState(false);
  /** null | { action: 'no_pigeon'|'delete', done: number, total: number } */
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(ids));
    setProgress(null);
  }, [open, ids]);

  useEffect(() => {
    if (!open || !ids.length) return undefined;
    let cancelled = false;
    const load = async () => {
      for (let i = 0; i < ids.length; i += 1) {
        if (cancelled) return;
        const id = ids[i];
        try {
          // Full detail: reliable image_info + boxes for overlays
          const [imgRes, detRes] = await Promise.all([
            axios.get(`/api/cv/detections/${id}/image`),
            axios.get(`/api/cv/detections/${id}`).catch(() => null)
          ]);
          const detail = detRes?.data || null;
          const hasOriginal = Boolean(imgRes.data?.image?.url);
          const url = imgRes.data?.image?.url || imgRes.data?.zoomed_image?.url || null;
          const sizeHint = hasOriginal ? 'original' : 'zoomed';
          setThumbs((prev) => ({
            ...prev,
            [id]: url
              ? { url, sizeHint, detail }
              : { url: null, sizeHint, detail }
          }));
        } catch {
          setThumbs((prev) => ({
            ...prev,
            [id]: { url: null, sizeHint: 'original', detail: null }
          }));
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, ids]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ids));
  const selectNone = () => setSelected(new Set());

  const selectedList = detections.filter((d) => selected.has(String(d._id)));

  const applyClassify = async () => {
    if (!selectedList.length) return;
    const total = selectedList.length;
    setBusy(true);
    setProgress({ action: 'no_pigeon', done: 0, total });
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < selectedList.length; i += 1) {
        const d = selectedList[i];
        try {
          await axios.patch(`/api/cv/detections/${d._id}/classify`, { action: 'no_pigeon' });
          ok += 1;
        } catch {
          fail += 1;
        }
        setProgress({ action: 'no_pigeon', done: i + 1, total });
      }
      if (ok) toast.success(`${ok} Erkennung(en) als „Keine Taube“ markiert`);
      if (fail) toast.error(`${fail} fehlgeschlagen`);
      onApplied?.({
        action: 'no_pigeon',
        ids: selectedList.map((d) => d._id)
      });
      onClose?.();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const applyDelete = async () => {
    if (!selectedList.length) return;
    if (!window.confirm(`${selectedList.length} Erkennung(en) wirklich löschen?`)) return;
    const total = selectedList.length;
    setBusy(true);
    setProgress({ action: 'delete', done: 0, total });
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < selectedList.length; i += 1) {
        const d = selectedList[i];
        try {
          await axios.delete(`/api/cv/detections/${d._id}`);
          ok += 1;
        } catch {
          fail += 1;
        }
        setProgress({ action: 'delete', done: i + 1, total });
      }
      if (ok) toast.success(`${ok} Erkennung(en) gelöscht`);
      if (fail) toast.error(`${fail} fehlgeschlagen`);
      onApplied?.({
        action: 'delete',
        ids: selectedList.map((d) => d._id)
      });
      onClose?.();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const progressLabel = progress
    ? (progress.action === 'delete'
      ? `Lösche ${progress.done} / ${progress.total}…`
      : `Markiere ${progress.done} / ${progress.total}…`)
    : null;
  const progressPct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Betroffene Erkennungen aktualisieren</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Rote Rahmen = Boxen in Ignore-Zonen. Bild unbeschnitten.
        </Typography>
        {progress && (
          <Box sx={{ mb: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" fontWeight={600}>
                {progressLabel}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {progressPct}%
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={progressPct} />
          </Box>
        )}
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button size="small" onClick={selectAll} disabled={busy}>Alle</Button>
          <Button size="small" onClick={selectNone} disabled={busy}>Keine</Button>
          <Chip size="small" label={`${selected.size} / ${ids.length} gewählt`} />
        </Stack>

        {!ids.length ? (
          <Typography color="text.secondary">Keine betroffenen Erkennungen im aktuellen Filter.</Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 1.5
            }}
          >
            {detections.map((d) => {
              const id = String(d._id);
              const checked = selected.has(id);
              const thumb = thumbs[id];
              const detForOverlay = thumb?.detail
                ? { ...d, ...thumb.detail, image_info: thumb.detail.image_info || d.image_info }
                : d;
              const overlays = thumb
                ? affectedBirdOverlays(detForOverlay, zones, thumb.sizeHint)
                : [];
              const affectedCount = overlays.filter((o) => o.affected).length;
              return (
                <Box
                  key={id}
                  onClick={() => !busy && toggle(id)}
                  sx={{
                    border: 1,
                    borderColor: checked ? 'error.main' : 'divider',
                    borderRadius: 1,
                    overflow: 'hidden',
                    cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.7 : 1,
                    bgcolor: checked ? 'rgba(244,67,54,0.06)' : 'background.paper'
                  }}
                >
                  <Box
                    sx={{
                      position: 'relative',
                      width: '100%',
                      bgcolor: 'grey.200',
                      minHeight: 100,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {thumb === undefined && (
                      <Box sx={{ py: 5 }}>
                        <CircularProgress size={22} />
                      </Box>
                    )}
                    {thumb && thumb.url === null && (
                      <Typography variant="caption" color="text.secondary" sx={{ py: 5 }}>
                        kein Bild
                      </Typography>
                    )}
                    {thumb?.url && (
                      <Box
                        sx={{
                          position: 'relative',
                          display: 'block',
                          width: '100%',
                          lineHeight: 0
                        }}
                      >
                        <Box
                          component="img"
                          src={thumb.url}
                          alt=""
                          sx={{
                            display: 'block',
                            width: '100%',
                            height: 'auto'
                          }}
                        />
                        {zones.length > 0 && (
                          <Box
                            component="svg"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            sx={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              width: '100%',
                              height: '100%',
                              pointerEvents: 'none'
                            }}
                          >
                            {zones.map((z, zi) => (
                              <polygon
                                key={`z-${zi}`}
                                points={z.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                                fill="rgba(244, 67, 54, 0.2)"
                                stroke="#c62828"
                                strokeWidth="1.2"
                                vectorEffect="non-scaling-stroke"
                              />
                            ))}
                          </Box>
                        )}
                        {overlays.map((box, bi) => (
                          <Box
                            key={`b-${bi}`}
                            sx={{
                              position: 'absolute',
                              left: `${box.left}%`,
                              top: `${box.top}%`,
                              width: `${Math.max(box.width, 1)}%`,
                              height: `${Math.max(box.height, 1)}%`,
                              border: box.affected
                                ? '2px solid #f44336'
                                : '1px solid rgba(33, 150, 243, 0.9)',
                              boxSizing: 'border-box',
                              pointerEvents: 'none',
                              boxShadow: box.affected
                                ? '0 0 0 1px rgba(0,0,0,0.5)'
                                : undefined
                            }}
                          />
                        ))}
                      </Box>
                    )}
                    <Checkbox
                      checked={checked}
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        zIndex: 2,
                        color: '#fff',
                        bgcolor: 'rgba(0,0,0,0.4)',
                        borderRadius: 1,
                        p: 0.25,
                        m: 0.5
                      }}
                      disabled={busy}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(id)}
                    />
                  </Box>
                  <Box sx={{ p: 0.75 }}>
                    <Typography variant="caption" display="block" noWrap>
                      {d.processedAt
                        ? new Date(d.processedAt).toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short'
                        })
                        : id.slice(-6)}
                      {overlays.length > 0
                        ? ` · ${affectedCount || overlays.length} Markierung(en)`
                        : ''}
                    </Typography>
                    <FormControlLabel
                      sx={{ m: 0, mt: 0.25 }}
                      control={<Checkbox size="small" checked={checked} disabled={busy} />}
                      label={<Typography variant="caption">auswählen</Typography>}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(id)}
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={busy}>Abbrechen</Button>
        <Box sx={{ flex: 1 }} />
        <Button
          color="error"
          variant="outlined"
          disabled={busy || !selectedList.length}
          onClick={applyDelete}
        >
          {progress?.action === 'delete'
            ? `${progress.done} / ${progress.total}`
            : 'Löschen'}
        </Button>
        <Button
          color="warning"
          variant="contained"
          disabled={busy || !selectedList.length}
          onClick={applyClassify}
          startIcon={progress?.action === 'no_pigeon' ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {progress?.action === 'no_pigeon'
            ? `${progress.done} / ${progress.total}`
            : 'Als keine Taube markieren'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
