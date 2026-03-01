import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  Grid,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  ArrowBack as ArrowLeftIcon,
  ArrowForward as ArrowRightIcon,
  PhotoCamera as CameraIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import RouteVisualization from './RouteVisualization';

const PositionPreview = () => {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState({ rotation: 90, tilt: 90, zoom: 1 });
  const [isMoving, setIsMoving] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  
  // Images and analysis for each camera
  const [tapoOriginal, setTapoOriginal] = useState(null);
  const [tapoZoomed, setTapoZoomed] = useState(null);
  const [tapoAnalysis, setTapoAnalysis] = useState(null);
  const [raspberryPiOriginal, setRaspberryPiOriginal] = useState(null);
  const [raspberryPiZoomed, setRaspberryPiZoomed] = useState(null);
  const [raspberryPiAnalysis, setRaspberryPiAnalysis] = useState(null);
  
  // Fallback for single camera mode
  const [originalImage, setOriginalImage] = useState(null);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [analysis, setAnalysis] = useState(null);

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

  const fetchDevice = async (deviceId) => {
    try {
      const response = await axios.get(`/api/devices/${deviceId}`);
      setDevice(response.data);
      // Set initial position from device if available
      if (response.data.actions?.route?.coordinates?.length > 0) {
        const firstCoord = response.data.actions.route.coordinates[0];
        setPosition({
          rotation: firstCoord.rotation || 90,
          tilt: firstCoord.tilt || 90,
          zoom: firstCoord.zoom || 1
        });
      }
    } catch (error) {
      toast.error('Fehler beim Laden des Geräts');
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (selectedDevice) {
      fetchDevice(selectedDevice);
      // Clear previous images
      setTapoOriginal(null);
      setTapoZoomed(null);
      setTapoAnalysis(null);
      setRaspberryPiOriginal(null);
      setRaspberryPiZoomed(null);
      setRaspberryPiAnalysis(null);
      setOriginalImage(null);
      setZoomedImage(null);
      setAnalysis(null);
    }
  }, [selectedDevice]);

  const handleDeviceChange = (event) => {
    setSelectedDevice(event.target.value);
  };

  const handlePositionChange = (field, value) => {
    setPosition(prev => ({
      ...prev,
      [field]: parseFloat(value) || 0
    }));
  };

  const moveDevice = async (deltaRot = 0, deltaTilt = 0) => {
    if (!selectedDevice || isMoving) return;
    
    const newPosition = {
      rotation: position.rotation + deltaRot,
      tilt: position.tilt + deltaTilt,
      zoom: position.zoom || 1
    };
    
    setIsMoving(true);
    try {
      await axios.post(`/api/devices/${selectedDevice}/position-preview/move`, {
        rotation: newPosition.rotation,
        tilt: newPosition.tilt,
        zoom: newPosition.zoom
      });
      setPosition(newPosition);
      toast.success('Gerät bewegt');
    } catch (error) {
      toast.error('Fehler beim Bewegen des Geräts');
    } finally {
      setIsMoving(false);
    }
  };

  const handleRouteCoordinateClick = async (coordinate) => {
    if (!selectedDevice || isMoving) return;
    
    const newPosition = {
      rotation: coordinate.rotation || 90,
      tilt: coordinate.tilt || 90,
      zoom: coordinate.zoom || 1
    };
    
    setPosition(newPosition);
    
    setIsMoving(true);
    try {
      await axios.post(`/api/devices/${selectedDevice}/position-preview/move`, {
        rotation: newPosition.rotation,
        tilt: newPosition.tilt,
        zoom: newPosition.zoom
      });
      toast.success('Zu Routenposition bewegt');
    } catch (error) {
      toast.error('Fehler beim Bewegen zur Routenposition');
    } finally {
      setIsMoving(false);
    }
  };

  const captureAndAnalyze = async () => {
    if (!selectedDevice || isCapturing || isMoving) return;
    
    setIsCapturing(true);
    
    // Clear previous images
    setTapoOriginal(null);
    setTapoZoomed(null);
    setTapoAnalysis(null);
    setRaspberryPiOriginal(null);
    setRaspberryPiZoomed(null);
    setRaspberryPiAnalysis(null);
    setOriginalImage(null);
    setZoomedImage(null);
    setAnalysis(null);
    
    try {
      const isDualMode = device?.camera?.type === 'dual';
      
      if (isDualMode) {
        // Dual camera mode - process each camera separately for progressive updates
        const cameraPromises = [];
        
        // Tapo camera
        if (device.camera.tapo) {
          cameraPromises.push(
            axios.post(`/api/devices/${selectedDevice}/position-preview/capture-camera`, {
              rotation: position.rotation,
              tilt: position.tilt,
              zoom: position.zoom || 1,
              cameraType: 'tapo'
            }).then(response => {
              const data = response.data;
              if (data.tapo) {
                if (data.tapo.error) {
                  toast.error(`Tapo Kamera Fehler: ${data.tapo.error}`);
                } else {
                  if (data.tapo.original) setTapoOriginal(data.tapo.original);
                  if (data.tapo.zoomed) setTapoZoomed(data.tapo.zoomed);
                  if (data.tapo.analysis) {
                    console.log('Tapo analysis data:', data.tapo.analysis);
                    console.log('Tapo image_url:', data.tapo.analysis.image_url);
                    setTapoAnalysis(data.tapo.analysis);
                    const detectionCount = data.tapo.analysis.detection_count || data.tapo.analysis.detections?.length || 0;
                    toast.success(`Tapo Analyse abgeschlossen: ${detectionCount} Objekt(e) erkannt`);
                  }
                }
              }
            }).catch(error => {
              console.error('Tapo camera error:', error);
              toast.error(`Tapo Kamera Fehler: ${error.response?.data?.message || error.message}`);
            })
          );
        }
        
        // Raspberry Pi camera
        if (device.camera.raspberryPi) {
          cameraPromises.push(
            axios.post(`/api/devices/${selectedDevice}/position-preview/capture-camera`, {
              rotation: position.rotation,
              tilt: position.tilt,
              zoom: position.zoom || 1,
              cameraType: 'raspberry-pi'
            }).then(response => {
              const data = response.data;
              if (data.raspberryPi) {
                if (data.raspberryPi.error) {
                  toast.error(`Raspberry Pi Kamera Fehler: ${data.raspberryPi.error}`);
                } else {
                  if (data.raspberryPi.original) setRaspberryPiOriginal(data.raspberryPi.original);
                  if (data.raspberryPi.zoomed) setRaspberryPiZoomed(data.raspberryPi.zoomed);
                  if (data.raspberryPi.analysis) {
                    console.log('Raspberry Pi analysis data:', data.raspberryPi.analysis);
                    console.log('Raspberry Pi image_url:', data.raspberryPi.analysis.image_url);
                    setRaspberryPiAnalysis(data.raspberryPi.analysis);
                    const detectionCount = data.raspberryPi.analysis.detection_count || data.raspberryPi.analysis.detections?.length || 0;
                    toast.success(`Raspberry Pi Analyse abgeschlossen: ${detectionCount} Objekt(e) erkannt`);
                  }
                }
              }
            }).catch(error => {
              console.error('Raspberry Pi camera error:', error);
              toast.error(`Raspberry Pi Kamera Fehler: ${error.response?.data?.message || error.message}`);
            })
          );
        }
        
        // Wait for all cameras to complete (but results are displayed as they arrive)
        const results = await Promise.allSettled(cameraPromises);
        
        // Check if we got any successful results
        const hasSuccess = results.some(r => r.status === 'fulfilled');
        if (!hasSuccess) {
          toast.warning('Keine Bilder empfangen. Bitte prüfen Sie die Kamera-Konfiguration.');
        }
      } else {
        // Single camera mode
        const response = await axios.post(`/api/devices/${selectedDevice}/position-preview/capture-camera`, {
          rotation: position.rotation,
          tilt: position.tilt,
          zoom: position.zoom || 1,
          cameraType: 'single'
        });
        
        const data = response.data;
        
        if (data.error) {
          toast.error(`Kamera Fehler: ${data.error}`);
        } else {
          if (data.original) setOriginalImage(data.original);
          if (data.zoomed) setZoomedImage(data.zoomed);
          if (data.analysis) {
            console.log('Single camera analysis data:', data.analysis);
            console.log('Single camera image_url:', data.analysis.image_url);
            setAnalysis(data.analysis);
            const detectionCount = data.analysis.detection_count || data.analysis.detections?.length || 0;
            toast.success(`Analyse abgeschlossen: ${detectionCount} Objekt(e) erkannt`);
          }
          
          if (!data.original && !data.zoomed && !data.analysis) {
            toast.warning('Keine Bilder empfangen. Bitte prüfen Sie die Kamera-Konfiguration.');
          }
        }
      }
    } catch (error) {
      console.error('Capture error:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Fehler beim Aufnehmen und Analysieren';
      toast.error(errorMessage);
    } finally {
      setIsCapturing(false);
    }
  };

  const renderAnalysisResults = (analysisData, cameraName = '') => {
    if (!analysisData) return null;
    
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {cameraName ? `${cameraName} - ` : ''}Analyseergebnisse
          </Typography>
          
          {/* Detection Stats Table */}
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell><strong>Erkannte Objekte</strong></TableCell>
                  <TableCell><strong>Verarbeitungszeit</strong></TableCell>
                  <TableCell><strong>KI-Modell</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <Typography variant="h6" color="primary">
                      {analysisData.detection_count || analysisData.total_objects || 0}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body1">
                      {analysisData.processing_time != null && analysisData.processing_time !== '' ? `${(Number(analysisData.processing_time) / 1000).toFixed(2)} s` : 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body1">
                      {analysisData.model?.name || 'N/A'}
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* Annotated Image - Show after stats, before detected objects */}
          {analysisData.image_url && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Annotiertes Bild:
              </Typography>
              <Box
                sx={{
                  position: 'relative',
                  display: 'inline-block',
                  maxWidth: '100%'
                }}
              >
                <Box
                  component="img"
                  src={analysisData.image_url}
                  alt="Analyzed image with detections"
                  sx={{
                    maxWidth: '100%',
                    maxHeight: '500px',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    cursor: 'crosshair'
                  }}
                />
              </Box>
            </Box>
          )}

          {/* Detected Objects - Show after annotated image */}
          {analysisData.detections && analysisData.detections.length > 0 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Erkannte Objekte:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {analysisData.detections.map((detection, index) => (
                  <Chip
                    key={index}
                    label={`${detection.class} (${(detection.confidence * 100).toFixed(1)}%)`}
                    color="primary"
                    variant="outlined"
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Detection Details Table */}
          {analysisData.detections && analysisData.detections.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Erkennungsdetails:
              </Typography>
              
              {analysisData.image_info && (
                <Box sx={{ mb: 2, p: 2, backgroundColor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.200' }}>
                  <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    📐 Bildgröße: {analysisData.image_info.original_size?.width} × {analysisData.image_info.original_size?.height} Pixel
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Model Input: {analysisData.image_info.model_input_size?.width} × {analysisData.image_info.model_input_size?.height} Pixel
                  </Typography>
                </Box>
              )}
              
              <TableContainer component={Paper} sx={{ mt: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>ID</strong></TableCell>
                      <TableCell><strong>Objekt</strong></TableCell>
                      <TableCell><strong>Confidence</strong></TableCell>
                      <TableCell><strong>Zentrum</strong></TableCell>
                      <TableCell><strong>Obere Ecke</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {analysisData.detections.map((detection, index) => (
                      <TableRow key={index}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>
                          <Chip
                            label={detection.class}
                            color="primary"
                            variant="outlined"
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="primary">
                            {detection.confidence > 1 ? detection.confidence.toFixed(1) : (detection.confidence * 100).toFixed(1) + '%'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="secondary">
                            ({detection.bbox_original?.x?.toFixed(1) || 'N/A'}, {detection.bbox_original?.y?.toFixed(1) || 'N/A'})
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            ({detection.bbox.x.toFixed(0)}, {detection.bbox.y.toFixed(0)})
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  const coordinates = device?.actions?.route?.coordinates || [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Position Vorschau
        </Typography>
      </Box>

      {/* Device Selection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <FormControl fullWidth>
            <InputLabel>Gerät auswählen</InputLabel>
            <Select
              value={selectedDevice}
              onChange={handleDeviceChange}
              label="Gerät auswählen"
            >
              <MenuItem value="">
                <em>Kein Gerät ausgewählt</em>
              </MenuItem>
              {devices.map((device) => (
                <MenuItem key={device._id} value={device._id}>
                  {device.name} ({device.taubenschiesser?.ip || 'Keine IP'})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      {selectedDevice && device && (
        <Grid container spacing={3}>
          {/* Route Visualization */}
          {coordinates.length > 0 && (
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Route - Position anklicken
                  </Typography>
                  <RouteVisualization 
                    coordinates={coordinates}
                    height={400}
                    showLabels={true}
                    onCoordinateClick={handleRouteCoordinateClick}
                  />
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Position Controls */}
          <Grid item xs={12} md={coordinates.length > 0 ? 6 : 12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Position steuern
                </Typography>
                
                {/* Manual Position Input */}
                <Grid container spacing={2} sx={{ mb: 3 }}>
                  <Grid item xs={4}>
                    <TextField
                      fullWidth
                      label="Rotation"
                      type="number"
                      value={position.rotation}
                      onChange={(e) => handlePositionChange('rotation', e.target.value)}
                      inputProps={{ min: 0, max: 360, step: 1 }}
                    />
                  </Grid>
                  <Grid item xs={4}>
                    <TextField
                      fullWidth
                      label="Tilt"
                      type="number"
                      value={position.tilt}
                      onChange={(e) => handlePositionChange('tilt', e.target.value)}
                      inputProps={{ min: -180, max: 180, step: 1 }}
                    />
                  </Grid>
                  <Grid item xs={4}>
                    <TextField
                      fullWidth
                      label="Zoom"
                      type="number"
                      value={position.zoom || 1}
                      onChange={(e) => handlePositionChange('zoom', e.target.value)}
                      inputProps={{ min: 0.1, max: 10, step: 0.1 }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Button
                      fullWidth
                      variant="contained"
                      onClick={() => moveDevice(0, 0)}
                      disabled={isMoving}
                    >
                      Zu Position bewegen
                    </Button>
                  </Grid>
                </Grid>

                {/* Direction Controls */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Schnellsteuerung
                  </Typography>
                  
                  {/* Up Button */}
                  <Button
                    variant="outlined"
                    onClick={() => moveDevice(0, 10)}
                    disabled={isMoving}
                    startIcon={<ArrowUpIcon />}
                  >
                    Hoch
                  </Button>
                  
                  {/* Middle Row - Left, Capture, Right */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Button
                      variant="outlined"
                      onClick={() => moveDevice(-10, 0)}
                      disabled={isMoving}
                      startIcon={<ArrowLeftIcon />}
                    >
                      Links
                    </Button>
                    
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={captureAndAnalyze}
                      disabled={isCapturing || isMoving}
                      startIcon={<CameraIcon />}
                      sx={{ minWidth: 120 }}
                    >
                      {isCapturing ? 'Aufnahme...' : 'Aufnehmen & Analysieren'}
                    </Button>
                    
                    <Button
                      variant="outlined"
                      onClick={() => moveDevice(10, 0)}
                      disabled={isMoving}
                      startIcon={<ArrowRightIcon />}
                    >
                      Rechts
                    </Button>
                  </Box>
                  
                  {/* Down Button */}
                  <Button
                    variant="outlined"
                    onClick={() => moveDevice(0, -10)}
                    disabled={isMoving}
                    startIcon={<ArrowDownIcon />}
                  >
                    Runter
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Images and Analysis - Dual Camera Mode */}
          {(tapoOriginal || raspberryPiOriginal || originalImage || tapoZoomed || raspberryPiZoomed || zoomedImage) && (
            <>
              {/* Dual Camera Mode - Side by Side */}
              {(tapoOriginal || raspberryPiOriginal) && (
                <>
                  <Grid item xs={12}>
                    <Typography variant="h5" gutterBottom sx={{ mt: 2 }}>
                      Kamera-Ansichten
                    </Typography>
                  </Grid>
                  
                  {/* Left Column - Tapo Camera */}
                  <Grid item xs={12} md={6}>
                    {tapoOriginal ? (
                      <>
                        <Card sx={{ mb: 2 }}>
                          <CardContent>
                            <Typography variant="h6" gutterBottom>
                              Tapo Kamera - Original
                            </Typography>
                            <Box
                              component="img"
                              src={tapoOriginal}
                              alt="Tapo Original"
                              sx={{
                                width: '100%',
                                height: 400,
                                objectFit: 'contain',
                                borderRadius: 1,
                                border: '1px solid #ddd',
                                backgroundColor: '#f5f5f5'
                              }}
                            />
                          </CardContent>
                        </Card>
                        <Card sx={{ mb: 2 }}>
                          <CardContent>
                            <Typography variant="h6" gutterBottom>
                              Tapo Kamera - Gezoomt (Analyse-Eingabe)
                            </Typography>
                            {tapoZoomed ? (
                              <Box
                                component="img"
                                src={tapoZoomed}
                                alt="Tapo Zoomed"
                                sx={{
                                  width: '100%',
                                  height: 400,
                                  objectFit: 'contain',
                                  borderRadius: 1,
                                  border: '1px solid #ddd',
                                  backgroundColor: '#f5f5f5'
                                }}
                              />
                            ) : (
                              <Box
                                sx={{
                                  width: '100%',
                                  height: 300,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  border: '2px dashed #ccc',
                                  borderRadius: 1,
                                  backgroundColor: '#f5f5f5'
                                }}
                              >
                                <Typography color="textSecondary">
                                  Kein Zoom-Bild verfügbar
                                </Typography>
                              </Box>
                            )}
                          </CardContent>
                        </Card>
                        {tapoAnalysis && (
                          <Box sx={{ mb: 2 }}>
                            {renderAnalysisResults(tapoAnalysis, 'Tapo')}
                          </Box>
                        )}
                      </>
                    ) : (
                      <Card>
                        <CardContent>
                          <Typography variant="body2" color="textSecondary" align="center">
                            Tapo Kamera - Keine Daten
                          </Typography>
                        </CardContent>
                      </Card>
                    )}
                  </Grid>
                  
                  {/* Right Column - Raspberry Pi Camera */}
                  <Grid item xs={12} md={6}>
                    {raspberryPiOriginal ? (
                      <>
                        <Card sx={{ mb: 2 }}>
                          <CardContent>
                            <Typography variant="h6" gutterBottom>
                              Raspberry Pi Kamera - Original
                            </Typography>
                            <Box
                              component="img"
                              src={raspberryPiOriginal}
                              alt="Raspberry Pi Original"
                              sx={{
                                width: '100%',
                                height: 400,
                                objectFit: 'contain',
                                borderRadius: 1,
                                border: '1px solid #ddd',
                                backgroundColor: '#f5f5f5'
                              }}
                            />
                          </CardContent>
                        </Card>
                        <Card sx={{ mb: 2 }}>
                          <CardContent>
                            <Typography variant="h6" gutterBottom>
                              Raspberry Pi Kamera - Gezoomt (Analyse-Eingabe)
                            </Typography>
                            {raspberryPiZoomed ? (
                              <Box
                                component="img"
                                src={raspberryPiZoomed}
                                alt="Raspberry Pi Zoomed"
                                sx={{
                                  width: '100%',
                                  height: 400,
                                  objectFit: 'contain',
                                  borderRadius: 1,
                                  border: '1px solid #ddd',
                                  backgroundColor: '#f5f5f5'
                                }}
                              />
                            ) : (
                              <Box
                                sx={{
                                  width: '100%',
                                  height: 300,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  border: '2px dashed #ccc',
                                  borderRadius: 1,
                                  backgroundColor: '#f5f5f5'
                                }}
                              >
                                <Typography color="textSecondary">
                                  Kein Zoom-Bild verfügbar
                                </Typography>
                              </Box>
                            )}
                          </CardContent>
                        </Card>
                        {raspberryPiAnalysis && (
                          <Box sx={{ mb: 2 }}>
                            {renderAnalysisResults(raspberryPiAnalysis, 'Raspberry Pi')}
                          </Box>
                        )}
                      </>
                    ) : (
                      <Card>
                        <CardContent>
                          <Typography variant="body2" color="textSecondary" align="center">
                            Raspberry Pi Kamera - Keine Daten
                          </Typography>
                        </CardContent>
                      </Card>
                    )}
                  </Grid>
                </>
              )}
              
              {/* Single Camera Mode */}
              {!tapoOriginal && !raspberryPiOriginal && originalImage && (
                <>
                  <Grid item xs={12}>
                    <Typography variant="h5" gutterBottom sx={{ mt: 2 }}>
                      Kamera
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Original Bild
                        </Typography>
                        <Box
                          component="img"
                          src={originalImage}
                          alt="Original"
                          sx={{
                            width: '100%',
                            height: 400,
                            objectFit: 'contain',
                            borderRadius: 1,
                            border: '1px solid #ddd',
                            backgroundColor: '#f5f5f5'
                          }}
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Card>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Gezoomtes Bild (Analyse-Eingabe)
                        </Typography>
                        {zoomedImage ? (
                          <Box
                            component="img"
                            src={zoomedImage}
                            alt="Zoomed"
                            sx={{
                              width: '100%',
                              height: 400,
                              objectFit: 'contain',
                              borderRadius: 1,
                              border: '1px solid #ddd',
                              backgroundColor: '#f5f5f5'
                            }}
                          />
                        ) : (
                          <Box
                            sx={{
                              width: '100%',
                              height: 300,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '2px dashed #ccc',
                              borderRadius: 1,
                              backgroundColor: '#f5f5f5'
                            }}
                          >
                            <Typography color="textSecondary">
                              Kein Zoom-Bild verfügbar
                            </Typography>
                          </Box>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                  {analysis && (
                    <Grid item xs={12}>
                      {renderAnalysisResults(analysis)}
                    </Grid>
                  )}
                </>
              )}
            </>
          )}
        </Grid>
      )}

      {!selectedDevice && (
        <Alert severity="info">
          Bitte wähle ein Gerät aus, um die Position Vorschau zu verwenden.
        </Alert>
      )}
    </Box>
  );
};

export default PositionPreview;

