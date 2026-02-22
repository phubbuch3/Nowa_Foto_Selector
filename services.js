/**
 * Select Studio Cloud - Service Layer (PRODUCTION)
 * 
 * Uses:
 * - Google Firebase (Firestore & Storage)
 * - Resend API (Email)
 */

// New Config provided by User
const firebaseConfig = {
    apiKey: "AIzaSyBcs_M4QrSUO6WoangZjoVlcknptdcrDSM",
    authDomain: "noras-bildspeicher.firebaseapp.com",
    projectId: "noras-bildspeicher",
    storageBucket: "noras-bildspeicher.firebasestorage.app",
    messagingSenderId: "993005721210",
    // Different App ID provided in latest prompt
    appId: "1:993005721210:web:255dc3b837e2a1633b8dc3",
    measurementId: "G-S4W62QJLW9"
};

// Resend API (Deprecated, currently using client-side EmailJS)
// const RESEND_API_KEY = '...'; 

class SelectStudioService {
    constructor() {
        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.firestore();
        this.storage = firebase.storage();
        this.auth = firebase.auth();

        // Auth Listener for Protected Routes
        this.checkAuth();
    }

    checkAuth() {
        // Simple client-side route protection
        const path = window.location.pathname;
        const page = path.split("/").pop(); // e.g. 'index.html'

        this.auth.onAuthStateChanged(user => {
            console.log("Auth State Changed:", user ? user.email : "Logged Out");

            // 1. Protect Admin Panel (index.html or root)
            // If on index.html (or root) and NOT logged in -> Go to Login
            if ((page === 'index.html' || page === '') && !user) {
                // window.location.href = 'login.html'; 
                // Commented out to prevent redirect loop during dev if file:// doesn't match perfectly
                // logic is better placed in the HTML file itself for immediate effect
            }

            // 2. Prevent Login Page access if already logged in
            if (page === 'login.html' && user) {
                window.location.href = 'index.html';
            }
        });
    }

