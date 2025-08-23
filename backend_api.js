// server.js - Backend completo con Express y PostgreSQL
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de base de datos
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Configuración de multer para archivos
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token de acceso requerido' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
};

// ============ RUTAS DE AUTENTICACIÓN ============

// Registro de maestro
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, school } = req.body;
        
        // Verificar si el email ya existe
        const existingUser = await pool.query(
            'SELECT id FROM teachers WHERE email = $1',
            [email]
        );
        
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        // Hash de la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insertar nuevo maestro
        const result = await pool.query(
            'INSERT INTO teachers (name, email, password_hash, school) VALUES ($1, $2, $3, $4) RETURNING id, name, email, school',
            [name, email, hashedPassword, school]
        );
        
        const teacher = result.rows[0];
        const token = jwt.sign(
            { id: teacher.id, email: teacher.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            teacher: {
                id: teacher.id,
                name: teacher.name,
                email: teacher.email,
                school: teacher.school
            }
        });
        
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Login de maestro
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Buscar maestro
        const result = await pool.query(
            'SELECT id, name, email, password_hash, school FROM teachers WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        
        const teacher = result.rows[0];
        
        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, teacher.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        
        // Generar token
        const token = jwt.sign(
            { id: teacher.id, email: teacher.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            teacher: {
                id: teacher.id,
                name: teacher.name,
                email: teacher.email,
                school: teacher.school
            }
        });
        
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============ RUTAS DE ESTUDIANTES ============

// Obtener estudiantes del maestro
app.get('/api/students', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, photo, created_at FROM students WHERE teacher_id = $1 ORDER BY name',
            [req.user.id]
        );
        
        res.json({
            success: true,
            students: result.rows
        });
        
    } catch (error) {
        console.error('Error obteniendo estudiantes:', error);
        res.status(500).json({ error: 'Error obteniendo estudiantes' });
    }
});

// Registrar nuevo estudiante
app.post('/api/students', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
        const { name, descriptor } = req.body;
        const photo = req.file ? req.file.buffer.toString('base64') : null;
        
        if (!name || !descriptor) {
            return res.status(400).json({ error: 'Nombre y descriptor son requeridos' });
        }
        
        // Insertar estudiante
        const result = await pool.query(
            'INSERT INTO students (teacher_id, name, descriptor, photo) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.user.id, name, JSON.parse(descriptor), photo]
        );
        
        res.json({
            success: true,
            student: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error registrando estudiante:', error);
        res.status(500).json({ error: 'Error registrando estudiante' });
    }
});

// Eliminar estudiante
app.delete('/api/students/:id', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        // Verificar que el estudiante pertenece al maestro
        const result = await pool.query(
            'DELETE FROM students WHERE id = $1 AND teacher_id = $2 RETURNING id',
            [studentId, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }
        
        res.json({
            success: true,
            message: 'Estudiante eliminado'
        });
        
    } catch (error) {
        console.error('Error eliminando estudiante:', error);
        res.status(500).json({ error: 'Error eliminando estudiante' });
    }
});

// ============ RUTAS DE ASISTENCIA ============

// Registrar asistencia
app.post('/api/attendance', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { date, time, detected, recognized, students } = req.body;
        
        // Crear sesión de asistencia
        const sessionResult = await client.query(
            'INSERT INTO attendance_sessions (teacher_id, session_date, session_time, total_detected, total_recognized) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [req.user.id, date, time, detected, recognized]
        );
        
        const sessionId = sessionResult.rows[0].id;
        
        // Registrar asistencia individual
        for (const student of students) {
            await client.query(
                'INSERT INTO attendance_records (session_id, student_id, confidence, is_present) VALUES ($1, $2, $3, $4)',
                [sessionId, student.studentId, student.confidence, student.present]
            );
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            sessionId,
            message: 'Asistencia registrada exitosamente'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error registrando asistencia:', error);
        res.status(500).json({ error: 'Error registrando asistencia' });
    } finally {
        client.release();
    }
});

