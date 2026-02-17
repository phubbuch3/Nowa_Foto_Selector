/**
 * Select Studio Cloud - Service Layer (PRODUCTION)
 * 
 * Uses:
 * - Google Firebase (Firestore & Storage)
 * - Resend API (Email)
 */

const firebaseConfig = {
    apiKey: "AIzaSyBcs_M4QrSUO6WoangZjoVlcknptdcrDSM",
    authDomain: "noras-bildspeicher.firebaseapp.com",
    projectId: "noras-bildspeicher",
    storageBucket: "noras-bildspeicher.firebasestorage.app",
    messagingSenderId: "993005721210",
    appId: "1:993005721210:web:1aba2d550cb0d0963b8dc3",
    measurementId: "G-95T36VHK1K"
};

// Resend API Key
const RESEND_API_KEY = 're_8tKhvU8h_c7jYDKNsCGgxUeCEjK4Cg6r5';

class SelectStudioService {
    constructor() {
        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.firestore();
        this.storage = firebase.storage();
    }

    // --- Project Operations ---

    /**
     * Create a new Project with Real Cloud Upload
     */
    async createProject(email, packageSize, files = []) {
        try {
            // 1. Upload Files to Firebase Storage
            const uploadedAssets = await this.uploadFilesToCloud(files);

            // 2. Create DB Entry in Firestore
            const newProject = {
                id: crypto.randomUUID(), // Local ID (used for folder path)
                email: email,
                packageSize: parseInt(packageSize) || 12, // Default to 12 if missing
                status: 'SELECTION',
                createdAt: new Date().toISOString(),
                assets: uploadedAssets,
                selections: {}
            };

            // Add to Firestore (using generated ID)
            const docRef = await this.db.collection('projects').add(newProject);
            console.log("Project written with ID: ", docRef.id);

            // Update local object with Firestore ID if needed, but we use internal ID for logic
            newProject.firestoreId = docRef.id;

            // 3. Trigger Mail via Resend
            await this.sendMail('UPLOAD_READY', newProject);

            return newProject;
        } catch (error) {
            console.error("Error adding project: ", error);
            throw error;
        }
    }

    async getProject(id) {
        // Search by our internal 'id' field, not the doc ID
        const snapshot = await this.db.collection('projects').where('id', '==', id).get();
        if (snapshot.empty) return null;
        return snapshot.docs[0].data();
    }

    async getAllProjects() {
        const snapshot = await this.db.collection('projects').orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(doc => doc.data());
    }

    async updateProjectStatus(id, newStatus) {
        const snapshot = await this.db.collection('projects').where('id', '==', id).get();
        if (snapshot.empty) throw new Error('Project not found');

        const doc = snapshot.docs[0];
        await doc.ref.update({ status: newStatus });

        const project = doc.data();
        project.status = newStatus;

        // Triggers
        if (newStatus === 'COMPLETED') {
            await this.sendMail('FINAL_DELIVERY', project);
        }

        return project;
    }

    async updateProjectPackage(id, size) {
        const snapshot = await this.db.collection('projects').where('id', '==', id).get();
        if (snapshot.empty) throw new Error('Project not found');

        await snapshot.docs[0].ref.update({ packageSize: parseInt(size) });
    }

    // --- Selection Operations ---

    async submitSelection(projectId, selections) {
        const snapshot = await this.db.collection('projects').where('id', '==', projectId).get();
        if (snapshot.empty) throw new Error('Project not found');

        const doc = snapshot.docs[0];
        const project = doc.data();

        // Validation
        const selectionCount = Object.keys(selections).length;
        if (selectionCount > project.packageSize) {
            throw new Error(`Limit überschritten. Max: ${project.packageSize}, Gewählt: ${selectionCount}`);
        }

        // Update
        await doc.ref.update({
            selections: selections,
            status: 'PROCESSING'
        });

        // Trigger
        project.selections = selections;
        await this.sendMail('SELECTION_DONE', project);

        return project;
    }

    // --- Cloud Helpers ---

    async uploadFilesToCloud(files) {
        if (!files || files.length === 0) return [];

        const assets = [];
        const uploadPromises = Array.from(files).map(async (file, index) => {
            const fileName = `projects/${Date.now()}_${file.name}`;
            const storageRef = this.storage.ref().child(fileName);

            const snapshot = await storageRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();

            return {
                id: `IMG_${String(index + 1).padStart(3, '0')}`,
                url: downloadURL,
                name: file.name,
                type: 'RAW'
            };
        });

        return Promise.all(uploadPromises);
    }

    // --- Resend Mail ---
    async sendMail(type, project) {
        console.log(`Preparing Resend Mail: ${type} for ${project.email}`);

        // Ensure valid base URL for local or hosted
        // For local file://, this might be tricky, but we try to construct a relative link
        // In production, use your actual domain.
        let baseUrl = window.location.href.split('?')[0];
        if (baseUrl.includes('admin.html')) baseUrl = baseUrl.replace('admin.html', 'index.html');
        // If it sends 'index.html', replace it.
        const cleanBaseUrl = baseUrl;

        const link = `${cleanBaseUrl}?projectId=${project.id}`;

        let subject = '';
        let htmlBody = '';

        if (type === 'UPLOAD_READY') {
            subject = 'Deine Galerie ist online!';
            htmlBody = `<p>Hallo!</p><p>Deine Bilder sind bereit. Bitte triff deine Auswahl hier:</p><p><a href="${link}">${link}</a></p>`;
        } else if (type === 'SELECTION_DONE') {
            subject = 'Auswahl erhalten';
            htmlBody = `<p>Der Kunde hat gewählt!</p><p>Anzahl: ${Object.keys(project.selections).length}</p><p><a href="${link}">Zum Projekt</a></p>`;
        } else if (type === 'FINAL_DELIVERY') {
            subject = 'Fertige Bilder';
            htmlBody = `<p>Deine Bilder sind fertig!</p><p><a href="${link}">Zum Download</a></p>`;
        }

        // Resend API Call
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${RESEND_API_KEY}`
                },
                body: JSON.stringify({
                    from: 'onboarding@resend.dev',
                    to: project.email,
                    subject: subject,
                    html: htmlBody
                })
            });

            if (response.ok) {
                console.log('✅ Resend success');
                // alert('E-Mail gesendet!');
            } else {
                const err = await response.json();
                console.error('❌ Resend Error:', err);
                alert(`Mail-Fehler (Resend): ${err.name} - ${err.message}. \n\nHinweis: Nutze 'onboarding@resend.dev' als Absender.`);
            }
        } catch (e) {
            console.error('Fetch Error:', e);
            // Fallback
            window.open(`mailto:${project.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(link)}`);
        }
    }
}

// Export singleton
window.selectService = new SelectStudioService();
