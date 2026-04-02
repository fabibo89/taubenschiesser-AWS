import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { formatWaitChipLine } from '../utils/waitDisplay';

// Helper component for stream display
const StreamDisplay = ({ streamUrl, isLoading, loadTimeoutRef, setIsLoading, toggleStream, cameraName, isMjpeg = false, imageRef = null }) => {
  if (!streamUrl) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 180 }}>
        <CircularProgress size={40} />
        <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
          Stream wird vorbereitet...
        </Typography>
      </Box>
    );
  }
  
  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
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
              height: 'auto',
              display: 'block',
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
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
              }
              setIsLoading(false);
            }}
          />
        ) : (
          <img
            src={streamUrl}
            alt={`${cameraName} Stream`}
            crossOrigin="anonymous"
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: '4px'
            }}
            onError={(e) => {
              console.error(`${cameraName} image load error:`, e);
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
              }
              setIsLoading(false);
            }}
            onLoad={() => {
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
              }
              setIsLoading(false);
            }}
            onLoadStart={() => {
              setIsLoading(true);
            }}
          />
        )}
      </Box>
    </Box>
  );
};

// Helper component for stream placeholder
const StreamPlaceholder = ({ toggleStream, cameraName }) => (
  <Box textAlign="center" sx={{ width: '100%', py: 2 }}>
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

/** Elapsed seconds in current wait window (server anchor or legacy client-only tick). */
const getWaitElapsedSeconds = (waitingInfo) => {
  if (!waitingInfo) return null;
  if (waitingInfo.wait_started_at) {
    const t = Date.parse(waitingInfo.wait_started_at);
    if (!Number.isNaN(t)) return Math.max(0, (Date.now() - t) / 1000);
  }
  if (waitingInfo.receivedAtMs != null) {
    return Math.max(0, (Date.now() - Number(waitingInfo.receivedAtMs)) / 1000);
  }
  return null;
};

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

const DeviceCard = React.memo(({
  device,
  isStreaming,
  position,
  deviceStatus,
  waitingInfo,
  waitTick,
  toggleStream,
  handleDeviceControl,
  navigate,
}) => {
  const [streamUrl, setStreamUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const loadTimeoutRef = useRef(null);
  // Raspberry Pi stream state
  const [raspberryPiStreamUrl, setRaspberryPiStreamUrl] = useState(null);
  const [raspberryPiIsLoading, setRaspberryPiIsLoading] = useState(false);
  const raspberryPiLoadTimeoutRef = useRef(null);
  const raspberryPiImageRef = useRef(null);

  const hasTapo = device.camera?.tapo?.ip && device.camera?.tapo?.username && device.camera?.tapo?.password;
  const hasRaspberryPi = device.camera?.raspberryPi?.ip;
  const isDualCamera = hasTapo && hasRaspberryPi;

  const normalized = useMemo(() => {
    const rot = Math.max(0, Math.min(360, Number(position?.rot) || 0));
    const tiltVal = Math.max(0, Math.min(180, Number(position?.tilt) || 0));
    const rotPct = rot / 360;
    const tiltPct = tiltVal / 180;
    return { rotPct, tiltPct, rot, tilt: tiltVal };
  }, [position]);

  // device_waiting is only pushed from the monitor on each control-loop tick (~1s). Recompute chip
  // text locally (same elapsed formula as waitTick).
  const hardwareMonitorChipLabel = useMemo(() => {
    if (deviceStatus?.status === 'device_waiting' && waitingInfo?.threshold != null) {
      void waitTick;
      const elapsed = getWaitElapsedSeconds(waitingInfo);
      if (elapsed == null) return deviceStatus?.message ?? '';
      const holding = waitingInfo.holding === true;
      const base = holding ? 'Halte Position' : 'Warte';
      const max = waitingInfo.max_threshold;
      const extra = max != null ? ` (max ${Number(max).toFixed(0)}s)` : '';
      return formatWaitChipLine(base, elapsed, waitingInfo.threshold, extra);
    }
    return deviceStatus?.message ?? '';
  }, [deviceStatus?.status, deviceStatus?.message, waitingInfo, waitTick]);

  useEffect(() => {
    if (isStreaming && device && hasTapo) {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
      const imageUrl = `${API_URL}/api/device-image/${device._id}`;

      setStreamUrl(imageUrl);

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
    }

    setStreamUrl(null);
  }, [isStreaming, device, hasTapo, isLoading]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (isStreaming && device && hasRaspberryPi) {
      const pi = device.camera.raspberryPi;
      const piIp = pi.ip;
      const piPort = pi.port || 8080;
      const streamEndpoint = pi.streamEndpoint || '/stream.mjpeg';
      const params = new URLSearchParams();

      if (pi.flip) params.set('flip', 'true');
      if (typeof pi.angle === 'number' && pi.angle !== 0) params.set('angle', String(pi.angle));
      if (pi.square) params.set('square', 'true');
      if (pi.resolution) params.set('resolution', String(pi.resolution));

      let nextUrl = `http://${piIp}:${piPort}${streamEndpoint}`;
      const qs = params.toString();
      if (qs) {
        const separator = streamEndpoint.includes('?') ? '&' : '?';
        nextUrl = `${nextUrl}${separator}${qs}`;
      }

      setRaspberryPiStreamUrl(nextUrl);
      setRaspberryPiIsLoading(false);

      return () => {
        const imgEl = raspberryPiImageRef.current;
        const timeoutId = raspberryPiLoadTimeoutRef.current;
        if (imgEl) {
          imgEl.src = '';
          imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        setRaspberryPiStreamUrl(null);
        if (timeoutId) clearTimeout(timeoutId);
      };
    }

    if (raspberryPiImageRef.current) {
      raspberryPiImageRef.current.src = '';
      raspberryPiImageRef.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
    setRaspberryPiStreamUrl(null);
  }, [isStreaming, device, hasRaspberryPi]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
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

        {isDualCamera ? (
          <Box sx={{ mb: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Paper
                  sx={{
                    width: '100%',
                    maxHeight: '400px',
                    overflow: 'auto',
                    display: 'flex',
                    alignItems: 'stretch',
                    justifyContent: 'center',
                    bgcolor: 'grey.100',
                    position: 'relative',
                    mb: 2,
                    minHeight: 120
                  }}
                >
                  {isStreaming ? (
                    <StreamDisplay
                      streamUrl={streamUrl}
                      isLoading={isLoading}
                      loadTimeoutRef={loadTimeoutRef}
                      setIsLoading={setIsLoading}
                      toggleStream={() => toggleStream(device._id)}
                      cameraName="Tapo"
                    />
                  ) : (
                    <StreamPlaceholder toggleStream={() => toggleStream(device._id)} cameraName="Tapo" />
                  )}
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper
                  sx={{
                    width: '100%',
                    maxHeight: '400px',
                    overflow: 'auto',
                    display: 'flex',
                    alignItems: 'stretch',
                    justifyContent: 'center',
                    bgcolor: 'grey.100',
                    position: 'relative',
                    minHeight: 120
                  }}
                >
                  {isStreaming ? (
                    <StreamDisplay
                      streamUrl={raspberryPiStreamUrl}
                      isLoading={raspberryPiIsLoading}
                      loadTimeoutRef={raspberryPiLoadTimeoutRef}
                      setIsLoading={setRaspberryPiIsLoading}
                      toggleStream={() => toggleStream(device._id)}
                      cameraName="Raspberry Pi"
                      isMjpeg={true}
                      imageRef={raspberryPiImageRef}
                    />
                  ) : (
                    <StreamPlaceholder toggleStream={() => toggleStream(device._id)} cameraName="Raspberry Pi" />
                  )}
                </Paper>
              </Grid>
            </Grid>
          </Box>
        ) : (
          <Paper
            sx={{
              width: '100%',
              maxHeight: '400px',
              overflow: 'auto',
              mb: 2,
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'center',
              bgcolor: 'grey.100',
              position: 'relative',
              minHeight: 120
            }}
          >
            {isStreaming ? (
              hasRaspberryPi && !hasTapo ? (
                <StreamDisplay
                  streamUrl={raspberryPiStreamUrl}
                  isLoading={raspberryPiIsLoading}
                  loadTimeoutRef={raspberryPiLoadTimeoutRef}
                  setIsLoading={setRaspberryPiIsLoading}
                  toggleStream={() => toggleStream(device._id)}
                  cameraName="Raspberry Pi"
                  isMjpeg={true}
                  imageRef={raspberryPiImageRef}
                />
              ) : (
                <StreamDisplay
                  streamUrl={streamUrl}
                  isLoading={isLoading}
                  loadTimeoutRef={loadTimeoutRef}
                  setIsLoading={setIsLoading}
                  toggleStream={() => toggleStream(device._id)}
                  cameraName="Kamera"
                />
              )
            ) : (
              <StreamPlaceholder toggleStream={() => toggleStream(device._id)} cameraName="Kamera" />
            )}
          </Paper>
        )}

        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom textAlign="center">
            Steuerung
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1 }} />

            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ position: 'relative', width: 8, height: 110, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.round(normalized.tiltPct * 100)}%`, bgcolor: '#1976d2' }} />
              </Box>
              <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666', minWidth: '20px', textAlign: 'center' }}>
                {normalized.tilt.toFixed(0)}°
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ position: 'relative', width: 190, height: 8, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                  <Box sx={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.round(normalized.rotPct * 100)}%`, bgcolor: '#1976d2' }} />
                </Box>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666' }}>
                  {normalized.rot.toFixed(0)}°
                </Typography>
              </Box>

              <Button variant="outlined" size="small" onClick={() => handleDeviceControl(device._id, 'move_up')} sx={{ minWidth: 60 }}>
                <ArrowUpIcon />
              </Button>

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button variant="outlined" size="small" onClick={() => handleDeviceControl(device._id, 'rotate_left')} sx={{ minWidth: 60 }}>
                  <RotateLeftIcon />
                </Button>
                <Button variant="outlined" size="small" onClick={() => handleDeviceControl(device._id, 'shoot')} sx={{ minWidth: 60 }}>
                  ✚
                </Button>
                <Button variant="outlined" size="small" onClick={() => handleDeviceControl(device._id, 'rotate_right')} sx={{ minWidth: 60 }}>
                  <RotateRightIcon />
                </Button>
              </Box>

              <Button variant="outlined" size="small" onClick={() => handleDeviceControl(device._id, 'move_down')} sx={{ minWidth: 60 }}>
                <ArrowDownIcon />
              </Button>

              <Button variant="outlined" color="warning" size="small" onClick={() => handleDeviceControl(device._id, 'reset')} sx={{ mt: 1, minWidth: 60 }}>
                Reset
              </Button>
            </Box>

            <Box sx={{ flex: 1 }} />
          </Box>
        </Box>

        <Box mb={2} sx={{ minHeight: 52 }}>
          <Typography variant="caption" color="textSecondary" gutterBottom sx={{ display: 'block' }}>
            Hardware Monitor Status:
          </Typography>
          {deviceStatus ? (
            <Chip
              label={hardwareMonitorChipLabel}
              color={getStatusColor(deviceStatus.status)}
              size="small"
              sx={{
                fontSize: '0.7rem',
                maxWidth: '100%',
                '& .MuiChip-label': {
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              }}
            />
          ) : (
            <Chip label="Kein Status verfügbar" color="default" size="small" sx={{ fontSize: '0.7rem' }} />
          )}
        </Box>

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
          <Box mt={1} textAlign="center">
            <Chip
              label={device.monitorStatus === 'running' ? 'Läuft' : device.monitorStatus === 'paused' ? 'Pausiert' : 'Gestoppt'}
              color={device.monitorStatus === 'running' ? 'success' : device.monitorStatus === 'paused' ? 'warning' : 'default'}
              size="small"
            />
          </Box>
        </Box>

        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom>
            Schießen bei Erkennung
          </Typography>
          <ButtonGroup variant="outlined" size="small" fullWidth>
            <Tooltip title="Bei Taubenerkennung schießen und speichern">
              <Button
                onClick={() => handleDeviceControl(device._id, 'arm')}
                color={device.monitorArmed ? 'error' : 'primary'}
                variant={device.monitorArmed ? 'contained' : 'outlined'}
              >
                Scharf
              </Button>
            </Tooltip>
            <Tooltip title="Nur speichern, nicht schießen">
              <Button
                onClick={() => handleDeviceControl(device._id, 'disarm')}
                color={!device.monitorArmed ? 'success' : 'primary'}
                variant={!device.monitorArmed ? 'contained' : 'outlined'}
              >
                Sicher
              </Button>
            </Tooltip>
          </ButtonGroup>
          <Box mt={1} textAlign="center">
            <Chip label={device.monitorArmed ? 'Scharf' : 'Sicher'} color={device.monitorArmed ? 'error' : 'success'} size="small" />
          </Box>
        </Box>

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
});

// IMPORTANT: These chart components must live at module scope.
// If defined inside `Dashboard`, every Dashboard re-render changes the component identity,
// forcing ApexCharts to unmount/mount -> visible blinking (and can trigger Safari scroll jumps).
const DetectionChart = React.memo(({ device, detectionStats }) => {
  const deviceIdStr = String(device._id);
  const data = detectionStats[deviceIdStr] || [];

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" align="center" sx={{ py: 2 }}>
        Keine Daten für diesen Zeitraum
      </Typography>
    );
  }

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
    legend: { position: 'bottom', horizontalAlign: 'center' },
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

  return <Chart options={chartOptions} series={series} type="bar" height={300} />;
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

const TaubeTempChart = React.memo(({ device, detectionStats }) => {
  const deviceIdStr = String(device._id);
  const data = detectionStats[deviceIdStr] || [];
  const hasTempData = data.some(item => item.avg_temp_pigeon != null);
  if (data.length === 0) return null;

  const chartOptions = {
    chart: { type: 'line', stacked: false, toolbar: { show: false }, animations: { enabled: false } },
    plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 0 } },
    stroke: { show: true, width: [1, hasTempData ? 1.5 : 0], colors: ['#fff', '#f44336'] },
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime',
      labels: {
        rotate: -45,
        rotateAlways: true,
        style: { fontSize: '12px' },
        datetimeFormatter: { year: 'yyyy', month: 'dd.MM', day: 'dd.MM', hour: 'dd.MM' }
      }
    },
    yaxis: hasTempData
      ? [
        {
          seriesName: 'Taube',
          title: { show: false },
          axisTicks: { show: true },
          axisBorder: { show: true },
          labels: { style: { fontSize: '11px' }, formatter: (val) => Math.round(val) },
          min: 0,
          forceNiceScale: true
        },
        {
          seriesName: 'Ø Temp',
          opposite: true,
          title: { show: false },
          axisTicks: { show: true },
          axisBorder: { show: true, color: '#f44336' },
          labels: { style: { colors: '#f44336', fontSize: '11px' }, formatter: (val) => Math.round(val) },
          min: 0,
          forceNiceScale: true
        }
      ]
      : [
        {
          title: { show: false },
          axisTicks: { show: true },
          axisBorder: { show: true },
          labels: { style: { fontSize: '11px' }, formatter: (val) => Math.round(val) },
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
    ...(hasTempData ? [{
      name: 'Ø Temp',
      type: 'line',
      data: data.map(item => [new Date(item.date).getTime(), item.avg_temp_pigeon != null ? item.avg_temp_pigeon : null])
    }] : [])
  ];

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" color="textSecondary" gutterBottom>
        Tauben-Erkennungen & Temperatur
      </Typography>
      <Chart options={chartOptions} series={series} type="line" height={220} />
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

const HourlyDetectionChart = React.memo(({ device, hourlyStats }) => {
  const deviceIdStr = String(device._id);
  const rawData = hourlyStats[deviceIdStr] || [];
  if (rawData.length === 0) return null;

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
    chart: { type: 'bar', stacked: false, toolbar: { show: false }, animations: { enabled: false } },
    plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 0 } },
    dataLabels: { enabled: false },
    stroke: { show: true, width: [1, hasTempData ? 1.5 : 0], colors: ['#fff', '#f44336'] },
    xaxis: {
      categories,
      labels: { rotate: -45, rotateAlways: true, style: { fontSize: '12px' } }
    },
    yaxis: hasTempData
      ? [
        {
          seriesName: 'Tauben',
          title: { show: false },
          axisTicks: { show: true },
          axisBorder: { show: true },
          labels: { style: { fontSize: '11px' }, formatter: (val) => Math.round(val) },
          min: 0,
          forceNiceScale: true
        },
        {
          seriesName: 'Ø Temp',
          opposite: true,
          title: { show: false },
          axisTicks: { show: true },
          axisBorder: { show: true, color: '#f44336' },
          labels: { style: { colors: '#f44336', fontSize: '11px' }, formatter: (val) => Math.round(val) },
          min: 0,
          forceNiceScale: true
        }
      ]
      : [
        {
          title: { show: false },
          axisTicks: { show: true },
          axisBorder: { show: true },
          labels: { style: { fontSize: '11px' }, formatter: (val) => Math.round(val) },
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
    { name: 'Tauben', type: 'column', data: trimmedData.map(item => item.count) },
    ...(hasTempData ? [{ name: 'Ø Temp', type: 'line', data: trimmedData.map(item => item.avg_temp) }] : [])
  ];

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" color="textSecondary" gutterBottom>
        Tauben nach Uhrzeit (letzte 30 Tage)
      </Typography>
      <Chart options={chartOptions} series={series} type="line" height={220} />
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

const Dashboard = () => {
  const [devices, setDevices] = useState([]);
  const [devicePositions, setDevicePositions] = useState({}); // { [deviceId]: { rot, tilt } }
  const [deviceStatuses, setDeviceStatuses] = useState({}); // { [deviceId]: { status, message, timestamp } }
  const [deviceWaiting, setDeviceWaiting] = useState({}); // { [deviceId]: { wait_started_at, threshold, dynamic_threshold, max_threshold, holding, receivedAtMs?, timestamp } }
  const [waitTick, setWaitTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [streamingDevices, setStreamingDevices] = useState({});
  const [detectionStats, setDetectionStats] = useState({});
  const [hourlyStats, setHourlyStats] = useState({});
  const navigate = useNavigate();
  const { socket, connected } = useSocket();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Tick once per second so we can locally count waiting time in the UI.
  useEffect(() => {
    const id = setInterval(() => setWaitTick((t) => t + 1), 1000);
    return () => clearInterval(id);
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
        setDevicePositions(prev => {
          const prevPos = prev[deviceId] || { rot: 0, tilt: 0 };
          const nextRot = typeof rot === 'number' ? rot : prevPos.rot;
          const nextTilt = typeof tilt === 'number' ? tilt : prevPos.tilt;
          if (prevPos.rot === nextRot && prevPos.tilt === nextTilt) return prev;
          return {
            ...prev,
            [deviceId]: { rot: nextRot, tilt: nextTilt }
          };
        });
      }

      // Update device status for hardware monitor events
      if (eventType) {
        let message = data?.message;

        // Only update dyn/max baseline from events that are part of the wait/analysis cycle.
        // Other events may carry stale/default dyn/max and would cause the UI to "jump" to max.
        const isDynWaitRelevantEvent =
          eventType === 'device_waiting' ||
          eventType === 'cv_analysis_complete' ||
          eventType === 'birds_detected';
        if (
          isDynWaitRelevantEvent &&
          (data?.dynamic_threshold != null || data?.max_threshold != null || data?.holding != null)
        ) {
          setDeviceWaiting(prev => {
            const prevEntry = prev[deviceId] || {};
            const next = {
              ...prevEntry,
              dynamic_threshold: data.dynamic_threshold ?? prevEntry.dynamic_threshold,
              max_threshold: data.max_threshold ?? prevEntry.max_threshold,
              holding: data.holding === true,
              timestamp: new Date(),
            };
            return { ...prev, [deviceId]: next };
          });
        }

        // Reset local waiting counter when leaving waiting state (not on analysis result events).
        const preserveWaitBaseline =
          eventType === 'cv_analysis_complete' ||
          eventType === 'birds_detected';
        if (eventType !== 'device_waiting' && !preserveWaitBaseline) {
          setDeviceWaiting(prev => {
            const prevEntry = prev[deviceId];
            if (!prevEntry || (prevEntry.wait_started_at == null && prevEntry.receivedAtMs == null && prevEntry.threshold == null)) {
              return prev;
            }
            return {
              ...prev,
              [deviceId]: {
                ...prevEntry,
                wait_started_at: null,
                threshold: null,
                receivedAtMs: null,
                timestamp: new Date(),
              }
            };
          });
        }

        // After analysis / bird hit: new inactivity period — baseline 0s, keep dyn/max from payload.
        if (eventType === 'cv_analysis_complete' || eventType === 'birds_detected') {
          setDeviceWaiting(prev => {
            const prevEntry = prev[deviceId] || {};
            const dyn = data?.dynamic_threshold ?? prevEntry.dynamic_threshold;
            const max = data?.max_threshold ?? prevEntry.max_threshold;
            if (dyn == null && max == null) return prev;
            return {
              ...prev,
              [deviceId]: {
                ...prevEntry,
                threshold: prevEntry.threshold,
                dynamic_threshold: dyn,
                max_threshold: max,
                holding: data?.holding === true,
                wait_started_at: data?.wait_started_at || new Date().toISOString(),
                receivedAtMs: null,
                timestamp: new Date(),
              }
            };
          });
        }

        if (eventType === 'device_waiting' && data?.threshold != null) {
          const holding = data?.holding === true;
          const max = data?.max_threshold;
          const base = holding ? 'Halte Position' : 'Warte';
          const extra = max != null ? ` (max ${max}s)` : '';
          const ws = data.wait_started_at ? Date.parse(data.wait_started_at) : Date.now();
          const elapsed = Math.max(0, (Date.now() - (Number.isNaN(ws) ? Date.now() : ws)) / 1000);
          message = formatWaitChipLine(base, elapsed, data.threshold, extra);

          // Store waiting info separately for constant display line (avoid re-render if unchanged)
          setDeviceWaiting(prev => {
            const prevEntry = prev[deviceId];
            const next = {
              wait_started_at: data.wait_started_at || new Date().toISOString(),
              threshold: data.threshold,
              dynamic_threshold: data.dynamic_threshold,
              max_threshold: data.max_threshold,
              holding: data.holding === true,
              receivedAtMs: null,
              timestamp: new Date()
            };
            if (
              prevEntry &&
              prevEntry.wait_started_at === next.wait_started_at &&
              prevEntry.threshold === next.threshold &&
              prevEntry.dynamic_threshold === next.dynamic_threshold &&
              prevEntry.max_threshold === next.max_threshold &&
              prevEntry.holding === next.holding
            ) {
              return prev;
            }
            return { ...prev, [deviceId]: next };
          });
        }

        if (!message) {
          if (eventType === 'cv_analysis_complete') {
            const bc = data?.bird_count;
            const cam = data?.camera ? ` (${data.camera})` : '';
            // CV service uses ms; hardware-monitor may send processing_time_sec
            const ptRaw = data?.processing_time_sec != null ? Number(data.processing_time_sec) : (
              data?.processing_time != null ? Number(data.processing_time) / 1000 : null
            );
            const pt = ptRaw != null && Number.isFinite(ptRaw) ? ` · ${ptRaw.toFixed(2)}s` : '';
            if (data?.birds_found && bc > 0) {
              message = `Analyse: ${bc} Vögel erkannt${cam}${pt}`;
            } else if (data?.birds_found) {
              message = `Analyse: Vögel erkannt${cam}${pt}`;
            } else {
              message = `Analyse: 0 Vögel${cam}${pt}`;
            }
          }
        }
        if (!message) return;
        setDeviceStatuses(prev => {
          const prevEntry = prev[deviceId];
          if (prevEntry && prevEntry.status === eventType && prevEntry.message === message) return prev;
          return {
            ...prev,
            [deviceId]: {
              status: eventType,
              message,
              timestamp: new Date()
            }
          };
        });
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
      });
      
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

      // Initialize waiting info from persisted hardwareMonitor (so it's not empty until next socket event)
      const waitingInit = {};
      devicesWithStatus.forEach(d => {
        const hm = d?.hardwareMonitor;
        const hmData = hm?.lastWaitingData || hm?.lastEventData;
        if (hmData && (hmData.dynamic_threshold != null || hmData.max_threshold != null || hmData.holding != null)) {
          waitingInit[d._id] = {
            wait_started_at: hmData.wait_started_at,
            threshold: hmData.threshold,
            dynamic_threshold: hmData.dynamic_threshold,
            max_threshold: hmData.max_threshold,
            holding: hmData.holding === true,
            wait_count: 0,
            receivedAtMs: hmData.receivedAtMs,
            timestamp: hm?.lastWaitingAt
              ? new Date(hm.lastWaitingAt)
              : (hm?.lastEventAt ? new Date(hm.lastEventAt) : new Date())
          };
        }
      });
      if (Object.keys(waitingInit).length > 0) {
        setDeviceWaiting(prev => ({ ...prev, ...waitingInit }));
      }

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
        // Visuelles Feedback für Status-Änderung
        const device = devices.find(d => d._id === statusChange.deviceId);
        if (device) {
          const componentName = statusChange.component === 'taubenschiesser' ? 'Taubenschiesser' : 'Kamera';
          const statusText = statusChange.status === 'online' ? 'online' : 'offline';
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
  // NOTE: Scroll restore was removed because it caused Safari scroll jumps.

  // Helper function to calculate overall status
  const calculateOverallStatus = (taubenschiesserStatus, cameraStatus) => {
    if (taubenschiesserStatus === 'online' && cameraStatus === 'online') return 'online';
    if (taubenschiesserStatus === 'online' || cameraStatus === 'online') return 'maintenance';
    return 'offline';
  };

  // Geräte-Steuerung
  const handleDeviceControl = useCallback(async (deviceId, action) => {
    try {
      if (action === 'refresh') {
        // Status aktualisieren
        const response = await axios.post(`/api/device-control/${deviceId}/refresh`);
        
        // Erfolgsmeldung anzeigen
        return;
      }

      if (action === 'start') {
        // Geräte-Überwachung starten
        const response = await axios.post(`/api/device-control/${deviceId}/start`);
        
        if (response.data.success) {
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
        
        if (response.data.success) {
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
  }, []);

  // RTSP-Stream starten/stoppen (nur Frontend-Toggle, keine Server-Konvertierung)
  const toggleStream = useCallback(async (deviceId) => {
    try {
      // Direkter Frontend-Toggle - keine Server-Konvertierung nötig
      setStreamingDevices(prev => {
        const next = !prev[deviceId];
        return { ...prev, [deviceId]: next };
      });
      
    } catch (error) {
      console.error('Error toggling RTSP stream:', error);
    }
  }, []);

  // RTSP-Stream-Status ist immer verfügbar (keine Server-Abfrage nötig)
  // const getStreamStatus = async (deviceId) => {
  //   // Nicht mehr nötig - RTSP-Streams sind direkt verfügbar
  //   return { active: streamingDevices[deviceId] };
  // };

  // ⚠️ DO NOT define Chart components inside `Dashboard`.
  // Reason: `Dashboard` re-renders frequently due to live socket events. If chart components are
  // defined here, their *component identity changes on every render* -> ApexCharts unmount/mount
  // -> visible blinking (all browsers) and often scroll jumps in Safari.
  //
  // Keep charts at *module scope* (see the `DetectionChart`/`TaubeTempChart`/`HourlyDetectionChart`
  // definitions above `Dashboard`). These inner versions are intentionally unused.
  const DetectionChartInner = React.memo(({ device, detectionStats }) => {
    // Ensure device._id is converted to string for consistent lookup
    const deviceIdStr = String(device._id);
    const data = detectionStats[deviceIdStr] || [];
    
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
  const TaubeTempChartInner = React.memo(({ device, detectionStats }) => {
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
  const HourlyDetectionChartInner = React.memo(({ device, hourlyStats }) => {
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
    <Box sx={{ overflowAnchor: 'none' }}>
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
                    waitingInfo={deviceWaiting[device._id]}
                    waitTick={waitTick}
                    toggleStream={toggleStream}
                    handleDeviceControl={handleDeviceControl}
                    navigate={navigate}
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
