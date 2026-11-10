// Soporte técnico: el docente reporta fallas, el servicio técnico las atiende desde su panel.
// Cada reporte nuevo (y cada mensaje del docente) avisa por WhatsApp al número de soporte.
const express = require('express');
const https   = require('https');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { JWT_SECRET, docenteRequired, tecnicoRequired, usuarioRequired } = require('../auth');

const router = express.Router();

// Contacto que ve el docente en su panel
const SOPORTE = {
    nombre:   process.env.SOPORTE_NOMBRE   || 'Servicio técnico',
    telefono: process.env.SOPORTE_TELEFONO || '+59165723672',
    correo:   process.env.SOPORTE_CORREO   || 'servicio@gmail.com',
};
// Cuenta inicial del servicio técnico: se crea una sola vez, con la contraseña
// de la variable de entorno TECNICO_PASSWORD (no se guarda en el código).
const TECNICO_INICIAL = {
    nombre:   'Servicio técnico',
    correo:   SOPORTE.correo,
    password: process.env.TECNICO_PASSWORD,
};
const ESTADOS = ['pendiente', 'en_revision', 'resuelto'];
const PANEL_URL = process.env.PANEL_URL || 'https://xrayvr.up.railway.app';

// ── Tablas ────────────────────────────────────────────────────────────────────

async function init() {
    await db.execute(`CREATE TABLE IF NOT EXISTS tecnicos (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        nombre        VARCHAR(100) NOT NULL,
        correo        VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        creado_en     TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS reportes (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        docente_id     INT          NOT NULL,
        docente_nombre VARCHAR(150) NOT NULL,
        categoria      VARCHAR(120) NOT NULL,
        descripcion    TEXT,
        estado         VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        creado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS reporte_mensajes (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        reporte_id   INT          NOT NULL,
        autor        VARCHAR(10)  NOT NULL,
        autor_nombre VARCHAR(150) NOT NULL,
        texto        TEXT         NOT NULL,
        creado_en    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reporte_id) REFERENCES reportes(id) ON DELETE CASCADE)`);

    const [t] = await db.execute('SELECT id FROM tecnicos WHERE correo = ?', [TECNICO_INICIAL.correo]);
    if (!t.length) {
        if (!TECNICO_INICIAL.password) {
            console.warn('[soporte] Define TECNICO_PASSWORD para crear la cuenta de servicio técnico.');
            return;
        }
        const hash = await bcrypt.hash(TECNICO_INICIAL.password, 10);
        await db.execute('INSERT INTO tecnicos (nombre, correo, password_hash) VALUES (?, ?, ?)',
            [TECNICO_INICIAL.nombre, TECNICO_INICIAL.correo, hash]);
        console.log('[soporte] Cuenta de servicio técnico creada:', TECNICO_INICIAL.correo);
    }
}

// ── WhatsApp (CallMeBot) ──────────────────────────────────────────────────────
// Requiere la variable CALLMEBOT_APIKEY (se obtiene una vez desde el celular de soporte).
// Sin ella, el reporte se guarda igual y el panel ofrece avisar con un enlace de WhatsApp.

function avisarWhatsApp(texto) {
    const apikey = process.env.CALLMEBOT_APIKEY;
    if (!apikey) return Promise.resolve('no_configurado');
    const url = 'https://api.callmebot.com/whatsapp.php'
        + '?phone=' + encodeURIComponent(SOPORTE.telefono)
        + '&text='  + encodeURIComponent(texto)
        + '&apikey=' + encodeURIComponent(apikey);
    return new Promise(resolve => {
        const req = https.get(url, res => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 300 ? 'enviado' : 'error');
        });
        req.on('error', e => { console.error('[whatsapp]', e.message); resolve('error'); });
        req.setTimeout(10000, () => { req.destroy(); resolve('error'); });
    });
}

// ── Login del servicio técnico ────────────────────────────────────────────────

