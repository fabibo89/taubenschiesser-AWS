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
  IconButton,
  CardMedia
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as DetectionIcon,
  Close as CloseIcon,
  Image as ImageIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import axios from 'axios';

const Detections = () => {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    deviceId: '',
    dateFrom: '',
    dateTo: ''
  });
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
        </Box>
      )
    }
  ];

  return (
    <Box>
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
            <Typography variant="h6">
              Erkennungs-Bilder
            </Typography>
            <IconButton onClick={handleCloseImageDialog} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedDetection && (
            <Grid container spacing={2}>
              {/* Original Image */}
              {selectedDetection.image?.url && (
                <Grid item xs={12} md={selectedDetection.zoomed_image?.url ? 6 : 12}>
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Original-Bild
                      </Typography>
                      <Box
                        component="img"
                        src={selectedDetection.image.url}
                        alt="Original Detection"
                        sx={{
                          width: '100%',
                          height: 'auto',
                          maxHeight: '500px',
                          objectFit: 'contain',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1
                        }}
                      />
                      {selectedDetection.image_info?.original_size && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                          Größe: {selectedDetection.image_info.original_size.width} x {selectedDetection.image_info.original_size.height}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* Zoomed Image */}
              {selectedDetection.zoomed_image?.url && (
                <Grid item xs={12} md={selectedDetection.image?.url ? 6 : 12}>
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Gezoomtes Bild {selectedDetection.zoom_factor && `(${selectedDetection.zoom_factor}x)`}
                      </Typography>
                      <Box
                        component="img"
                        src={selectedDetection.zoomed_image.url}
                        alt="Zoomed Detection"
                        sx={{
                          width: '100%',
                          height: 'auto',
                          maxHeight: '500px',
                          objectFit: 'contain',
                          border: '1px solid #e0e0e0',
                          borderRadius: 1
                        }}
                      />
                      {selectedDetection.image_info?.zoomed_size && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                          Größe: {selectedDetection.image_info.zoomed_size.width} x {selectedDetection.image_info.zoomed_size.height}
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
      </Dialog>
    </Box>
  );
};

export default Detections;
