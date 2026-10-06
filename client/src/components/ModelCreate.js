import React, { useState } from 'react';
import { Box, Container, Paper, Tab, Tabs, Typography } from '@mui/material';

const TABS = [
  {
    id: 'data',
    label: 'Daten',
    title: 'Daten vorbereiten',
    text: 'Hier kommen die Erkennungen raus, aus denen das neue Modell lernt.'
  },
  {
    id: 'training',
    label: 'Training',
    title: 'Modell trainieren',
    text: 'Hier wird aus den vorbereiteten Daten das Modell gebaut.'
  },
  {
    id: 'esp',
    label: 'ESP-P4',
    title: 'Auf dem ESP-P4',
    text: 'Hier landet das fertige Modell auf dem ESP-P4.'
  },
  {
    id: 'benchmark',
    label: 'Benchmark',
    title: 'Benchmark',
    text: 'Hier wird das Modell auf dem Gerät mit den anderen Läufen verglichen.'
  }
];

const ModelCreate = () => {
  const [tab, setTab] = useState(TABS[0].id);
  const current = TABS.find((item) => item.id === tab) || TABS[0];

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Modell erstellen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Neues Modell aus den Erkennungen bauen, auf den ESP-P4 bringen und dort messen.
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(event, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {TABS.map((item) => (
            <Tab key={item.id} value={item.id} label={item.label} />
          ))}
        </Tabs>
      </Box>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          {current.title}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {current.text}
        </Typography>
      </Paper>
    </Container>
  );
};

export default ModelCreate;
