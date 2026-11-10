const express = require('express');
const cors    = require('cors');
const path    = require('path');
const api     = require('./routes/api');
const soporte = require('./routes/soporte');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', api);
app.use('/api', soporte.router);

soporte.init().catch(e => console.error('[soporte] init:', e.message));

// Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    console.log('MYSQL_URL:', process.env.MYSQL_URL ? 'SET' : 'NOT SET');
    console.log('MYSQLHOST:', process.env.MYSQLHOST || 'NOT SET');
    console.log('MYSQLPORT:', process.env.MYSQLPORT || 'NOT SET');
});
