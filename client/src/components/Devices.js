import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
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
  Paper,
  Slider,
  CircularProgress,
  Checkbox,
  Switch
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CheckCircle as OnlineIcon,
  Error as OfflineIcon,
  Warning as WarningIcon,
  Route as RouteIcon,
  PhotoCamera as PhotoCameraIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import RouteEditDialog from './RouteEditDialog';
import { useRouteManagement } from '../hooks/useRouteManagement';

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [routeDeviceId, setRouteDeviceId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    location: { name: '', coordinates: { lat: 0, lng: 0 } },
    taubenschiesser: { ip: '', invertRotation: false, invertTilt: false },
    camera: { 
      type: 'tapo',
      directUrl: '',
      rtspUrl: '',
      tapo: { ip: '', username: '', password: '', stream: 'stream1', fov: 110 },
      raspberryPi: { ip: '', port: 8080, endpoint: '/image.jpg', streamEndpoint: '/stream.mjpeg', flip: false, fov: 75 },
      useLocalImage: false,
      localImagePath: ''
    }
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
    handleSavePanorama
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
      setFormData({
        name: device.name,
        location: device.location || { name: '', coordinates: { lat: 0, lng: 0 } },
        taubenschiesser: {
          ip: device.taubenschiesser?.ip || '',
          invertRotation: device.taubenschiesser?.invertRotation || false,
          invertTilt: device.taubenschiesser?.invertTilt || false
        },
        camera: device.camera || { 
          type: 'tapo',
          directUrl: '',
          rtspUrl: '',
          tapo: { ip: '', username: '', password: '', stream: 'stream1', fov: 110 },
          raspberryPi: { ip: '', port: 8080, endpoint: '/image.jpg', streamEndpoint: '/stream.mjpeg', flip: false, fov: 75 },
          useLocalImage: false,
          localImagePath: ''
        }
      });
    } else {
      setEditingDevice(null);
      setFormData({
        name: '',
        location: { name: '', coordinates: { lat: 0, lng: 0 } },
        taubenschiesser: { ip: '', invertRotation: false, invertTilt: false },
        camera: { 
          type: 'tapo',
          directUrl: '',
          rtspUrl: '',
          tapo: { ip: '', username: '', password: '', stream: 'stream1', fov: 110 },
          raspberryPi: { ip: '', port: 8080, endpoint: '/image.jpg', streamEndpoint: '/stream.mjpeg', flip: false, fov: 75 },
          useLocalImage: false,
          localImagePath: ''
        }
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingDevice(null);
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

  const handleCoordinateSubmit = () => {
    if (editingIndex !== null) {
      handleUpdateCoordinate();
    } else {
      handleAddCoordinate();
    }
    clearPreview();
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
    if (window.confirm('Gerät wirklich löschen?')) {
      try {
        await axios.delete(`/api/devices/${deviceId}`);
        toast.success('Gerät erfolgreich gelöscht');
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

            {/* Camera Configuration */}
            <FormControl fullWidth margin="dense">
              <InputLabel>Kamera-Typ</InputLabel>
              <Select
                value={formData.camera.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  const updatedCamera = { 
                    ...formData.camera, 
                    type: newType,
                    // Set useLocalImage based on type (keep path for easy switching)
                    useLocalImage: newType === 'local'
                  };
                  setFormData({
                    ...formData,
                    camera: updatedCamera
                  });
                }}
                label="Kamera-Typ"
              >
                <MenuItem value="direct">Direkter RTSP-Link</MenuItem>
                <MenuItem value="tapo">Tapo Kamera</MenuItem>
                <MenuItem value="raspberry-pi">Raspberry Pi Kamera</MenuItem>
                <MenuItem value="dual">Dual (Tapo + Raspberry Pi)</MenuItem>
                <MenuItem value="local">Lokales Bild (Test)</MenuItem>
              </Select>
            </FormControl>

            {/* Tapo Camera Configuration */}
            {formData.camera.type === 'tapo' && (
              <>
                <TextField
                  margin="dense"
                  label="Kamera IP"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.tapo.ip}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, ip: e.target.value }
                    }
                  })}
                  placeholder="192.168.1.101"
                />
                <TextField
                  margin="dense"
                  label="Benutzername"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.tapo.username}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, username: e.target.value }
                    }
                  })}
                />
                <TextField
                  margin="dense"
                  label="Passwort"
                  fullWidth
                  variant="outlined"
                  type="text"
                  value={formData.camera.tapo.password}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, password: e.target.value }
                    }
                  })}
                  helperText="Passwort ist sichtbar für Bearbeitung"
                />
                <FormControl fullWidth margin="dense">
                  <InputLabel>Stream</InputLabel>
                  <Select
                    value={formData.camera.tapo.stream}
                    onChange={(e) => setFormData({
                      ...formData,
                      camera: {
                        ...formData.camera,
                        tapo: { ...formData.camera.tapo, stream: e.target.value }
                      }
                    })}
                    label="Stream"
                  >
                    <MenuItem value="stream1">Stream 1 (1920x1080, 30fps)</MenuItem>
                    <MenuItem value="stream2">Stream 2 (640x480, 30fps)</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  margin="dense"
                  label="Diagonal Field of View (FOV) in Grad"
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={formData.camera.tapo.fov || 110}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, fov: parseFloat(e.target.value) || 110 }
                    }
                  })}
                  helperText="Diagonaler Bildwinkel in Grad (Standard: 110° für Tapo)"
                  inputProps={{ min: 1, max: 180, step: 0.1 }}
                />
              </>
            )}

            {/* Direct RTSP URL */}
            {formData.camera.type === 'direct' && (
              <TextField
                margin="dense"
                label="RTSP URL"
                fullWidth
                variant="outlined"
                value={formData.camera.directUrl}
                onChange={(e) => setFormData({
                  ...formData,
                  camera: { ...formData.camera, directUrl: e.target.value }
                })}
                placeholder="rtsp://user:pass@ip:port/stream"
              />
            )}

            {/* Raspberry Pi Camera Configuration */}
            {formData.camera.type === 'raspberry-pi' && (
              <>
                <TextField
                  margin="dense"
                  label="Raspberry Pi IP/Hostname"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.raspberryPi?.ip || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        ip: e.target.value,
                        port: formData.camera.raspberryPi?.port || 8080,
                        endpoint: formData.camera.raspberryPi?.endpoint || '/image.jpg',
                        streamEndpoint: formData.camera.raspberryPi?.streamEndpoint || '/stream.mjpeg'
                      }
                    }
                  })}
                  placeholder="PiCam oder 192.168.1.100"
                  helperText="Hostname (z.B. PiCam) oder IP-Adresse"
                />
                <TextField
                  margin="dense"
                  label="Port"
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={formData.camera.raspberryPi?.port || 8080}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        port: parseInt(e.target.value) || 8080
                      }
                    }
                  })}
                  helperText="Standard: 8080"
                />
                <TextField
                  margin="dense"
                  label="Image Endpoint"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.raspberryPi?.endpoint || '/image.jpg'}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        endpoint: e.target.value
                      }
                    }
                  })}
                  helperText="Endpoint für Einzelbilder (Standard: /image.jpg)"
                />
                <TextField
                  margin="dense"
                  label="Stream Endpoint"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.raspberryPi?.streamEndpoint || '/stream.mjpeg'}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        streamEndpoint: e.target.value
                      }
                    }
                  })}
                  helperText="Endpoint für MJPEG-Stream (Standard: /stream.mjpeg)"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.camera.raspberryPi?.flip || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        camera: {
                          ...formData.camera,
                          raspberryPi: { 
                            ...(formData.camera.raspberryPi || {}),
                            flip: e.target.checked
                          }
                        }
                      })}
                    />
                  }
                  label="Bild um 180° drehen"
                />
                <TextField
                  margin="dense"
                  label="Raspberry Pi Diagonal FOV (Grad)"
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={formData.camera.raspberryPi?.fov || 75}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        fov: parseFloat(e.target.value) || 75
                      }
                    }
                  })}
                  helperText="Diagonaler Bildwinkel in Grad (Standard: 75° für Raspberry Pi Camera Module 3)"
                  inputProps={{ min: 1, max: 180, step: 0.1 }}
                />
              </>
            )}

            {/* Dual Camera Configuration */}
            {formData.camera.type === 'dual' && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, fontWeight: 'bold' }}>
                  Tapo Kamera
                </Typography>
                <TextField
                  margin="dense"
                  label="Kamera IP"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.tapo?.ip || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { 
                        ...(formData.camera.tapo || {}),
                        ip: e.target.value,
                        username: formData.camera.tapo?.username || '',
                        password: formData.camera.tapo?.password || '',
                        stream: formData.camera.tapo?.stream || 'stream1'
                      }
                    }
                  })}
                  placeholder="192.168.1.101"
                />
                <TextField
                  margin="dense"
                  label="Benutzername"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.tapo?.username || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { 
                        ...(formData.camera.tapo || {}),
                        username: e.target.value
                      }
                    }
                  })}
                />
                <TextField
                  margin="dense"
                  label="Passwort"
                  fullWidth
                  variant="outlined"
                  type="text"
                  value={formData.camera.tapo?.password || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { 
                        ...(formData.camera.tapo || {}),
                        password: e.target.value
                      }
                    }
                  })}
                  helperText="Passwort ist sichtbar für Bearbeitung"
                />
                <FormControl fullWidth margin="dense">
                  <InputLabel>Stream</InputLabel>
                  <Select
                    value={formData.camera.tapo?.stream || 'stream1'}
                    onChange={(e) => setFormData({
                      ...formData,
                      camera: {
                        ...formData.camera,
                        tapo: { 
                          ...(formData.camera.tapo || {}),
                          stream: e.target.value
                        }
                      }
                    })}
                    label="Stream"
                  >
                    <MenuItem value="stream1">Stream 1 (1920x1080, 30fps)</MenuItem>
                    <MenuItem value="stream2">Stream 2 (640x480, 30fps)</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  margin="dense"
                  label="Tapo Diagonal FOV (Grad)"
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={formData.camera.tapo?.fov || 110}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { 
                        ...(formData.camera.tapo || {}),
                        fov: parseFloat(e.target.value) || 110
                      }
                    }
                  })}
                  helperText="Diagonaler Bildwinkel in Grad (Standard: 110° für Tapo, Master-Kamera)"
                  inputProps={{ min: 1, max: 180, step: 0.1 }}
                />

                <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, fontWeight: 'bold' }}>
                  Raspberry Pi Kamera
                </Typography>
                <TextField
                  margin="dense"
                  label="Raspberry Pi IP/Hostname"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.raspberryPi?.ip || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        ip: e.target.value,
                        port: formData.camera.raspberryPi?.port || 8080,
                        endpoint: formData.camera.raspberryPi?.endpoint || '/image.jpg',
                        streamEndpoint: formData.camera.raspberryPi?.streamEndpoint || '/stream.mjpeg'
                      }
                    }
                  })}
                  placeholder="PiCam oder 192.168.1.100"
                  helperText="Hostname (z.B. PiCam) oder IP-Adresse"
                />
                <TextField
                  margin="dense"
                  label="Port"
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={formData.camera.raspberryPi?.port || 8080}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        port: parseInt(e.target.value) || 8080
                      }
                    }
                  })}
                  helperText="Standard: 8080"
                />
                <TextField
                  margin="dense"
                  label="Image Endpoint"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.raspberryPi?.endpoint || '/image.jpg'}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        endpoint: e.target.value
                      }
                    }
                  })}
                  helperText="Endpoint für Einzelbilder (Standard: /image.jpg)"
                />
                <TextField
                  margin="dense"
                  label="Stream Endpoint"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.raspberryPi?.streamEndpoint || '/stream.mjpeg'}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        streamEndpoint: e.target.value
                      }
                    }
                  })}
                  helperText="Endpoint für MJPEG-Stream (Standard: /stream.mjpeg)"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formData.camera.raspberryPi?.flip || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        camera: {
                          ...formData.camera,
                          raspberryPi: { 
                            ...(formData.camera.raspberryPi || {}),
                            flip: e.target.checked
                          }
                        }
                      })}
                    />
                  }
                  label="Bild um 180° drehen"
                />
                <TextField
                  margin="dense"
                  label="Raspberry Pi Diagonal FOV (Grad)"
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={formData.camera.raspberryPi?.fov || 75}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      raspberryPi: { 
                        ...(formData.camera.raspberryPi || {}),
                        fov: parseFloat(e.target.value) || 75
                      }
                    }
                  })}
                  helperText="Diagonaler Bildwinkel in Grad (Standard: 75° für Raspberry Pi Camera Module 3, wird automatisch an Tapo-FOV angepasst)"
                  inputProps={{ min: 1, max: 180, step: 0.1 }}
                />
              </>
            )}

            {/* Local Image Configuration */}
            {formData.camera.type === 'local' && (
              <>
                <TextField
                  margin="dense"
                  label="Pfad zum Bild"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.localImagePath || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: { 
                      ...formData.camera, 
                      useLocalImage: true,
                      localImagePath: e.target.value 
                    }
                  })}
                  placeholder="/Users/name/Documents/test.jpg oder images/bird.jpg"
                  helperText="Absoluter Pfad oder relativ zum Arbeitsordner"
                />
              </>
            )}

            {/* Legacy RTSP URL for backward compatibility */}
            <TextField
              margin="dense"
              label="Legacy RTSP URL (für Rückwärtskompatibilität)"
              fullWidth
              variant="outlined"
              value={formData.camera.rtspUrl}
              onChange={(e) => setFormData({
                ...formData,
                camera: { ...formData.camera, rtspUrl: e.target.value }
              })}
              placeholder="rtsp://user:pass@ip:port/stream"
            />
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
      />
    </Box>
  );
};

export default Devices;
