import React, { useState, useEffect, useMemo } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  LinearProgress,
  IconButton,
  Button,
  ButtonGroup,
  Paper,
  Avatar,
  Tooltip,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Devices as DevicesIcon,
  PlayArrow as PlayIcon,
  RotateLeft as RotateLeftIcon,
  RotateRight as RotateRightIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  Camera as CameraIcon,
  Settings as SettingsIcon,
  Refresh as RefreshIcon,
  PlayCircleOutline as StartIcon,
  PauseCircleOutline as PauseIcon2
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import axios from 'axios';
import Chart from 'react-apexcharts';

// Helper component for stream display
const StreamDisplay = ({ streamUrl, currentImage, isLoading, loadTimeoutRef, setIsLoading, setCurrentImage, setStreamUrl, toggleStream, cameraName, isMjpeg = false, imageRef = null }) => {
  if (!streamUrl) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <CircularProgress size={40} />
        <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
          Stream wird vorbereitet...
        </Typography>
      </Box>
    );
  }
  
  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Loading-Indikator */}
      {isLoading && (
        <Box sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 10,
          backgroundColor: 'rgba(0,0,0,0.4)',
          color: 'rgba(255,255,255,0.8)',
          padding: '3px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 300
        }}>
          Aktualisiere...
        </Box>
      )}
      {/* Camera name label */}
      <Box sx={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 10,
        backgroundColor: 'rgba(0,0,0,0.6)',
        color: 'rgba(255,255,255,0.9)',
        padding: '4px 8px',
        borderRadius: '3px',
        fontSize: '11px',
        fontWeight: 500
      }}>
        {cameraName}
      </Box>
      <Box 
        sx={{ 
          position: 'relative', 
          width: '100%', 
          height: '100%',
          cursor: 'pointer',
          '&:hover': {
            opacity: 0.95
          }
        }}
        onClick={toggleStream}
        title="Klicken um Stream zu stoppen"
      >
        {/* For MJPEG streams, use img tag directly */}
        {isMjpeg ? (
          <img
            ref={imageRef}
            src={streamUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
            alt={`${cameraName} Stream`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '4px'
            }}
            onError={(e) => {
              console.error(`${cameraName} stream error:`, e);
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
              }
              setIsLoading(false);
            }}
            onLoad={() => {
              console.log(`${cameraName} stream loaded`);
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
              }
              setIsLoading(false);
            }}
          />
        ) : (
          <>
            {/* Altes Bild - wird ausgeblendet wenn neues Bild lädt */}
            {currentImage && !isLoading && (
              <img
                src={currentImage}
                alt={`Previous ${cameraName} Stream`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  zIndex: 1
                }}
              />
            )}
            
            {/* Neues Bild - bleibt immer sichtbar, auch während des Ladens */}
            <img
              src={streamUrl}
              alt={`${cameraName} Stream`}
              crossOrigin="anonymous"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: '4px',
                zIndex: 2
              }}
              onError={(e) => {
                console.error(`${cameraName} image load error:`, e);
                if (loadTimeoutRef.current) {
                  clearTimeout(loadTimeoutRef.current);
                }
                setIsLoading(false);
              }}
              onLoad={() => {
                console.log(`${cameraName} image loaded for:`, streamUrl);
                if (loadTimeoutRef.current) {
                  clearTimeout(loadTimeoutRef.current);
                }
                setCurrentImage(streamUrl);
                setIsLoading(false);
              }}
              onLoadStart={() => {
                console.log(`${cameraName} image loading started for:`, streamUrl);
                setIsLoading(true);
              }}
            />
          </>
        )}
      </Box>
    </Box>
  );
};

// Helper component for stream placeholder
const StreamPlaceholder = ({ toggleStream, cameraName }) => (
  <Box textAlign="center">
    <CameraIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
    <Typography variant="body2" color="textSecondary">
      {cameraName} Stream nicht aktiv
    </Typography>
    <Button
      variant="outlined"
      startIcon={<PlayIcon />}
      onClick={toggleStream}
      sx={{ mt: 1 }}
    >
      Stream starten
    </Button>
  </Box>
);

