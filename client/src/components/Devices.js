import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Switch,
  Checkbox,
  Radio,
  RadioGroup,
  Divider,
  Stack
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CheckCircle as OnlineIcon,
  Error as OfflineIcon,
  Warning as WarningIcon,
  Route as RouteIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import RouteEditDialog from './RouteEditDialog';
import { useRouteManagement } from '../hooks/useRouteManagement';
import {
  createCameraEntry,
  normalizeRole,
  legacyCameraFromCameras,
  ensureFormCameras,
  emptyCameraForm,
  defaultTapo,
  defaultRaspberryPi,
  defaultEsp32P4
} from '../utils/deviceCameras';

const RESOLUTION_RECT = [
  { value: '', label: 'Standard (Kamera-Default)' },
  { value: '640x480', label: '640×480 (SD)' },
  { value: '1280x720', label: '1280×720 (HD)' },
  { value: '1920x1080', label: '1920×1080 (Full HD)' },
  { value: '3280x2464', label: '3280×2464 (Full)' }
];

const RESOLUTION_SQUARE = [
  { value: '', label: 'Standard (Kamera-Default)' },
  { value: '640', label: '640×640' },
  { value: '800', label: '800×800' },
  { value: '1024', label: '1024×1024' },
  { value: '1280', label: '1280×1280' },
  { value: '1920', label: '1920×1920' }
];

function resolutionOptions(square) {
  return square ? RESOLUTION_SQUARE : RESOLUTION_RECT;
}

