import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  CircularProgress,
  Grid,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Image as ImageIcon,
  CheckCircle as SuccessIcon
} from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { toast } from 'react-toastify';

const ImageUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showTooltip, setShowTooltip] = useState(false);

  const onDrop = async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    setUploading(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('deviceId', 'demo-device'); // Demo device ID for testing

      const response = await axios.post('/api/cv/detect', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setResult(response.data);
      toast.success('Bild erfolgreich analysiert!');
    } catch (error) {
      const message = error.response?.data?.detail || 'Fehler beim Analysieren des Bildes';
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp']
    },
    multiple: false,
    disabled: uploading
  });

  const resetUpload = () => {
    setResult(null);
    setError('');
  };

  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Get the actual image element to check its natural dimensions
    const img = event.currentTarget;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    
    // Check if we have image info and valid dimensions
    if (result?.image_info?.original_size?.width && result?.image_info?.original_size?.height && rect.width > 0 && rect.height > 0) {
      // Calculate scaling factors based on actual image dimensions
      const scaleX = result.image_info.original_size.width / rect.width;
      const scaleY = result.image_info.original_size.height / rect.height;
      
      // Convert to original image coordinates
      const originalX = Math.round(x * scaleX);
      const originalY = Math.round(y * scaleY);
      
      setMousePosition({ 
        x: originalX, 
        y: originalY,
        displayX: Math.round(x),
        displayY: Math.round(y),
        scaleX: scaleX.toFixed(2),
        scaleY: scaleY.toFixed(2),
        debug: `Orig:${result.image_info.original_size.width}x${result.image_info.original_size.height}, Display:${Math.round(rect.width)}x${Math.round(rect.height)}`
      });
    } else {
      // Fallback to display coordinates only
      setMousePosition({ 
        x: Math.round(x), 
        y: Math.round(y),
        displayX: Math.round(x),
        displayY: Math.round(y),
        scaleX: '1.00',
        scaleY: '1.00',
        debug: 'No scaling data'
      });
    }
  };

  const handleMouseEnter = () => {
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Bildanalyse
      </Typography>
      
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Laden Sie ein Bild hoch, um Objekte mit KI zu erkennen
      </Typography>

      {/* Upload Area */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Paper
            {...getRootProps()}
            sx={{
              p: 4,
              textAlign: 'center',
              border: '2px dashed',
              borderColor: isDragActive ? 'primary.main' : 'grey.300',
              backgroundColor: isDragActive ? 'action.hover' : 'background.paper',
              cursor: uploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                borderColor: uploading ? 'grey.300' : 'primary.main',
                backgroundColor: uploading ? 'background.paper' : 'action.hover'
              }
            }}
          >
            <input {...getInputProps()} />
            
            {uploading ? (
              <Box>
                <CircularProgress size={48} sx={{ mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Analysiere Bild...
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Bitte warten Sie, während das KI-Modell Ihr Bild analysiert.
                </Typography>
              </Box>
            ) : (
              <Box>
                <UploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  {isDragActive ? 'Bild hier ablegen' : 'Bild hochladen oder hier ablegen'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Unterstützte Formate: JPEG, PNG, GIF, BMP, WebP
                </Typography>
              </Box>
            )}
          </Paper>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Results Display */}
      {result && (
        <Card>
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">
                Analyseergebnisse
              </Typography>
              <Button variant="outlined" onClick={resetUpload}>
                Neues Bild hochladen
              </Button>
            </Box>

            {/* Detection Stats */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4" color="primary">
                    {result.detection_count || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Erkannte Objekte
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4" color="primary">
                    {result.processing_time ? `${result.processing_time.toFixed(0)}ms` : 'N/A'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Verarbeitungszeit
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4" color="primary">
                    {result.model?.name || 'N/A'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    KI-Modell
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Detected Objects */}
            {result.detections && result.detections.length > 0 && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  Erkannte Objekte:
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {result.detections.map((detection, index) => (
                    <Chip
                      key={index}
                      icon={<SuccessIcon />}
                      label={`${detection.class} (${(detection.confidence * 100).toFixed(1)}%)`}
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Annotated Image */}
            {result.image_url && (
              <Box>
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
                    src={result.image_url}
                    alt="Analyzed image with detections"
                    onMouseMove={handleMouseMove}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
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
                  
                  {/* Tooltip */}
                  {showTooltip && mousePosition && !isNaN(mousePosition.x) && !isNaN(mousePosition.y) && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: (mousePosition.displayY || mousePosition.y) - 30,
                        left: (mousePosition.displayX || mousePosition.x) + 10,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: 1,
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        pointerEvents: 'none',
                        zIndex: 1000,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Original: ({mousePosition.x}, {mousePosition.y})
                      <br />
                      Display: ({mousePosition.displayX}, {mousePosition.displayY})
                      <br />
                      Scale: {mousePosition.scaleX}x, {mousePosition.scaleY}x
                      <br />
                      {mousePosition.debug}
                    </Box>
                  )}
                </Box>
              </Box>
            )}


            {/* Detection Details Table */}
            {result.detections && result.detections.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Erkennungsdetails:
                </Typography>
                
                {/* Bildgröße Info */}
                {result.image_info && (
                  <Box sx={{ mb: 2, p: 2, backgroundColor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.200' }}>
                    <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                      📐 Bildgröße: {result.image_info.original_size?.width} × {result.image_info.original_size?.height} Pixel
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Model Input: {result.image_info.model_input_size?.width} × {result.image_info.model_input_size?.height} Pixel
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
                        <TableCell><strong title="Mittelpunkt der Bounding Box">Zentrum</strong></TableCell>
                        <TableCell><strong title="Obere linke Ecke der Bounding Box">Obere Ecke</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.detections.map((detection, index) => (
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
                            <Typography variant="body2" color="secondary" title="Mittelpunkt der Bounding Box">
                              ({detection.bbox_original?.x?.toFixed(1) || 'N/A'}, {detection.bbox_original?.y?.toFixed(1) || 'N/A'})
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" title="Obere linke Ecke der Bounding Box">
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

            {/* Demo Mode Warning */}
            {result.demo_mode && (
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>Demo-Modus:</strong> Das KI-Modell ist nicht verfügbar. 
                  Die gezeigten Erkennungen sind Beispieldaten.
                </Typography>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default ImageUpload;
