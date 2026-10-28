import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  FormControl,
  Select,
  MenuItem,
  ListSubheader,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  LinearProgress,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as DetectionIcon,
  Delete as DeleteIcon,
  Favorite as FavoriteIcon,
  Cancel as CancelIcon,
  Thermostat as ThermostatIcon,
  DeleteSweep as DeleteSweepIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import axios from 'axios';
import { toast } from 'react-toastify';
import DetectionDetailDialog, {
  DetectionSourceChips,
  ShootActiveIcons,
  fovCalibrationChipProps
} from './DetectionDetailDialog';

function formatDeltaSeconds(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  if (n < 60) return `${n} Sek`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m} Min ${s} Sek` : `${m} Min`;
}

function DuplicateThumb({ detectionId, birdBoxes, imageInfo, imageUrl, onLoadRequest, onOpen, caption, subcaption, borderColor }) {
  const rootRef = useRef(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!detectionId || imageUrl !== undefined || requestedRef.current) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      requestedRef.current = true;
      onLoadRequest(detectionId);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (requestedRef.current) return;
        requestedRef.current = true;
        onLoadRequest(detectionId);
        obs.disconnect();
      },
      { root: null, rootMargin: '120px', threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [detectionId, imageUrl, onLoadRequest]);

  const imgW = imageInfo?.zoomed_size?.width || imageInfo?.original_size?.width || 640;
  const imgH = imageInfo?.zoomed_size?.height || imageInfo?.original_size?.height || 640;

  return (
    <Box ref={rootRef} sx={{ width: 160, flexShrink: 0 }}>
      <Typography variant="caption" display="block" fontWeight={600} noWrap title={caption}>
        {caption}
      </Typography>
      {subcaption && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          {subcaption}
        </Typography>
      )}
      <Box
        onClick={() => onOpen?.(detectionId)}
        title="Große Ansicht öffnen"
        sx={{
          position: 'relative',
          width: 160,
          height: 160,
          bgcolor: '#000',
          borderRadius: 1,
          border: `2px solid ${borderColor || '#90a4ae'}`,
          overflow: 'hidden',
          cursor: onOpen ? 'pointer' : 'default'
        }}
      >
        {typeof imageUrl === 'string' && imageUrl ? (
          <>
            <Box
              component="img"
              src={imageUrl}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
            {(birdBoxes || []).map((b, i) => {
              const left = (b.x1 / imgW) * 100;
              const top = (b.y1 / imgH) * 100;
              const width = ((b.x2 - b.x1) / imgW) * 100;
              const height = ((b.y2 - b.y1) / imgH) * 100;
              return (
                <Box
                  key={i}
                  sx={{
                    position: 'absolute',
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    border: '2px solid #ff1744',
                    boxSizing: 'border-box',
                    pointerEvents: 'none'
                  }}
                />
              );
            })}
          </>
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <Typography variant="caption" color="grey.400">
              {imageUrl === null ? 'Kein Bild' : 'Lädt…'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// Renders thumbnail for a detection row; triggers load via onLoadRequest when imageUrl not yet loaded
function ThumbnailCell({ detectionId, imageUrl, onLoadRequest, onOpenDialog }) {
  useEffect(() => {
    if (detectionId && imageUrl === undefined) onLoadRequest(detectionId);
  }, [detectionId, imageUrl, onLoadRequest]);

  if (imageUrl === 'loading' || imageUrl === undefined) {
    return <Typography variant="caption" color="text.secondary">Lädt…</Typography>;
  }
  if (imageUrl === null || imageUrl === '') {
    return <Typography variant="caption" color="text.secondary">Kein Bild</Typography>;
  }
  if (typeof imageUrl === 'string') {
    return (
      <Box
        component="img"
        src={imageUrl}
        alt="Detection Thumbnail"
        sx={{
          width: 80,
          height: 80,
          objectFit: 'contain',
          display: 'block',
          borderRadius: 1,
          border: '1px solid #e0e0e0',
          cursor: 'pointer'
        }}
        onClick={onOpenDialog}
      />
    );
  }
  return <Typography variant="caption" color="text.secondary">Kein Bild</Typography>;
}

const Detections = () => {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    deviceId: '',
    dateFrom: '',
    dateTo: '',
    classificationStatus: '',
    cameraPosition: '' // Format: "rotation,tilt" z.B. "90,45"
  });
  // Positions from device routes: { device: { _id, name }, coordinates: [ { rotation, tilt, zoom, index } ] }
  const [positionsByDevice, setPositionsByDevice] = useState([]);
  const [classificationDialogOpen, setClassificationDialogOpen] = useState(false);
  const [detectionToClassify, setDetectionToClassify] = useState(null);
  const [pagination, setPagination] = useState({
    page: 0,
    pageSize: 20,
    total: 0
  });
  const [detailDetectionId, setDetailDetectionId] = useState(null);
  // Thumbnails loaded per row (id -> url string, or 'loading', or null for no image)
  const [imageByDetectionId, setImageByDetectionId] = useState({});
  const imageByDetectionIdRef = useRef({});
  imageByDetectionIdRef.current = imageByDetectionId;

  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [dupWindowMinutes, setDupWindowMinutes] = useState(5);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupDeleting, setDupDeleting] = useState(false);
  const [dupPreview, setDupPreview] = useState(null);
  const imageLoadQueueRef = useRef({ pending: [], active: 0, maxConcurrent: 3 });

  const loadImageForDetection = useCallback((id) => {
    const idStr = typeof id === 'string' ? id : id?.toString?.();
    if (!idStr) return;
    if (imageByDetectionIdRef.current[idStr] !== undefined) return;

    const q = imageLoadQueueRef.current;
    if (q.pending.includes(idStr)) return;
    q.pending.push(idStr);

    const pump = () => {
      while (q.active < q.maxConcurrent && q.pending.length > 0) {
        const nextId = q.pending.shift();
        if (!nextId) break;
        if (imageByDetectionIdRef.current[nextId] !== undefined) continue;

        q.active += 1;
        setImageByDetectionId((prev) => {
          if (prev[nextId] !== undefined) return prev;
          return { ...prev, [nextId]: 'loading' };
        });

        axios
          .get(`/api/cv/detections/${nextId}/image`)
          .then((response) => {
            const url = response.data.zoomed_image?.url || response.data.image?.url || null;
            setImageByDetectionId((prev) => ({ ...prev, [nextId]: url }));
          })
          .catch(() => {
            setImageByDetectionId((prev) => ({ ...prev, [nextId]: null }));
          })
          .finally(() => {
            q.active = Math.max(0, q.active - 1);
            pump();
          });
      }
    };

    pump();
  }, []);

  const fetchPositionsFromRoutes = async () => {
    try {
      const response = await axios.get('/api/devices');
      const devices = response.data.devices || response.data || [];
      const byDevice = [];
      for (const dev of devices) {
        const coords = dev.actions?.route?.coordinates || [];
        const positions = coords
          .map((c, index) => ({ rotation: c.rotation, tilt: c.tilt, zoom: c.zoom, index }))
          .filter((c) => c.rotation !== undefined || c.tilt !== undefined);
        if (positions.length > 0) {
          byDevice.push({
            device: { _id: dev._id, name: dev.name || 'Unbekannt' },
            coordinates: positions
          });
        }
      }
      setPositionsByDevice(byDevice);
    } catch (error) {
      console.error('Error fetching positions from routes:', error);
    }
  };

  const detectionsFetchSeqRef = useRef(0);

  const fetchDetections = useCallback(async () => {
    const seq = ++detectionsFetchSeqRef.current;

    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pagination.page + 1),
        limit: String(pagination.pageSize)
      });

      const deviceId = (filters.deviceId || '').trim();
      if (deviceId) params.append('deviceId', deviceId);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (filters.classificationStatus) params.append('classificationStatus', filters.classificationStatus);
      if (filters.cameraPosition) {
        const [rotation, tilt] = filters.cameraPosition.split(',');
        if (rotation) params.append('rotation', rotation);
        if (tilt) params.append('tilt', tilt);
      }

      const response = await axios.get(`/api/cv/detections?${params}`);
      // Ignore stale responses (date/filter changed while request was in flight)
      if (seq !== detectionsFetchSeqRef.current) return;

      setDetections(response.data.detections || []);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination?.total || 0
      }));
      setImageByDetectionId({});
    } catch (error) {
      if (seq !== detectionsFetchSeqRef.current) return;
      console.error('Error fetching detections:', error);
      const status = error.response?.status;
      // Don't spam for empty/not-found filter edge cases
      if (status && status < 500) {
        setDetections([]);
        setPagination(prev => ({ ...prev, total: 0 }));
        return;
      }
      toast.error(error.response?.data?.error || 'Fehler beim Laden der Erkennungen');
    } finally {
      if (seq === detectionsFetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [filters, pagination.page, pagination.pageSize]);

  useEffect(() => {
    fetchDetections();
    fetchPositionsFromRoutes();
  }, [fetchDetections]);

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
    setPagination(prev => ({
      ...prev,
      page: 0
    }));
  };

  const handleOpenImageDialog = (detection) => {
    const id = detection?._id;
    if (id == null) return;
    setDetailDetectionId(typeof id === 'string' ? id : String(id));
  };

  const handleCloseImageDialog = () => {
    setDetailDetectionId(null);
  };

  const handleDetailDeleted = (id) => {
    setDetections((prev) => prev.filter((d) => d._id !== id));
    setPagination((prev) => ({
      ...prev,
      total: Math.max(0, (prev.total || 0) - 1)
    }));
  };

  const handleDetailUpdated = (next) => {
    if (!next?._id) return;
    setDetections((prev) => prev.map((d) => (
      d._id === next._id
        ? {
            ...d,
            classification_status: next.classification_status,
            classifiedAt: next.classifiedAt,
            birds: next.birds,
            target_bird: next.target_bird,
            ...(next.camera_position ? { camera_position: next.camera_position } : {})
          }
        : d
    )));
  };

  const detailNeighborIds = useMemo(() => detections.map((d) => d._id), [detections]);

  const handleDeleteDetection = async (detection) => {
    if (!detection) return;

    const confirmDelete = window.confirm('Erkennung und zugehörige Bilder wirklich löschen?');
    if (!confirmDelete) return;

    try {
      await axios.delete(`/api/cv/detections/${detection._id}`);

      // Entferne lokal aus der Liste
      setDetections((prev) => prev.filter((d) => d._id !== detection._id));
      setPagination((prev) => ({
        ...prev,
        total: Math.max(0, (prev.total || 0) - 1)
      }));
    } catch (error) {
      console.error('Error deleting detection:', error);
      alert('Fehler beim Löschen der Erkennung');
    }
  };

  const handleOpenDupDialog = () => {
    setDupPreview(null);
    setDupDialogOpen(true);
  };

  const handleCloseDupDialog = () => {
    if (dupDeleting) return;
    setDupDialogOpen(false);
  };

  const handleScanDuplicates = async () => {
    setDupLoading(true);
    setDupPreview(null);
    imageLoadQueueRef.current.pending = [];
    try {
      const params = new URLSearchParams();
      params.set('windowMinutes', String(dupWindowMinutes || 5));
      if (filters.deviceId) params.set('deviceId', filters.deviceId);
      const res = await axios.get(`/api/cv/detections/duplicates/preview?${params}`);
      setDupPreview(res.data);
      if (!res.data.groups?.length) {
        toast.info('Keine Duplikate gefunden');
      }
    } catch (error) {
      console.error('Duplicate preview error:', error);
      toast.error('Duplikat-Scan fehlgeschlagen');
    } finally {
      setDupLoading(false);
    }
  };

  const handleDeleteDuplicates = async () => {
    const ids = dupPreview?.duplicateIds || [];
    if (!ids.length) return;
    const ok = window.confirm(
      `${ids.length} doppelte Erkennung(en) wirklich löschen? Die jeweils erste („führende“) bleibt erhalten.`
    );
    if (!ok) return;
    setDupDeleting(true);
    try {
      const res = await axios.post('/api/cv/detections/duplicates/delete', { ids });
      toast.success(`${res.data.deleted} Duplikate gelöscht`);
      setDupDialogOpen(false);
      setDupPreview(null);
      await fetchDetections();
    } catch (error) {
      console.error('Duplicate delete error:', error);
      toast.error('Löschen der Duplikate fehlgeschlagen');
    } finally {
      setDupDeleting(false);
    }
  };

  const handleOpenClassificationDialog = (detection) => {
    setDetectionToClassify(detection);
    setClassificationDialogOpen(true);
  };

  const handleCloseClassificationDialog = () => {
    setClassificationDialogOpen(false);
    setDetectionToClassify(null);
  };

  const handleClassifyDetection = async (action) => {
    if (!detectionToClassify) return;

    try {
      if (action === 'delete') {
        await axios.delete(`/api/cv/detections/${detectionToClassify._id}`);
        toast.error('Erkennung gelöscht');
      } else {
        await axios.patch(`/api/cv/detections/${detectionToClassify._id}/classify`, {
          action: action
        });
        if (action === 'confirm_pigeon') {
          toast.success('Als Taube klassifiziert');
        } else {
          toast.warning('Als "Keine Taube" klassifiziert');
        }
      }
      
      // Aktualisiere die Liste
      await fetchDetections();
      handleCloseClassificationDialog();
          } catch (error) {
      console.error('Error classifying detection:', error);
      toast.error('Fehler beim Klassifizieren der Erkennung');
    }
  };

  const columns = [
    {
      field: 'image',
      headerName: 'Bild',
      width: 100,
      sortable: false,
      renderCell: (params) => {
        const idKey = params.row._id == null ? '' : (typeof params.row._id === 'string' ? params.row._id : params.row._id.toString?.() ?? String(params.row._id));
        return (
          <Box>
            <ThumbnailCell
              detectionId={idKey}
              imageUrl={imageByDetectionId[idKey]}
              onLoadRequest={loadImageForDetection}
              onOpenDialog={() => handleOpenImageDialog(params.row)}
            />
          </Box>
        );
      }
    },
    {
      field: 'device',
      headerName: 'Gerät',
      width: 200,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value?.name || 'Unbekannt'}
        </Typography>
      )
    },
    {
      field: 'shootActive',
      headerName: 'Schuss',
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <ShootActiveIcons detection={params.row} />
      )
    },
    {
      field: 'detection_authority',
      headerName: 'Erkennung',
      width: 140,
      sortable: false,
      renderCell: (params) => <DetectionSourceChips detection={params.row} />
    },
    {
      field: 'detections',
      headerName: 'Erkannte Objekte',
      width: 200,
      renderCell: (params) => (
        <Box>
          {params.value?.map((detection, index) => (
            <Chip
              key={index}
              label={`${detection.class} (${(detection.confidence * 100).toFixed(1)}%)`}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
        </Box>
      )
    },
    {
      field: 'detection_count',
      headerName: 'Anzahl',
      width: 100,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.row.detections?.length || 0}
        </Typography>
      )
    },
    {
      field: 'processingTime',
      headerName: 'Verarbeitungszeit',
      width: 150,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value != null && params.value !== '' ? `${(Number(params.value) / 1000).toFixed(2)} s` : 'N/A'}
        </Typography>
      )
    },
    {
      field: 'processedAt',
      headerName: 'Zeitstempel',
      width: 180,
      renderCell: (params) => (
        <Typography variant="body2">
          {new Date(params.value).toLocaleString()}
        </Typography>
      )
    },
    {
      field: 'temperature',
      headerName: 'Temperatur',
      width: 120,
      renderCell: (params) => (
        <Box display="flex" alignItems="center" gap={0.5}>
          {params.value !== null && params.value !== undefined ? (
            <>
              <ThermostatIcon fontSize="small" color="action" />
              <Typography variant="body2">
                {params.value.toFixed(1)}°C
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              N/A
            </Typography>
          )}
        </Box>
      )
    },
    {
      field: 'camera_position',
      headerName: 'Kamera-Position',
      width: 200,
      renderHeader: () => (
        <Box display="flex" alignItems="center" gap={1} width="100%">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Kamera-Position
          </Typography>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select
              value={filters.deviceId && filters.cameraPosition ? `${filters.deviceId}:${filters.cameraPosition}` : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  // Clearing position also clears deviceId set by this dropdown
                  setFilters((prev) => ({ ...prev, cameraPosition: '', deviceId: '' }));
                  setPagination((prev) => ({ ...prev, page: 0 }));
                  return;
                }
                const colon = v.indexOf(':');
                const deviceId = colon >= 0 ? v.slice(0, colon) : '';
                const pos = colon >= 0 ? v.slice(colon + 1) : '';
                if (deviceId && pos) {
                  setFilters((prev) => ({ ...prev, deviceId, cameraPosition: pos }));
                  setPagination((prev) => ({ ...prev, page: 0 }));
                }
              }}
              displayEmpty
              sx={{ height: '32px', fontSize: '0.75rem' }}
              renderValue={(selected) => {
                if (!selected) return 'Alle Positionen';
                const [deviceId, pos] = selected.split(':');
                const [rotation, tilt] = (pos || '').split(',');
                const group = positionsByDevice.find((g) => String(g.device._id) === String(deviceId));
                const coord = group?.coordinates.find(
                  (c) => String(c.rotation) === String(rotation) && String(c.tilt) === String(tilt)
                );
                const num = coord ? coord.index + 1 : '';
                const deviceName = group?.device?.name || '';
                return deviceName && num ? `${deviceName} – Routenpunkt ${num}` : selected;
              }}
            >
              <MenuItem value="">Alle Positionen</MenuItem>
              {positionsByDevice.map((group) => [
                <ListSubheader key={`sh-${group.device._id}`} sx={{ lineHeight: 2 }}>
                  {group.device.name}
                </ListSubheader>,
                ...group.coordinates.map((coord) => {
                  const value = `${group.device._id}:${coord.rotation ?? ''},${coord.tilt ?? ''}`;
                  const label = `Routenpunkt ${coord.index + 1}`;
                  const zoomStr = coord.zoom != null ? ` (Zoom: ${coord.zoom}x)` : '';
                  return (
                    <MenuItem key={value} value={value} sx={{ pl: 3 }}>
                      {label}: R: {coord.rotation ?? '-'}° / T: {coord.tilt ?? '-'}°{zoomStr}
                    </MenuItem>
                  );
                })
              ])}
            </Select>
          </FormControl>
        </Box>
      ),
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value && params.value.rotation !== undefined && params.value.tilt !== undefined ? (
            `R: ${params.value.rotation}° / T: ${params.value.tilt}°`
          ) : (
            <span style={{ color: 'rgba(0, 0, 0, 0.6)' }}>N/A</span>
          )}
        </Typography>
      )
    },
    {
      field: 'model',
      headerName: 'Modell',
      width: 120,
      renderCell: (params) => (
        <Typography variant="body2">
          {params.value?.name || 'N/A'}
        </Typography>
      )
    },
    {
      field: 'classification_status',
      headerName: 'Klassifizierung',
      width: 150,
      renderCell: (params) => {
        const status = params.value;
        const handleClick = (e) => {
          e.stopPropagation();
          handleOpenClassificationDialog(params.row);
        };
        
        if (!status || status === 'unclassified') {
          return (
            <Chip 
              label="Unkategorisiert" 
              size="small" 
              variant="outlined" 
              onClick={handleClick}
              sx={{ cursor: 'pointer' }}
            />
          );
        } else if (status === 'confirmed_pigeon') {
          return (
            <Chip 
              label="Taube" 
              size="small" 
              color="success" 
              icon={<FavoriteIcon />}
              onClick={handleClick}
              sx={{ cursor: 'pointer' }}
            />
          );
        } else if (status === 'no_pigeon') {
          return (
            <Chip 
              label="Keine Taube" 
              size="small" 
              color="error" 
              icon={<CancelIcon />}
              onClick={handleClick}
              sx={{ cursor: 'pointer' }}
            />
          );
        }
        return (
          <Chip 
            label={status} 
            size="small" 
            variant="outlined"
            onClick={handleClick}
            sx={{ cursor: 'pointer' }}
          />
        );
      }
    },
    {
      field: 'fovCalibration',
      headerName: 'Kalibrierung',
      width: 130,
      sortable: false,
      renderCell: (params) => {
        const chip = fovCalibrationChipProps(params.row.fovCalibration);
        return <Chip size="small" {...chip} />;
      }
    },
    {
      field: 'actions',
      headerName: 'Aktionen',
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            size="small"
            onClick={() => handleOpenImageDialog(params.row)}
            color="primary"
            title="Details anzeigen"
          >
            <DetectionIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleDeleteDetection(params.row)}
            color="error"
            title="Erkennung löschen"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      )
    }
  ];

  return (
    <Box>
      {loading && <LinearProgress />}
      <Typography variant="h4" gutterBottom>
        Erkennungen
      </Typography>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Geräte-ID"
                value={filters.deviceId}
                onChange={(e) => handleFilterChange('deviceId', e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  )
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Von Datum"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Bis Datum"
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                variant="outlined"
                startIcon={<FilterIcon />}
                onClick={fetchDetections}
                fullWidth
              >
                Filter anwenden
              </Button>
            </Grid>
            {(filters.dateFrom || filters.dateTo) && (
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Zeitraum: {filters.dateFrom || '…'} → {filters.dateTo || '…'}
                  {pagination.total != null ? ` · ${pagination.total.toLocaleString('de-DE')} Treffer` : ''}
                </Typography>
              </Grid>
            )}
            <Grid item xs={12} sm={6} md={3}>
              <Button
                variant="outlined"
                color="warning"
                startIcon={<DeleteSweepIcon />}
                onClick={handleOpenDupDialog}
                fullWidth
              >
                Duplikate prüfen
              </Button>
            </Grid>
            {/* Classification Status Filter Buttons */}
            <Grid item xs={12}>
              <Box display="flex" gap={1} flexWrap="wrap">
                <Button
                  variant={filters.classificationStatus === '' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', '')}
                  size="small"
                >
                  Alle
                </Button>
                <Button
                  variant={filters.classificationStatus === 'unclassified' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', 'unclassified')}
                  size="small"
                >
                  Unkategorisiert
                </Button>
                <Button
                  variant={filters.classificationStatus === 'confirmed_pigeon' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', 'confirmed_pigeon')}
                  size="small"
                  color="success"
                  startIcon={<FavoriteIcon />}
                >
                  Taube
                </Button>
                <Button
                  variant={filters.classificationStatus === 'no_pigeon' ? 'contained' : 'outlined'}
                  onClick={() => handleFilterChange('classificationStatus', 'no_pigeon')}
                  size="small"
                  color="error"
                  startIcon={<CancelIcon />}
                >
                  Keine Taube
                </Button>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Detections Table */}
      <Card>
        <CardContent>
          <DataGrid
            rows={detections}
            columns={columns}
            loading={loading}
            getRowId={(row) => row._id}
            rowHeight={96}
            pageSizeOptions={[10, 20, 50]}
            paginationModel={{
              page: pagination.page,
              pageSize: pagination.pageSize
            }}
            onPaginationModelChange={(model) => {
              setPagination(prev => ({
                ...prev,
                page: model.page,
                pageSize: model.pageSize
              }));
            }}
            rowCount={pagination.total}
            paginationMode="server"
            disableRowSelectionOnClick
            initialState={{
              pagination: {
                paginationModel: { pageSize: 20 }
              }
            }}
          />
        </CardContent>
      </Card>

      <DetectionDetailDialog
        open={Boolean(detailDetectionId)}
        detectionId={detailDetectionId}
        neighborIds={detailNeighborIds}
        onClose={handleCloseImageDialog}
        onDeleted={handleDetailDeleted}
        onUpdated={handleDetailUpdated}
      />

      {/* Duplicate cleanup dialog (dry-run + delete) */}
      <Dialog
        open={dupDialogOpen}
        onClose={handleCloseDupDialog}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>Doppelte Erkennungen</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" paragraph>
            Gleiche Position (Rot/Tilt), innerhalb des Zeitfensters, überlappende Vogel-Bounding-Box.
            Die erste Erkennung bleibt; spätere werden als Duplikat vorgeschlagen.
            {filters.deviceId ? ' Filter: aktuelles Gerät.' : ''}
          </Typography>
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" mb={2}>
            <TextField
              label="Fenster (Minuten)"
              type="number"
              size="small"
              value={dupWindowMinutes}
              onChange={(e) => setDupWindowMinutes(Math.max(0.5, Number(e.target.value) || 5))}
              inputProps={{ min: 0.5, max: 60, step: 0.5 }}
              sx={{ width: 160 }}
            />
            <Button
              variant="contained"
              onClick={handleScanDuplicates}
              disabled={dupLoading || dupDeleting}
              startIcon={dupLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
            >
              Dry-Run starten
            </Button>
          </Box>

          {dupPreview && (
            <Box mb={2}>
              <Typography variant="body2">
                Gescannt: {dupPreview.scanned} · Gruppen: {dupPreview.groups?.length || 0} · zu löschen:{' '}
                <strong>{dupPreview.totalDuplicates || 0}</strong>
              </Typography>
            </Box>
          )}

          {dupPreview?.groups?.length > 0 && (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="caption" color="text.secondary">
                Gruppen aufklappen, um Vorschaubilder zu laden (max. 3 parallel — vermeidet 429).
              </Typography>
              {dupPreview.groups.map((group, groupIndex) => {
                const keepId = group.keep?._id?.toString?.() || group.keep?._id;
                return (
                  <Accordion
                    key={keepId}
                    disableGutters
                    defaultExpanded={groupIndex < 2}
                    TransitionProps={{ unmountOnExit: true }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">
                        {group.deviceName || 'Gerät'} · R: {group.rotation}° / T: {group.tilt}° ·{' '}
                        {group.duplicates.length} Duplikat{group.duplicates.length === 1 ? '' : 'e'}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box display="flex" gap={2} flexWrap="wrap" alignItems="flex-start">
                        <DuplicateThumb
                          detectionId={keepId}
                          birdBoxes={group.keep.birdBoxes}
                          imageInfo={group.keep.image_info}
                          imageUrl={imageByDetectionId[keepId]}
                          onLoadRequest={loadImageForDetection}
                          onOpen={(id) => handleOpenImageDialog({ _id: id })}
                          caption="Behalten (führend)"
                          subcaption={
                            group.keep.processedAt
                              ? new Date(group.keep.processedAt).toLocaleString()
                              : ''
                          }
                          borderColor="#2e7d32"
                        />
                        {group.duplicates.map((dup) => {
                          const dupId = dup._id?.toString?.() || dup._id;
                          return (
                            <DuplicateThumb
                              key={dupId}
                              detectionId={dupId}
                              birdBoxes={dup.birdBoxes}
                              imageInfo={dup.image_info}
                              imageUrl={imageByDetectionId[dupId]}
                              onLoadRequest={loadImageForDetection}
                              onOpen={(id) => handleOpenImageDialog({ _id: id })}
                              caption={`Löschen · Δt ${formatDeltaSeconds(dup.deltaSeconds)}`}
                              subcaption={
                                dup.processedAt
                                  ? new Date(dup.processedAt).toLocaleString()
                                  : ''
                              }
                              borderColor="#c62828"
                            />
                          );
                        })}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDupDialog} disabled={dupDeleting}>
            Schließen
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!dupPreview?.duplicateIds?.length || dupLoading || dupDeleting}
            onClick={handleDeleteDuplicates}
            startIcon={dupDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepIcon />}
          >
            {dupPreview?.totalDuplicates || 0} Duplikate löschen
          </Button>
        </DialogActions>
      </Dialog>

      {/* Classification Dialog */}
      <Dialog
        open={classificationDialogOpen}
        onClose={handleCloseClassificationDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Zuordnung anpassen
        </DialogTitle>
        <DialogContent>
          {detectionToClassify && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Aktuelle Zuordnung:
              </Typography>
              <Box mb={3}>
                {!detectionToClassify.classification_status || detectionToClassify.classification_status === 'unclassified' ? (
                  <Chip label="Unkategorisiert" variant="outlined" />
                ) : detectionToClassify.classification_status === 'confirmed_pigeon' ? (
                  <Chip label="Taube" color="success" icon={<FavoriteIcon />} />
                ) : (
                  <Chip label="Keine Taube" color="error" icon={<CancelIcon />} />
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Neue Zuordnung wählen:
              </Typography>
              <Box display="flex" flexDirection="column" gap={2} mt={2}>
                <Button
                  variant={detectionToClassify.classification_status === 'confirmed_pigeon' ? 'contained' : 'outlined'}
                  color="success"
                  startIcon={<FavoriteIcon />}
                  onClick={() => handleClassifyDetection('confirm_pigeon')}
                  fullWidth
                >
                  Taube
                </Button>
                <Button
                  variant={detectionToClassify.classification_status === 'no_pigeon' ? 'contained' : 'outlined'}
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => handleClassifyDetection('no_pigeon')}
                  fullWidth
                >
                  Keine Taube
                </Button>
                <Button
                  variant={!detectionToClassify.classification_status || detectionToClassify.classification_status === 'unclassified' ? 'contained' : 'outlined'}
                  onClick={() => handleClassifyDetection('unclassified')}
                  fullWidth
                >
                  Unkategorisiert
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => handleClassifyDetection('delete')}
                  fullWidth
                >
                  Erkennung löschen
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseClassificationDialog}>
            Abbrechen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Detections;
