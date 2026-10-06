import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';

const ROLE_LABEL = {
  live: 'Produktiv',
  replay: 'Nebenlauf',
  esp: 'ESP-P4'
};

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatInput(input) {
  if (!input || input.height == null || input.width == null) return '—';
  return `${input.width}×${input.height}`;
}

const Models = () => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState({ status: 'idle' });
  const [startingId, setStartingId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await axios.get('/api/models');
      setModels(response.data.models || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Modelle konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let timer;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await axios.get('/api/models/replay');
        if (!cancelled) setJob(response.data || { status: 'idle' });
        if (!cancelled && response.data?.status === 'running') {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'Laufstatus nicht verfügbar');
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job.status]);

  const startRun = async (model) => {
    setStartingId(model.id);
    setError('');
    try {
      const response = await axios.post(`/api/models/${model.id}/replay`);
      setJob(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Lauf konnte nicht gestartet werden');
    } finally {
      setStartingId(null);
    }
  };

  const stopRun = async () => {
    setError('');
    try {
      const response = await axios.post('/api/models/replay/stop');
      setJob(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Lauf konnte nicht gestoppt werden');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Modelle
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Das Produktivmodell bleibt das, womit der Taubenschießer erkennt. Nebenläufe laden wir getrennt.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {job.status !== 'idle' && (
        <Alert
          severity={job.status === 'failed' ? 'error' : job.status === 'running' ? 'info' : 'success'}
          sx={{ mb: 2 }}
          action={job.status === 'running' ? (
            <Button color="inherit" size="small" onClick={stopRun}>Stopp</Button>
          ) : null}
        >
          {job.modelName || 'Lauf'}: {job.message || job.status}
          {job.total != null && ` — ${job.processed || 0}/${job.total}`}
          {` — gespeichert ${job.updated || 0}, übersprungen ${job.skipped || 0}, Fehler ${job.errors || 0}`}
        </Alert>
      )}

      <Paper>
        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Rolle</TableCell>
                <TableCell>Datei</TableCell>
                <TableCell>Laufzeit</TableCell>
                <TableCell>Auflösung</TableCell>
                <TableCell>Größe</TableCell>
                <TableCell>Tests</TableCell>
                <TableCell>Lauf</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {models.map((model) => {
                const artifacts = model.artifacts?.length ? model.artifacts : [null];
                return (
                  <TableRow key={model.id}>
                    <TableCell>
                      {model.name}
                      {model.isLiveFile && (
                        <Chip size="small" color="primary" label="geladen" sx={{ ml: 1 }} />
                      )}
                    </TableCell>
                    <TableCell>{ROLE_LABEL[model.role] || model.role}</TableCell>
                    <TableCell>
                      {artifacts.map((artifact) => (
                        <Box key={artifact?.file || 'none'}>
                          {artifact?.file || '—'}
                          {artifact && !artifact.present && (
                            <Chip size="small" color="warning" label="fehlt" sx={{ ml: 1 }} />
                          )}
                        </Box>
                      ))}
                    </TableCell>
                    <TableCell>
                      {artifacts.map((artifact) => (
                        <Box key={`${artifact?.file || 'none'}-runtime`}>{artifact?.runtime || '—'}</Box>
                      ))}
                    </TableCell>
                    <TableCell>
                      {artifacts.map((artifact) => (
                        <Box key={`${artifact?.file || 'none'}-input`}>{formatInput(artifact?.input)}</Box>
                      ))}
                    </TableCell>
                    <TableCell>
                      {artifacts.map((artifact) => (
                        <Box key={`${artifact?.file || 'none'}-size`}>{formatBytes(artifact?.bytes)}</Box>
                      ))}
                    </TableCell>
                    <TableCell>{model.tests?.length ? model.tests.length : '—'}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={
                          startingId === model.id
                          || job.status === 'running'
                          || !(model.artifacts || []).some((artifact) => artifact.runtime === 'onnx' && artifact.present)
                        }
                        onClick={() => startRun(model)}
                      >
                        {job.status === 'running' && job.modelId === model.id ? 'läuft' : 'Starten'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Container>
  );
};

export default Models;