router.post('/tecnico/login', async (req, res) => {
    const { correo, password } = req.body;
    if (!correo || !password) return res.status(400).json({ error: 'Faltan campos' });
    try {
        const [rows] = await db.execute('SELECT * FROM tecnicos WHERE correo = ?', [correo.trim().toLowerCase()]);
        if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash)))
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        const token = jwt.sign({ id: rows[0].id, nombre: rows[0].nombre, rol: 'tecnico' },
            JWT_SECRET, { expiresIn: '12h' });
        res.json({ token, nombre: rows[0].nombre, rol: 'tecnico' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Contacto ──────────────────────────────────────────────────────────────────

router.get('/soporte/contacto', usuarioRequired, (req, res) => res.json(SOPORTE));

// ── Reportes ──────────────────────────────────────────────────────────────────

// Docente: crear un reporte
router.post('/reportes', docenteRequired, async (req, res) => {
    const categoria   = String(req.body.categoria   || '').trim().slice(0, 120);
    const descripcion = String(req.body.descripcion || '').trim().slice(0, 4000);
    if (!categoria) return res.status(400).json({ error: 'Elige el tipo de problema' });
    if (categoria === 'Otro problema' && !descripcion)
        return res.status(400).json({ error: 'Describe el problema' });
    try {
        const nombre = req.usuario.nombre || 'Docente';
        const [r] = await db.execute(
            'INSERT INTO reportes (docente_id, docente_nombre, categoria, descripcion) VALUES (?, ?, ?, ?)',
            [req.usuario.id, nombre, categoria, descripcion || null]);
        const id = r.insertId;
        const aviso = `🔧 Reporte #${id} — ${categoria}\nDocente: ${nombre}`
            + (descripcion ? `\n"${descripcion.slice(0, 300)}"` : '')
            + `\nResponder en: ${PANEL_URL}`;
        const whatsapp = await avisarWhatsApp(aviso);
        res.json({ ok: true, id, whatsapp, aviso });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Docente: sus reportes · Técnico: todos
router.get('/reportes', usuarioRequired, async (req, res) => {
    try {
        const [reportes] = req.rol === 'tecnico'
            ? await db.execute("SELECT * FROM reportes ORDER BY FIELD(estado,'pendiente','en_revision','resuelto'), actualizado_en DESC")
            : await db.execute('SELECT * FROM reportes WHERE docente_id = ? ORDER BY actualizado_en DESC', [req.usuario.id]);
        if (!reportes.length) return res.json([]);
        const ids = reportes.map(r => r.id);
        const [msgs] = await db.query(
            'SELECT * FROM reporte_mensajes WHERE reporte_id IN (?) ORDER BY creado_en, id', [ids]);
        reportes.forEach(r => { r.mensajes = msgs.filter(m => m.reporte_id === r.id); });
        res.json(reportes);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Docente (dueño) o técnico: agregar un mensaje al reporte
router.post('/reportes/:id/mensajes', usuarioRequired, async (req, res) => {
    const id    = parseInt(req.params.id);
    const texto = String(req.body.texto || '').trim().slice(0, 4000);
    if (!id || !texto) return res.status(400).json({ error: 'Escribe un mensaje' });
    try {
        const [rows] = await db.execute('SELECT * FROM reportes WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ error: 'Reporte no encontrado' });
        const rep = rows[0];
        if (req.rol === 'docente' && rep.docente_id !== req.usuario.id)
            return res.status(403).json({ error: 'Sin permiso' });

        const nombre = req.usuario.nombre || (req.rol === 'tecnico' ? 'Servicio técnico' : 'Docente');
        await db.execute(
            'INSERT INTO reporte_mensajes (reporte_id, autor, autor_nombre, texto) VALUES (?, ?, ?, ?)',
            [id, req.rol, nombre, texto]);

        let whatsapp = null;
        if (req.rol === 'tecnico') {
            if (rep.estado === 'pendiente')
                await db.execute("UPDATE reportes SET estado = 'en_revision' WHERE id = ?", [id]);
            else
                await db.execute('UPDATE reportes SET actualizado_en = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        } else {
            // El docente vuelve a escribir: si estaba resuelto, se reabre
            await db.execute("UPDATE reportes SET estado = IF(estado = 'resuelto', 'pendiente', estado), actualizado_en = CURRENT_TIMESTAMP WHERE id = ?", [id]);
            whatsapp = await avisarWhatsApp(`💬 Reporte #${id} — ${rep.categoria}\n${nombre}: "${texto.slice(0, 300)}"\nResponder en: ${PANEL_URL}`);
        }
        res.json({ ok: true, whatsapp });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Técnico: cambiar estado
router.patch('/reportes/:id/estado', tecnicoRequired, async (req, res) => {
    const id     = parseInt(req.params.id);
    const estado = req.body.estado;
    if (!id || !ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    try {
        const [r] = await db.execute('UPDATE reportes SET estado = ? WHERE id = ?', [estado, id]);
        if (!r.affectedRows) return res.status(404).json({ error: 'Reporte no encontrado' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Docente: marcar su propio reporte como resuelto ("ya se solucionó")
router.post('/reportes/:id/resuelto', docenteRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const [r] = await db.execute("UPDATE reportes SET estado = 'resuelto' WHERE id = ? AND docente_id = ?",
            [id, req.usuario.id]);
        if (!r.affectedRows) return res.status(404).json({ error: 'Reporte no encontrado' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router, init };
