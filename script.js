document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    const PLACEHOLDER_IMG = 'https://picsum.photos/400/600?grayscale'; // Fallback

    // --- State ---
    const state = {
        projectId: null,
        project: null,
        mode: 'edit', // 'edit' | 'view'
        maxSelection: 12,
        currentAssets: [],
        selectedPhotos: new Map(), // Map<id, {options: []}>
        lightboxIndex: -1
    };

    // --- DOM Elements ---
    const elements = {
        // Sidebar / Info
        packageSelect: document.getElementById('package-select'),
        photoGrid: document.getElementById('photo-grid'),
        currentCount: document.getElementById('current-count'),
        maxCount: document.getElementById('max-count'),
        progressFill: document.getElementById('progress-fill'),
        btnBulkRetouch: document.getElementById('btn-bulk-retouch'), // NEW
        selectedList: document.getElementById('selected-list'),
        submitBtn: document.getElementById('submit-btn'),
        galleryTitle: document.getElementById('gallery-title-text'),

        // Header Actions
        btnShare: document.getElementById('btn-share'),
        adminLink: document.getElementById('admin-link'),

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
        const viewMode = urlParams.get('view');

        if (viewMode === 'true') {
            state.mode = 'view';
            document.body.classList.add('mode-view');
        }

        if (!state.projectId) {
            // Check if we are photographer visiting index.html without ID -> Redirect to Admin? 
            // Or just show 404.
            // But maybe we handle "Demo" mode?
            document.body.innerHTML = '<div style="color:white; text-align:center; padding:50px;">Please provide a Project ID.</div>';
            return;
        }

        // Load Project
        try {
            console.log("Fetching project...", state.projectId);
            const project = await window.selectService.getProject(state.projectId);
            if (!project) {
                alert('Projekt nicht gefunden.');
                return;
            }
            state.project = project;
            state.currentAssets = project.assets || [];
            state.maxSelection = parseInt(project.packageSize) || 12;

            console.log("Project loaded:", project.email, "Assets:", state.currentAssets.length, "Mode:", state.mode);

            // Update UI Title
            if (elements.galleryTitle) {
                elements.galleryTitle.textContent = `Galerie: ${project.email}`;
            }

            // Setup View/Edit State
            if (state.mode === 'view') {
                // UI Cleanups for View Only
                if (elements.submitBtn) elements.submitBtn.style.display = 'none';
                if (elements.packageSelect) elements.packageSelect.disabled = true;
            } else {
                // Edit Mode
                // If package size is set in DB, enforce it in UI selector (or hide selector if fixed)
                if (elements.packageSelect) {
                    elements.packageSelect.value = state.maxSelection;
                    // If user is photographer (we don't have auth yet, but maybe check if coming from admin?)
                    // For now, let's assume if you have the Edit Link, you can change package size? 
                    // Requirement: "das auswählen der paketgrösse soll beim anlegen eines projektes definiert werden"
                    // So we DISABLE the selector for the customer.
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

            // Render
            renderGrid(state.currentAssets);
            updateSummary();
            setupEventListeners();
            console.log("App initialized successfully.");

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

        if (elements.btnBulkRetouch) {
            elements.btnBulkRetouch.addEventListener('click', () => {
                if (state.selectedPhotos.size > 0) {
                    openSelectionModal('BULK');
                } else {
                    // Try to select ALL
                    if (state.currentAssets.length <= state.maxSelection) {
                        // Select ALL
                        state.currentAssets.forEach(asset => {
                            if (!state.selectedPhotos.has(asset.id)) {
                                state.selectedPhotos.set(asset.id, { id: asset.id, options: [] });
                                updateUIForSelection(asset.id, true);
                            }
                        });
                        updateSummary();
                        openSelectionModal('BULK');
                    } else {
                        alert(`Zu viele Bilder (${state.currentAssets.length}) für das Paket (${state.maxSelection}). Bitte triff erst eine Auswahl.`);
                    }
                }
            });
        }

        // Submit
        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', async () => {
                if (state.mode === 'view') return;
                try {
                    const selections = {};
                    state.selectedPhotos.forEach((val, key) => { selections[key] = val.options; });
                    await window.selectService.submitSelection(state.projectId, selections);
                    alert('Auswahl erfolgreich gespeichert!');
                } catch (e) {
                    alert('Fehler: ' + e.message);
                }
            });
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
    function renderGrid(assets) {
        elements.photoGrid.innerHTML = '';
        state.currentAssets = assets; // sync

        assets.forEach((asset, index) => {
            const card = document.createElement('div');
            card.className = 'photo-card';
            card.dataset.id = asset.id;

            // Image (Real URL or Placeholder)
            const img = document.createElement('img');
            img.src = asset.url;
            img.loading = 'lazy';

            // Interaction: Click Image -> Lightbox
            img.onclick = (e) => {
                e.stopPropagation();
                openLightbox(index);
            };

            // Selection Indicators & Direct Toggle
            const idBadge = document.createElement('div');
            idBadge.className = 'photo-id-badge';
            idBadge.textContent = asset.id.replace('IMG_', '');

            // Selection Checkbox Overlay
            const selectOverlay = document.createElement('div');
            selectOverlay.className = 'select-overlay';
            selectOverlay.style.position = 'absolute';
            selectOverlay.style.top = '10px';
            selectOverlay.style.right = '10px';
            selectOverlay.style.zIndex = '5';
            selectOverlay.style.cursor = 'pointer';

            const isSelected = state.selectedPhotos.has(asset.id);
            selectOverlay.innerHTML = `<div class="check-indicator">✓</div>`;

            // Retouch Badge (New)
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
                handlePhotoSelection(asset.id);
            };

            card.append(img, idBadge, selectOverlay, retouchBadge);
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
        if (state.mode === 'view') return;

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

    function openSelectionModal(id) {
        activePhotoId = id;
        elements.retouchForm.reset(); // Reset first

        if (id === 'BULK') {
            elements.modalTitle.textContent = `FÜR ALLE ${state.selectedPhotos.size} BILDER`;
            // Optional: change instruction text dynamically if needed
            elements.modalSave.textContent = "FÜR ALLE ÜBERNEHMEN";
            elements.modalDeselect.style.visibility = 'hidden';
        } else {
            elements.modalTitle.textContent = `BILD #${id.split('_')[1]}`;

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

        if (activePhotoId === 'BULK') {
            // Apply to all
            state.selectedPhotos.forEach((val, key) => {
                val.options = [...options]; // Copy
                updateUIForSelection(key, true);
            });
            alert(`Retusche für ${state.selectedPhotos.size} Bilder aktualisiert.`);
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
            if (isSelected) {
                card.classList.add('selected');
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

        // Bulk Button Logic
        if (elements.btnBulkRetouch) {
            elements.btnBulkRetouch.style.display = 'block';
            if (count > 0) {
                elements.btnBulkRetouch.textContent = `RETUSCHE FÜR ${count} BILDER SETZEN`;
            } else {
                elements.btnBulkRetouch.textContent = `ALLE ${state.currentAssets.length} BILDER WÄHLEN & RETUSCHIEREN`;
            }
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
    }

    // Expose for inline onclick
    window.removeSelectionItem = (id) => {
        removeSelection(id);
        updateLightboxButton();
    };

    function showToast() {
        elements.toast.hidden = false;
        setTimeout(() => elements.toast.hidden = true, 3000);
    }

    // Run
    init();

});