function normalizeResolutionForSquare(resolution, square) {
  const opts = resolutionOptions(square);
  const cur = resolution == null || resolution === ''
    ? (square ? '640' : '640x480')
    : String(resolution);
  if (opts.some((o) => o.value === cur)) return cur;
  // Map common WIDTHxHEIGHT → side when enabling square
  if (square && cur.includes('x')) {
    const [w] = cur.split('x');
    if (opts.some((o) => o.value === w)) return w;
  }
  // Map side → WIDTHxHEIGHT heuristic when disabling square
  if (!square && cur && !cur.includes('x')) {
    const mapped = {
      640: '640x480',
      800: '1280x720',
      1024: '1280x720',
      1280: '1280x720',
      1920: '1920x1080'
    }[cur];
    if (mapped && opts.some((o) => o.value === mapped)) return mapped;
  }
  return '';
}

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [shootTestLoading, setShootTestLoading] = useState(false);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [routeDeviceId, setRouteDeviceId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    location: { name: '', coordinates: { lat: 0, lng: 0 } },
    taubenschiesser: { ip: '', invertRotation: false, invertTilt: false, shootingTimeMs: 500, stabilizeTimeMs: 500, maxWaitBetweenMovesSeconds: 20, shootUseLaser: true, shootUseAudio: false, shootLaserBlink: false, shootLaserBlinkMs: 100, postShotFovCalibrate: false },
    ...emptyCameraForm()
  });
  const navigate = useNavigate();
  const {
    actionsConfig,
    setActionsConfig,
    newCoordinate,
    setNewCoordinate,
    editingIndex,
    updatingImages,
    handleModeChange,
    handleAddCoordinate,
    handleRemoveCoordinate,
    handleEditCoordinate,
    handleUpdateCoordinate,
    handleCancelEdit,
    handleUpdateImage,
    handleUpdateAllImages,
    fetchActionsConfig,
    saveActionsConfig,
    previewImage,
    previewLoading,
    previewError,
    handlePreviewCoordinate,
    clearPreview,
    stitchingInProgress,
    stitchingError,
    panoramaImage,
    panoramaStatistics,
    panoramaTransformationMatrices,
    panoramaImageSizes,
    handleStitchPanorama,
    handleSavePanorama,
    handleSaveRoutePointSettings
  } = useRouteManagement(routeDeviceId);

  useEffect(() => {
    fetchDevices();
  }, []);


  const fetchDevices = async () => {
    try {
      const response = await axios.get('/api/devices');
      setDevices(response.data);
    } catch (error) {
      toast.error('Fehler beim Laden der Geräte');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (device = null) => {
    if (device) {
      setEditingDevice(device);
      const camState = ensureFormCameras(device);
      setFormData({
        name: device.name,
        location: device.location || { name: '', coordinates: { lat: 0, lng: 0 } },
        taubenschiesser: {
          ip: device.taubenschiesser?.ip || '',
          invertRotation: device.taubenschiesser?.invertRotation || false,
          invertTilt: device.taubenschiesser?.invertTilt || false,
          shootingTimeMs: device.taubenschiesser?.shootingTimeMs ?? 500,
          stabilizeTimeMs: device.taubenschiesser?.stabilizeTimeMs ?? 500,
          maxWaitBetweenMovesSeconds: device.taubenschiesser?.maxWaitBetweenMovesSeconds
            ?? device.actions?.waitBetweenMovesSeconds
            ?? 20,
          shootLaserBlink: device.taubenschiesser?.shootLaserBlink ?? false,
          shootLaserBlinkMs: device.taubenschiesser?.shootLaserBlinkMs ?? 100,
          shootUseLaser: device.taubenschiesser?.shootUseLaser !== false,
          shootUseAudio: device.taubenschiesser?.shootUseAudio ?? false,
          postShotFovCalibrate: !!device.taubenschiesser?.postShotFovCalibrate
        },
        ...camState
      });
    } else {
      setEditingDevice(null);
      setFormData({
        name: '',
        location: { name: '', coordinates: { lat: 0, lng: 0 } },
        taubenschiesser: { ip: '', invertRotation: false, invertTilt: false, shootingTimeMs: 500, stabilizeTimeMs: 500, maxWaitBetweenMovesSeconds: 20, shootUseLaser: true, shootUseAudio: false, shootLaserBlink: false, shootLaserBlinkMs: 100, postShotFovCalibrate: false },
        ...emptyCameraForm()
      });
    }
    setOpenDialog(true);
  };

  const setCameras = (nextListOrFn) => {
    setFormData((prev) => {
      const prevList = prev.cameras || [];
      const nextList = typeof nextListOrFn === 'function' ? nextListOrFn(prevList) : nextListOrFn;
      const cameras = normalizeRole(nextList);
      return {
        ...prev,
        cameras,
        camera: legacyCameraFromCameras(cameras, prev.camera)
      };
    });
  };

  const updateCameraAt = (id, patch) => {
    setCameras((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const updateCameraNested = (id, key, nestedPatch) => {
    setCameras((list) => list.map((c) => {
      if (c.id !== id) return c;
      const prevNested = c[key] || (
        key === 'tapo' ? defaultTapo()
          : key === 'esp32P4' ? defaultEsp32P4()
            : defaultRaspberryPi()
      );
      return { ...c, [key]: { ...prevNested, ...nestedPatch } };
    }));
  };

  const addCamera = (type = 'raspberry-pi') => {
    setCameras((list) => {
      const role = list.length === 0 ? 'master' : 'slave';
      return [...list, createCameraEntry(type, role)];
    });
  };

  const removeCamera = (id) => {
    setCameras((list) => {
      const next = list.filter((c) => c.id !== id);
      if (!next.length) {
        toast.warning('Mindestens eine Kamera behalten');
        return list;
      }
      return next;
    });
  };

  const setMasterCamera = (id) => {
    setCameras((list) => list.map((c) => ({
      ...c,
      role: c.id === id ? 'master' : 'slave',
      enabled: true
    })));
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingDevice(null);
  };

  const handleShootTest = async () => {
    if (!editingDevice?._id) return;
    const durationMs = Number(formData.taubenschiesser.shootingTimeMs);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      toast.error('Bitte eine gültige Schussdauer (ms) eingeben.');
      return;
    }
    const laserBlink = !!formData.taubenschiesser.shootLaserBlink;
    const useLaser = formData.taubenschiesser.shootUseLaser !== false;
    const useAudio = !!formData.taubenschiesser.shootUseAudio;
    let laserBlinkMs = Number(formData.taubenschiesser.shootLaserBlinkMs ?? 100);
    if (laserBlink && useLaser) {
      if (!Number.isFinite(laserBlinkMs)) laserBlinkMs = 100;
      laserBlinkMs = Math.min(500, Math.max(20, laserBlinkMs));
    }
    setShootTestLoading(true);
    try {
      await axios.post(`/api/device-control/${editingDevice._id}/control`, {
        action: 'shoot',
        durationMs,
        useLaser,
        useAudio,
        ...(useLaser && laserBlink ? { laserBlink: true, laserBlinkMs } : {})
      });
      const parts = [`${durationMs} ms`];
      if (useLaser) parts.push(laserBlink ? `Laser blinkend ${laserBlinkMs} ms` : 'Laser fest');
      else parts.push('Laser aus');
      if (useAudio) parts.push('Audio an');
      toast.success(`Test-Schuss gesendet (${parts.join(', ')})`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Test-Schuss fehlgeschlagen');
    } finally {
      setShootTestLoading(false);
    }
  };

  const handleRouteDialogOpen = async (deviceId) => {
    setRouteDeviceId(deviceId);
    const result = await fetchActionsConfig(deviceId);
    if (!result.success && result?.message) {
      toast.error(`Fehler beim Laden der Route: ${result.message}`);
      return;
    }
    setRouteDialogOpen(true);
  };

  const handleRouteDialogClose = () => {
    setRouteDialogOpen(false);
    setRouteDeviceId(null);
    handleCancelEdit();
    clearPreview();
  };

  const handleSaveActionsConfig = async () => {
    const result = await saveActionsConfig(routeDeviceId);
    if (result.success) {
      toast.success(result.message);
      handleRouteDialogClose();
    } else {
      toast.error(`Fehler: ${result?.message || 'Route konnte nicht gespeichert werden'}`);
    }
  };

  const handleCoordinateImageUpdate = async (index) => {
    const result = await handleUpdateImage(index, routeDeviceId);
    if (!result?.success && result?.message) {
      toast.error(result.message);
    }
  };

  const handleAllImagesUpdate = async () => {
    const result = await handleUpdateAllImages(routeDeviceId);
    if (!result?.success && result?.message) {
      toast.error(result.message);
    }
  };

  const handlePreviewCoordinateRequest = async () => {
    const result = await handlePreviewCoordinate(routeDeviceId, newCoordinate);
    if (!result?.success && result?.message) {
      toast.error(result.message);
    }
  };

  const handleReorderCoordinates = (draggedIndex, dropIndex) => {
    const newCoordinates = [...actionsConfig.route.coordinates];
    const draggedItem = newCoordinates[draggedIndex];
    newCoordinates.splice(draggedIndex, 1);
    newCoordinates.splice(dropIndex, 0, draggedItem);
    
    // Update order values
    const updatedCoordinates = newCoordinates.map((coord, idx) => ({
      ...coord,
      order: idx
    }));
    
    setActionsConfig(prev => ({
      ...prev,
      route: {
        ...prev.route,
        coordinates: updatedCoordinates
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingDevice) {
        await axios.put(`/api/devices/${editingDevice._id}`, formData);
        toast.success('Gerät erfolgreich aktualisiert');
      } else {
        await axios.post('/api/devices', formData);
        toast.success('Gerät erfolgreich erstellt');
      }
      fetchDevices();
      handleCloseDialog();
    } catch (error) {
      toast.error('Fehler beim Speichern des Geräts');
    }
  };

  const handleDelete = async (deviceId) => {
    if (window.confirm(
      'Gerät wirklich löschen?\n\n'
      + 'Alle zugehörigen Erkennungen, Bilder, Routen- und Panorama-Daten werden unwiderruflich gelöscht.'
    )) {
      try {
        await axios.delete(`/api/devices/${deviceId}`);
        toast.success('Gerät und zugehörige Bilder gelöscht');
        fetchDevices();
      } catch (error) {
        toast.error('Fehler beim Löschen des Geräts');
      }
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'online':
        return <OnlineIcon color="success" />;
      case 'offline':
        return <OfflineIcon color="error" />;
      case 'maintenance':
        return <WarningIcon color="warning" />;
      default:
        return <OfflineIcon color="disabled" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'online':
        return 'success';
      case 'offline':
        return 'error';
      case 'maintenance':
        return 'warning';
      default:
        return 'default';
    }
  };

  const columns = [
    {
      field: 'name',
      headerName: 'Name',
      width: 200,
      renderCell: (params) => (
        <Box display="flex" alignItems="center">
          {getStatusIcon(params.row.status)}
          <Typography sx={{ ml: 1 }}>{params.value}</Typography>
        </Box>
      )
    },
    {
      field: 'status',
      headerName: 'Gesamt-Status',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={getStatusColor(params.value)}
        />
      )
    },
    {
      field: 'taubenschiesserStatus',
      headerName: 'Taubenschiesser',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={getStatusColor(params.value)}
        />
      )
    },
    {
      field: 'cameraStatus',
      headerName: 'Kamera',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={getStatusColor(params.value)}
        />
      )
    },
    {
      field: 'lastSeen',
      headerName: 'Letztes Signal',
      width: 180,
      renderCell: (params) => (
        <Typography variant="body2">
          {new Date(params.value).toLocaleString()}
        </Typography>
      )
    },
    {
      field: 'actions',
      headerName: 'Aktionen',
      width: 250,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            size="small"
            onClick={() => navigate(`/devices/${params.row._id}`)}
            title="Gerät anzeigen"
          >
            <ViewIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleRouteDialogOpen(params.row._id)}
            title="Route bearbeiten"
          >
            <RouteIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleOpenDialog(params.row)}
            title="Gerät bearbeiten"
          >
            <EditIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleDelete(params.row._id)}
            color="error"
            title="Gerät löschen"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      )
    }
  ];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Geräte
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Neues Gerät
        </Button>
      </Box>

      <Card>
        <CardContent>
          <DataGrid
            rows={devices}
            columns={columns}
            loading={loading}
            getRowId={(row) => row._id}
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: {
                paginationModel: { pageSize: 10 }
              }
            }}
            disableRowSelectionOnClick
          />
        </CardContent>
      </Card>

      {/* Add/Edit Device Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingDevice ? 'Gerät bearbeiten' : 'Neues Gerät'}
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Name"
              fullWidth
              variant="outlined"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <TextField
              margin="dense"
              label="Standort"
              fullWidth
              variant="outlined"
              value={formData.location.name}
              onChange={(e) => setFormData({
                ...formData,
                location: { ...formData.location, name: e.target.value }
              })}
            />
            {/* Taubenschiesser Configuration */}
            <TextField
              margin="dense"
              label="Taubenschiesser IP"
              fullWidth
              variant="outlined"
              value={formData.taubenschiesser.ip}
              onChange={(e) => setFormData({
                ...formData,
                taubenschiesser: { ...formData.taubenschiesser, ip: e.target.value }
              })}
              placeholder="192.168.1.100"
              required
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
              <TextField
                margin="dense"
                label="Schussdauer (ms)"
                type="number"
                variant="outlined"
                value={formData.taubenschiesser.shootingTimeMs ?? 500}
                onChange={(e) => setFormData({
                  ...formData,
                  taubenschiesser: { ...formData.taubenschiesser, shootingTimeMs: e.target.value === '' ? 500 : Number(e.target.value) }
                })}
                inputProps={{ min: 0, step: 50 }}
                sx={{ width: 140 }}
              />
              <TextField
                margin="dense"
                label="Stabilize (ms)"
                type="number"
                variant="outlined"
                value={formData.taubenschiesser.stabilizeTimeMs ?? 500}
                onChange={(e) => setFormData({
                  ...formData,
                  taubenschiesser: { ...formData.taubenschiesser, stabilizeTimeMs: e.target.value === '' ? 500 : Number(e.target.value) }
                })}
                inputProps={{ min: 0, step: 50 }}
                sx={{ width: 140 }}
              />
              <TextField
                margin="dense"
                label="Max Wait zwischen Moves (s)"
                type="number"
                variant="outlined"
                value={formData.taubenschiesser.maxWaitBetweenMovesSeconds ?? 20}
                onChange={(e) => setFormData({
                  ...formData,
                  taubenschiesser: {
                    ...formData.taubenschiesser,
                    maxWaitBetweenMovesSeconds: Math.min(300, Math.max(5, Number(e.target.value) || 20))
                  }
                })}
                inputProps={{ min: 5, max: 300, step: 1 }}
                sx={{ width: 190 }}
              />
              {editingDevice?._id && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleShootTest}
                  disabled={shootTestLoading}
                >
                  {shootTestLoading ? 'Sende…' : 'Test-Schuss'}
                </Button>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.taubenschiesser.shootUseLaser !== false}
                    onChange={(e) => setFormData({
                      ...formData,
                      taubenschiesser: {
                        ...formData.taubenschiesser,
                        shootUseLaser: e.target.checked
                      }
                    })}
                  />
                }
                label="Laser nutzen"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={!!formData.taubenschiesser.shootUseAudio}
                    onChange={(e) => setFormData({
                      ...formData,
                      taubenschiesser: {
                        ...formData.taubenschiesser,
                        shootUseAudio: e.target.checked
                      }
                    })}
                  />
                }
                label="Akustische Signale"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={!!formData.taubenschiesser.postShotFovCalibrate}
                    onChange={(e) => setFormData({
                      ...formData,
                      taubenschiesser: {
                        ...formData.taubenschiesser,
                        postShotFovCalibrate: e.target.checked
                      }
                    })}
                  />
                }
                label="FOV bei Erkennung kalibrieren"
              />
            </Box>
            {!!formData.taubenschiesser.postShotFovCalibrate && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, mb: 0.5 }}>
                Nach Speichern einer Tauben-Erkennung: Bildabgleich und FOV-Sample auf die Detection
                (bei scharfem Monitor nach dem Schuss am Aim, sonst vom Wegpunkt). Schreibt kein FOV ins Gerät.
              </Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!formData.taubenschiesser.shootLaserBlink}
                    disabled={formData.taubenschiesser.shootUseLaser === false}
                    onChange={(e) => setFormData({
                      ...formData,
                      taubenschiesser: {
                        ...formData.taubenschiesser,
                        shootLaserBlink: e.target.checked
                      }
                    })}
                  />
                }
                label="Laser blinkend (sonst fest an)"
              />
              <TextField
                margin="dense"
                label="Blink-Intervall (ms)"
                type="number"
                variant="outlined"
                value={formData.taubenschiesser.shootLaserBlinkMs ?? 100}
                onChange={(e) => setFormData({
                  ...formData,
                  taubenschiesser: {
                    ...formData.taubenschiesser,
                    shootLaserBlinkMs: Math.min(500, Math.max(20, Number(e.target.value) || 100))
                  }
                })}
                inputProps={{ min: 20, max: 500, step: 10 }}
                disabled={formData.taubenschiesser.shootUseLaser === false || !formData.taubenschiesser.shootLaserBlink}
                sx={{ width: 170 }}
              />
            </Box>
            <Box sx={{ mt: 2, mb: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                Position-Invertierung
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.taubenschiesser.invertRotation || false}
                    onChange={(e) => setFormData({
                      ...formData,
                      taubenschiesser: { ...formData.taubenschiesser, invertRotation: e.target.checked }
                    })}
                  />
                }
                label="Rotation invertieren (180° - Wert)"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.taubenschiesser.invertTilt || false}
                    onChange={(e) => setFormData({
                      ...formData,
                      taubenschiesser: { ...formData.taubenschiesser, invertTilt: e.target.checked }
                    })}
                  />
                }
                label="Kippung invertieren (180° - Wert)"
              />
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  Wenn aktiviert, werden alle Positionen aus den Routen-Elementen invertiert (180° - Wert).
                  Nützlich, wenn das Gerät in umgekehrter Richtung montiert ist.
                </Typography>
              </Alert>
            </Box>

            {/* Multi-camera Configuration */}
            <Box sx={{ mt: 2, mb: 1 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="subtitle1">Kameras</Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => addCamera('raspberry-pi')}>
                    PiCam
                  </Button>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => addCamera('esp32-p4')}>
                    ESP-P4
                  </Button>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => addCamera('tapo')}>
                    Tapo
                  </Button>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => addCamera('direct')}>
                    RTSP
                  </Button>
                </Stack>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                Genau eine Master-Kamera steuert Aim/FOV/Schuss.
                Mit „Foto vor Vertreibung“ macht die Kamera nach dem Aim und vor dem Schuss ein Still.
                „aktiv“ ist vorerst für alle Kameras fest an.
              </Typography>

              <RadioGroup
                value={(formData.cameras || []).find((c) => c.role === 'master')?.id || ''}
                onChange={(e) => setMasterCamera(e.target.value)}
              >
                {(formData.cameras || []).map((cam, idx) => (
                  <Card key={cam.id} variant="outlined" sx={{ mb: 1.5, p: 1.5 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap">
                      <FormControlLabel
                        value={cam.id}
                        control={<Radio size="small" />}
                        label="Master"
                      />
                      <Chip
                        size="small"
                        color={cam.role === 'master' ? 'primary' : 'default'}
                        label={cam.role === 'master' ? 'Master' : 'Slave'}
                      />
                      <Chip size="small" variant="outlined" label={`#${idx + 1}`} />
                      <Box sx={{ flex: 1 }} />
                      <FormControlLabel
                        control={(
                          <Switch
                            size="small"
                            checked
                            disabled
                          />
                        )}
                        label="aktiv"
                        title="Vorerst immer aktiv"
                      />
                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={!!cam.photoBeforeDeterrence}
                            onChange={(e) => updateCameraAt(cam.id, {
                              photoBeforeDeterrence: e.target.checked
                            })}
                          />
                        )}
                        label="Foto vor Vertreibung"
                        title="Still nach Aim, bevor geschossen/vertrieben wird"
                      />
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => removeCamera(cam.id)}
                        disabled={(formData.cameras || []).length <= 1}
                        title="Kamera entfernen"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                      <TextField
                        size="small"
                        label="Name"
                        fullWidth
                        value={cam.name || ''}
                        onChange={(e) => updateCameraAt(cam.id, { name: e.target.value })}
                      />
                      <FormControl size="small" fullWidth>
                        <InputLabel>Typ</InputLabel>
                        <Select
                          label="Typ"
                          value={cam.type}
                          onChange={(e) => updateCameraAt(cam.id, {
                            type: e.target.value,
                            useLocalImage: e.target.value === 'local'
                          })}
                        >
                          <MenuItem value="tapo">Tapo</MenuItem>
                          <MenuItem value="raspberry-pi">Raspberry Pi</MenuItem>
                          <MenuItem value="esp32-p4">ESP-P4 Cam</MenuItem>
                          <MenuItem value="direct">RTSP direkt</MenuItem>
                          <MenuItem value="local">Lokales Bild</MenuItem>
                        </Select>
                      </FormControl>
                    </Stack>

                    {cam.type === 'tapo' && (
                      <>
                        <TextField
                          margin="dense"
                          size="small"
                          label="Kamera IP"
                          fullWidth
                          value={cam.tapo?.ip || ''}
                          onChange={(e) => updateCameraNested(cam.id, 'tapo', { ip: e.target.value })}
                          placeholder="192.168.1.101"
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Benutzername"
                          fullWidth
                          value={cam.tapo?.username || ''}
                          onChange={(e) => updateCameraNested(cam.id, 'tapo', { username: e.target.value })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Passwort"
                          fullWidth
                          type="text"
                          value={cam.tapo?.password || ''}
                          onChange={(e) => updateCameraNested(cam.id, 'tapo', { password: e.target.value })}
                          helperText="Passwort ist sichtbar für Bearbeitung"
                        />
                        <FormControl fullWidth margin="dense" size="small">
                          <InputLabel>Stream</InputLabel>
                          <Select
                            label="Stream"
                            value={cam.tapo?.stream || 'stream1'}
                            onChange={(e) => updateCameraNested(cam.id, 'tapo', { stream: e.target.value })}
                          >
                            <MenuItem value="stream1">stream1</MenuItem>
                            <MenuItem value="stream2">stream2</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          margin="dense"
                          size="small"
                          label="Diagonal FOV (°)"
                          type="number"
                          fullWidth
                          value={cam.tapo?.fov ?? 110}
                          onChange={(e) => updateCameraNested(cam.id, 'tapo', {
                            fov: parseFloat(e.target.value) || 110
                          })}
                        />
                      </>
                    )}

                    {cam.type === 'raspberry-pi' && (
                      <>
                        <TextField
                          margin="dense"
                          size="small"
                          label="PiCam IP / Hostname"
                          fullWidth
                          value={cam.raspberryPi?.ip || ''}
                          onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', { ip: e.target.value })}
                          placeholder="PiCam oder 192.168.x.x"
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Port"
                          type="number"
                          fullWidth
                          value={cam.raspberryPi?.port ?? 8080}
                          onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', {
                            port: parseInt(e.target.value, 10) || 8080
                          })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Bild-Endpoint"
                          fullWidth
                          value={cam.raspberryPi?.endpoint || '/image.jpg'}
                          onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', { endpoint: e.target.value })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Stream-Endpoint"
                          fullWidth
                          value={cam.raspberryPi?.streamEndpoint || '/stream.mjpeg'}
                          onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', {
                            streamEndpoint: e.target.value
                          })}
                        />
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={!!cam.raspberryPi?.flip}
                              onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', {
                                flip: e.target.checked
                              })}
                            />
                          )}
                          label="Bild um 180° drehen (flip)"
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="FOV (°)"
                          type="number"
                          fullWidth
                          value={cam.raspberryPi?.fov ?? 75}
                          onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', {
                            fov: parseFloat(e.target.value) || 75
                          })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Drehwinkel (°)"
                          type="number"
                          fullWidth
                          value={cam.raspberryPi?.angle ?? 0}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value);
                            updateCameraNested(cam.id, 'raspberryPi', {
                              angle: Number.isNaN(raw) ? 0 : raw
                            });
                          }}
                        />
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={cam.raspberryPi?.square == null ? true : !!cam.raspberryPi.square}
                              onChange={(e) => {
                                const square = e.target.checked;
                                updateCameraNested(cam.id, 'raspberryPi', {
                                  square,
                                  resolution: normalizeResolutionForSquare(
                                    cam.raspberryPi?.resolution,
                                    square
                                  )
                                });
                              }}
                            />
                          )}
                          label="Quadratischer Ausschnitt"
                        />
                        <FormControl fullWidth margin="dense" size="small">
                          <InputLabel>Auflösung</InputLabel>
                          <Select
                            label="Auflösung"
                            value={normalizeResolutionForSquare(
                              cam.raspberryPi?.resolution,
                              cam.raspberryPi?.square == null ? true : !!cam.raspberryPi.square
                            )}
                            onChange={(e) => updateCameraNested(cam.id, 'raspberryPi', {
                              resolution: e.target.value
                            })}
                          >
                            {resolutionOptions(cam.raspberryPi?.square == null ? true : !!cam.raspberryPi.square).map((o) => (
                              <MenuItem key={`pi-${o.value || 'default'}`} value={o.value}>
                                {o.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </>
                    )}

                    {cam.type === 'esp32-p4' && (
                      <>
                        <TextField
                          margin="dense"
                          size="small"
                          label="ESP-P4 IP / Hostname"
                          fullWidth
                          value={cam.esp32P4?.ip || ''}
                          onChange={(e) => updateCameraNested(cam.id, 'esp32P4', { ip: e.target.value })}
                          placeholder="ESP-P4 oder 192.168.x.x"
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Port"
                          type="number"
                          fullWidth
                          value={cam.esp32P4?.port ?? 8080}
                          onChange={(e) => updateCameraNested(cam.id, 'esp32P4', {
                            port: parseInt(e.target.value, 10) || 8080
                          })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Bild-Endpoint"
                          fullWidth
                          value={cam.esp32P4?.endpoint || '/image.jpg'}
                          onChange={(e) => updateCameraNested(cam.id, 'esp32P4', { endpoint: e.target.value })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Stream-Endpoint"
                          fullWidth
                          value={cam.esp32P4?.streamEndpoint || '/stream.mjpeg'}
                          onChange={(e) => updateCameraNested(cam.id, 'esp32P4', {
                            streamEndpoint: e.target.value
                          })}
                        />
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={!!cam.esp32P4?.flip}
                              onChange={(e) => updateCameraNested(cam.id, 'esp32P4', {
                                flip: e.target.checked
                              })}
                            />
                          )}
                          label="Bild um 180° drehen (flip)"
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="FOV (°)"
                          type="number"
                          fullWidth
                          value={cam.esp32P4?.fov ?? 75}
                          onChange={(e) => updateCameraNested(cam.id, 'esp32P4', {
                            fov: parseFloat(e.target.value) || 75
                          })}
                        />
                        <TextField
                          margin="dense"
                          size="small"
                          label="Drehwinkel (°)"
                          type="number"
                          fullWidth
                          value={cam.esp32P4?.angle ?? 0}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value);
                            updateCameraNested(cam.id, 'esp32P4', {
                              angle: Number.isNaN(raw) ? 0 : raw
                            });
                          }}
                        />
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={cam.esp32P4?.square == null ? true : !!cam.esp32P4.square}
                              onChange={(e) => {
                                const square = e.target.checked;
                                updateCameraNested(cam.id, 'esp32P4', {
                                  square,
                                  resolution: normalizeResolutionForSquare(
                                    cam.esp32P4?.resolution,
                                    square
                                  )
                                });
                              }}
                            />
                          )}
                          label="Quadratischer Ausschnitt"
                        />
                        <FormControl fullWidth margin="dense" size="small">
                          <InputLabel>Auflösung</InputLabel>
                          <Select
                            label="Auflösung"
                            value={normalizeResolutionForSquare(
                              cam.esp32P4?.resolution,
                              cam.esp32P4?.square == null ? true : !!cam.esp32P4.square
                            )}
                            onChange={(e) => updateCameraNested(cam.id, 'esp32P4', {
                              resolution: e.target.value
                            })}
                          >
                            {resolutionOptions(cam.esp32P4?.square == null ? true : !!cam.esp32P4.square).map((o) => (
                              <MenuItem key={`p4-${o.value || 'default'}`} value={o.value}>
                                {o.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </>
                    )}

                    {cam.type === 'direct' && (
                      <TextField
                        margin="dense"
                        size="small"
                        label="RTSP URL"
                        fullWidth
                        value={cam.directUrl || ''}
                        onChange={(e) => updateCameraAt(cam.id, { directUrl: e.target.value })}
                        placeholder="rtsp://user:pass@ip:554/stream"
                      />
                    )}

                    {cam.type === 'local' && (
                      <TextField
                        margin="dense"
                        size="small"
                        label="Pfad zum Bild"
                        fullWidth
                        value={cam.localImagePath || ''}
                        onChange={(e) => updateCameraAt(cam.id, {
                          localImagePath: e.target.value,
                          useLocalImage: true
                        })}
                        placeholder="/Users/name/Documents/test.jpg"
                      />
                    )}
                  </Card>
                ))}
              </RadioGroup>
              <Divider sx={{ my: 1 }} />
            </Box>

          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button type="submit" variant="contained">
              {editingDevice ? 'Aktualisieren' : 'Erstellen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Route Bearbeitungs Dialog */}
      <RouteEditDialog
        open={routeDialogOpen}
        onClose={handleRouteDialogClose}
        onSave={handleSaveActionsConfig}
        actionsConfig={actionsConfig}
        newCoordinate={newCoordinate}
        setNewCoordinate={setNewCoordinate}
        editingIndex={editingIndex}
        updatingImages={updatingImages}
        previewImage={previewImage}
        previewLoading={previewLoading}
        previewError={previewError}
        onModeChange={handleModeChange}
        onWaitBetweenMovesChange={() => {}}
        onAddCoordinate={handleAddCoordinate}
        onUpdateCoordinate={handleUpdateCoordinate}
        onCancelEdit={handleCancelEdit}
        onRemoveCoordinate={handleRemoveCoordinate}
        onEditCoordinate={handleEditCoordinate}
        onUpdateImage={(index) => handleCoordinateImageUpdate(index)}
        onUpdateAllImages={handleAllImagesUpdate}
        onPreviewCoordinate={handlePreviewCoordinateRequest}
        onReorderCoordinates={handleReorderCoordinates}
        maxZoom={3}
        stitchingInProgress={stitchingInProgress}
        stitchingError={stitchingError}
        panoramaImage={panoramaImage}
        panoramaStatistics={panoramaStatistics}
        panoramaTransformationMatrices={panoramaTransformationMatrices}
        panoramaImageSizes={panoramaImageSizes}
        onStitchPanorama={(showBorders) => handleStitchPanorama(routeDeviceId, showBorders)}
        onSavePanorama={async () => {
          const result = await handleSavePanorama(routeDeviceId);
          if (result.success) {
            toast.success(result.message || 'Panorama erfolgreich gespeichert');
          } else {
            toast.error(result.message || 'Fehler beim Speichern des Panoramas');
          }
        }}
        onSaveRoutePointSettings={handleSaveRoutePointSettings}
      />
    </Box>
  );
};

export default Devices;
