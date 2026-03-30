
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json'); // You'll need to provide this if running locally, or use default

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const projectId = '2d142ac8-b35a-4232-8b45-5783fef2573d';

async function manipulateProject() {
    const query = await db.collection('projects').where('id', '==', projectId).get();
    if (query.empty) {
        console.log('Project not found');
        return;
    }

    const doc = query.docs[0];
    const elevenDaysAgo = new Date();
    elevenDaysAgo.setDate(elevenDaysAgo.getDate() - 11);

    await doc.ref.update({
        status: 'COMPLETED',
        completedAt: elevenDaysAgo.toISOString(),
        downloadCount: 0
    });

    console.log('Project manipulated successfully to appear overdue (11 days ago, 0 downloads)');
}

manipulateProject();
