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
    // --- EmailJS ---
    async sendMail(type, project) {
        console.log(`Sending Mail via EmailJS: ${type} for ${project.email}`);

        // Base URL Logic (Auto-detect environment)
        let currentUrl = window.location.href.split('?')[0];
        // Strip the filename to get folder
        const basePath = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);

        // Define clean entry points
        const adminUrl = basePath + 'index.html';          // Admin Dashboard
        const galleryUrl = basePath + 'customer.html?projectId=' + project.id; // Customer View

        let templateParams = {
            to_email: project.email,
            to_name: project.email.split('@')[0],
            project_id: project.id,
            admin_email: "phubbuch3@gmail.com", // YOUR Email (Photographer)
            link_gallery: galleryUrl,
            link_admin: adminUrl,
            message: "",
            subject: "",
            btn_text: "Ansehen",
            link_action: galleryUrl
        };

        // Configure Message based on Type
        if (type === 'UPLOAD_READY') {
            templateParams.subject = "Deine Galerie ist online! 📸";
            templateParams.message = `Deine Bilder sind bereit. Du kannst ab sofort deine Auswahl treffen.`;
            templateParams.link_action = galleryUrl;
            templateParams.btn_text = "Galerie ansehen";
        }
        else if (type === 'SELECTION_DONE') {
            // Switch recipient to Admin
            templateParams.to_email = templateParams.admin_email;
            templateParams.to_name = "Admin";
            templateParams.subject = "Neue Auswahl vom Kunden ✅";
            templateParams.message = `Der Kunde (${project.email}) hat ${Object.keys(project.selections).length} Bilder ausgewählt.`;
            templateParams.link_action = adminUrl;
            templateParams.btn_text = "Zum Admin Dashboard";
        }
        else if (type === 'FINAL_DELIVERY') {
            templateParams.subject = "Deine fertigen Bilder sind da! ✨";
            templateParams.message = `Die Bearbeitung ist abgeschlossen. Du kannst deine Bilder jetzt herunterladen.`;
            templateParams.link_action = galleryUrl; // Ideally this should be a direct download link or zip, but gallery view works
            templateParams.btn_text = "Bilder herunterladen";
        }

        try {
            // ⚠️ REPLACE WITH YOUR EMAILJS KEYS
            const SERVICE_ID = "YOUR_SERVICE_ID";
            const TEMPLATE_ID = "YOUR_TEMPLATE_ID";

            if (typeof emailjs === 'undefined') {
                console.error("EmailJS SDK not loaded.");
                alert("EmailJS SDK fehlt. Bitte index.html prüfen.");
                return;
            }

            await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams);
            console.log('✅ Mail sent successfully via EmailJS');
            // alert("E-Mail erfolgreich gesendet!"); // Optional feedback
        } catch (error) {
            console.error('❌ EmailJS Error:', error);
            alert("Mail konnte nicht gesendet werden. (Hast du die Keys in services.js ersetzt?)");
            // Fallback to mailto
            window.open(`mailto:${templateParams.to_email}?subject=${encodeURIComponent(templateParams.subject)}&body=${encodeURIComponent(templateParams.message + "\n\nLink: " + templateParams.link_action)}`);
        }
    }
}

// Export singleton
window.selectService = new SelectStudioService();
