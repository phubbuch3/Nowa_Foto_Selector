document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    const PLACEHOLDER_IMG = 'https://picsum.photos/400/600?grayscale'; // Fallback

    // --- State ---
    const state = {
        projectId: null,
        project: null,
        mode: 'edit', // 'edit' | 'view' | 'download'
        maxSelection: 12,
        currentAssets: [],
        selectedPhotos: new Map(), // Map<id, {options: []}>
        lightboxIndex: -1,
        currentUser: null // Admin User
    };

    // --- DOM Elements ---
    const elements = {
        // ... previous elements ...
        packageSelect: document.getElementById('package-select'),
        photoGrid: document.getElementById('photo-grid'),
        currentCount: document.getElementById('current-count'),
        maxCount: document.getElementById('max-count'),
        progressFill: document.getElementById('progress-fill'),
        btnBulkRetouch: document.getElementById('btn-bulk-retouch'),
        selectedList: document.getElementById('selected-list'),
        submitBtn: document.getElementById('submit-btn'),
        btnSaveDraft: document.getElementById('btn-save-draft'), // New Button
        btnAddRetouch: document.getElementById('btn-add-retouch'),
        btnRemoveRetouch: document.getElementById('btn-remove-retouch'),
        extraRetouchCount: document.getElementById('extra-retouch-count'),
        galleryTitle: document.getElementById('gallery-title-text'),

        // Header Actions
        btnShare: document.getElementById('btn-share'),
        adminLink: document.getElementById('admin-link'),

        // Admin FAB
        adminFab: document.getElementById('admin-upload-fab'),
        btnAddPhotos: document.getElementById('btn-add-photos'),
        adminFileInput: document.getElementById('admin-file-input'),

        // Share Modal
        shareModal: document.getElementById('share-modal'),
        shareClose: document.getElementById('share-close'),
        shareLinkEdit: document.getElementById('share-link-edit'),
        shareLinkView: document.getElementById('share-link-view'),
        btnCopyEdit: document.getElementById('copy-edit'),
        btnCopyView: document.getElementById('copy-view'),

        // Retouch Modal
        modal: document.getElementById('retouch-modal'),
        modalTitle: document.getElementById('modal-image-title'),
        modalClose: document.getElementById('modal-close'),
        modalCancel: document.getElementById('modal-cancel'),
        modalSave: document.getElementById('modal-save'),
        retouchForm: document.getElementById('retouch-form'),
        modalDeselect: document.getElementById('modal-deselect'),

        // Lightbox
        lightbox: document.getElementById('lightbox'),
        lbImg: document.getElementById('lb-img'),
        lbClose: document.getElementById('lb-close'),
        lbPrev: document.getElementById('lb-prev'),
        lbNext: document.getElementById('lb-next'),
        lbSelectBtn: document.getElementById('lb-select-btn'),

        // Toast
        toast: document.getElementById('toast')
    };

    let activePhotoId = null; // ID currently being retouched in modal

    // --- Initialization ---
    async function init() {
        console.log("Initializing Select Studio App...");
        const urlParams = new URLSearchParams(window.location.search);
        state.projectId = urlParams.get('projectId');

        if (!state.projectId) {
            document.body.innerHTML = '<div style="color:white; text-align:center; padding:50px;">Please provide a Project ID.</div>';
            return;
        }

        // Wait for Auth to determine view mode (Admin vs Customer)
        firebase.auth().onAuthStateChanged(async (user) => {
            state.currentUser = user;

            // Admin UI Elements
            if (user) {
                console.log("Admin Logged In:", user.email);
                if (elements.adminLink) elements.adminLink.style.display = 'inline-block';
                if (elements.adminFab) elements.adminFab.hidden = false;
            } else {
                console.log("Guest User (Customer)");
            }

            // Load Project Data ONLY after Auth is known
            await loadProjectData(user);
        });
    }

    async function loadProjectData(user) {
        try {
            console.log("Fetching project...", state.projectId);
            const project = await window.selectService.getProject(state.projectId);
            if (!project) {
                alert('Projekt nicht gefunden.');
                return;
            }
            state.project = project;

            // --- Status Logic ---
            if (project.status === 'COMPLETED') {
                if (user) {
                    // --- Admin View ---
                    state.mode = 'view';
                    state.currentAssets = project.finalAssets || [];

                    if (elements.galleryTitle) {
                        elements.galleryTitle.innerHTML = `Finale Bilder <span style="font-size:0.7rem; background:#fff; color:#000; padding:2px 4px; border-radius:4px; vertical-align:middle;">ADMIN</span>`;
                    }

                    // Add Toggle Button for Admin to switch to RAW
                    const actions = document.querySelector('.gallery-actions');
                    let toggleBtn = document.getElementById('admin-toggle-view');

                    // Remove existing if any (to prevent duplicates)
                    if (toggleBtn) toggleBtn.remove();

                    toggleBtn = document.createElement('button');
                    toggleBtn.id = 'admin-toggle-view';
                    toggleBtn.className = 'btn-secondary';
                    toggleBtn.style.marginRight = '10px';
                    toggleBtn.textContent = "Originale anzeigen";

                    toggleBtn.onclick = () => {
                        // Toggle Logic
                        if (toggleBtn.textContent.includes("Originale")) {
                            // Switch to Originals
                            state.currentAssets = project.assets || [];
                            renderGrid(state.currentAssets, "ORIGINAL");
                            toggleBtn.textContent = "Finale anzeigen";
                            elements.galleryTitle.innerHTML = `Original Bilder <span style="font-size:0.7rem; background:#fff; color:#000; padding:2px 4px; border-radius:4px; vertical-align:middle;">ADMIN</span>`;
                        } else {
                            // Switch to Finals
                            state.currentAssets = project.finalAssets || [];
                            renderGrid(state.currentAssets, "FINAL");
                            toggleBtn.textContent = "Originale anzeigen";
                            elements.galleryTitle.innerHTML = `Finale Bilder <span style="font-size:0.7rem; background:#fff; color:#000; padding:2px 4px; border-radius:4px; vertical-align:middle;">ADMIN</span>`;
                        }
                    };

                    if (actions) actions.prepend(toggleBtn);

                    // NEW: Download All Button for Admin
                    let dlAllBtn = document.getElementById('admin-dl-all');
                    if (dlAllBtn) dlAllBtn.remove();

                    dlAllBtn = document.createElement('button');
                    dlAllBtn.id = 'admin-dl-all';
                    dlAllBtn.className = 'btn-secondary';
                    dlAllBtn.textContent = "Alle Herunterladen";
                    dlAllBtn.onclick = () => downloadAllAssets();

                    if (actions) actions.prepend(dlAllBtn); // Order: DL All, Toggle, Share

                    renderGrid(state.currentAssets, "FINAL");

                } else {
                    // --- Customer View: Finals Download ---
                    state.mode = 'download';
                    state.currentAssets = project.finalAssets || [];
                    state.maxSelection = 0;

                    if (elements.galleryTitle) elements.galleryTitle.textContent = "Deine fertigen Bilder ✨";
                    setupDownloadUI(project);
                    renderGrid(state.currentAssets, "FINAL");
                }
            } else {
                // --- Normal Selection Flow ---
                const viewMode = new URLSearchParams(window.location.search).get('view');
                if (viewMode === 'true') {
                    state.mode = 'view';
                    document.body.classList.add('mode-view');
                } else {
                    state.mode = (project.status === 'SELECTION') ? 'edit' : 'view';
                }

                state.currentAssets = project.assets || [];

                const packageLimits = {
                    0: { images: 5, retouches: 0 },
                    1: { images: 12, retouches: 1 },
                    2: { images: 20, retouches: 2 },
                    3: { images: 30, retouches: 3 },
                    4: { images: 35, retouches: 4 }
                };

                let pkgIndex = parseInt(project.packageSize) || 0;
                if (!packageLimits[pkgIndex]) pkgIndex = 0;

                state.baseMaxImages = packageLimits[pkgIndex].images;
                state.baseMaxRetouches = packageLimits[pkgIndex].retouches;
                state.extraRetouches = project.extraRetouches || 0;

                state.maxSelection = state.baseMaxImages + state.extraRetouches;
                state.maxRetouches = state.baseMaxRetouches + state.extraRetouches;

                if (elements.extraRetouchCount) elements.extraRetouchCount.textContent = state.extraRetouches;

                console.log("Project loaded:", project.email, "Max Selection:", state.maxSelection);

                // Update UI Title
                if (elements.galleryTitle) {
                    elements.galleryTitle.textContent = `Galerie: ${project.customerName || project.email}`;
                    if (user) elements.galleryTitle.innerHTML += ' <span style="font-size:0.7rem; background:#fff; color:#000; padding:2px 4px; border-radius:4px; vertical-align:middle;">ADMIN</span>';
                }

                // Update Element Texts
                if (elements.maxCount) elements.maxCount.textContent = state.maxSelection;
                if (state.maxSelection === 0) {
                    // Special Case: 0 Retouches allowed (Basic Package)
                    // But maybe they still need to 'submit' that they have seen it?
                    // Or if 0 retouches, they just download the raw files?
                    // User request: "mann soll nur noch so viele bilder markieren wie retouchen man zur verfügung hat"
                    // So if 0 -> 0 marks allowed.

                    // Disable selection
                    document.body.classList.add('no-selection');
                    if (document.getElementById('selected-list')) document.getElementById('selected-list').innerHTML = '<div style="padding:10px; color:#888;">Keine Retuschen in diesem Paket enthalten.</div>';
                }

                // Hide Bulk Retouch if max selection is small (logic change requested)
                if (elements.btnBulkRetouch) {
                    // User logic: "12 bilder paket -> 1 retouche". Bulk makes no sense for 1 image.
                    elements.btnBulkRetouch.style.display = 'none';
                }

                if (state.mode === 'view') {
                    if (elements.submitBtn) elements.submitBtn.style.display = 'none';
                    if (elements.btnSaveDraft) elements.btnSaveDraft.style.display = 'none';
                    if (elements.packageSelect) elements.packageSelect.disabled = true;
                    document.body.classList.add('read-only');
                } else {
                    if (elements.packageSelect) {
                        elements.packageSelect.value = state.maxSelection;
                        elements.packageSelect.disabled = true;
                    }
                }

                // Restore Selections
                if (project.selections) {
                    Object.keys(project.selections).forEach(key => {
                        const opts = project.selections[key];
                        state.selectedPhotos.set(key, { id: key, options: Array.isArray(opts) ? opts : [] });
                    });
                }

                renderGrid(state.currentAssets, "BILD");
                if (state.mode !== 'download') updateSummary();
            }

            setupEventListeners();

        } catch (e) {
            console.error("Initialization Error:", e);
            alert('Fehler beim Laden: ' + e.message);
        }
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        // Share
        if (elements.btnShare) {
            elements.btnShare.addEventListener('click', openShareModal);
        }
        if (elements.shareClose) {
            elements.shareClose.addEventListener('click', () => elements.shareModal.hidden = true);
        }

        // Copy Buttons
        if (elements.btnCopyEdit) {
            elements.btnCopyEdit.addEventListener('click', () => copyToClipboard(elements.shareLinkEdit));
        }
        if (elements.btnCopyView) {
            elements.btnCopyView.addEventListener('click', () => copyToClipboard(elements.shareLinkView));
        }

        // Lightbox
        if (elements.lbClose) elements.lbClose.addEventListener('click', closeLightbox);

        // Background Close
        if (elements.lightbox) {
            elements.lightbox.addEventListener('click', (e) => {
                if (e.target === elements.lightbox || e.target.classList.contains('lb-content')) {
                    closeLightbox();
                }
            });
        }

        // Image Zoom Toggle
        if (elements.lbImg) {
            elements.lbImg.addEventListener('click', (e) => {
                e.stopPropagation(); // prevent closing
                toggleZoom();
            });
        }

        if (elements.lbPrev) elements.lbPrev.addEventListener('click', (e) => { e.stopPropagation(); showPrevPhoto(); });
        if (elements.lbNext) elements.lbNext.addEventListener('click', (e) => { e.stopPropagation(); showNextPhoto(); });

        if (elements.lbSelectBtn) elements.lbSelectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.lightboxIndex >= 0) {
                const asset = state.currentAssets[state.lightboxIndex];
                closeLightbox(); // Close first so modal is visible
                handlePhotoSelection(asset.id);
            }
        });

        // Keyboard Nav
        document.addEventListener('keydown', (e) => {
            if (!elements.lightbox.hidden) {
                if (e.key === 'Escape') closeLightbox();
                if (e.key === 'ArrowLeft') showPrevPhoto();
                if (e.key === 'ArrowRight') showNextPhoto();
            }
        });


        // Selection Modal
        if (elements.modalClose) elements.modalClose.addEventListener('click', closeSelectionModal);
        if (elements.modalCancel) elements.modalCancel.addEventListener('click', closeSelectionModal);
        if (elements.modalSave) elements.modalSave.addEventListener('click', saveModalSelection);
        if (elements.modalDeselect) elements.modalDeselect.addEventListener('click', () => {
            if (activePhotoId) {
                removeSelection(activePhotoId);
                closeSelectionModal();
                updateLightboxButton();
            }
        });

        // Bulk Retouch Removed per user request


        // Buy Extra Retouch Handlers
        if (elements.btnAddRetouch) {
            elements.btnAddRetouch.addEventListener('click', async () => {
                if (state.mode === 'view') return;
                if (confirm("Möchtest du +1 zusätzliches Bild inklusive +1 Retusche für 10 CHF hinzufügen?")) {
                    const originalText = elements.btnAddRetouch.textContent;
                    elements.btnAddRetouch.textContent = "…";
                    elements.btnAddRetouch.disabled = true;

                    try {
                        state.extraRetouches++;
                        await window.selectService.updateProjectExtraRetouches(state.projectId, state.extraRetouches);

                        state.maxSelection = state.baseMaxImages + state.extraRetouches;
                        state.maxRetouches = state.baseMaxRetouches + state.extraRetouches;
                        if (elements.extraRetouchCount) elements.extraRetouchCount.textContent = state.extraRetouches;

                        updateSummary();
                        alert("Erfolgreich hinzugefügt! NOWA Studio wird bei Klick auf 'Auswahl definitiv absenden' benachrichtigt.");
                    } catch (e) {
                        state.extraRetouches--;
                        alert("Fehler beim Kauf: " + e.message);
                    } finally {
                        elements.btnAddRetouch.textContent = originalText;
                        elements.btnAddRetouch.disabled = false;
                    }
                }
            });
        }

        if (elements.btnRemoveRetouch) {
            elements.btnRemoveRetouch.addEventListener('click', async () => {
                if (state.mode === 'view' || state.extraRetouches <= 0) return;

                const totalUsedRetouches = getUsedRetouches(null);
                const totalPhotosSelected = state.selectedPhotos.size;

                if (state.baseMaxRetouches + state.extraRetouches - 1 < totalUsedRetouches || state.baseMaxImages + state.extraRetouches - 1 < totalPhotosSelected) {
                    alert("Diese Retusche ist bereits in Benutzung.\\nBitte wähle zuerst eine Retusche oder ein Bild ab, bevor du die Option entfernst.");
                    return;
                }

                if (confirm("Möchtest du -1 Retusche & Bild (10 CHF) entfernen?")) {
                    const originalText = elements.btnRemoveRetouch.textContent;
                    elements.btnRemoveRetouch.textContent = "…";
                    elements.btnRemoveRetouch.disabled = true;

                    try {
                        state.extraRetouches--;
                        await window.selectService.updateProjectExtraRetouches(state.projectId, state.extraRetouches);

                        state.maxSelection = state.baseMaxImages + state.extraRetouches;
                        state.maxRetouches = state.baseMaxRetouches + state.extraRetouches;
                        if (elements.extraRetouchCount) elements.extraRetouchCount.textContent = state.extraRetouches;

                        updateSummary();
                    } catch (e) {
                        state.extraRetouches++;
                        alert("Fehler beim Entfernen: " + e.message);
                    } finally {
                        elements.btnRemoveRetouch.textContent = originalText;
                        elements.btnRemoveRetouch.disabled = false;
                    }
                }
            });
        }

        // Save Draft
        if (elements.btnSaveDraft) {
            elements.btnSaveDraft.addEventListener('click', async () => {
                if (state.mode === 'view') return;
                try {
                    const selections = {};
                    state.selectedPhotos.forEach((val, key) => { selections[key] = val.options; });

                    const originalText = elements.btnSaveDraft.textContent;
                    elements.btnSaveDraft.textContent = "SPEICHERT...";
                    elements.btnSaveDraft.disabled = true;

                    // Pass false for Draft
                    await window.selectService.submitSelection(state.projectId, selections, false);
                    alert('Auswahl erfolgreich zwischengespeichert! Du kannst später weitermachen.');

                    elements.btnSaveDraft.textContent = originalText;
                    elements.btnSaveDraft.disabled = false;
                } catch (e) {
                    alert('Fehler: ' + e.message);
                    elements.btnSaveDraft.textContent = "Auswahl speichern";
                    elements.btnSaveDraft.disabled = false;
                }
            });
        }

        // Submit Final
        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', async () => {
                if (state.mode === 'view') return;

                // --- Checkout Workaround Intercept ---
                if (state.extraRetouches > 0) {
                    // Show Checkout Modal
                    const checkoutModal = document.getElementById('checkout-modal');
                    const checkoutCount = document.getElementById('checkout-retouch-count');
                    const checkoutPrice = document.getElementById('checkout-total-price');
                    const checkoutCheck = document.getElementById('checkout-confirm-check');
                    const checkoutSubmit = document.getElementById('checkout-submit');
                    const checkoutCancel = document.getElementById('checkout-cancel');
                    const checkoutBack = document.getElementById('checkout-back');

                    if (checkoutModal) {
                        checkoutCount.textContent = state.extraRetouches;
                        checkoutPrice.textContent = (state.extraRetouches * 10) + " CHF";
                        checkoutCheck.checked = false;
                        checkoutSubmit.disabled = true;

                        checkoutCheck.onchange = (e) => {
                            checkoutSubmit.disabled = !e.target.checked;
                        };

                        const closeModal = () => { checkoutModal.hidden = true; };
                        checkoutCancel.onclick = closeModal;
                        checkoutBack.onclick = closeModal;

                        checkoutSubmit.onclick = async () => {
                            checkoutSubmit.disabled = true;
                            checkoutSubmit.textContent = "WIRD GESENDET...";
                            await finalizeSubmission();
                            closeModal();
                        };

                        checkoutModal.hidden = false;
                        return; // Stop normal flow
                    }
                }

                // Normal flow if no extra retouches bought
                if (!confirm("Bist du sicher? Deine Auswahl wird final an den Fotografen gesendet und kann nicht mehr geändert werden.")) return;
                await finalizeSubmission();
            });
        }

        async function finalizeSubmission() {
            try {
                const selections = {};
                state.selectedPhotos.forEach((val, key) => { selections[key] = val.options; });

                // Pass true for Final
                await window.selectService.submitSelection(state.projectId, selections, true);
                alert('Auswahl erfolgreich abgesendet! Vielen Dank.');
                // Optional: Reload or lock UI
                window.location.reload();
            } catch (e) {
                alert('Fehler: ' + e.message);
                if (document.getElementById('checkout-submit')) {
                    document.getElementById('checkout-submit').disabled = false;
                    document.getElementById('checkout-submit').textContent = "Jetzt Zahlung bestätigen & Absenden";
                }
            }
        }



        // Admin FAB Upload
        if (elements.btnAddPhotos && elements.adminFileInput) {
            elements.btnAddPhotos.addEventListener('click', () => {
                elements.adminFileInput.click();
            });

            elements.adminFileInput.addEventListener('change', async (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;

                if (!confirm(`${files.length} neue Bilder hinzufügen?`)) {
                    elements.adminFileInput.value = ''; // Reset
                    return;
                }

                try {
                    // Show Loading State (Basic)
                    const originalIcon = elements.btnAddPhotos.innerHTML;
                    elements.btnAddPhotos.innerHTML = '<span style="font-size:12px;">...</span>';
                    elements.btnAddPhotos.disabled = true;

                    const newAssets = await window.selectService.addAssetsToProject(state.projectId, files);

                    // Update State
                    state.currentAssets = [...state.currentAssets, ...newAssets];

                    // Re-render
                    renderGrid(state.currentAssets);
                    updateSummary(); // Just in case

                    alert(`${newAssets.length} Bilder erfolgreich hinzugefügt!`);

                    // Reset
                    elements.adminFileInput.value = '';
                } catch (error) {
                    console.error("Upload Error:", error);
                    alert("Fehler beim Hochladen: " + error.message);
                } finally {
                    elements.btnAddPhotos.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>`;
                    elements.btnAddPhotos.disabled = false;
                }
            });
        }
    }

    // --- Download Logic ---
    async function forceDownload(url, filename) {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error("Force download failed, fallback to new tab", e);
            window.open(url, '_blank');
        }
    }

    async function downloadAllAssets() {
        if (!confirm(`Möchtest du alle ${state.currentAssets.length} Bilder als ZIP herunterladen? Dies kann einen Moment dauern.`)) return;

        const zip = new JSZip();
        // Removed subfolder for easier access: const imgFolder = zip.folder(...);

        const originalText = document.getElementById('btn-download-all')?.textContent || document.getElementById('admin-dl-all')?.textContent;
        const btnAll = document.getElementById('btn-download-all') || document.getElementById('admin-dl-all');
        if (btnAll) {
            btnAll.textContent = "ZIP wird erstellt... (0%)";
            btnAll.disabled = true;
        }

        try {
            let processed = 0;
            let successCount = 0;
            const total = state.currentAssets.length;

            const chunkSize = 5;
            for (let i = 0; i < total; i += chunkSize) {
                const chunk = state.currentAssets.slice(i, i + chunkSize);

                await Promise.all(chunk.map(async (asset, idx) => {
                    try {
                        // Append timestamp to avoid cache-related CORS issues
                        // Check if URL already has params (Firebase URLs usually do)
                        const fetchUrl = asset.url + (asset.url.includes('?') ? '&' : '?') + `t=${Date.now()}`;

                        const response = await fetch(fetchUrl);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const blob = await response.blob();

                        const filename = asset.name || `Bild_${i + idx + 1}.jpg`;
                        // Add to root of zip
                        zip.file(filename, blob);
                        successCount++;

                    } catch (e) {
                        console.error("ZIP: Failed to fetch", asset.name, e);
                    }
                }));

                processed += chunk.length;
                if (btnAll) btnAll.textContent = `ZIP wird erstellt... (${Math.round((processed / total) * 100)}%)`;
            }

            if (successCount === 0) {
                alert("Fehler: Keine Bilder konnten heruntergeladen werden. Möglicherweise blockiert der Browser oder die Firewall den Zugriff (CORS).");
                return;
            }

            if (btnAll) btnAll.textContent = "ZIP wird kompiliert...";

            const content = await zip.generateAsync({ type: "blob" });
            const zipName = `Gallery_${state.projectId || 'Images'}.zip`;

            const link = document.createElement('a');
            link.href = window.URL.createObjectURL(content);
            link.download = zipName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(link.href);

        } catch (error) {
            console.error("ZIP generation error:", error);
            alert("Fehler ZIP: " + error.message);
        } finally {
            if (btnAll) {
                btnAll.textContent = originalText || "ALLE HERUNTERLADEN";
                btnAll.disabled = false;
            }
        }
    }

    // --- Share Logic ---
    function openShareModal() {
        // Generate Links
        const baseUrl = window.location.href.split('?')[0];
        const editUrl = `${baseUrl}?projectId=${state.projectId}`;
        const viewUrl = `${baseUrl}?projectId=${state.projectId}&view=true`;

        elements.shareLinkEdit.value = editUrl;
        elements.shareLinkView.value = viewUrl;

        elements.shareModal.hidden = false;
    }

    function copyToClipboard(inputElement) {
        inputElement.select();
        document.execCommand('copy'); // Legacy/Simple
        // Or navigator.clipboard.writeText(inputElement.value);

        const originalText = inputElement.previousElementSibling?.textContent || "Link";
        // Visual feedback could be added here
        alert("Link kopiert!");
    }


    // --- Grid Rendering ---
    function renderGrid(assets, labelPrefix = "BILD") {
        elements.photoGrid.innerHTML = '';
        state.currentAssets = assets; // sync

        if (!assets || assets.length === 0) {
            elements.photoGrid.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">Keine Bilder vorhanden.</div>';
            return;
        }

        assets.forEach((asset, index) => {
            const card = document.createElement('div');
            card.className = 'photo-card';
            card.dataset.id = asset.id;

            // Image (Real URL or Placeholder)
            const img = document.createElement('img');
            img.src = asset.url;
            img.loading = 'lazy';

            // Cursor for clickable images
            img.style.cursor = 'zoom-in';

            // Interaction: Click Image -> Lightbox
            img.onclick = (e) => {
                e.stopPropagation();
                openLightbox(index);
            };

            card.appendChild(img); // Fix: Append image to card

            // ID Badge Logic
            const idBadge = document.createElement('div');
            idBadge.className = 'photo-id-badge';

            // User Requirement: "schön nummeriert", "wieder bei 1 anfangen"
            // Use Index + 1 for clean display regardless of internal ID logic
            idBadge.textContent = `${labelPrefix} #${String(index + 1).padStart(3, '0')}`;

            // Visual Distinction for Originals
            if (labelPrefix === 'ORIGINAL') {
                idBadge.style.color = '#ffaaaa';
                idBadge.style.border = '1px solid #ffaaaa';
            }
            // Visual Distinction for Finals
            else if (labelPrefix === 'FINAL') {
                idBadge.style.color = '#aaffaa';
                idBadge.style.border = '1px solid #aaffaa';
            }

            card.append(idBadge);


            // In Download Mode OR Final View (Admin)
            if (state.mode === 'download' || labelPrefix === 'FINAL') {
                // Add Download Button Overlay
                const dlOverlay = document.createElement('div');
                dlOverlay.style.position = 'absolute';
                dlOverlay.style.bottom = '10px';
                dlOverlay.style.right = '10px';
                dlOverlay.style.background = 'rgba(0,0,0,0.7)';
                dlOverlay.style.color = '#fff';
                dlOverlay.style.padding = '5px 10px';
                dlOverlay.style.borderRadius = '4px';
                dlOverlay.style.fontSize = '0.8rem';
                dlOverlay.style.cursor = 'pointer'; // Make it look clickable
                dlOverlay.style.pointerEvents = 'auto'; // Ensure it receives clicks
                dlOverlay.textContent = 'Herunterladen';

                dlOverlay.onclick = (e) => {
                    e.stopPropagation(); // Stop Lightbox
                    forceDownload(asset.url, asset.name || `Final_${index + 1}.jpg`);
                };

                card.append(dlOverlay);
            }

            // Admin: Show Original Filename
            if (state.currentUser) {
                const adminLabel = document.createElement('div');
                adminLabel.className = 'admin-filename';
                adminLabel.textContent = asset.name || 'No Name';
                card.appendChild(adminLabel);
            }

            // Selection Checkbox Overlay (ONLY EDIT MODE)
            if (state.mode === 'edit') {
                const selectOverlay = document.createElement('div');
                selectOverlay.className = 'select-overlay';
                selectOverlay.style.position = 'absolute';
                selectOverlay.style.bottom = '10px';
                selectOverlay.style.right = '10px';
                selectOverlay.style.zIndex = '5';
                selectOverlay.style.cursor = 'pointer';

                const isSelected = state.selectedPhotos.has(asset.id);

                // Dynamic Checkbox State
                const checkbox = document.createElement('div');
                checkbox.className = 'check-indicator';
                checkbox.innerHTML = isSelected ? 'Ausgewählt' : 'Retuschen auswählen';
                selectOverlay.appendChild(checkbox);

                // Retouch Badge (New) - Moved creation here to be conditional
                const retouchBadge = document.createElement('div');
                retouchBadge.className = 'retouch-badge';
                retouchBadge.textContent = 'RETOUCH';

                if (state.selectedPhotos.has(asset.id)) {
                    card.classList.add('selected');
                    const opts = state.selectedPhotos.get(asset.id).options;
                    if (opts && opts.length > 0) card.classList.add('has-retouch');
                }

                // Restore Click Handler
                selectOverlay.onclick = (e) => {
                    e.stopPropagation();

                    // Requirement: Clicking the hook (haken) of a selected image should deselect it
                    if (state.selectedPhotos.has(asset.id)) {
                        // Deselect
                        state.selectedPhotos.delete(asset.id);
                        updateUIForSelection(asset.id, false);
                        updateSummary();
                    } else {
                        // Select (Open Modal)
                        handlePhotoSelection(asset.id);
                    }
                };

                card.append(selectOverlay);
                // Append retouchBadge only if it has content or is needed
                if (state.selectedPhotos.has(asset.id) && state.selectedPhotos.get(asset.id).options.length > 0) {
                    card.appendChild(retouchBadge);
                }
            }

            elements.photoGrid.appendChild(card);
        });
    }

    // --- Lightbox Logic ---
    function openLightbox(index) {
        state.lightboxIndex = index;
        updateLightboxImage();
        elements.lightbox.hidden = false;
        updateLightboxButton();
    }

    function closeLightbox() {
        elements.lightbox.hidden = true;
    }

    function showNextPhoto() {
        if (state.lightboxIndex < state.currentAssets.length - 1) {
            state.lightboxIndex++;
            updateLightboxImage();
            updateLightboxButton();
        }
    }

    function showPrevPhoto() {
        if (state.lightboxIndex > 0) {
            state.lightboxIndex--;
            updateLightboxImage();
            updateLightboxButton();
        }
    }

    function updateLightboxImage() {
        const asset = state.currentAssets[state.lightboxIndex];
        if (asset) elements.lbImg.src = asset.url;
        resetZoom();
    }

    function toggleZoom() {
        if (!elements.lbImg) return;
        elements.lbImg.classList.toggle('zoomed');
    }

    function resetZoom() {
        if (elements.lbImg) elements.lbImg.classList.remove('zoomed');
    }

    function updateLightboxButton() {
        const asset = state.currentAssets[state.lightboxIndex];
        if (!asset || !elements.lbSelectBtn) return;

        // Final Download Mode
        if (state.mode === 'download') {
            elements.lbSelectBtn.textContent = "Herunterladen";
            elements.lbSelectBtn.style.display = 'inline-block';
            elements.lbSelectBtn.style.background = "var(--color-primary)";
            elements.lbSelectBtn.style.color = "#fff";

            // Clone to remove old listeners
            const newBtn = elements.lbSelectBtn.cloneNode(true);
            elements.lbSelectBtn.parentNode.replaceChild(newBtn, elements.lbSelectBtn);
            elements.lbSelectBtn = newBtn;

            elements.lbSelectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Download Link
                const link = document.createElement('a');
                link.href = asset.url;
                link.download = asset.name || `Final_${asset.id}.jpg`;
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
            return;
        }

        // View Mode: Hide Select Button
        if (state.mode === 'view') {
            elements.lbSelectBtn.style.display = 'none';
            return;
        }

        // Edit Mode: Update Text/Style
        if (state.selectedPhotos.has(asset.id)) {
            elements.lbSelectBtn.textContent = "Bearbeiten / Abwählen";
            elements.lbSelectBtn.style.background = "#fff";
            elements.lbSelectBtn.style.color = "#000";
        } else {
            elements.lbSelectBtn.textContent = "Auswählen";
            elements.lbSelectBtn.style.background = "var(--color-accent)";
            elements.lbSelectBtn.style.color = "var(--color-bg)";
        }
    }

    // --- Selection Logic ---
    function handlePhotoSelection(id) {
        if (state.mode !== 'edit') return;

        if (state.selectedPhotos.has(id)) {
            // Already selected -> Edit
            openSelectionModal(id);
        } else {
            // New Selection -> Check Limit
            if (state.selectedPhotos.size >= state.maxSelection) {
                showToast();
                return;
            }
            openSelectionModal(id);
        }
    }

    function getUsedRetouches(ignorePhotoId = null) {
        let used = 0;
        state.selectedPhotos.forEach((data, id) => {
            if (id !== ignorePhotoId && data.options) {
                used += data.options.length;
            }
        });
        return used;
    }

    function openSelectionModal(id) {
        activePhotoId = id;
        elements.retouchForm.reset(); // Reset first

        if (id === 'BULK') {
            elements.modalTitle.textContent = `FÜR ALLE ${state.selectedPhotos.size} BILDER`;
            // Optional: change instruction text dynamically if needed
            elements.modalSave.textContent = "FÜR ALLE ÜBERNEHMEN";
            elements.modalDeselect.style.visibility = 'hidden';
        } else {
            // Safe split if id contains underscores
            const parts = id.split('_');
            const displayId = parts.length > 1 ? parts[1] : id;
            elements.modalTitle.textContent = `BILD #${displayId}`;

            if (state.selectedPhotos.has(id)) {
                // Pre-fill
                const data = state.selectedPhotos.get(id);
                const checkboxes = elements.retouchForm.querySelectorAll('input');
                checkboxes.forEach(cb => {
                    if (data.options.includes(cb.value)) cb.checked = true;
                });
                elements.modalSave.textContent = "UPDATE SPEICHERN";
                elements.modalDeselect.style.visibility = 'visible';
            } else {
                elements.modalSave.textContent = "SPEICHERN & AUSWÄHLEN";
                elements.modalDeselect.style.visibility = 'hidden';
            }

            // Limit checks for checkboxes
            const checkboxes = elements.retouchForm.querySelectorAll('input');
            const usedSpan = document.getElementById('retouch-used');
            const maxSpan = document.getElementById('retouch-max');

            const updateCounterDisplay = () => {
                if (usedSpan && maxSpan) {
                    const currentlyChecked = elements.retouchForm.querySelectorAll('input:checked').length;
                    const otherUsed = getUsedRetouches(activePhotoId);
                    usedSpan.textContent = otherUsed + currentlyChecked;
                    maxSpan.textContent = state.maxRetouches;
                }
            };

            updateCounterDisplay(); // Initial display call

            checkboxes.forEach(cb => {
                cb.onchange = (e) => {
                    const currentlyChecked = elements.retouchForm.querySelectorAll('input:checked').length;
                    const otherUsed = getUsedRetouches(activePhotoId);

                    if (e.target.checked) {
                        if (otherUsed + currentlyChecked > state.maxRetouches) {
                            e.target.checked = false;
                            alert(`Limit erreicht! Du hast in deinem Paket max. ${state.maxRetouches} Retuschen zur Verfügung.\n\nDu kannst unten links weitere Retuschen (+10 CHF) dazukaufen.`);
                        }
                    }
                    updateCounterDisplay(); // Update on change
                };
            });
        }

        elements.modal.hidden = false;
    }

    function closeSelectionModal() {
        elements.modal.hidden = true;
        activePhotoId = null;
    }

    function saveModalSelection() {
        if (!activePhotoId) return;

        const checkboxes = elements.retouchForm.querySelectorAll('input:checked');
        const options = Array.from(checkboxes).map(cb => cb.value);

        if (options.length === 0 && activePhotoId !== 'BULK') {
            alert('Bitte wähle mindestens eine Retusche aus. Ohne Retusche kann das Bild nicht ausgewählt werden.\n\nWenn du das Bild nicht mehr auswählen möchtest, klicke unten links auf "BILD ABWÄHLEN".');
            return;
        }

        if (activePhotoId === 'BULK') {
            // Apply to ALL assets (as requested: "für alle bilder auf einmal")
            // But we must respect the Package Limit!

            let applyCount = 0;
            const newOptions = [...options];

            state.currentAssets.forEach(asset => {
                // Logic:
                // 1. If already selected -> Update options
                // 2. If NOT selected -> Select it & Update options (IF limit allows)

                if (state.selectedPhotos.has(asset.id)) {
                    state.selectedPhotos.set(asset.id, { id: asset.id, options: newOptions });
                    updateUIForSelection(asset.id, true);
                    applyCount++;
                } else {
                    // Not selected yet. Can we select more?
                    if (state.selectedPhotos.size < state.maxSelection) {
                        state.selectedPhotos.set(asset.id, { id: asset.id, options: newOptions });
                        updateUIForSelection(asset.id, true);
                        applyCount++;
                    }
                }
            });

            if (applyCount < state.currentAssets.length && state.currentAssets.length > state.maxSelection) {
                alert(`Retusche wurde auf ${applyCount} Bilder angewendet (Paketlimit: ${state.maxSelection}).`);
            } else {
                alert(`Retusche für alle Bilder übernommen!`);
            }

        } else {
            // Single
            state.selectedPhotos.set(activePhotoId, { id: activePhotoId, options });
            updateUIForSelection(activePhotoId, true);
        }

        updateSummary();
        closeSelectionModal();
        updateLightboxButton(); // Update if open
    }

    function removeSelection(id) {
        state.selectedPhotos.delete(id);
        updateUIForSelection(id, false);
        updateSummary();
    }

    function updateUIForSelection(id, isSelected) {
        const card = document.querySelector(`.photo-card[data-id="${id}"]`);
        if (card) {
            const checkIndicator = card.querySelector('.check-indicator');
            if (isSelected) {
                card.classList.add('selected');
                if (checkIndicator) checkIndicator.innerHTML = 'Ausgewählt';
                // check options
                const data = state.selectedPhotos.get(id);
                if (data && data.options && data.options.length > 0) {
                    card.classList.add('has-retouch');
                } else {
                    card.classList.remove('has-retouch');
                }
            } else {
                card.classList.remove('selected');
                card.classList.remove('has-retouch');
                if (checkIndicator) checkIndicator.innerHTML = 'Retuschen auswählen';
            }
        }
    }

    // --- Summary & Toast ---
    function updateSummary() {
        const count = state.selectedPhotos.size;
        elements.currentCount.textContent = String(count).padStart(2, '0');
        elements.maxCount.textContent = state.maxSelection;

        const percent = (count / state.maxSelection) * 100;
        elements.progressFill.style.width = `${percent}%`;

        if (elements.submitBtn) elements.submitBtn.disabled = (count === 0);
        if (elements.btnSaveDraft) elements.btnSaveDraft.disabled = (count === 0);

        // Bulk Button Logic
        if (elements.btnBulkRetouch) {
            elements.btnBulkRetouch.style.display = 'block';
            elements.btnBulkRetouch.textContent = `RETOUCHE FÜR ALLE BILDER ÜBERNEHMEN`;
        }

        // List
        elements.selectedList.innerHTML = '';
        if (count === 0) {
            elements.selectedList.innerHTML = '<div class="empty-state">Noch keine Bilder gewählt.</div>';
            return;
        }

        state.selectedPhotos.forEach((data, id) => {
            const item = document.createElement('div');
            item.className = 'selected-item';

            // Simplified item list
            item.innerHTML = `
                <div class="item-header">
                    <span class="item-id">${id.replace('IMG_', 'BILD ')}</span>
                    <button class="item-remove" onclick="removeSelectionItem('${id}')">&times;</button>
                </div>
            `;
            elements.selectedList.appendChild(item);
        });

        // Update Extra Retouch buttons state
        if (elements.btnRemoveRetouch) {
            if (state.extraRetouches <= 0) {
                elements.btnRemoveRetouch.disabled = true;
                elements.btnRemoveRetouch.style.background = '#333';
                elements.btnRemoveRetouch.style.cursor = 'not-allowed';
            } else {
                elements.btnRemoveRetouch.disabled = false;
                elements.btnRemoveRetouch.style.background = 'var(--color-text)'; // White
                elements.btnRemoveRetouch.style.cursor = 'pointer';
            }
        }
    }

    // Expose for inline onclick
    window.removeSelectionItem = (id) => {
        removeSelection(id);
        updateLightboxButton();
    };

    window.downloadAllAssets = downloadAllAssets;

    function showToast() {
        elements.toast.hidden = false;
        setTimeout(() => elements.toast.hidden = true, 3000);
    }


    // Run
    init();

}); // End DOMContentLoaded

// --- Helper Functions outside ---

function setupDownloadUI(project) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.innerHTML = `
            <div class="sidebar-header">
                <h1 style="font-size: 1.5rem;">SELECT STUDIO</h1>
            </div>
            <div style="padding: 20px;">
                <h3 style="margin-bottom:10px;">Fertig! 🥳</h3>
                <p style="font-size:0.9rem; color:#ccc; line-height:1.5;">
                    Vielen Dank für dein Vertrauen.<br><br>
                    Hier sind deine retuschierten Bilder. Du kannst sie einzeln herunterladen.
                </p>
                
                <div style="margin-top: 30px; font-size: 0.8rem; color: #888;">
                    Verfügbar bis:<br>
                    <span style="color:#fff;">${project.expiresAt ? new Date(project.expiresAt).toLocaleDateString('de-DE') : 'Keine Angabe'}</span>
                </div>

                <button id="btn-download-all" class="btn-primary" style="margin-top: 30px;">
                    ALLE HERUNTERLADEN
                </button>
            </div>
        `;

        // Attach listener
        const btnAll = document.getElementById('btn-download-all');
        if (btnAll) {
            btnAll.addEventListener('click', () => window.downloadAllAssets());
        }
    }
}