// Status-Farbe für Geräte/Chips (modulweit, damit DeviceCard nicht bei jedem Dashboard-Render remountet)
const getDeviceStatusColor = (status) => {
  switch (status) {
    case 'online':
      return 'success';
    case 'offline':
      return 'error';
    case 'maintenance':
      return 'warning';
    case 'device_waiting':
      return 'info';
    case 'device_moving':
      return 'warning';
    case 'device_stopped':
    case 'device_stabilizing':
      return 'success';
    case 'device_busy':
      return 'warning';
    case 'analysis_started':
    case 'analyzing':
    case 'analyzing_cv':
    case 'capturing':
      return 'primary';
    case 'cv_analysis_complete':
    case 'birds_detected':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
};

/* eslint-disable no-unused-vars */
// Ausgelagerte Geräte-Karte (modulweit definiert, verhindert Remount bei Dashboard-Updates)
export const DeviceCard = ({
  device,
  isStreaming,
  position = { rot: 0, tilt: 0 },
  deviceStatus,
  onToggleStream,
  onDeviceControl
}) => {
  const [streamUrl, setStreamUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const loadTimeoutRef = React.useRef(null);
  const [raspberryPiStreamUrl, setRaspberryPiStreamUrl] = useState(null);
  const [raspberryPiIsLoading, setRaspberryPiIsLoading] = useState(false);
  const [raspberryPiCurrentImage, setRaspberryPiCurrentImage] = useState(null);
  const raspberryPiLoadTimeoutRef = React.useRef(null);
  const raspberryPiImageRef = React.useRef(null);
  const navigate = useNavigate();

  const hasTapo = device.camera?.tapo?.ip && device.camera?.tapo?.username && device.camera?.tapo?.password;
  const hasRaspberryPi = device.camera?.raspberryPi?.ip;
  const isDualCamera = hasTapo && hasRaspberryPi;

  const normalized = useMemo(() => {
    const rot = Math.max(0, Math.min(360, Number(position.rot) || 0));
    const tiltVal = Math.max(0, Math.min(180, Number(position.tilt) || 0));
    const rotPct = rot / 360;
    const tiltPct = tiltVal / 180;
    return { rotPct, tiltPct, rot, tilt: tiltVal };
  }, [position]);

  useEffect(() => {
    if (isStreaming && device && hasTapo) {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
      const imageUrl = `${API_URL}/api/device-image/${device._id}`;
      setStreamUrl(imageUrl);
      setCurrentImage(imageUrl);
      const interval = setInterval(() => {
        if (isStreaming && !isLoading) {
          const timestamp = Date.now();
          const updatedUrl = `${imageUrl}?t=${timestamp}`;
          setIsLoading(true);
          setStreamUrl(updatedUrl);
          loadTimeoutRef.current = setTimeout(() => {
            setIsLoading(false);
          }, 10000);
        }
      }, 3000);
      return () => {
        clearInterval(interval);
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      };
    } else {
      setStreamUrl(null);
    }
  }, [isStreaming, device, hasTapo, isLoading]);

  useEffect(() => {
    if (isStreaming && device && hasRaspberryPi) {
      const imgEl = raspberryPiImageRef.current;
      const timeoutId = raspberryPiLoadTimeoutRef.current;
      const pi = device.camera.raspberryPi;
      const piIp = pi.ip;
      const piPort = pi.port || 8080;
      const streamEndpoint = pi.streamEndpoint || '/stream.mjpeg';
      const piFlip = pi.flip || false;
      const piAngle = typeof pi.angle === 'number' ? pi.angle : 0;
      const piSquare = pi.square || false;
      const piResolution = pi.resolution;
      let streamUrl = `http://${piIp}:${piPort}${streamEndpoint}`;
      const params = [];
      if (piFlip) params.push('flip=true');
      if (piAngle && !Number.isNaN(piAngle)) params.push(`angle=${piAngle}`);
      if (piSquare) params.push('square=true');
      if (piResolution) params.push(`resolution=${encodeURIComponent(piResolution)}`);
      if (params.length) {
        const separator = streamEndpoint.includes('?') ? '&' : '?';
        streamUrl = `${streamUrl}${separator}${params.join('&')}`;
      }
      setRaspberryPiStreamUrl(streamUrl);
      setRaspberryPiCurrentImage(streamUrl);
      setRaspberryPiIsLoading(false);
      return () => {
        if (imgEl) {
          imgEl.src = '';
          imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        setRaspberryPiStreamUrl(null);
        setRaspberryPiCurrentImage(null);
        if (timeoutId) clearTimeout(timeoutId);
      };
    } else {
      if (raspberryPiImageRef.current) {
        raspberryPiImageRef.current.src = '';
        raspberryPiImageRef.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
      setRaspberryPiStreamUrl(null);
      setRaspberryPiCurrentImage(null);
    }
  }, [isStreaming, device, hasRaspberryPi]);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center">
            <Avatar
              sx={{
                bgcolor: getDeviceStatusColor(device.status) + '.main',
                mr: 1,
                width: 48,
                height: 48
              }}
            >
              <img
                src="/images/icon.png"
                alt="Taubenschiesser"
                style={{
                  width: '36px',
                  height: '36px',
                  objectFit: 'contain',
                  filter: 'brightness(0) invert(1)',
                  opacity: 0.95
                }}
              />
            </Avatar>
            <Box>
              <Typography variant="h6">{device.name}</Typography>
              <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                <Tooltip title={`Taubenschiesser: ${device.taubenschiesserStatus || 'offline'}`}>
                  <Chip
                    icon={<DevicesIcon />}
                    label={device.taubenschiesserStatus || 'offline'}
                    size="small"
                    color={getDeviceStatusColor(device.taubenschiesserStatus)}
                    sx={{ fontSize: '0.75rem' }}
                  />
                </Tooltip>
                <Tooltip title={`Kamera: ${device.cameraStatus || 'offline'}`}>
                  <Chip
                    icon={<CameraIcon />}
                    label={device.cameraStatus || 'offline'}
                    size="small"
                    color={getDeviceStatusColor(device.cameraStatus)}
                    sx={{ fontSize: '0.75rem' }}
                  />
                </Tooltip>
              </Box>
            </Box>
          </Box>
          <Box display="flex" gap={1}>
            <Tooltip title="Gerät-Einstellungen">
              <IconButton onClick={() => navigate(`/devices/${device._id}`)}>
                <SettingsIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Status aktualisieren">
              <IconButton onClick={() => onDeviceControl('refresh')}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {isDualCamera ? (
          <Box sx={{ mb: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Paper sx={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100', position: 'relative', maxHeight: '400px', mb: 2 }}>
                  {isStreaming ? (
                    <StreamDisplay
                      streamUrl={streamUrl}
                      currentImage={currentImage}
                      isLoading={isLoading}
                      loadTimeoutRef={loadTimeoutRef}
                      setIsLoading={setIsLoading}
                      setCurrentImage={setCurrentImage}
                      setStreamUrl={setStreamUrl}
                      toggleStream={onToggleStream}
                      cameraName="Tapo"
                    />
                  ) : (
                    <StreamPlaceholder toggleStream={onToggleStream} cameraName="Tapo" />
                  )}
                </Paper>
              </Grid>
              <Grid item xs={12}>
                <Paper sx={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100', position: 'relative', maxHeight: '400px' }}>
                  {isStreaming ? (
                    <StreamDisplay
                      streamUrl={raspberryPiStreamUrl}
                      currentImage={raspberryPiCurrentImage}
                      isLoading={raspberryPiIsLoading}
                      loadTimeoutRef={raspberryPiLoadTimeoutRef}
                      setIsLoading={setRaspberryPiIsLoading}
                      setCurrentImage={setRaspberryPiCurrentImage}
                      setStreamUrl={setRaspberryPiStreamUrl}
                      toggleStream={onToggleStream}
                      cameraName="Raspberry Pi"
                      isMjpeg={true}
                      imageRef={raspberryPiImageRef}
                    />
                  ) : (
                    <StreamPlaceholder toggleStream={onToggleStream} cameraName="Raspberry Pi" />
                  )}
                </Paper>
              </Grid>
            </Grid>
          </Box>
        ) : (
          <Paper sx={{ width: '100%', aspectRatio: '16/9', mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100', position: 'relative', maxHeight: '400px' }}>
            {isStreaming ? (
              hasRaspberryPi && !hasTapo ? (
                <StreamDisplay
                  streamUrl={raspberryPiStreamUrl}
                  currentImage={raspberryPiCurrentImage}
                  isLoading={raspberryPiIsLoading}
                  loadTimeoutRef={raspberryPiLoadTimeoutRef}
                  setIsLoading={setRaspberryPiIsLoading}
                  setCurrentImage={setRaspberryPiCurrentImage}
                  setStreamUrl={setRaspberryPiStreamUrl}
                  toggleStream={onToggleStream}
                  cameraName="Raspberry Pi"
                  isMjpeg={true}
                  imageRef={raspberryPiImageRef}
                />
              ) : (
                <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
                  {isLoading && (
                    <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.8)', padding: '3px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 300 }}>
                      Aktualisiere...
                    </Box>
                  )}
                  {streamUrl ? (
                    <Box sx={{ position: 'relative', width: '100%', height: '100%', cursor: 'pointer', '&:hover': { opacity: 0.95 } }} onClick={onToggleStream} title="Klicken um Stream zu stoppen">
                      {currentImage && (
                        <img
                          src={currentImage}
                          alt="Previous Device Stream"
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', zIndex: 1 }}
                        />
                      )}
                      <img
                        src={streamUrl}
                        alt="Device Stream"
                        crossOrigin="anonymous"
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', opacity: isLoading ? 0 : 1, transition: 'opacity 0.3s ease', zIndex: 2 }}
                        onError={() => { if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current); setIsLoading(false); }}
                        onLoad={() => { if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current); setCurrentImage(streamUrl); setIsLoading(false); }}
                        onLoadStart={() => setIsLoading(true)}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <CircularProgress size={40} />
                      <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>Stream wird vorbereitet...</Typography>
                    </Box>
                  )}
                </Box>
              )
            ) : (
              <Box textAlign="center">
                <CameraIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
                <Typography variant="body2" color="textSecondary">Stream nicht aktiv</Typography>
                <Button variant="outlined" startIcon={<PlayIcon />} onClick={onToggleStream} sx={{ mt: 1 }}>Stream starten</Button>
              </Box>
            )}
          </Paper>
        )}

        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom textAlign="center">Steuerung</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ position: 'relative', width: 8, height: 110, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.round(normalized.tiltPct * 100)}%`, bgcolor: '#1976d2' }} />
              </Box>
              <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666', minWidth: '20px', textAlign: 'center' }}>{normalized.tilt.toFixed(0)}°</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ position: 'relative', width: 190, height: 8, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                  <Box sx={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.round(normalized.rotPct * 100)}%`, bgcolor: '#1976d2' }} />
                </Box>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666' }}>{normalized.rot.toFixed(0)}°</Typography>
              </Box>
              <Button variant="outlined" size="small" onClick={() => onDeviceControl('move_up')} sx={{ minWidth: 60 }}><ArrowUpIcon /></Button>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button variant="outlined" size="small" onClick={() => onDeviceControl('rotate_left')} sx={{ minWidth: 60 }}><RotateLeftIcon /></Button>
                <Button variant="outlined" size="small" onClick={() => onDeviceControl('shoot')} sx={{ minWidth: 60 }}>✚</Button>
                <Button variant="outlined" size="small" onClick={() => onDeviceControl('rotate_right')} sx={{ minWidth: 60 }}><RotateRightIcon /></Button>
              </Box>
              <Button variant="outlined" size="small" onClick={() => onDeviceControl('move_down')} sx={{ minWidth: 60 }}><ArrowDownIcon /></Button>
              <Button variant="outlined" color="warning" size="small" onClick={() => onDeviceControl('reset')} sx={{ mt: 1, minWidth: 60 }}>Reset</Button>
            </Box>
            <Box sx={{ flex: 1 }} />
          </Box>
        </Box>

        <Box mb={2}>
          <Typography variant="caption" color="textSecondary" gutterBottom sx={{ display: 'block' }}>Hardware Monitor Status:</Typography>
          {deviceStatus ? (
            <>
              <Chip label={deviceStatus.message} color={getDeviceStatusColor(deviceStatus.status)} size="small" sx={{ fontSize: '0.7rem' }} />
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>{deviceStatus.timestamp.toLocaleTimeString()}</Typography>
            </>
          ) : (
            <Chip label="Kein Status verfügbar" color="default" size="small" sx={{ fontSize: '0.7rem' }} />
          )}
        </Box>

        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom>Geräte-Steuerung</Typography>
          <ButtonGroup variant="outlined" size="small" fullWidth>
            <Tooltip title="Überwachung starten">
              <Button onClick={() => onDeviceControl('start')} color={device.monitorStatus === 'running' ? 'success' : 'primary'} variant={device.monitorStatus === 'running' ? 'contained' : 'outlined'}>
                <StartIcon />
              </Button>
            </Tooltip>
            <Tooltip title="Überwachung pausieren">
              <Button onClick={() => onDeviceControl('pause')} color={device.monitorStatus === 'paused' ? 'warning' : 'primary'} variant={device.monitorStatus === 'paused' ? 'contained' : 'outlined'}>
                <PauseIcon2 />
              </Button>
            </Tooltip>
          </ButtonGroup>
          <Box mt={1} textAlign="center">
            <Chip label={device.monitorStatus === 'running' ? 'Läuft' : device.monitorStatus === 'paused' ? 'Pausiert' : 'Gestoppt'} color={device.monitorStatus === 'running' ? 'success' : device.monitorStatus === 'paused' ? 'warning' : 'default'} size="small" />
          </Box>
        </Box>

        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom>Schießen bei Erkennung</Typography>
          <ButtonGroup variant="outlined" size="small" fullWidth>
            <Tooltip title="Bei Taubenerkennung schießen und speichern">
              <Button onClick={() => onDeviceControl('arm')} color={device.monitorArmed ? 'error' : 'primary'} variant={device.monitorArmed ? 'contained' : 'outlined'}>
                Scharf
              </Button>
            </Tooltip>
            <Tooltip title="Nur speichern, nicht schießen">
              <Button onClick={() => onDeviceControl('disarm')} color={!device.monitorArmed ? 'success' : 'primary'} variant={!device.monitorArmed ? 'contained' : 'outlined'}>
                Sicher
              </Button>
            </Tooltip>
          </ButtonGroup>
          <Box mt={1} textAlign="center">
            <Chip label={device.monitorArmed ? 'Scharf' : 'Sicher'} color={device.monitorArmed ? 'error' : 'success'} size="small" />
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="textSecondary">IP: {device.taubenschiesser?.ip || 'Nicht gesetzt'}</Typography>
          <br />
          <Typography variant="caption" color="textSecondary">Letztes Signal: {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Nie'}</Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

// Detection Chart Component - Using ApexCharts with memoization to prevent blinking
export const DetectionChart = React.memo(({ device, detectionStats }) => {
  // Ensure device._id is converted to string for consistent lookup
  const deviceIdStr = String(device._id);
  const data = detectionStats[deviceIdStr] || [];
  
  console.log(`[DetectionChart] Device ${deviceIdStr} (${device.name}):`, {
    hasData: data.length > 0,
    dataLength: data.length,
    availableStats: Object.keys(detectionStats),
    data: data.slice(0, 3) // Log first 3 entries
  });
  
  if (data.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" align="center" sx={{ py: 2 }}>
        Keine Daten für diesen Zeitraum
      </Typography>
    );
  }

  // Gestapelte Balken: Unkategorisiert, Taube, Keine Taube
  const chartOptions = {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      animations: { enabled: false }
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        borderRadius: 0
      }
    },
    dataLabels: { enabled: false },
    stroke: {
      show: true,
      width: 1,
      colors: ['#fff']
    },
    xaxis: {
      type: 'datetime',
      labels: {
        rotate: -45,
        rotateAlways: true,
        style: { fontSize: '12px' },
        datetimeFormatter: {
          year: 'yyyy',
          month: 'dd.MM',
          day: 'dd.MM',
          hour: 'dd.MM'
        }
      }
    },
    yaxis: {
      title: { show: false },
      axisTicks: { show: true },
      axisBorder: { show: true },
      labels: {
        style: { fontSize: '11px' },
        formatter: (val) => Math.round(val)
      },
      min: 0,
      forceNiceScale: true
    },
    fill: { opacity: 1 },
    legend: {
      position: 'bottom',
      horizontalAlign: 'center',
    },
    colors: ['#9e9e9e', '#4caf50', '#f44336'],
    tooltip: {
      shared: true,
      intersect: false,
      y: [
        { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
        { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
        { formatter: (val) => (val != null ? val + ' Erkennungen' : '') }
      ]
    }
  };

  const series = [
    { name: 'Unkategorisiert', data: data.map(item => [new Date(item.date).getTime(), item.unclassified || 0]) },
    { name: 'Taube', data: data.map(item => [new Date(item.date).getTime(), item.confirmed_pigeon || 0]) },
    { name: 'Keine Taube', data: data.map(item => [new Date(item.date).getTime(), item.no_pigeon || 0]) }
  ];

  return (
    <Chart
      options={chartOptions}
      series={series}
      type="bar"
      height={300}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if device ID or detection stats changed
  const prevDeviceId = String(prevProps.device._id);
  const nextDeviceId = String(nextProps.device._id);
  const prevData = prevProps.detectionStats[prevDeviceId] || [];
  const nextData = nextProps.detectionStats[nextDeviceId] || [];
  
  // Compare device ID
  if (prevDeviceId !== nextDeviceId) return false;
  
  // Compare data length
  if (prevData.length !== nextData.length) return false;
  
  // Deep comparison of data (compare JSON strings for simplicity)
  if (prevData.length > 0 && nextData.length > 0) {
    const prevDataStr = JSON.stringify(prevData);
    const nextDataStr = JSON.stringify(nextData);
    if (prevDataStr !== nextDataStr) return false;
  }
  
  return true; // Props are equal, skip re-render
});

// Taube + Temperatur Chart: Balken (Anzahl Taube) + Kurve (Ø Temperatur)
export const TaubeTempChart = React.memo(({ device, detectionStats }) => {
  const deviceIdStr = String(device._id);
  const data = detectionStats[deviceIdStr] || [];
  const hasTempData = data.some(item => item.avg_temp_pigeon != null);

  if (data.length === 0) return null;

  const chartOptions = {
    chart: {
      type: 'line',
      stacked: false,
      toolbar: { show: false },
      animations: { enabled: false }
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        borderRadius: 0
      }
    },
    stroke: {
      show: true,
      width: [1, hasTempData ? 1.5 : 0],
      colors: ['#fff', '#f44336']
    },
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime',
      labels: {
        rotate: -45,
        rotateAlways: true,
        style: { fontSize: '12px' },
        datetimeFormatter: {
          year: 'yyyy',
          month: 'dd.MM',
          day: 'dd.MM',
          hour: 'dd.MM'
        }
      }
    },
    yaxis: hasTempData
      ? [
          {
            seriesName: 'Taube',
            title: { show: false },
            axisTicks: { show: true },
            axisBorder: { show: true },
            labels: {
              style: { fontSize: '11px' },
              formatter: (val) => Math.round(val)
            },
            min: 0,
            forceNiceScale: true
          },
          {
            seriesName: 'Ø Temp',
            opposite: true,
            title: { show: false },
            axisTicks: { show: true },
            axisBorder: { show: true, color: '#f44336' },
            labels: {
              style: { colors: '#f44336', fontSize: '11px' },
              formatter: (val) => Math.round(val)
            },
            min: 0,
            forceNiceScale: true
          }
        ]
      : [
          {
            title: { show: false },
            axisTicks: { show: true },
            axisBorder: { show: true },
            labels: {
              style: { fontSize: '11px' },
              formatter: (val) => Math.round(val)
            },
            min: 0,
            forceNiceScale: true
          }
        ],
    fill: { opacity: 1 },
    legend: { position: 'bottom', horizontalAlign: 'center' },
    colors: ['#4caf50', '#f44336'],
    tooltip: {
      shared: true,
      intersect: false,
      y: hasTempData
        ? [
            { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
            { formatter: (val) => (val != null ? val + ' °C' : '') }
          ]
        : [{ formatter: (val) => (val != null ? val + ' Erkennungen' : '') }]
    }
  };

  const series = [
    {
      name: 'Taube',
      type: 'column',
      showInLegend: false,
      data: data.map(item => [new Date(item.date).getTime(), item.confirmed_pigeon || 0])
    },
    ...(hasTempData
      ? [{
          name: 'Ø Temp',
          type: 'line',
          data: data.map(item => [
            new Date(item.date).getTime(),
            item.avg_temp_pigeon != null ? item.avg_temp_pigeon : null
          ])
        }]
      : [])
  ];

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" color="textSecondary" gutterBottom>
        Tauben-Erkennungen & Temperatur
      </Typography>
      <Chart
        options={chartOptions}
        series={series}
        type="line"
        height={220}
      />
    </Box>
  );
}, (prevProps, nextProps) => {
  const prevDeviceId = String(prevProps.device._id);
  const nextDeviceId = String(nextProps.device._id);
  const prevData = prevProps.detectionStats[prevDeviceId] || [];
  const nextData = nextProps.detectionStats[nextDeviceId] || [];
  if (prevDeviceId !== nextDeviceId) return false;
  if (prevData.length !== nextData.length) return false;
  if (prevData.length > 0 && nextData.length > 0) {
    if (JSON.stringify(prevData) !== JSON.stringify(nextData)) return false;
  }
  return true;
});



/* eslint-enable no-unused-vars */
const Dashboard = () => {
  const [devices, setDevices] = useState([]);
  const [devicePositions, setDevicePositions] = useState({}); // { [deviceId]: { rot, tilt } }
  const [deviceStatuses, setDeviceStatuses] = useState({}); // { [deviceId]: { status, message, timestamp } }
  const [loading, setLoading] = useState(true);
  const [streamingDevices, setStreamingDevices] = useState({});
  const [detectionStats, setDetectionStats] = useState({});
  const [hourlyStats, setHourlyStats] = useState({});
  const navigate = useNavigate();
  const { socket, connected } = useSocket();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Subscribe to hardware monitor events for all loaded devices to track live rot/tilt
  useEffect(() => {
    if (!socket || !connected || devices.length === 0) return;

    const roomsJoined = new Set();

    const handleMonitorEvent = (event) => {
      const { deviceId, eventType, data } = event || {};
      if (!deviceId || !data) return;

      // Try to extract rotation/tilt from several possible shapes
      const rot = (data?.position?.rot ?? data?.rot ?? data?.rotation);
      const tilt = (data?.position?.tilt ?? data?.tilt);

      if (typeof rot === 'number' || typeof tilt === 'number') {
        setDevicePositions(prev => ({
          ...prev,
          [deviceId]: {
            rot: typeof rot === 'number' ? rot : (prev[deviceId]?.rot ?? 0),
            tilt: typeof tilt === 'number' ? tilt : (prev[deviceId]?.tilt ?? 0)
          }
        }));
      }

      // Update device status for hardware monitor events
      if (eventType && data?.message) {
        setDeviceStatuses(prev => ({
          ...prev,
          [deviceId]: {
            status: eventType,
            message: data.message,
            timestamp: new Date()
          }
        }));
      }
    };

    // Join all monitor rooms for current devices
    devices.forEach(d => {
      if (d?._id && !roomsJoined.has(d._id)) {
        const monitorRoom = `monitor-${d._id}`;
        socket.emit('join', monitorRoom);
        roomsJoined.add(d._id);
      }
    });

    socket.on('hardware-monitor-event', handleMonitorEvent);

    return () => {
      socket.off('hardware-monitor-event', handleMonitorEvent);
      // Leave rooms
      roomsJoined.forEach(id => {
        const monitorRoom = `monitor-${id}`;
        socket.emit('leave', monitorRoom);
      });
    };
  }, [socket, connected, devices]);

  const fetchDashboardData = async () => {
    try {
      const [devicesResponse, statsResponse, hourlyResponse] = await Promise.all([
        axios.get('/api/devices'),
        axios.get('/api/cv/detections/statistics?days=30').catch(() => ({ data: { statistics: [] } })),
        axios.get('/api/cv/detections/statistics/hourly?days=30').catch(() => ({ data: { statistics: [] } }))
      ]);

      const devicesData = devicesResponse.data;
      const stats = statsResponse.data.statistics || [];
      const hourly = hourlyResponse.data.statistics || [];

      // Convert statistics to map by deviceId
      // Ensure deviceId is always a string for consistent lookup
      const statsMap = {};
      stats.forEach(stat => {
        // Ensure deviceId is string
        const deviceIdStr = String(stat.deviceId);
        statsMap[deviceIdStr] = stat.data;
        console.log(`[DetectionStats] Mapped stats for device ${deviceIdStr}:`, stat.data?.length || 0, 'days');
      });
      
      console.log('[DetectionStats] Stats map:', Object.keys(statsMap));
      console.log('[DetectionStats] Devices:', devicesData.map(d => ({ id: d._id, name: d.name })));
      
      setDetectionStats(statsMap);

      const hourlyMap = {};
      hourly.forEach(stat => {
        hourlyMap[String(stat.deviceId)] = stat.data;
      });
      setHourlyStats(hourlyMap);

      // Ensure monitorStatus is set for all devices
      const devicesWithStatus = devicesData.map(device => ({
        ...device,
        monitorStatus: device.monitorStatus || 'paused',
        monitorArmed: device.monitorArmed ?? false
      }));

      setDevices(devicesWithStatus);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Socket-Events für Echtzeit-Updates
  useEffect(() => {
    if (socket && connected) {
      socket.on('device-update', (device) => {
        setDevices(prevDevices => 
          prevDevices.map(d => d._id === device._id ? device : d)
        );
      });

      // Sofortige Status-Änderungen
      socket.on('device-status-change', (statusChange) => {
        console.log('Device status changed:', statusChange);
        
        // Visuelles Feedback für Status-Änderung
        const device = devices.find(d => d._id === statusChange.deviceId);
        if (device) {
          const componentName = statusChange.component === 'taubenschiesser' ? 'Taubenschiesser' : 'Kamera';
          const statusText = statusChange.status === 'online' ? 'online' : 'offline';
          console.log(`🔄 ${device.name}: ${componentName} ist jetzt ${statusText}`);
        }
        
        setDevices(prevDevices => 
          prevDevices.map(d => {
            if (d._id === statusChange.deviceId) {
              const updated = { ...d };
              if (statusChange.component === 'taubenschiesser') {
                updated.taubenschiesserStatus = statusChange.status;
              } else if (statusChange.component === 'camera') {
                updated.cameraStatus = statusChange.status;
              }
              // Recalculate overall status
              updated.status = calculateOverallStatus(updated.taubenschiesserStatus, updated.cameraStatus);
              return updated;
            }
            return d;
          })
        );
      });

      return () => {
        socket.off('device-update');
        socket.off('device-status-change');
      };
    }
  }, [socket, connected, devices]);

  // Helper function to calculate overall status
  const calculateOverallStatus = (taubenschiesserStatus, cameraStatus) => {
    if (taubenschiesserStatus === 'online' && cameraStatus === 'online') return 'online';
    if (taubenschiesserStatus === 'online' || cameraStatus === 'online') return 'maintenance';
    return 'offline';
  };

  // Geräte-Steuerung
  const handleDeviceControl = async (deviceId, action) => {
    try {
      if (action === 'refresh') {
        // Status aktualisieren
        const response = await axios.post(`/api/device-control/${deviceId}/refresh`);
        console.log(`Refreshing device ${deviceId}:`, response.data);
        
        // Erfolgsmeldung anzeigen
        if (response.data.success) {
          console.log('Device status updated successfully');
        }
        return;
      }

      if (action === 'start') {
        // Geräte-Überwachung starten
        const response = await axios.post(`/api/device-control/${deviceId}/start`);
        console.log(`Starting device monitoring ${deviceId}:`, response.data);
        
        if (response.data.success) {
          console.log('Device monitoring started');
          // Update device status in state
          setDevices(prevDevices => 
            prevDevices.map(d => 
              d._id === deviceId 
                ? { ...d, monitorStatus: 'running' }
                : d
            )
          );
        }
        return;
      }

      if (action === 'pause') {
        // Geräte-Überwachung pausieren
        const response = await axios.post(`/api/device-control/${deviceId}/pause`);
        console.log(`Pausing device monitoring ${deviceId}:`, response.data);
        
        if (response.data.success) {
          console.log('Device monitoring paused');
          // Update device status in state
          setDevices(prevDevices => 
            prevDevices.map(d => 
              d._id === deviceId 
                ? { ...d, monitorStatus: 'paused' }
                : d
            )
          );
        }
        return;
      }

      if (action === 'arm' || action === 'disarm') {
        // Monitor scharf (schießen bei Taube) oder sicher (nur Detection speichern)
        const armed = action === 'arm';
        const response = await axios.patch(`/api/device-control/${deviceId}/arm`, { armed });
        console.log(`Monitor ${armed ? 'armed' : 'disarmed'} for ${deviceId}:`, response.data);
        if (response.data.success) {
          setDevices(prevDevices =>
            prevDevices.map(d =>
              d._id === deviceId ? { ...d, monitorArmed: armed } : d
            )
          );
        }
        return;
      }

      // MQTT-Befehl senden
      const response = await axios.post(`/api/device-control/${deviceId}/control`, {
        action
      });

      console.log(`Command '${action}' sent to device ${deviceId}:`, response.data);
      
      // Erfolgsmeldung anzeigen (optional)
      // toast.success(`Befehl '${action}' gesendet`);
      
    } catch (error) {
      console.error('Error controlling device:', error);
      
      // Spezifische Fehlermeldungen
      if (error.response?.data?.error) {
        console.error('Server error:', error.response.data.error);
        if (error.response.data.details) {
          console.error('Details:', error.response.data.details);
        }
        
        // MQTT-spezifische Fehlermeldungen
        if (error.response.data.error.includes('MQTT')) {
          console.error('MQTT connection issue. Check MQTT settings in Profile → Settings');
        }
      } else {
        console.error('Network error:', error.message);
      }
      
      // toast.error(`Fehler beim Senden des Befehls: ${error.response?.data?.error || error.message}`);
    }
  };

  // RTSP-Stream starten/stoppen (nur Frontend-Toggle, keine Server-Konvertierung)
  const toggleStream = async (deviceId) => {
    try {
      const isStreaming = streamingDevices[deviceId];
      
      // Direkter Frontend-Toggle - keine Server-Konvertierung nötig
      setStreamingDevices(prev => ({ ...prev, [deviceId]: !isStreaming }));
      
      console.log(`RTSP Stream ${!isStreaming ? 'gestartet' : 'gestoppt'} für Gerät ${deviceId} (direkt im Browser)`);
      
    } catch (error) {
      console.error('Error toggling RTSP stream:', error);
    }
  };

  // RTSP-Stream-Status ist immer verfügbar (keine Server-Abfrage nötig)
  // const getStreamStatus = async (deviceId) => {
  //   // Nicht mehr nötig - RTSP-Streams sind direkt verfügbar
  //   return { active: streamingDevices[deviceId] };
  // };

  const getStatusColor = (status) => {
    switch (status) {
      case 'online':
        return 'success';
      case 'offline':
        return 'error';
      case 'maintenance':
        return 'warning';
      // Hardware Monitor Status Colors
      case 'device_waiting':
        return 'info';
      case 'device_moving':
        return 'warning';
      case 'device_stopped':
      case 'device_stabilizing':
        return 'success';
      case 'device_busy':
        return 'warning';
      case 'analysis_started':
      case 'analyzing':
      case 'analyzing_cv':
      case 'capturing':
        return 'primary';
      case 'cv_analysis_complete':
      case 'birds_detected':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  // Detection Chart Component - Using ApexCharts with memoization to prevent blinking
  const DetectionChart = React.memo(({ device, detectionStats }) => {
    // Ensure device._id is converted to string for consistent lookup
    const deviceIdStr = String(device._id);
    const data = detectionStats[deviceIdStr] || [];
    
    console.log(`[DetectionChart] Device ${deviceIdStr} (${device.name}):`, {
      hasData: data.length > 0,
      dataLength: data.length,
      availableStats: Object.keys(detectionStats),
      data: data.slice(0, 3) // Log first 3 entries
    });
    
    if (data.length === 0) {
      return (
        <Typography variant="body2" color="textSecondary" align="center" sx={{ py: 2 }}>
          Keine Daten für diesen Zeitraum
        </Typography>
      );
    }

    // Gestapelte Balken: Unkategorisiert, Taube, Keine Taube
    const chartOptions = {
      chart: {
        type: 'bar',
        stacked: true,
        toolbar: { show: false },
        animations: { enabled: false }
      },
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '55%',
          borderRadius: 0
        }
      },
      dataLabels: { enabled: false },
      stroke: {
        show: true,
        width: 1,
        colors: ['#fff']
      },
      xaxis: {
        type: 'datetime',
        labels: {
          rotate: -45,
          rotateAlways: true,
          style: { fontSize: '12px' },
          datetimeFormatter: {
            year: 'yyyy',
            month: 'dd.MM',
            day: 'dd.MM',
            hour: 'dd.MM'
          }
        }
      },
      yaxis: {
        title: { show: false },
        axisTicks: { show: true },
        axisBorder: { show: true },
        labels: {
          style: { fontSize: '11px' },
          formatter: (val) => Math.round(val)
        },
        min: 0,
        forceNiceScale: true
      },
      fill: { opacity: 1 },
      legend: {
        position: 'bottom',
        horizontalAlign: 'center',
      },
      colors: ['#9e9e9e', '#4caf50', '#f44336'],
      tooltip: {
        shared: true,
        intersect: false,
        y: [
          { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
          { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
          { formatter: (val) => (val != null ? val + ' Erkennungen' : '') }
        ]
      }
    };

    const series = [
      { name: 'Unkategorisiert', data: data.map(item => [new Date(item.date).getTime(), item.unclassified || 0]) },
      { name: 'Taube', data: data.map(item => [new Date(item.date).getTime(), item.confirmed_pigeon || 0]) },
      { name: 'Keine Taube', data: data.map(item => [new Date(item.date).getTime(), item.no_pigeon || 0]) }
    ];

    return (
      <Chart
        options={chartOptions}
        series={series}
        type="bar"
        height={300}
      />
    );
  }, (prevProps, nextProps) => {
    // Custom comparison: only re-render if device ID or detection stats changed
    const prevDeviceId = String(prevProps.device._id);
    const nextDeviceId = String(nextProps.device._id);
    const prevData = prevProps.detectionStats[prevDeviceId] || [];
    const nextData = nextProps.detectionStats[nextDeviceId] || [];
    
    // Compare device ID
    if (prevDeviceId !== nextDeviceId) return false;
    
    // Compare data length
    if (prevData.length !== nextData.length) return false;
    
    // Deep comparison of data (compare JSON strings for simplicity)
    if (prevData.length > 0 && nextData.length > 0) {
      const prevDataStr = JSON.stringify(prevData);
      const nextDataStr = JSON.stringify(nextData);
      if (prevDataStr !== nextDataStr) return false;
    }
    
    return true; // Props are equal, skip re-render
  });

  // Taube + Temperatur Chart: Balken (Anzahl Taube) + Kurve (Ø Temperatur)
  const TaubeTempChart = React.memo(({ device, detectionStats }) => {
    const deviceIdStr = String(device._id);
    const data = detectionStats[deviceIdStr] || [];
    const hasTempData = data.some(item => item.avg_temp_pigeon != null);

    if (data.length === 0) return null;

    const chartOptions = {
      chart: {
        type: 'line',
        stacked: false,
        toolbar: { show: false },
        animations: { enabled: false }
      },
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '55%',
          borderRadius: 0
        }
      },
      stroke: {
        show: true,
        width: [1, hasTempData ? 1.5 : 0],
        colors: ['#fff', '#f44336']
      },
      dataLabels: { enabled: false },
      xaxis: {
        type: 'datetime',
        labels: {
          rotate: -45,
          rotateAlways: true,
          style: { fontSize: '12px' },
          datetimeFormatter: {
            year: 'yyyy',
            month: 'dd.MM',
            day: 'dd.MM',
            hour: 'dd.MM'
          }
        }
      },
      yaxis: hasTempData
        ? [
            {
              seriesName: 'Taube',
              title: { show: false },
              axisTicks: { show: true },
              axisBorder: { show: true },
              labels: {
                style: { fontSize: '11px' },
                formatter: (val) => Math.round(val)
              },
              min: 0,
              forceNiceScale: true
            },
            {
              seriesName: 'Ø Temp',
              opposite: true,
              title: { show: false },
              axisTicks: { show: true },
              axisBorder: { show: true, color: '#f44336' },
              labels: {
                style: { colors: '#f44336', fontSize: '11px' },
                formatter: (val) => Math.round(val)
              },
              min: 0,
              forceNiceScale: true
            }
          ]
        : [
            {
              title: { show: false },
              axisTicks: { show: true },
              axisBorder: { show: true },
              labels: {
                style: { fontSize: '11px' },
                formatter: (val) => Math.round(val)
              },
              min: 0,
              forceNiceScale: true
            }
          ],
      fill: { opacity: 1 },
      legend: { position: 'bottom', horizontalAlign: 'center' },
      colors: ['#4caf50', '#f44336'],
      tooltip: {
        shared: true,
        intersect: false,
        y: hasTempData
          ? [
              { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
              { formatter: (val) => (val != null ? val + ' °C' : '') }
            ]
          : [{ formatter: (val) => (val != null ? val + ' Erkennungen' : '') }]
      }
    };

    const series = [
      {
        name: 'Taube',
        type: 'column',
        showInLegend: false,
        data: data.map(item => [new Date(item.date).getTime(), item.confirmed_pigeon || 0])
      },
      ...(hasTempData
        ? [{
            name: 'Ø Temp',
            type: 'line',
            data: data.map(item => [
              new Date(item.date).getTime(),
              item.avg_temp_pigeon != null ? item.avg_temp_pigeon : null
            ])
          }]
        : [])
    ];

    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
          Tauben-Erkennungen & Temperatur
        </Typography>
        <Chart
          options={chartOptions}
          series={series}
          type="line"
          height={220}
        />
      </Box>
    );
  }, (prevProps, nextProps) => {
    const prevDeviceId = String(prevProps.device._id);
    const nextDeviceId = String(nextProps.device._id);
    const prevData = prevProps.detectionStats[prevDeviceId] || [];
    const nextData = nextProps.detectionStats[nextDeviceId] || [];
    if (prevDeviceId !== nextDeviceId) return false;
    if (prevData.length !== nextData.length) return false;
    if (prevData.length > 0 && nextData.length > 0) {
      if (JSON.stringify(prevData) !== JSON.stringify(nextData)) return false;
    }
    return true;
  });

  // Hourly Detection Chart: bar chart showing pigeon detections by hour of day + temperature line
  const HourlyDetectionChart = React.memo(({ device, hourlyStats }) => {
    const deviceIdStr = String(device._id);
    const rawData = hourlyStats[deviceIdStr] || [];

    if (rawData.length === 0) return null;

    // Build full 24h array, then trim leading/trailing hours with 0 detections
    const hourMap = {};
    rawData.forEach(item => { hourMap[item.hour] = item; });
    const allHours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: hourMap[h]?.count || 0,
      avg_temp: hourMap[h]?.avg_temp ?? null
    }));

    let firstNonZero = allHours.findIndex(h => h.count > 0);
    let lastNonZero = allHours.length - 1;
    while (lastNonZero > firstNonZero && allHours[lastNonZero].count === 0) lastNonZero--;
    if (firstNonZero < 0) return null;
    const trimmedData = allHours.slice(firstNonZero, lastNonZero + 1);

    const hasTempData = trimmedData.some(item => item.avg_temp != null);
    const categories = trimmedData.map(item => `${String(item.hour).padStart(2, '0')}:00`);

    const chartOptions = {
      chart: {
        type: 'bar',
        stacked: false,
        toolbar: { show: false },
        animations: { enabled: false }
      },
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '55%',
          borderRadius: 0
        }
      },
      dataLabels: { enabled: false },
      stroke: {
        show: true,
        width: [1, hasTempData ? 1.5 : 0],
        colors: ['#fff', '#f44336']
      },
      xaxis: {
        categories,
        labels: {
          rotate: -45,
          rotateAlways: true,
          style: { fontSize: '12px' }
        }
      },
      yaxis: hasTempData
        ? [
            {
              seriesName: 'Tauben',
              title: { show: false },
              axisTicks: { show: true },
              axisBorder: { show: true },
              labels: {
                style: { fontSize: '11px' },
                formatter: (val) => Math.round(val)
              },
              min: 0,
              forceNiceScale: true
            },
            {
              seriesName: 'Ø Temp',
              opposite: true,
              title: { show: false },
              axisTicks: { show: true },
              axisBorder: { show: true, color: '#f44336' },
              labels: {
                style: { colors: '#f44336', fontSize: '11px' },
                formatter: (val) => Math.round(val)
              },
              min: 0,
              forceNiceScale: true
            }
          ]
        : [
            {
              title: { show: false },
              axisTicks: { show: true },
              axisBorder: { show: true },
              labels: {
                style: { fontSize: '11px' },
                formatter: (val) => Math.round(val)
              },
              min: 0,
              forceNiceScale: true
            }
          ],
      fill: { opacity: 1 },
      legend: { position: 'bottom', horizontalAlign: 'center' },
      colors: ['#4caf50', '#f44336'],
      tooltip: {
        shared: true,
        intersect: false,
        y: hasTempData
          ? [
              { formatter: (val) => (val != null ? val + ' Erkennungen' : '') },
              { formatter: (val) => (val != null ? val + ' °C' : '') }
            ]
          : [{ formatter: (val) => (val != null ? val + ' Erkennungen' : '') }]
      }
    };

    const series = [
      {
        name: 'Tauben',
        type: 'column',
        data: trimmedData.map(item => item.count)
      },
      ...(hasTempData
        ? [{
            name: 'Ø Temp',
            type: 'line',
            data: trimmedData.map(item => item.avg_temp)
          }]
        : [])
    ];

    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
          Tauben nach Uhrzeit (letzte 30 Tage)
        </Typography>
        <Chart
          options={chartOptions}
          series={series}
          type="line"
          height={220}
        />
      </Box>
    );
  }, (prevProps, nextProps) => {
    const prevDeviceId = String(prevProps.device._id);
    const nextDeviceId = String(nextProps.device._id);
    const prevData = prevProps.hourlyStats[prevDeviceId] || [];
    const nextData = nextProps.hourlyStats[nextDeviceId] || [];
    if (prevDeviceId !== nextDeviceId) return false;
    if (prevData.length !== nextData.length) return false;
    if (prevData.length > 0 && nextData.length > 0) {
      if (JSON.stringify(prevData) !== JSON.stringify(nextData)) return false;
    }
    return true;
  });

  // Geräte-Komponente
  const DeviceCard = ({ device }) => {
    const [streamUrl, setStreamUrl] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentImage, setCurrentImage] = useState(null);
    const loadTimeoutRef = React.useRef(null);
    // Raspberry Pi stream state
    const [raspberryPiStreamUrl, setRaspberryPiStreamUrl] = useState(null);
    const [raspberryPiIsLoading, setRaspberryPiIsLoading] = useState(false);
    const [raspberryPiCurrentImage, setRaspberryPiCurrentImage] = useState(null);
    const raspberryPiLoadTimeoutRef = React.useRef(null);
    const raspberryPiImageRef = React.useRef(null); // Ref to track the img element
    const isStreaming = streamingDevices[device._id];
    const position = useMemo(
      () => devicePositions[device._id] || { rot: 0, tilt: 0 },
      // devicePositions from parent state - updates when positions change
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [devicePositions, device._id]
    );
    const deviceStatus = deviceStatuses[device._id];
    
    // Check if device has both cameras
    const hasTapo = device.camera?.tapo?.ip && device.camera?.tapo?.username && device.camera?.tapo?.password;
    const hasRaspberryPi = device.camera?.raspberryPi?.ip;
    const isDualCamera = hasTapo && hasRaspberryPi;

    // Normalize helpers for bar fill (rot assumed 0-360, tilt assumed 0..180; clamp as safety)
    const normalized = useMemo(() => {
      const rot = Math.max(0, Math.min(360, Number(position.rot) || 0));
      const tiltVal = Math.max(0, Math.min(180, Number(position.tilt) || 0));
      const rotPct = rot / 360; // 0..1
      const tiltPct = tiltVal / 180; // 0..180 -> 0..1
      return { rotPct, tiltPct, rot, tilt: tiltVal };
    }, [position]);
    
  // Einfache Bild-Updates mit automatischer Aktualisierung - Tapo Camera
  useEffect(() => {
    if (isStreaming && device && hasTapo) {
      // Einfache Bild-URL verwenden (kein Video-Stream)
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
      const imageUrl = `${API_URL}/api/device-image/${device._id}`;
      
      console.log(`Setting Tapo image URL for device ${device._id}:`, imageUrl);
      setStreamUrl(imageUrl);
      setCurrentImage(imageUrl);
      
      // Automatische Aktualisierung alle 3 Sekunden
      const interval = setInterval(() => {
        if (isStreaming && !isLoading) {
          // URL mit Timestamp für Cache-Busting
          const timestamp = Date.now();
          const updatedUrl = `${imageUrl}?t=${timestamp}`;
          console.log(`Updating Tapo image for device ${device._id}:`, updatedUrl);
          setIsLoading(true);
          setStreamUrl(updatedUrl);
          
          // Sicherheits-Timeout: Falls Bild nicht lädt, nach 10 Sek weitermachen
          loadTimeoutRef.current = setTimeout(() => {
            console.warn(`Tapo image load timeout for device ${device._id}`);
            setIsLoading(false);
          }, 10000);
        }
      }, 3000);
      
      return () => {
        clearInterval(interval);
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
        }
      };
    } else {
      setStreamUrl(null);
    }
  }, [isStreaming, device, hasTapo, isLoading]);
  
  // Raspberry Pi Camera Stream
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (isStreaming && device && hasRaspberryPi) {
      const pi = device.camera.raspberryPi;
      const piIp = pi.ip;
      const piPort = pi.port || 8080;
      const streamEndpoint = pi.streamEndpoint || '/stream.mjpeg';
      const piFlip = pi.flip || false;
      
      // Add flip parameter if needed
      let streamUrl = `http://${piIp}:${piPort}${streamEndpoint}`;
      if (piFlip) {
        const separator = streamEndpoint.includes('?') ? '&' : '?';
        streamUrl = `${streamUrl}${separator}flip=true`;
      }
      
      console.log(`Setting Raspberry Pi stream URL for device ${device._id}:`, streamUrl);
      setRaspberryPiStreamUrl(streamUrl);
      setRaspberryPiCurrentImage(streamUrl);
      
      // For MJPEG stream, we don't need to update it - it's a continuous stream
      // But we can still track loading state
      setRaspberryPiIsLoading(false);
      
      return () => {
        const imgEl = raspberryPiImageRef.current;
        const timeoutId = raspberryPiLoadTimeoutRef.current;
        if (imgEl) {
          imgEl.src = '';
          imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        setRaspberryPiStreamUrl(null);
        setRaspberryPiCurrentImage(null);
        if (timeoutId) clearTimeout(timeoutId);
      };
    } else {
      // Stop the stream when not streaming
      if (raspberryPiImageRef.current) {
        raspberryPiImageRef.current.src = '';
        raspberryPiImageRef.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 1x1 transparent pixel
      }
      setRaspberryPiStreamUrl(null);
      setRaspberryPiCurrentImage(null);
    }
  }, [isStreaming, device, hasRaspberryPi]);
  /* eslint-enable react-hooks/exhaustive-deps */

    return (
      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ flexGrow: 1 }}>
          {/* Geräte-Header */}
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center">
              <Avatar 
                sx={{ 
                  bgcolor: getStatusColor(device.status) + '.main', 
                  mr: 1,
                  width: 48,
                  height: 48
                }}
              >
                <img 
                  src="/images/icon.png" 
                  alt="Taubenschiesser" 
                  style={{ 
                    width: '36px', 
                    height: '36px',
                    objectFit: 'contain',
                    filter: 'brightness(0) invert(1)',
                    opacity: 0.95
                  }}
                />
              </Avatar>
              <Box>
                <Typography variant="h6">{device.name}</Typography>
                <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                  <Tooltip title={`Taubenschiesser: ${device.taubenschiesserStatus || 'offline'}`}>
                    <Chip 
                      icon={<DevicesIcon />}
                      label={device.taubenschiesserStatus || 'offline'}
                      size="small"
                      color={getStatusColor(device.taubenschiesserStatus)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </Tooltip>
                  <Tooltip title={`Kamera: ${device.cameraStatus || 'offline'}`}>
                    <Chip 
                      icon={<CameraIcon />}
                      label={device.cameraStatus || 'offline'}
                      size="small"
                      color={getStatusColor(device.cameraStatus)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </Tooltip>
                </Box>
              </Box>
            </Box>
            <Box display="flex" gap={1}>
              <Tooltip title="Gerät-Einstellungen">
                <IconButton onClick={() => navigate(`/devices/${device._id}`)}>
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Status aktualisieren">
                <IconButton onClick={() => handleDeviceControl(device._id, 'refresh')}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Live-Stream Bereich - Support für dual cameras */}
          {isDualCamera ? (
            <Box sx={{ mb: 2 }}>
              <Grid container spacing={2}>
                {/* Tapo Camera Stream */}
                <Grid item xs={12}>
                  <Paper 
                    sx={{ 
                      width: '100%',
                      aspectRatio: '16/9',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      bgcolor: 'grey.100',
                      position: 'relative',
                      maxHeight: '400px',
                      mb: 2
                    }}
                  >
                    {isStreaming ? (
                      <StreamDisplay
                        streamUrl={streamUrl}
                        currentImage={currentImage}
                        isLoading={isLoading}
                        loadTimeoutRef={loadTimeoutRef}
                        setIsLoading={setIsLoading}
                        setCurrentImage={setCurrentImage}
                        setStreamUrl={setStreamUrl}
                        toggleStream={() => toggleStream(device._id)}
                        cameraName="Tapo"
                      />
                    ) : (
                      <StreamPlaceholder
                        toggleStream={() => toggleStream(device._id)}
                        cameraName="Tapo"
                      />
                    )}
                  </Paper>
                </Grid>
                
                {/* Raspberry Pi Camera Stream */}
                <Grid item xs={12}>
                  <Paper 
                    sx={{ 
                      width: '100%',
                      aspectRatio: '16/9',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      bgcolor: 'grey.100',
                      position: 'relative',
                      maxHeight: '400px'
                    }}
                  >
                    {isStreaming ? (
                      <StreamDisplay
                        streamUrl={raspberryPiStreamUrl}
                        currentImage={raspberryPiCurrentImage}
                        isLoading={raspberryPiIsLoading}
                        loadTimeoutRef={raspberryPiLoadTimeoutRef}
                        setIsLoading={setRaspberryPiIsLoading}
                        setCurrentImage={setRaspberryPiCurrentImage}
                        setStreamUrl={setRaspberryPiStreamUrl}
                        toggleStream={() => toggleStream(device._id)}
                        cameraName="Raspberry Pi"
                        isMjpeg={true}
                        imageRef={raspberryPiImageRef}
                      />
                    ) : (
                      <StreamPlaceholder
                        toggleStream={() => toggleStream(device._id)}
                        cameraName="Raspberry Pi"
                      />
                    )}
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          ) : (
            <Paper 
              sx={{ 
                width: '100%',
                aspectRatio: '16/9',
                mb: 2, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                bgcolor: 'grey.100',
                position: 'relative',
                maxHeight: '400px' // Fallback für ältere Browser
              }}
            >
            {isStreaming ? (
              // Für reine Raspberry Pi Kamera: Verwende StreamDisplay mit MJPEG
              hasRaspberryPi && !hasTapo ? (
                <StreamDisplay
                  streamUrl={raspberryPiStreamUrl}
                  currentImage={raspberryPiCurrentImage}
                  isLoading={raspberryPiIsLoading}
                  loadTimeoutRef={raspberryPiLoadTimeoutRef}
                  setIsLoading={setRaspberryPiIsLoading}
                  setCurrentImage={setRaspberryPiCurrentImage}
                  setStreamUrl={setRaspberryPiStreamUrl}
                  toggleStream={() => toggleStream(device._id)}
                  cameraName="Raspberry Pi"
                  isMjpeg={true}
                  imageRef={raspberryPiImageRef}
                />
              ) : (
                // Für andere Kameras (Tapo, Direct, etc.): Verwende bestehende Logik
                <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
                  {/* Loading-Indikator */}
                  {isLoading && (
                    <Box sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 10,
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      color: 'rgba(255,255,255,0.8)',
                      padding: '3px 6px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      fontWeight: 300
                    }}>
                      Aktualisiere...
                    </Box>
                  )}
                  {streamUrl ? (
                    <Box 
                      sx={{ 
                        position: 'relative', 
                        width: '100%', 
                        height: '100%',
                        cursor: 'pointer',
                        '&:hover': {
                          opacity: 0.95
                        }
                      }}
                      onClick={() => toggleStream(device._id)}
                      title="Klicken um Stream zu stoppen"
                    >
                      {/* Altes Bild - bleibt sichtbar */}
                      {currentImage && (
                      <img
                        src={currentImage}
                        alt="Previous Device Stream"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover', // Ändert zu 'cover' für 16:9 Füllung
                          borderRadius: '4px',
                          zIndex: 1
                        }}
                      />
                      )}
                      
                      {/* Neues Bild - lädt im Hintergrund */}
                      <img
                        key={streamUrl}
                        src={streamUrl}
                        alt="Device Stream"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover', // Ändert zu 'cover' für 16:9 Füllung
                          borderRadius: '4px',
                          opacity: isLoading ? 0 : 1,
                          transition: 'opacity 0.3s ease',
                          zIndex: 2
                        }}
                        onError={(e) => {
                          console.error('Image load error:', e);
                          console.error('Image URL:', streamUrl);
                          if (loadTimeoutRef.current) {
                            clearTimeout(loadTimeoutRef.current);
                          }
                          setIsLoading(false);
                        }}
                        onLoad={() => {
                          console.log('Image loaded for:', streamUrl);
                          if (loadTimeoutRef.current) {
                            clearTimeout(loadTimeoutRef.current);
                          }
                          // Neues Bild ist fertig - ersetze das alte
                          setCurrentImage(streamUrl);
                          // Loading beendet
                          setIsLoading(false);
                        }}
                        onLoadStart={() => {
                          console.log('Image loading started for:', streamUrl);
                        }}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <CircularProgress size={40} />
                      <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                        Stream wird vorbereitet...
                      </Typography>
                    </Box>
                  )}
                </Box>
              )
            ) : (
              <Box textAlign="center">
                <CameraIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
                <Typography variant="body2" color="textSecondary">
                  Stream nicht aktiv
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<PlayIcon />}
                  onClick={() => toggleStream(device._id)}
                  sx={{ mt: 1 }}
                >
                  Stream starten
                </Button>
              </Box>
            )}
          </Paper>
          )}

          {/* Bewegungs-Steuerung */}
          <Box mb={2}>
            <Typography variant="subtitle2" gutterBottom textAlign="center">
              Steuerung
            </Typography>
            
            {/* D-Pad Layout with live position bars */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {/* Left spacer to push D-Pad to center */}
              <Box sx={{ flex: 1 }} />
              
              {/* Vertical Tilt Bar (left of D-Pad) */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ position: 'relative', width: 8, height: 110, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                  <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.round(normalized.tiltPct * 100)}%`, bgcolor: '#1976d2' }} />
                </Box>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666', minWidth: '20px', textAlign: 'center' }}>
                  {normalized.tilt.toFixed(0)}°
                </Typography>
              </Box>

              {/* D-Pad with Horizontal Rot Bar (centered) */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                {/* Horizontal Rot Bar (above D-Pad) */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ position: 'relative', width: 190, height: 8, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                    <Box sx={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.round(normalized.rotPct * 100)}%`, bgcolor: '#1976d2' }} />
                  </Box>
                  <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666' }}>
                    {normalized.rot.toFixed(0)}°
                  </Typography>
                </Box>
              {/* Top Row - Up */}
              <Button 
                variant="outlined" 
                size="small"
                onClick={() => handleDeviceControl(device._id, 'move_up')}
                sx={{ minWidth: 60 }}
              >
                <ArrowUpIcon />
              </Button>
              
              {/* Middle Row - Left, Shoot, Right */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleDeviceControl(device._id, 'rotate_left')}
                  sx={{ minWidth: 60 }}
                >
                  <RotateLeftIcon />
                </Button>
                
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleDeviceControl(device._id, 'shoot')}
                  sx={{ minWidth: 60 }}
                >
                  ✚
                </Button>
                
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleDeviceControl(device._id, 'rotate_right')}
                  sx={{ minWidth: 60 }}
                >
                  <RotateRightIcon />
                </Button>
              </Box>
              
              {/* Bottom Row - Down */}
              <Button 
                variant="outlined" 
                size="small"
                onClick={() => handleDeviceControl(device._id, 'move_down')}
                sx={{ minWidth: 60 }}
              >
                <ArrowDownIcon />
              </Button>
              
              {/* Reset Button */}
              <Button 
                variant="outlined" 
                color="warning"
                size="small"
                onClick={() => handleDeviceControl(device._id, 'reset')}
                sx={{ mt: 1, minWidth: 60 }}
              >
                Reset
              </Button>
              </Box>
              
              {/* Right spacer to balance and center D-Pad */}
              <Box sx={{ flex: 1 }} />
            </Box>
          </Box>

          {/* Hardware Monitor Status */}
          <Box mb={2}>
            <Typography variant="caption" color="textSecondary" gutterBottom sx={{ display: 'block' }}>
              Hardware Monitor Status:
            </Typography>
            {deviceStatus ? (
              <>
                <Chip
                  label={deviceStatus.message}
                  color={getStatusColor(deviceStatus.status)}
                  size="small"
                  sx={{ fontSize: '0.7rem' }}
                />
                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                  {deviceStatus.timestamp.toLocaleTimeString()}
                </Typography>
              </>
            ) : (
              <Chip
                label="Kein Status verfügbar"
                color="default"
                size="small"
                sx={{ fontSize: '0.7rem' }}
              />
            )}
          </Box>

          {/* Steuerungs-Buttons */}
          <Box mb={2}>
            <Typography variant="subtitle2" gutterBottom>
              Geräte-Steuerung
            </Typography>
            <ButtonGroup variant="outlined" size="small" fullWidth>
              <Tooltip title="Überwachung starten">
                <Button 
                  onClick={() => handleDeviceControl(device._id, 'start')}
                  color={device.monitorStatus === 'running' ? 'success' : 'primary'}
                  variant={device.monitorStatus === 'running' ? 'contained' : 'outlined'}
                >
                  <StartIcon />
                </Button>
              </Tooltip>
              <Tooltip title="Überwachung pausieren">
                <Button 
                  onClick={() => handleDeviceControl(device._id, 'pause')}
                  color={device.monitorStatus === 'paused' ? 'warning' : 'primary'}
                  variant={device.monitorStatus === 'paused' ? 'contained' : 'outlined'}
                >
                  <PauseIcon2 />
                </Button>
              </Tooltip>
            </ButtonGroup>
            
            {/* Status-Anzeige */}
            <Box mt={1} textAlign="center">
              <Chip 
                label={device.monitorStatus === 'running' ? 'Läuft' : device.monitorStatus === 'paused' ? 'Pausiert' : 'Gestoppt'}
                color={device.monitorStatus === 'running' ? 'success' : device.monitorStatus === 'paused' ? 'warning' : 'default'}
                size="small"
              />
            </Box>
          </Box>

          {/* Geräte-Info */}
          <Box>
            <Typography variant="caption" color="textSecondary">
              IP: {device.taubenschiesser?.ip || 'Nicht gesetzt'}
            </Typography>
            <br />
            <Typography variant="caption" color="textSecondary">
              Letztes Signal: {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Nie'}
            </Typography>
          </Box>

        </CardContent>
      </Card>
    );
  };

  // Helper: Gesamtzahl unkategorisierter Erkennungen (alle Tage)
  const getTotalUnclassified = (device) => {
    const deviceIdStr = String(device._id);
    const data = detectionStats[deviceIdStr] || [];
    return data.reduce((sum, item) => sum + (item.unclassified || 0), 0);
  };

  // Helper function to get today's detection count for a device
  const getTodayDetections = (device) => {
    const deviceIdStr = String(device._id);
    const data = detectionStats[deviceIdStr] || [];
    
    if (data.length === 0) return { total: 0, unclassified: 0 };
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Find today's data
    const todayData = data.find(item => item.date === todayStr);
    
    if (!todayData) return { total: 0, unclassified: 0 };
    
    // Calculate totals
    const unclassified = todayData.unclassified || 0;
    const total = unclassified + 
                  (todayData.confirmed_pigeon || 0) + 
                  (todayData.no_pigeon || 0);
    
    return { total, unclassified };
  };

  if (loading) {
    return <LinearProgress />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Taubenschiesser Dashboard
      </Typography>
      
      {/* Status-Alert */}
      {!connected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Verbindung zum Server unterbrochen. Echtzeit-Updates sind nicht verfügbar.
        </Alert>
      )}
      
      {/* Device Summary Cards with Today's Detections and Charts */}
      {devices.length > 0 && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {devices.map((device) => {
            const { total } = getTodayDetections(device);
            const totalUnclassified = getTotalUnclassified(device);
            return (
              <Grid item xs={12} md={6} lg={4} key={device._id}>
          <Card>
            <CardContent>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                      <Typography variant="h6">
                        {device.name}
                  </Typography>
                      <Box display="flex" gap={1}>
                        <Chip 
                          label={`${total} heute`}
                          color="primary"
                          variant="outlined"
                        />
                        {totalUnclassified > 0 && (
                      <Chip
                            label={`${totalUnclassified} unkategorisiert`}
                            color="warning"
                        variant="outlined"
                      />
                        )}
              </Box>
                    </Box>
                    <DetectionChart device={device} detectionStats={detectionStats} />
                    <TaubeTempChart device={device} detectionStats={detectionStats} />
                    <HourlyDetectionChart device={device} hourlyStats={hourlyStats} />
            </CardContent>
          </Card>
        </Grid>
            );
          })}
        </Grid>
      )}

      <Grid container spacing={3}>
        {/* Taubenschiesser Geräte */}
        <Grid item xs={12}>
          <Typography variant="h5" gutterBottom>
            Taubenschiesser Geräte
          </Typography>
          {devices.length > 0 ? (
            <Grid container spacing={3}>
              {devices.map((device) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={device._id}>
                  <DeviceCard
                    device={device}
                    isStreaming={!!streamingDevices[device._id]}
                    position={devicePositions[device._id] || { rot: 0, tilt: 0 }}
                    deviceStatus={deviceStatuses[device._id]}
                    onToggleStream={() => toggleStream(device._id)}
                    onDeviceControl={(action) => handleDeviceControl(device._id, action)}
                  />
                </Grid>
              ))}
            </Grid>
          ) : (
            <Card>
              <CardContent>
                <Box textAlign="center" py={4}>
                  <DevicesIcon sx={{ fontSize: 64, color: 'grey.400', mb: 2 }} />
                  <Typography variant="h6" color="textSecondary" gutterBottom>
                    Keine Geräte gefunden
                  </Typography>
                  <Typography variant="body2" color="textSecondary" paragraph>
                    Erstelle dein erstes Taubenschiesser-Gerät, um es hier zu sehen.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<DevicesIcon />}
                    onClick={() => navigate('/devices')}
                  >
                    Gerät erstellen
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
