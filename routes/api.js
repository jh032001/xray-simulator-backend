const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_en_produccion';
const SALT_ROUNDS = 10;

// Índices 0-based de respuesta correcta (deben coincidir con QuizPanel.cs)
const CORRECTAS = [1, 2, 3, 2, 3, 2, 3, 2, 3, 3];

// ── Middleware auth ───────────────────────────────────────────────────────────

function authRequired(req, res, next) {
    const header = req.headers['authorization'];
    const token  = header && header.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        req.docente = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido' });
    }
}

// ── Docentes ──────────────────────────────────────────────────────────────────

// POST /api/docente/register
router.post('/docente/register', async (req, res) => {
    const { nombre, correo, password } = req.body;
    if (!nombre || !correo || !password)
        return res.status(400).json({ error: 'Faltan campos' });
    if (password.length < 6)
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    try {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        await db.execute(
            'INSERT INTO docentes (nombre, correo, password_hash) VALUES (?, ?, ?)',
            [nombre.trim(), correo.trim().toLowerCase(), hash]
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('[register]', e);
        if (e.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ error: 'Ese correo ya está registrado' });
        res.status(500).json({ error: e.message || JSON.stringify(e) });
    }
});

// POST /api/docente/login
router.post('/docente/login', async (req, res) => {
    const { correo, password } = req.body;
    if (!correo || !password)
        return res.status(400).json({ error: 'Faltan campos' });

    try {
        const [rows] = await db.execute(
            'SELECT * FROM docentes WHERE correo = ?',
            [correo.trim().toLowerCase()]
        );
        if (!rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });

        const ok = await bcrypt.compare(password, rows[0].password_hash);
        if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

        const token = jwt.sign(
            { id: rows[0].id, nombre: rows[0].nombre },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.json({ token, nombre: rows[0].nombre });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Estudiantes (desde Unity) ─────────────────────────────────────────────────

// POST /api/login — registrar estudiante, devuelve su id
router.post('/login', async (req, res) => {
    const { nombre, apellido, semestre } = req.body;
    if (!nombre || !apellido || !semestre)
        return res.status(400).json({ error: 'Faltan campos' });

    try {
        const [result] = await db.execute(
            'INSERT INTO estudiantes (nombre, apellido, semestre) VALUES (?, ?, ?)',
            [nombre.trim(), apellido.trim(), semestre]
        );
        res.json({ estudiante_id: result.insertId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/submit — enviar respuestas del cuestionario
router.post('/submit', async (req, res) => {
    const { estudiante_id, tipo, respuestas } = req.body;
    if (!estudiante_id || !tipo || !respuestas)
        return res.status(400).json({ error: 'Faltan campos' });

    try {
        for (let i = 0; i < respuestas.length; i++) {
            const esCorrecta = respuestas[i] === CORRECTAS[i];
            await db.execute(
                'INSERT INTO respuestas (estudiante_id, tipo, pregunta, respuesta, correcta) VALUES (?, ?, ?, ?, ?)',
                [estudiante_id, tipo, i + 1, respuestas[i], esCorrecta]
            );
        }
        const puntaje = respuestas.filter((r, i) => r === CORRECTAS[i]).length;
        res.json({ puntaje, total: CORRECTAS.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Dashboard (protegido) ─────────────────────────────────────────────────────

// DELETE /api/estudiante/:id — eliminar estudiante y sus respuestas
router.delete('/estudiante/:id', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    try {
        await db.execute('DELETE FROM respuestas  WHERE estudiante_id = ?', [id]);
        await db.execute('DELETE FROM estudiantes WHERE id = ?', [id]);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/question-stats — aciertos por pregunta y tipo
router.get('/question-stats', authRequired, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                pregunta,
                tipo,
                COUNT(*)                                          AS total,
                SUM(CASE WHEN correcta = 1 THEN 1 ELSE 0 END)    AS correctas
            FROM respuestas
            GROUP BY pregunta, tipo
            ORDER BY pregunta, tipo
        `);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/results — requiere token de docente
router.get('/results', authRequired, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                e.id,
                e.nombre,
                e.apellido,
                e.semestre,
                SUM(CASE WHEN r.tipo = 'pre'  AND r.correcta = 1 THEN 1 ELSE 0 END) AS puntaje_pre,
                SUM(CASE WHEN r.tipo = 'post' AND r.correcta = 1 THEN 1 ELSE 0 END) AS puntaje_post,
                COUNT(CASE WHEN r.tipo = 'pre'  THEN 1 END) AS total_pre,
                COUNT(CASE WHEN r.tipo = 'post' THEN 1 END) AS total_post
            FROM estudiantes e
            LEFT JOIN respuestas r ON r.estudiante_id = e.id
            GROUP BY e.id
            ORDER BY e.creado_en DESC
        `);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
