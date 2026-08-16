import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  ListItemIcon,
  ListItemText,
  ListSubheader,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  LinearProgress,
  CircularProgress
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as DetectionIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Favorite as FavoriteIcon,
  Cancel as CancelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Thermostat as ThermostatIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import axios from 'axios';
import { toast } from 'react-toastify';

function formatTimeDiffAtPosition(seconds, direction) {
  if (seconds < 60) {
    const text = `${seconds} Sek`;
    return direction === 'before' ? `Vor ${text} an dieser Position erkannt` : `${text} danach erkannt`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const text = secs > 0 ? `${minutes} Min ${secs} Sek` : `${minutes} Min`;
  return direction === 'before' ? `Vor ${text} an dieser Position erkannt` : `${text} danach erkannt`;
}

function resolveShootActive(detection) {
  const active = detection?.shootActive;
  if (active && typeof active === 'object') {
    return {
      water: active.water === true,
      laser: active.laser === true,
      audio: active.audio === true,
      known: true
    };
  }
  if (detection?.shotFired === true) {
    return { water: true, laser: false, audio: false, known: true };
  }
  if (detection?.shotFired === false) {
    return { water: false, laser: false, audio: false, known: true };
  }
  return { water: false, laser: false, audio: false, known: false };
}

function ShootActiveLabels({ detection, sx }) {
  const flags = resolveShootActive(detection);
  if (!flags.known) return null;

  const anyActive = flags.water || flags.laser || flags.audio;
  if (!anyActive) {
    return (
      <Box display="flex" flexWrap="wrap" gap={0.5} sx={sx}>
        <Chip label="Kein Schuss" size="small" variant="outlined" />
      </Box>
    );
  }

  return (
    <Box display="flex" flexWrap="wrap" gap={0.5} sx={sx}>
      {flags.water && <Chip label="Wasser" size="small" color="info" variant="outlined" />}
      {flags.laser && <Chip label="Laser" size="small" color="success" variant="outlined" />}
      {flags.audio && <Chip label="Audio" size="small" color="primary" variant="outlined" />}
    </Box>
  );
}

// Renders thumbnail for a detection row; triggers load via onLoadRequest when imageUrl not yet loaded
function ThumbnailCell({ detectionId, imageUrl, onLoadRequest, onOpenDialog }) {
  useEffect(() => {
    if (detectionId && imageUrl === undefined) onLoadRequest(detectionId);
  }, [detectionId, imageUrl, onLoadRequest]);

  if (typeof imageUrl === 'string' && imageUrl) {
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
  if (imageUrl === 'loading') {
    return <Typography variant="caption" color="text.secondary">Lädt…</Typography>;
  }
  if (imageUrl === null) {
    return <Typography variant="caption" color="text.secondary">Kein Bild</Typography>;
  }
  return <Typography variant="caption" color="text.secondary">Lädt…</Typography>;
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
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [selectedDetectionLoading, setSelectedDetectionLoading] = useState(false);
  const [deviceRouteCoordinates, setDeviceRouteCoordinates] = useState([]);
  const [cameraPositionSaving, setCameraPositionSaving] = useState(false);
  const [nearestAtPosition, setNearestAtPosition] = useState({ before: null, after: null });
  // Thumbnails loaded per row (id -> url string, or 'loading', or null for no image)
  const [imageByDetectionId, setImageByDetectionId] = useState({});
  const imageByDetectionIdRef = useRef({});
  imageByDetectionIdRef.current = imageByDetectionId;

  const loadImageForDetection = useCallback(async (id) => {
    const idStr = typeof id === 'string' ? id : id?.toString?.();
    if (!idStr || imageByDetectionIdRef.current[idStr] !== undefined) return;
    setImageByDetectionId(prev => {
      if (prev[idStr] !== undefined) return prev;
      return { ...prev, [idStr]: 'loading' };
    });
    try {
      const response = await axios.get(`/api/cv/detections/${idStr}/image`);
      const url = response.data.zoomed_image?.url || response.data.image?.url || null;
      setImageByDetectionId(prev => ({ ...prev, [idStr]: url }));
    } catch {
      setImageByDetectionId(prev => ({ ...prev, [idStr]: null }));
    }
  }, []);

  useEffect(() => {
    if (!selectedDetection?.device?._id) {
      setDeviceRouteCoordinates([]);
      return;
    }
    let cancelled = false;
    axios.get(`/api/devices/${selectedDetection.device._id}`)
      .then((res) => {
        if (!cancelled) {
          const coords = res.data?.actions?.route?.coordinates || [];
          setDeviceRouteCoordinates(Array.isArray(coords) ? coords : []);
        }
      })
      .catch(() => {
        if (!cancelled) setDeviceRouteCoordinates([]);
      });
    return () => { cancelled = true; };
  }, [selectedDetection?.device?._id]);

  // Fetch nearest detection at same position (before/after) for "X min davor/danach" in dialog
  useEffect(() => {
    if (!selectedDetection) {
      setNearestAtPosition({ before: null, after: null });
      return;
    }
    const d = selectedDetection;
    const deviceId = d.device?._id ?? d.device;
    const pos = d.camera_position;
    if (!deviceId || pos?.rotation == null || pos?.tilt == null || !d.processedAt) {
      setNearestAtPosition({ before: null, after: null });
      return;
    }
    const processedAt = typeof d.processedAt === 'string' ? d.processedAt : d.processedAt?.toISO?.() ?? new Date(d.processedAt).toISOString();
    axios.get('/api/cv/detections/nearest-at-position', {
      params: { deviceId, rotation: pos.rotation, tilt: pos.tilt, processedAt }
    })
      .then((res) => setNearestAtPosition({ before: res.data.before || null, after: res.data.after || null }))
      .catch(() => setNearestAtPosition({ before: null, after: null }));
  }, [selectedDetection]);

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

  const fetchDetections = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page + 1,
        limit: pagination.pageSize
      });
      
      if (filters.deviceId) params.append('deviceId', filters.deviceId);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (filters.classificationStatus) params.append('classificationStatus', filters.classificationStatus);
      if (filters.cameraPosition) {
        const [rotation, tilt] = filters.cameraPosition.split(',');
        if (rotation) params.append('rotation', rotation);
        if (tilt) params.append('tilt', tilt);
      }

      const response = await axios.get(`/api/cv/detections?${params}`);
      setDetections(response.data.detections);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination.total
      }));
      setImageByDetectionId({});
    } catch (error) {
      console.error('Error fetching detections:', error);
    } finally {
      setLoading(false);
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

  const handleOpenImageDialog = async (detection) => {
    setImageDialogOpen(true);
    setSelectedDetectionLoading(true);
    setSelectedDetection(null);
    try {
      const response = await axios.get(`/api/cv/detections/${detection._id}`);
      setSelectedDetection(response.data);
    } catch (error) {
      console.error('Error fetching detection detail:', error);
      toast.error('Fehler beim Laden der Erkennung');
      setImageDialogOpen(false);
    } finally {
      setSelectedDetectionLoading(false);
    }
  };

  const handleCloseImageDialog = () => {
    setImageDialogOpen(false);
    setSelectedDetection(null);
    setSelectedDetectionLoading(false);
    setDeviceRouteCoordinates([]);
  };

  const handleCameraPositionChange = async (e) => {
    const value = e.target.value;
    if (value === '' || value === 'current' || !selectedDetection?._id) return;
    const index = Number(value);
    const coord = deviceRouteCoordinates[index];
    if (!coord || (coord.rotation === undefined && coord.tilt === undefined)) return;
    const rotation = coord.rotation ?? selectedDetection.camera_position?.rotation ?? 0;
    const tilt = coord.tilt ?? selectedDetection.camera_position?.tilt ?? 0;
    setCameraPositionSaving(true);
    try {
      const response = await axios.patch(`/api/cv/detections/${selectedDetection._id}`, {
        camera_position: { rotation, tilt }
      });
      setSelectedDetection((prev) => prev ? { ...prev, camera_position: response.data.camera_position } : null);
      setDetections((prev) => prev.map((d) => d._id === selectedDetection._id ? { ...d, camera_position: response.data.camera_position } : d));
      toast.success('Kamera-Position aktualisiert');
    } catch (err) {
      toast.error('Fehler beim Speichern der Kamera-Position');
    } finally {
      setCameraPositionSaving(false);
    }
  };

  const loadDetectionByIndex = useCallback(async (index) => {
    if (index < 0 || index >= detections.length) return;
    const lean = detections[index];
    setSelectedDetectionLoading(true);
    try {
      const response = await axios.get(`/api/cv/detections/${lean._id}`);
      setSelectedDetection(response.data);
    } catch (error) {
      console.error('Error fetching detection detail:', error);
      toast.error('Fehler beim Laden der Erkennung');
    } finally {
      setSelectedDetectionLoading(false);
    }
  }, [detections]);

  const handlePreviousDetection = useCallback(() => {
    if (!selectedDetection || detections.length === 0 || selectedDetectionLoading) return;
    const currentIndex = detections.findIndex((d) => d._id === selectedDetection._id);
    if (currentIndex > 0) {
      loadDetectionByIndex(currentIndex - 1);
    }
  }, [selectedDetection, detections, selectedDetectionLoading, loadDetectionByIndex]);

  const handleNextDetection = useCallback(() => {
    if (!selectedDetection || detections.length === 0 || selectedDetectionLoading) return;
    const currentIndex = detections.findIndex((d) => d._id === selectedDetection._id);
    if (currentIndex >= 0 && currentIndex < detections.length - 1) {
      loadDetectionByIndex(currentIndex + 1);
    }
  }, [selectedDetection, detections, selectedDetectionLoading, loadDetectionByIndex]);

  useEffect(() => {
    if (!imageDialogOpen) return undefined;

    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePreviousDetection();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextDetection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageDialogOpen, handlePreviousDetection, handleNextDetection]);

  const currentDetectionIndex = selectedDetection 
    ? detections.findIndex(d => d._id === selectedDetection._id)
    : -1;

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

      // Falls die aktuelle Detailansicht diese Erkennung zeigt, schließen
      if (selectedDetection && selectedDetection._id === detection._id) {
        handleCloseImageDialog();
      }
    } catch (error) {
      console.error('Error deleting detection:', error);
      alert('Fehler beim Löschen der Erkennung');
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
      
      // Falls die aktuelle Detailansicht diese Erkennung zeigt, aktualisiere sie
      if (selectedDetection && selectedDetection._id === detectionToClassify._id) {
        await fetchDetections();
      }
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
                  setFilters((prev) => ({ ...prev, cameraPosition: '' }));
                  setPagination((prev) => ({ ...prev, page: 0 }));
                  return;
                }
                const [deviceId, pos] = v.split(':');
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

      {/* Image Dialog */}
      <Dialog
        open={imageDialogOpen}
        onClose={handleCloseImageDialog}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={2}>
                <IconButton
                  onClick={handlePreviousDetection}
                  disabled={currentDetectionIndex <= 0}
                  size="small"
                  title="Vorheriges Bild"
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="h6">
                  Erkennungs-Bilder {selectedDetection && `(${currentDetectionIndex + 1} / ${detections.length})`}
                </Typography>
                <IconButton
                  onClick={handleNextDetection}
                  disabled={currentDetectionIndex >= detections.length - 1}
                  size="small"
                  title="Nächstes Bild"
                >
                  <ArrowForwardIcon />
                </IconButton>
              </Box>
              <IconButton onClick={handleCloseImageDialog} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
            {selectedDetection && !selectedDetectionLoading && (
              <ShootActiveLabels detection={selectedDetection} sx={{ mt: 1 }} />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedDetectionLoading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
              <CircularProgress />
            </Box>
          ) : selectedDetection && (
            <Grid container spacing={2} alignItems="flex-start">
              {/* Left: images */}
              <Grid item xs={12} md={7}>
                <Box display="flex" flexDirection="column" gap={2}>
              {/* Original Image mit Bounding-Boxen (bei Zoom = 1 nur dieses eine Bild; bei Zoom > 1 darunter Gezoomtes) */}
              {selectedDetection.image?.url && (
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Original-Bild
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <Box
                        sx={{
                          position: 'relative',
                          display: 'inline-block',
                          maxWidth: '100%',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1,
                          overflow: 'visible',
                          backgroundColor: '#000'
                        }}
                      >
                        <Box
                          component="img"
                          src={selectedDetection.image.url}
                          alt="Original Detection"
                          sx={{
                            display: 'block',
                            maxWidth: '100%',
                            height: 'auto',
                            verticalAlign: 'middle'
                          }}
                        />
                        {selectedDetection.image_info?.original_size &&
                          Array.isArray(selectedDetection.detections) &&
                          selectedDetection.detections.map((detection, index) => {
                            if (!detection.bbox) return null;

                            const { x, y, width, height } = detection.bbox;
                            const imgWidth = selectedDetection.image_info.original_size.width || 1;
                            const imgHeight = selectedDetection.image_info.original_size.height || 1;

                            // Falls ein gezoomtes Bild existiert, sind die BBox-Koordinaten relativ zum Zoom-Bild.
                            // Wir verschieben sie daher in das Originalbild, indem wir den Zoom-Ausschnitt zentriert annehmen.
                            let adjX = x;
                            let adjY = y;

                            if (selectedDetection.zoomed_image?.url && selectedDetection.image_info?.zoomed_size) {
                              const zoomWidth = selectedDetection.image_info.zoomed_size.width || imgWidth;
                              const zoomHeight = selectedDetection.image_info.zoomed_size.height || imgHeight;

                              const offsetX = (imgWidth - zoomWidth) / 2;
                              const offsetY = (imgHeight - zoomHeight) / 2;

                              adjX = offsetX + x;
                              adjY = offsetY + y;
                            }

                            const leftPct = (adjX / imgWidth) * 100;
                            const topPct = (adjY / imgHeight) * 100;
                            const widthPct = (width / imgWidth) * 100;
                            const heightPct = (height / imgHeight) * 100;

                            return (
                              <Box
                                key={`orig-bbox-${index}`}
                                sx={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${widthPct}%`,
                                  height: `${heightPct}%`,
                                  border: '2px solid #ff1744',
                                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                                  pointerEvents: 'none',
                                  boxSizing: 'border-box'
                                }}
                              />
                            );
                          })}
                      </Box>
                      </Box>
                      {selectedDetection.image_info?.original_size && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 1 }}
                        >
                          Größe: {selectedDetection.image_info.original_size.width} x{' '}
                          {selectedDetection.image_info.original_size.height}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
              )}

              {/* Zoomed Image nur anzeigen wenn Zoom > 1 (sonst nur 1 Bild) */}
              {selectedDetection.zoomed_image?.url && ((Number(selectedDetection.zoom_factor) || 1) > 1) && (
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Gezoomtes Bild {selectedDetection.zoom_factor && `(${selectedDetection.zoom_factor}x)`}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <Box
                        sx={{
                          position: 'relative',
                          display: 'inline-block',
                          maxWidth: '100%',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1,
                          overflow: 'visible',
                          backgroundColor: '#000'
                        }}
                      >
                        <Box
                          component="img"
                          src={selectedDetection.zoomed_image.url}
                          alt="Zoomed Detection"
                          sx={{
                            display: 'block',
                            maxWidth: '100%',
                            height: 'auto',
                            verticalAlign: 'middle'
                          }}
                        />
                        {selectedDetection.image_info?.zoomed_size &&
                          Array.isArray(selectedDetection.detections) &&
                          selectedDetection.detections.map((detection, index) => {
                            if (!detection.position) return null;

                            const { center_x, center_y, width, height } = detection.position;

                            const imgWidth = selectedDetection.image_info.zoomed_size.width || 1;
                            const imgHeight = selectedDetection.image_info.zoomed_size.height || 1;

                            // position.* sind Pixel-Koordinaten relativ zum gezoomten Bild
                            const bboxWidth = width || 0;
                            const bboxHeight = height || 0;
                            const bboxLeft = (center_x || 0) - bboxWidth / 2;
                            const bboxTop = (center_y || 0) - bboxHeight / 2;

                            const leftPct = (bboxLeft / imgWidth) * 100;
                            const topPct = (bboxTop / imgHeight) * 100;
                            const wPct = (bboxWidth / imgWidth) * 100;
                            const hPct = (bboxHeight / imgHeight) * 100;

                            return (
                              <Box
                                key={`zoom-bbox-${index}`}
                                sx={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${wPct}%`,
                                  height: `${hPct}%`,
                                  border: '2px solid #ff1744',
                                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                                  pointerEvents: 'none',
                                  boxSizing: 'border-box'
                                }}
                              />
                            );
                          })}
                      </Box>
                      </Box>
                      {selectedDetection.image_info?.zoomed_size && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 1 }}
                        >
                          Größe: {selectedDetection.image_info.zoomed_size.width} x{' '}
                          {selectedDetection.image_info.zoomed_size.height}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
              )}
                </Box>
              </Grid>

              {/* Right: Detection Details */}
              <Grid item xs={12} md={5}>
                <Card sx={{ position: { md: 'sticky' }, top: { md: 8 } }}>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>
                      Erkennungs-Details
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary">
                          Gerät: <strong>{selectedDetection.device?.name || 'Unbekannt'}</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary">
                          Zeitstempel: <strong>{new Date(selectedDetection.processedAt).toLocaleString()}</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary">
                          Verarbeitungszeit: <strong>{selectedDetection.processingTime != null && selectedDetection.processingTime !== '' ? `${(Number(selectedDetection.processingTime) / 1000).toFixed(2)} s` : 'N/A'}</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary">
                          Modell: <strong>{selectedDetection.model?.name || 'N/A'}</strong>
                        </Typography>
                      </Grid>
                      {selectedDetection.temperature !== null && selectedDetection.temperature !== undefined && (
                        <Grid item xs={12}>
                          <Typography variant="body2" color="text.secondary">
                            Temperatur: <strong>{selectedDetection.temperature.toFixed(1)}°C</strong>
                          </Typography>
                        </Grid>
                      )}
                      {resolveShootActive(selectedDetection).known && (
                        <Grid item xs={12}>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                            Schuss-Aktionen
                          </Typography>
                          <ShootActiveLabels detection={selectedDetection} />
                        </Grid>
                      )}
                      {(nearestAtPosition.before || nearestAtPosition.after) && (
                        <Grid item xs={12}>
                          <Box display="flex" flexWrap="wrap" gap={1}>
                            {nearestAtPosition.before && (
                              <Chip
                                icon={<ArrowBackIcon />}
                                label={formatTimeDiffAtPosition(nearestAtPosition.before.diffSeconds, 'before')}
                                size="small"
                                variant="outlined"
                                color="info"
                              />
                            )}
                            {nearestAtPosition.after && (
                              <Chip
                                icon={<ArrowForwardIcon />}
                                label={formatTimeDiffAtPosition(nearestAtPosition.after.diffSeconds, 'after')}
                                size="small"
                                variant="outlined"
                                color="info"
                              />
                            )}
                          </Box>
                        </Grid>
                      )}
                      {selectedDetection.camera_position && selectedDetection.camera_position.rotation !== undefined && selectedDetection.camera_position.tilt !== undefined && (
                        <Grid item xs={12}>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                            Kamera-Position (Routenpunkt, Zoom)
                          </Typography>
                          <FormControl size="small" fullWidth disabled={cameraPositionSaving}>
                            <Select
                              value={(() => {
                                const rot = selectedDetection.camera_position.rotation;
                                const tilt = selectedDetection.camera_position.tilt;
                                const idx = deviceRouteCoordinates.findIndex(
                                  (c) => (c.rotation == null ? rot == null : c.rotation === rot) &&
                                    (c.tilt == null ? tilt == null : c.tilt === tilt)
                                );
                                return idx >= 0 ? idx : 'current';
                              })()}
                              onChange={handleCameraPositionChange}
                              displayEmpty
                              MenuProps={{
                                PaperProps: { sx: { maxHeight: 400 } }
                              }}
                              renderValue={(v) => {
                                if (v === 'current') {
                                  const r = selectedDetection.camera_position.rotation;
                                  const t = selectedDetection.camera_position.tilt;
                                  const z = selectedDetection.zoom_factor ?? 1;
                                  return `Aktuell: R: ${r}° / T: ${t}° / Zoom: ${z}x`;
                                }
                                const c = deviceRouteCoordinates[v];
                                if (!c) return '';
                                const imgSrc = c.image
                                  ? (c.image.startsWith('data:') ? c.image : `data:image/jpeg;base64,${c.image}`)
                                  : null;
                                const zoomStr = c.zoom != null ? ` / Zoom: ${c.zoom}x` : '';
                                return (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    {imgSrc && (
                                      <Box
                                        component="img"
                                        src={imgSrc}
                                        alt=""
                                        sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5 }}
                                      />
                                    )}
                                    <span>Position {Number(v) + 1}: R: {c.rotation ?? '-'}° / T: {c.tilt ?? '-'}°{zoomStr}</span>
                                  </Box>
                                );
                              }}
                            >
                              <MenuItem value="current">
                                Aktuell: R: {selectedDetection.camera_position.rotation}° / T: {selectedDetection.camera_position.tilt}° / Zoom: {(selectedDetection.zoom_factor ?? 1)}x
                              </MenuItem>
                              {deviceRouteCoordinates.map((coord, idx) => {
                                const imgSrc = coord.image
                                  ? (coord.image.startsWith('data:') ? coord.image : `data:image/jpeg;base64,${coord.image}`)
                                  : null;
                                const zoomStr = coord.zoom != null ? ` / Zoom: ${coord.zoom}x` : '';
                                return (
                                  <MenuItem key={idx} value={idx}>
                                    <ListItemIcon sx={{ minWidth: 56 }}>
                                      {imgSrc ? (
                                        <Box
                                          component="img"
                                          src={imgSrc}
                                          alt=""
                                          sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5 }}
                                        />
                                      ) : (
                                        <Box sx={{ width: 48, height: 36, bgcolor: 'action.hover', borderRadius: 0.5 }} />
                                      )}
                                    </ListItemIcon>
                                    <ListItemText
                                      primary={`Position ${idx + 1}: R: ${coord.rotation ?? '-'}° / T: ${coord.tilt ?? '-'}°${zoomStr}`}
                                    />
                                  </MenuItem>
                                );
                              })}
                            </Select>
                          </FormControl>
                        </Grid>
                      )}
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Erkannte Objekte:
                        </Typography>
                        <Box display="flex" flexDirection="column" gap={1.5}>
                          {selectedDetection.detections?.map((detection, index) => (
                            <Card
                              key={index}
                              variant="outlined"
                              sx={{
                                p: 1.5,
                                borderWidth: detection.is_target_bird ? 2 : 1,
                                borderColor: detection.is_target_bird ? 'primary.main' : 'divider'
                              }}
                            >
                              <Grid container spacing={1}>
                                <Grid item xs={12}>
                                  <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                    <Chip
                                      label={`${detection.class}`}
                                      size="small"
                                      color="primary"
                                    />
                                    <Chip
                                      label={`${(detection.confidence * 100).toFixed(1)}%`}
                                      size="small"
                                      color="success"
                                      variant="outlined"
                                    />
                                    {detection.is_target_bird && (
                                      <Chip label="Zielvogel" size="small" color="primary" />
                                    )}
                                    {detection.size_category && (
                                      <Chip
                                        label={detection.size_category}
                                        size="small"
                                        variant="outlined"
                                      />
                                    )}
                                  </Box>
                                </Grid>
                                {(detection.esp_rot != null || detection.esp_tilt != null) && (
                                  <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary">
                                      Move: Rot {detection.esp_rot ?? '–'}°, Tilt {detection.esp_tilt ?? '–'}°
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.bbox && (
                                  <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary">
                                      Position (BBox): x={detection.bbox.x}, y={detection.bbox.y}
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.bbox && (
                                  <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary">
                                      Größe (BBox): {detection.bbox.width} × {detection.bbox.height} px
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.position && (
                                  <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary">
                                      Zentrum: ({detection.position.center_x?.toFixed(1)}, {detection.position.center_y?.toFixed(1)})
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.position && (
                                  <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary">
                                      Rel. Größe: {(detection.position.width * 100)?.toFixed(1)}% × {(detection.position.height * 100)?.toFixed(1)}%
                                    </Typography>
                                  </Grid>
                                )}
                              </Grid>
                            </Card>
                          ))}
                        </Box>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseImageDialog}>
            Schließen
          </Button>
          {selectedDetection && (
            <Button
              color="error"
              onClick={() => handleDeleteDetection(selectedDetection)}
            >
              Erkennung löschen
            </Button>
          )}
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