// Obtener historial de asistencia
app.get('/api/attendance', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate, limit = 50 } = req.query;
        
        let query = `
            SELECT 
                s.id,
                s.session_date,
                s.session_time,
                s.total_detected,
                s.total_recognized,
                s.created_at,
                json_agg(
                    json_build_object(
                        'student_name', st.name,
                        'confidence', r.confidence,
                        'is_present', r.is_present
                    )
                ) as students
            FROM attendance_sessions s
            LEFT JOIN attendance_records r ON s.id = r.session_id
            LEFT JOIN students st ON r.student_id = st.id
            WHERE s.teacher_id = $1
        `;
        
        const params = [req.user.id];
        let paramCount = 1;
        
        if (startDate) {
            paramCount++;
            query += ` AND s.session_date >= $${paramCount}`;
            params.push(startDate);
        }
        
        if (endDate) {
            paramCount++;
            query += ` AND s.session_date <= $${paramCount}`;
            params.push(endDate);
        }
        
        query += `
            GROUP BY s.id, s.session_date, s.session_time, s.total_detected, s.total_recognized, s.created_at
            ORDER BY s.session_date DESC, s.session_time DESC
            LIMIT $${paramCount + 1}
        `;
        params.push(parseInt(limit));
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            sessions: result.rows
        });
        
    } catch (error) {
        console.error('Error obteniendo asistencia:', error);
        res.status(500).json({ error: 'Error obteniendo historial de asistencia' });
    }
});

// Estadísticas de asistencia
app.get('/api/attendance/stats', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let dateFilter = '';
        const params = [req.user.id];
        
        if (startDate && endDate) {
            dateFilter = 'AND s.session_date BETWEEN $2 AND $3';
            params.push(startDate, endDate);
        }
        
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT s.id) as total_sessions,
                AVG(s.total_detected) as avg_detected,
                AVG(s.total_recognized) as avg_recognized,
                COUNT(DISTINCT st.id) as total_students,
                COUNT(r.id) as total_attendances
            FROM attendance_sessions s
            LEFT JOIN attendance_records r ON s.id = r.session_id
            LEFT JOIN students st ON r.student_id = st.id
            WHERE s.teacher_id = $1 ${dateFilter}
        `;
        
        const studentStatsQuery = `
            SELECT 
                st.name,
                COUNT(r.id) as attendance_count,
                AVG(r.confidence) as avg_confidence
            FROM students st
            LEFT JOIN attendance_records r ON st.id = r.student_id
            LEFT JOIN attendance_sessions s ON r.session_id = s.id
            WHERE st.teacher_id = $1 ${dateFilter}
            GROUP BY st.id, st.name
            ORDER BY attendance_count DESC
        `;
        
        const [statsResult, studentStatsResult] = await Promise.all([
            pool.query(statsQuery, params),
            pool.query(studentStatsQuery, params)
        ]);
        
        res.json({
            success: true,
            stats: statsResult.rows[0],
            studentStats: studentStatsResult.rows
        });
        
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
});

// ============ ESQUEMA DE BASE DE DATOS ============
const initDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS teachers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                school VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS students (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                descriptor JSONB NOT NULL,
                photo TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS attendance_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
                session_date DATE NOT NULL,
                session_time TIME NOT NULL,
                total_detected INTEGER DEFAULT 0,
                total_recognized INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS attendance_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id UUID REFERENCES attendance_sessions(id) ON DELETE CASCADE,
                student_id UUID REFERENCES students(id) ON DELETE SET NULL,
                confidence FLOAT DEFAULT 0,
                is_present BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE INDEX IF NOT EXISTS idx_students_teacher_id ON students(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_teacher_id ON attendance_sessions(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_sessions(session_date);
            CREATE INDEX IF NOT EXISTS idx_records_session_id ON attendance_records(session_id);
        `);
        
        console.log('✅ Base de datos inicializada correctamente');
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error);
    }
};

// Inicializar servidor
app.listen(PORT, async () => {
    await initDatabase();
    console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

module.exports = app;