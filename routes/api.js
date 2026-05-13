const express = require('express');
const router  = express.Router();
const db      = require('../db');

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
// Body: { estudiante_id, tipo: 'pre'|'post', respuestas: [0,2,1,...] }
router.post('/submit', async (req, res) => {
    const { estudiante_id, tipo, respuestas } = req.body;
    if (!estudiante_id || !tipo || !respuestas)
        return res.status(400).json({ error: 'Faltan campos' });

    const correctas = [1, 2, 1, 3, 3, 2, 1, 2, 1, 3]; // índices 0-based de respuesta correcta

    try {
        for (let i = 0; i < respuestas.length; i++) {
            const esCorrecta = respuestas[i] === correctas[i];
            await db.execute(
                'INSERT INTO respuestas (estudiante_id, tipo, pregunta, respuesta, correcta) VALUES (?, ?, ?, ?, ?)',
                [estudiante_id, tipo, i + 1, respuestas[i], esCorrecta]
            );
        }
        const puntaje = respuestas.filter((r, i) => r === correctas[i]).length;
        res.json({ puntaje, total: correctas.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/results — todos los resultados para el dashboard
router.get('/results', async (req, res) => {
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
