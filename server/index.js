import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import weather from './routes/weather.js';
import calendar from './routes/calendar.js';
import smarthome from './routes/smarthome.js';
import news from './routes/news.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// API routes
app.use('/api/weather', weather);
app.use('/api/calendar', calendar);
app.use('/api/smarthome', smarthome);
app.use('/api/news', news);

// Serve the built client in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Dashboard server on :${port}`);
});