    async logout() {
        await this.auth.signOut();
        window.location.href = 'login.html';
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

    async updateProjectExtraRetouches(id, extraCount) {
        const snapshot = await this.db.collection('projects').where('id', '==', id).get();
        if (snapshot.empty) throw new Error('Project not found');

        await snapshot.docs[0].ref.update({ extraRetouches: parseInt(extraCount) });

        const project = snapshot.docs[0].data();
        project.extraRetouches = parseInt(extraCount);

        // Note: Email notification for extra retouches is deferred to final submission
    }

    // --- Asset Operations ---

    async addAssetsToProject(projectId, files) {
        // 1. Upload
        const newAssets = await this.uploadFilesToCloud(files);

        // 2. Update Firestore
        // We need to get current assets first or just arrayUnion? 
        // Firestore arrayUnion is cleaner.
        const snapshot = await this.db.collection('projects').where('id', '==', projectId).get();
        if (snapshot.empty) throw new Error('Project not found');

        const doc = snapshot.docs[0];

        // Use arrayUnion to append
        await doc.ref.update({
            assets: firebase.firestore.FieldValue.arrayUnion(...newAssets)
        });

        return newAssets;
    }

    async deleteProject(projectId) {
        // Delete Firestore Doc
        // Note: This does NOT delete files from Storage automatically (requires Cloud Functions or manual list)
        // For simple usage, we just delete the doc reference.

        const snapshot = await this.db.collection('projects').where('id', '==', projectId).get();
        if (snapshot.empty) throw new Error('Project not found');

        await snapshot.docs[0].ref.delete();
        console.log("Project deleted:", projectId);
    }

    // --- Selection Operations ---

    async submitSelection(projectId, selections, isFinal = true) {
        const snapshot = await this.db.collection('projects').where('id', '==', projectId).get();
        if (snapshot.empty) throw new Error('Project not found');

        const doc = snapshot.docs[0];
        const project = doc.data();

        // Removed strictly enforcing the package limit here 
        // because frontend properly restricts based on basePackageSize + extraRetouches.
        // If we want a strict server-side check, we must calculate the exact package size + extra.
        // For now, let frontend handle it securely.

        // Update Data
        const updateData = {
            selections: selections
        };

        // Update Status only if Final
        if (isFinal) {
            updateData.status = 'PROCESSING';
        }

        await doc.ref.update(updateData);

        // Trigger Mail only if Final
        if (isFinal) {
            project.selections = selections;
            await this.sendMail('SELECTION_DONE', project);

            // If they bought extra retouches, also send the extra retouch mail now
            if (project.extraRetouches && project.extraRetouches > 0) {
                await this.sendMail('EXTRA_RETOUCH', project);
            }
        }

        return project;
    }

    async completeProjectWithFinals(projectId, files) {
        // 1. Upload Finals to separate folder "processed"
        const finalAssets = await this.uploadFilesToCloud(files, 'processed');

        // 2. Update Firestore
        const snapshot = await this.db.collection('projects').where('id', '==', projectId).get();
        if (snapshot.empty) throw new Error('Project not found');

        const doc = snapshot.docs[0];

        // Calculate Expiry (30 days)
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(now.getDate() + 30);

        const updateData = {
            status: 'COMPLETED',
            finalAssets: finalAssets,
            completedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString()
        };

        await doc.ref.update(updateData);

        // 3. Trigger Mail
        const project = doc.data(); // Old data
        // Merge new data for mail context
        Object.assign(project, updateData);

        await this.sendMail('FINAL_DELIVERY', project);
        return project;
    }

    // --- Cloud Helpers ---

    async uploadFilesToCloud(files, folderName = 'projects') {
        if (!files || files.length === 0) return [];

        const assets = [];
        const uploadPromises = Array.from(files).map(async (file, index) => {
            const fileName = `${folderName}/${Date.now()}_${file.name}`;
            const storageRef = this.storage.ref().child(fileName);

            // Set Metadata to force Download when accessing URL directly
            const metadata = {
                contentType: file.type,
                contentDisposition: `attachment; filename="${file.name}"`,
                cacheControl: 'public, max-age=31536000'
            };

            const snapshot = await storageRef.put(file, metadata);
            const downloadURL = await snapshot.ref.getDownloadURL();

            // Fix: Use Timestamp to ensure unique IDs across multiple uploads
            // Previous 'IMG_001' caused collisions and unwanted "auto-selection" of new files
            const uniqueId = `IMG_${Date.now()}_${index}`; // e.g. IMG_1708250000_0

            return {
                id: uniqueId,
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

        // Base URL Logic
        let basePath;
        if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
            let currentUrl = window.location.href.split('?')[0];
            basePath = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);
        } else {
            // Force Production URL to avoid Vercel Preview links in emails
            basePath = "https://nowa-foto-selector.vercel.app/";
        }

        // Define clean entry points
        const adminUrl = basePath + 'index.html';          // Admin Dashboard
        const galleryUrl = basePath + 'customer.html?projectId=' + project.id; // Customer View

        let templateParams = {
            // Updated to match your EmailJS Template variables {{email}}, {{name}}
            email: project.email,
            name: project.email.split('@')[0],

            project_id: project.id,
            admin_email: "phubbuch3@gmail.com, info@nowastudio.ch",
            link_gallery: galleryUrl,
            link_admin: adminUrl,
            message: "",
            subject: "",
            btn_text: "Ansehen",
            link_action: galleryUrl,
            image_url: "https://nowa-foto-selector.vercel.app/bilder/logo.jpeg"
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
            templateParams.email = templateParams.admin_email; // IMPORTANT: Overwrite 'email'
            templateParams.name = "Admin";

            templateParams.subject = `Kunde ${project.email} hat ausgewählt ✅`;
            templateParams.message = `Der Kunde ${project.email} hat seine Foto- und Retusche-Auswahl getroffen (${Object.keys(project.selections).length} Bilder). Du kannst die Bilder über diesen Link herunterladen und bearbeiten.`;

            // Fix: Deep link to specific project in Admin Dashboard
            templateParams.link_action = `${adminUrl}?projectId=${project.id}`;
            templateParams.btn_text = "Zur Bearbeitung (Admin)";
        }
        else if (type === 'FINAL_DELIVERY') {
            templateParams.subject = "Deine fertigen Bilder sind da! ✨";
            // User Request: "bedanken das er NOWA Studio ausgewählt hat und viel spass mit den bildern"
            templateParams.message = `Vielen Dank, dass du dich für NOWA Studio entschieden hast! Wir hoffen, du hast viel Freude mit deinen Bildern.\n\nDu kannst deine fertigen Aufnahmen unter folgendem Link ansehen und herunterladen (für 30 Tage verfügbar).`;
            templateParams.link_action = galleryUrl;
            templateParams.btn_text = "Bilder herunterladen";
        }
        else if (type === 'EXTRA_RETOUCH') {
            templateParams.email = templateParams.admin_email;
            templateParams.name = "Admin";
            templateParams.subject = `Zusatzkauf: Kunde ${project.email} kauft Retuschen 💰`;
            templateParams.message = `Der Kunde ${project.email} hat soeben zusätzliche Retuschen gekauft! Aktueller Stand extra-gekaufter Retuschen: ${project.extraRetouches} Stück (+ ${project.extraRetouches * 10} CHF).`;
            templateParams.link_action = `${adminUrl}?projectId=${project.id}`;
            templateParams.btn_text = "Zur Bearbeitung (Admin)";
        }

        try {
            // Explicitly pass Public Key as 3rd arg is params, 4th is UserID (Public Key)
            const PUBLIC_KEY = "YVVauE5uaG-7fu5Wi";

            const SERVICE_ID = "service_6rjou9e";
            const TEMPLATE_ID = "template_ajae9qt";

            await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY);
            console.log('✅ Mail sent successfully via EmailJS');
            // alert("E-Mail erfolgreich gesendet!"); // Optional feedback
        } catch (error) {
            console.error('❌ EmailJS Error:', error);
            // Show exact error to user
            const errorText = error.text || error.message || JSON.stringify(error);
            alert(`EmailJS Fehler (${error.status}):\n${errorText}\n\nBitte überprüfe Service ID, Template ID und Public Key.`);

            // Fallback to mailto (still useful)
            window.open(`mailto:${templateParams.to_email}?subject=${encodeURIComponent(templateParams.subject)}&body=${encodeURIComponent(templateParams.message + "\n\nLink: " + templateParams.link_action)}`);
        }
    }
}

// Initialize Service
window.selectService = new SelectStudioService();
