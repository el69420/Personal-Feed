require('dotenv').config();
const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json());

app.use(require('./routes/lastfm'));
app.use(require('./routes/garden'));
app.use(require('./routes/letterboxd'));

// Static files served last so API routes always take priority
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Personal Feed running on http://localhost:${PORT}`));
