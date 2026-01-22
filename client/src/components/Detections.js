import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  CardMedia,
  LinearProgress
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as DetectionIcon,
  Close as CloseIcon,
  Image as ImageIcon,
  Delete as DeleteIcon,
  Favorite as FavoriteIcon,
  Cancel as CancelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import axios from 'axios';
import { toast } from 'react-toastify';

const Detections = () => {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    deviceId: '',
    dateFrom: '',
    dateTo: '',
    classificationStatus: ''
  });
  const [classificationDialogOpen, setClassificationDialogOpen] = useState(false);
  const [detectionToClassify, setDetectionToClassify] = useState(null);
  const [pagination, setPagination] = useState({
    page: 0,
    pageSize: 20,
    total: 0
  });
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState(null);

  useEffect(() => {
    fetchDetections();
  }, [filters, pagination.page, pagination.pageSize]);

  const fetchDetections = async () => {
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

      const response = await axios.get(`/api/cv/detections?${params}`);
      setDetections(response.data.detections);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination.total
      }));
    } catch (error) {
      console.error('Error fetching detections:', error);
    } finally {
      setLoading(false);
    }
  };

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
    setSelectedDetection(detection);
    setImageDialogOpen(true);
  };

  const handleCloseImageDialog = () => {
    setImageDialogOpen(false);
    setSelectedDetection(null);
  };

  const handlePreviousDetection = () => {
    if (!selectedDetection || detections.length === 0) return;
    
    const currentIndex = detections.findIndex(d => d._id === selectedDetection._id);
    if (currentIndex > 0) {
      setSelectedDetection(detections[currentIndex - 1]);
    }
  };

  const handleNextDetection = () => {
    if (!selectedDetection || detections.length === 0) return;
    
    const currentIndex = detections.findIndex(d => d._id === selectedDetection._id);
    if (currentIndex < detections.length - 1) {
      setSelectedDetection(detections[currentIndex + 1]);
    }
  };

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
        toast.success('Erkennung gelöscht');
      } else {
        await axios.patch(`/api/cv/detections/${detectionToClassify._id}/classify`, {
          action: action
        });
        toast.success(
          action === 'confirm_pigeon' 
            ? 'Als Taube klassifiziert' 
            : 'Als "Keine Taube" klassifiziert'
        );
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
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          {params.row.zoomed_image?.url ? (
            <Box
              component="img"
              src={params.row.zoomed_image.url}
              alt="Detection Thumbnail"
              sx={{
                width: 80,
                height: 60,
                objectFit: 'cover',
                borderRadius: 1,
                border: '1px solid #e0e0e0',
                cursor: 'pointer'
              }}
              onClick={() => handleOpenImageDialog(params.row)}
            />
          ) : params.row.image?.url ? (
            <Box
              component="img"
              src={params.row.image.url}
              alt="Detection Thumbnail"
              sx={{
                width: 80,
                height: 60,
                objectFit: 'cover',
                borderRadius: 1,
                border: '1px solid #e0e0e0',
                cursor: 'pointer'
              }}
              onClick={() => handleOpenImageDialog(params.row)}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              Kein Bild
            </Typography>
          )}
        </Box>
      )
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
          {params.value ? `${params.value.toFixed(0)}ms` : 'N/A'}
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
        </DialogTitle>
        <DialogContent>
          {selectedDetection && (
            <Grid container spacing={2}>
              {/* Original Image mit Bounding-Boxen */}
              {selectedDetection.image?.url && (
                <Grid item xs={12} md={selectedDetection.zoomed_image?.url ? 6 : 12}>
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Original-Bild
                      </Typography>
                      <Box
                        sx={{
                          position: 'relative',
                          width: '100%',
                          maxHeight: '500px',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1,
                          overflow: 'hidden',
                          backgroundColor: '#000'
                        }}
                      >
                        <Box
                          component="img"
                          src={selectedDetection.image.url}
                          alt="Original Detection"
                          sx={{
                            width: '100%',
                            height: 'auto',
                            display: 'block',
                            objectFit: 'contain'
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
                </Grid>
              )}

              {/* Zoomed Image mit Bounding-Boxen */}
              {selectedDetection.zoomed_image?.url && (
                <Grid item xs={12} md={selectedDetection.image?.url ? 6 : 12}>
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Gezoomtes Bild {selectedDetection.zoom_factor && `(${selectedDetection.zoom_factor}x)`}
                      </Typography>
                      <Box
                        sx={{
                          position: 'relative',
                          width: '100%',
                          maxHeight: '500px',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1,
                          overflow: 'hidden',
                          backgroundColor: '#000'
                        }}
                      >
                        <Box
                          component="img"
                          src={selectedDetection.zoomed_image.url}
                          alt="Zoomed Detection"
                          sx={{
                            width: '100%',
                            height: 'auto',
                            display: 'block',
                            objectFit: 'contain'
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
                </Grid>
              )}

              {/* Detection Details */}
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>
                      Erkennungs-Details
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Gerät: <strong>{selectedDetection.device?.name || 'Unbekannt'}</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Zeitstempel: <strong>{new Date(selectedDetection.processedAt).toLocaleString()}</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Verarbeitungszeit: <strong>{selectedDetection.processingTime?.toFixed(0)}ms</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="text.secondary">
                          Modell: <strong>{selectedDetection.model?.name || 'N/A'}</strong>
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Erkannte Objekte:
                        </Typography>
                        <Box display="flex" flexDirection="column" gap={1.5}>
                          {selectedDetection.detections?.map((detection, index) => (
                            <Card key={index} variant="outlined" sx={{ p: 1.5 }}>
                              <Grid container spacing={1}>
                                <Grid item xs={12}>
                                  <Box display="flex" alignItems="center" gap={1}>
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
                                    {detection.size_category && (
                                      <Chip
                                        label={detection.size_category}
                                        size="small"
                                        variant="outlined"
                                      />
                                    )}
                                  </Box>
                                </Grid>
                                {detection.bbox && (
                                  <Grid item xs={12} sm={6}>
                                    <Typography variant="caption" color="text.secondary">
                                      Position (BBox): x={detection.bbox.x}, y={detection.bbox.y}
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.bbox && (
                                  <Grid item xs={12} sm={6}>
                                    <Typography variant="caption" color="text.secondary">
                                      Größe (BBox): {detection.bbox.width} × {detection.bbox.height} px
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.position && (
                                  <Grid item xs={12} sm={6}>
                                    <Typography variant="caption" color="text.secondary">
                                      Zentrum: ({detection.position.center_x?.toFixed(1)}, {detection.position.center_y?.toFixed(1)})
                                    </Typography>
                                  </Grid>
                                )}
                                {detection.position && (
                                  <Grid item xs={12} sm={6}>
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
