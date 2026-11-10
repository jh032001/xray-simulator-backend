const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar_en_produccion';

function leerToken(req) {
    const header = req.headers['authorization'];
    const token  = header && header.split(' ')[1];
    if (!token) return null;
    try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Los tokens de docente no traen "rol" (compatibles con los ya emitidos);
// los del servicio técnico traen rol: 'tecnico'.
const rolDe = u => (u && u.rol) || 'docente';

function requiere(...roles) {
    return (req, res, next) => {
        const u = leerToken(req);
        if (!u) return res.status(401).json({ error: 'No autorizado' });
        if (!roles.includes(rolDe(u))) return res.status(403).json({ error: 'Sin permiso' });
        req.usuario = u;
        req.rol     = rolDe(u);
        req.docente = u;   // compatibilidad con el código existente
        next();
    };
}

module.exports = {
    JWT_SECRET,
    rolDe,
    docenteRequired: requiere('docente'),
    tecnicoRequired: requiere('tecnico'),
    usuarioRequired: requiere('docente', 'tecnico'),
};
