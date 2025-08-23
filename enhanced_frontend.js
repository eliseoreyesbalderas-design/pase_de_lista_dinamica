// enhanced-frontend.js - Cliente mejorado con sincronización
class AttendanceApp {
    constructor() {
        this.apiUrl = 'https://your-api.herokuapp.com/api';
        this.token = localStorage.getItem('auth_token');
        this.students = [];
        this.attendanceRecords = [];
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        
        this.init();
    }
    
    async init() {
        // Event listeners para conectividad
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.showStatus('🌐 Conectado - Sincronizando datos...', 'success');
            this.syncPendingData();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.showStatus('📴 Modo offline - Los datos se sincronizarán cuando vuelva la conexión', 'info');
        });
        
        // Cargar datos locales
        await this.loadLocalData();
        
        // Verificar autenticación
        if (!this.token) {
            this.showLoginForm();
            return;
        }
        
        // Verificar token válido y sincronizar
        if (this.isOnline) {
            const isValid = await this.validateToken();
            if (isValid) {
                await this.syncWithServer();
            } else {
                this.showLoginForm();
            }
        } else {
            this.showApp();
        }
    }
    
    // ========== AUTENTICACIÓN ==========
    showLoginForm() {
        document.getElementById('app').innerHTML = `
            <div class="login-container">
                <div class="login-form">
                    <h2>🎓 Iniciar Sesión</h2>
                    <form id="loginForm">
                        <input type="email" id="loginEmail" placeholder="Email" required>
                        <input type="password" id="loginPassword" placeholder="Contraseña" required>
                        <button type="submit">Iniciar Sesión</button>
                    </form>
                    <p>
                        <a href="#" onclick="app.showRegisterForm()">¿No tienes cuenta? Regístrate</a>
                    </p>
                </div>
            </div>
        `;
        
        document.getElementById('loginForm').onsubmit = (e) => {
            e.preventDefault();
            this.login();
        };
    }
    
    showRegisterForm() {
        document.getElementById('app').innerHTML = `
            <div class="login-container">
                <div class="login-form">
                    <h2>📝 Registro</h2>
                    <form id="registerForm">
                        <input type="text" id="registerName" placeholder="Nombre completo" required>
                        <input type="email" id="registerEmail" placeholder="Email" required>
                        <input type="password" id="registerPassword" placeholder="Contraseña" required>
                        <input type="text" id="registerSchool" placeholder="Escuela" required>
                        <button type="submit">Registrarse</button>
                    </form>
                    <p>
                        <a href="#" onclick="app.showLoginForm()">¿Ya tienes cuenta? Inicia sesión</a>
                    </p>
                </div>
            </div>
        `;
        
        document.getElementById('registerForm').onsubmit = (e) => {
            e.preventDefault();
            this.register();
        };
    }
    
    async login() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        if (!this.isOnline) {
            this.showStatus('❌ Necesitas conexión a internet para iniciar sesión', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('auth_token', this.token);
                localStorage.setItem('user_data', JSON.stringify(data.teacher));
                
                await this.syncWithServer();
                this.showApp();
                this.showStatus('✅ Sesión iniciada correctamente', 'success');
            } else {
                this.showStatus(data.error || 'Error en login', 'error');
            }
        } catch (error) {
            this.showStatus('❌ Error de conexión', 'error');
        }
    }
    
    async register() {
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const school = document.getElementById('registerSchool').value;
        
        if (!this.isOnline) {
            this.showStatus('❌ Necesitas conexión a internet para registrarte', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, school })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.token = data.token;
                localStorage.setItem('auth_token', this.token);
                localStorage.setItem('user_data', JSON.stringify(data.teacher));
                
                this.showApp();
                this.showStatus('✅ Registro exitoso', 'success');
            } else {
                this.showStatus(data.error || 'Error en registro', 'error');
            }
        } catch (error) {
            this.showStatus('❌ Error de conexión', 'error');
        }
    }
    
    async validateToken() {
        if (!this.token || !this.isOnline) return false;
        
        try {
            const response = await fetch(`${this.apiUrl}/students`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            return response.ok;
        } catch {
            return false;
        }
    }
    
    logout() {
        this.token = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
        localStorage.removeItem('students_cache');
        localStorage.removeItem('attendance_cache');
        this.showLoginForm();
    }
    
    // ========== SINCRONIZACIÓN ==========
    async syncWithServer() {
        if (!this.isOnline || !this.token) return;
        
        try {
            // Descargar estudiantes del servidor
            const studentsResponse = await fetch(`${this.apiUrl}/students`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (studentsResponse.ok) {
                const studentsData = await studentsResponse.json();
                this.students = studentsData.students || [];
                localStorage.setItem('students_cache', JSON.stringify(this.students));
            }
            
            // Subir datos pendientes
            await this.syncPendingData();
            
        } catch (error) {
            console.error('Error sincronizando:', error);
        }
    }
    
    async syncPendingData() {
        if (!this.isOnline || !this.token) return;
        
        // Procesar cola de sincronización
        for (const item of this.syncQueue) {
            try {
                if (item.type === 'student') {
                    await this.syncStudent(item.data);
                } else if (item.type === 'attendance') {
                    await this.syncAttendance(item.data);
                }
                
                // Remover de la cola si fue exitoso
                this.syncQueue = this.syncQueue.filter(i => i.id !== item.id);
            } catch (error) {
                console.error('Error sincronizando item:', error);
            }
        }
        
        this.saveSyncQueue();
    }
    
    async syncStudent(studentData) {
        const formData = new FormData();
        formData.append('name', studentData.name);
        formData.append('descriptor', JSON.stringify(studentData.descriptor));
        
        if (studentData.photo) {
            // Convertir base64 a blob
            const response = await fetch(studentData.photo);
            const blob = await response.blob();
            formData.append('photo', blob, 'photo.jpg');
        }
        
        const response = await fetch(`${this.apiUrl}/students`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.token}` },
            body: formData
        });
        
        if (!response.ok) throw new Error('Error enviando estudiante');
    }
    
    async syncAttendance(attendanceData) {
        const response = await fetch(`${this.apiUrl}/attendance`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(attendanceData)
        });
        
        if (!response.ok) throw new Error('Error enviando asistencia');
    }
    
    addToSyncQueue(type, data) {
        const item = {
            id: Date.now(),
            type,
            data,
            timestamp: new Date().toISOString()
        };
        
        this.syncQueue.push(item);
        this.saveSyncQueue();
        
        if (this.isOnline && this.token) {
            setTimeout(() => this.syncPendingData(), 1000);
        }
    }
    
    saveSyncQueue() {
        localStorage.setItem('sync_queue', JSON.stringify(this.syncQueue));
    }
    
    loadSyncQueue() {
        const saved = localStorage.getItem('sync_queue');
        if (saved) {
            this.syncQueue = JSON.parse(saved);
        }
    }
    
    // ========== DATOS LOCALES ==========
    async loadLocalData() {
        this.loadSyncQueue();
        
        // Cargar estudiantes
        const savedStudents = localStorage.getItem('students_cache');
        if (savedStudents) {
            this.students = JSON.parse(savedStudents);
        }
        
        // Cargar asistencias
        const savedAttendance = localStorage.getItem('attendance_cache');
        if (savedAttendance) {
            this.attendanceRecords = JSON.parse(savedAtt