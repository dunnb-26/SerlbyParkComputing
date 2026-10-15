/* ==========================================================================
   UNIVERSAL FIREBASE CLOUD SYNC (cloud-sync.js)
   Automatically saves & loads all inputs, question labels, scores, and 
   screenshots to Firebase Firestore under users/{uid}/lessons/{lessonId}
   ========================================================================== */

(function() {
    const firebaseConfig = {
        apiKey: "AIzaSyDiRDdgM7VCOxEVob_pZ73AvZaNb7SvA9Y",
        authDomain: "serlby-park-computing.firebaseapp.com",
        projectId: "serlby-park-computing",
        storageBucket: "serlby-park-computing.firebasestorage.app",
        messagingSenderId: "648533806051",
        appId: "1:648533806051:web:1e42a4263dfb1fd8e72ed6",
        measurementId: "G-HDNYEE11WV"
    };

    if (typeof firebase === 'undefined') {
        console.error("Firebase SDKs are missing from the <head> of this page.");
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    // Automatically detect the lesson ID from filename (e.g., "y7-ht1-d-c")
    const pathParts = window.location.pathname.split('/');
    let rawFile = pathParts[pathParts.length - 1] || 'lesson';
    const AUTO_LESSON_ID = window.LESSON_ID || rawFile.replace(/\.html$/i, '').toLowerCase() || 'lesson';

    // Find all student input fields on the page (excludes teacher password modal)
    function getTrackableInputs() {
        return Array.from(document.querySelectorAll('input[type="text"], textarea'))
            .filter(el => el.id !== 'teacher-password-input' && !el.closest('#verify-modal'));
    }

    // Automatically find a readable question label for the Teacher Markbook
    function findLabelForInput(el, index) {
        if (el.getAttribute('data-label')) return el.getAttribute('data-label');
        
        // Check preceding label or paragraph
        const prev = el.previousElementSibling;
        if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'P' || prev.tagName === 'H4')) {
            return prev.innerText.replace(/\s+/g, ' ').trim().slice(0, 120);
        }
        // Check inside a parent question row or table row
        const row = el.closest('.question-row, .task-card, tr, .demonstrate-box');
        if (row) {
            const heading = row.querySelector('label, h3, h4, strong, td:first-child');
            if (heading && heading.innerText.trim()) {
                return heading.innerText.replace(/\s+/g, ' ').trim().slice(0, 120);
            }
        }
        if (el.id) return el.id.toUpperCase();
        if (el.placeholder) return el.placeholder.slice(0, 80);
        return 'Question / Box ' + (index + 1);
    }

    let syncTimer;
    window.syncWorkToCloud = function(immediate = false) {
        const user = auth.currentUser;
        if (!user) return;

        const inputs = getTrackableInputs();
        const items = [];
        const payload = {
            pageTitle: document.title || AUTO_LESSON_ID,
            lastUpdated: Date.now()
        };

        inputs.forEach((el, i) => {
            const cls = el.className || '';
            let status = 'neutral';
            if (cls.includes('input-correct') || (cls.includes('correct') && !cls.includes('incorrect'))) {
                status = 'correct';
            } else if (cls.includes('incorrect')) {
                status = 'incorrect';
            }

            // Backwards-compatible flat keys
            payload['input_' + i] = el.value;
            payload['class_' + i] = cls;
            if (el.id) payload['id_' + i] = el.id;

            // Structured item for Teacher Dashboard Markbook
            items.push({
                index: i,
                id: el.id || ('input_' + i),
                label: findLabelForInput(el, i),
                value: el.value,
                className: cls,
                status: status
            });
        });

        payload.items = items;

        // Capture score banner if present on page
        const scoreEl = document.getElementById('score-display');
        if (scoreEl && scoreEl.innerText.trim()) {
            payload.scoreText = scoreEl.innerText.replace(/\s+/g, ' ').trim();
        }

        // Capture Teacher Verified states & Screenshots
        const cardMaroon = document.getElementById('card-maroon');
        const cardNavy = document.getElementById('card-navy');
        if (cardMaroon) payload.maroon_verified = cardMaroon.classList.contains('teacher-verified');
        if (cardNavy) payload.navy_verified = cardNavy.classList.contains('teacher-verified');

        const imgMaroon = document.getElementById('img-maroon');
        const imgNavy = document.getElementById('img-navy');
        if (imgMaroon && imgMaroon.src.startsWith('data:image')) payload.img_maroon = imgMaroon.src;
        if (imgNavy && imgNavy.src.startsWith('data:image')) payload.img_navy = imgNavy.src;

        const statusPill = document.getElementById('save-status-pill');
        if (statusPill) statusPill.innerText = "⏳ Saving...";

        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            db.collection('users').doc(user.uid).collection('lessons').doc(AUTO_LESSON_ID)
              .set(payload, { merge: true })
              .then(() => {
                  if (statusPill) statusPill.innerText = "☁️ Saved to Cloud";
              })
              .catch(err => console.error("Cloud sync error:", err));
        }, immediate ? 50 : 700);
    };

    // Load student's saved work from Firebase when they open the lesson
    auth.onAuthStateChanged(async (user) => {
        if (!user) return;

        try {
            const doc = await db.collection('users').doc(user.uid).collection('lessons').doc(AUTO_LESSON_ID).get();
            if (doc.exists) {
                const data = doc.data();
                const inputs = getTrackableInputs();

                inputs.forEach((el, i) => {
                    const savedVal = data['input_' + i] !== undefined 
                        ? data['input_' + i] 
                        : (data.items && data.items[i] ? data.items[i].value : undefined);

                    if (savedVal !== undefined) {
                        el.value = savedVal;
                        if (data['class_' + i]) el.className = data['class_' + i];
                        if (el.tagName.toLowerCase() === 'textarea') {
                            el.style.height = 'auto';
                            el.style.height = el.scrollHeight + 'px';
                        }
                    }
                });

                if (data.img_maroon && document.getElementById('img-maroon')) {
                    document.getElementById('img-maroon').src = data.img_maroon;
                    document.getElementById('img-maroon').style.display = 'block';
                }
                if (data.img_navy && document.getElementById('img-navy')) {
                    document.getElementById('img-navy').src = data.img_navy;
                    document.getElementById('img-navy').style.display = 'block';
                }

                // Re-trigger page grading/score calculation if present
                if (typeof recalculateScore === 'function') recalculateScore();
            }
        } catch (err) {
            console.error("Error loading cloud lesson:", err);
        }
    });

    // Listen for typing and button clicks (like "Check Answers" or "Mark Stage 1")
    document.addEventListener('input', () => window.syncWorkToCloud(false));
    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            setTimeout(() => window.syncWorkToCloud(true), 200);
        }
    });
})();
