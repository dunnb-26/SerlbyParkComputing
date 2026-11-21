/* ==========================================================================
   UNIVERSAL FIREBASE CLOUD SYNC (cloud-sync.js)
   Automatically saves & loads all inputs, question labels, scores, and 
   screenshots to Firebase Firestore under users/{uid}/lessons/{lessonId}
   ========================================================================== */

/* --- SHARED TEACHER STAMP SYSTEM FOR ALL LESSON PAGES --- */
(function () {
    const STAMP_PASSCODE = "delta";
    const STAMP_TYPES = {
        assisted: { text: "🤝 Teacher Assisted", bg: "#e3f2fd", color: "#0d47a1", border: "#1976d2" },
        spag:     { text: "✍️ SPaG Issues",     bg: "#fff3e0", color: "#e65100", border: "#f57c00" },
        proud:    { text: "🏆 Proud Thursday Given", bg: "#fff8e1", color: "#7f6000", border: "#dfaa2b" }
    };

    let stampsUnlocked = false;
    let activeStampType = null;
    let placedStamps = [];
    let currentLessonId = null;

    function getLessonDocId() {
        if (window.LESSON_ID) return window.LESSON_ID;
        if (document.body && document.body.dataset.lessonId) return document.body.dataset.lessonId;
        const file = (window.location.pathname.split("/").pop() || "lesson").replace(/\.html$/i, "");
        return file || "default-lesson";
    }

    function getTargetUid() {
        const params = new URLSearchParams(window.location.search);
        const inspectUid = params.get("inspectUid") || sessionStorage.getItem("inspectStudentUid");
        if (sessionStorage.getItem("teacherMode") === "true" && inspectUid) {
            return inspectUid;
        }
        if (typeof auth !== "undefined" && auth && auth.currentUser) {
            return auth.currentUser.uid;
        }
        return null;
    }

    function getStampContainer() {
        return document.getElementById("main-workspace")
            || document.querySelector(".task-container")
            || document.querySelector("main")
            || document.body;
    }

    function injectStampStylesAndUI() {
        if (document.getElementById("shared-stamp-styles")) return;

        const style = document.createElement("style");
        style.id = "shared-stamp-styles";
        style.textContent = `
            #shared-stamp-layer { position: absolute; inset: 0; pointer-events: none; z-index: 25; }
            .shared-teacher-stamp {
                position: absolute; transform: translate(-50%, -50%);
                padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold;
                border: 2px solid; box-shadow: 0 3px 8px rgba(0,0,0,0.18);
                white-space: nowrap; user-select: none; z-index: 30;
            }
            .shared-teacher-stamp.unlocked { pointer-events: auto; cursor: pointer; }
            .shared-teacher-stamp.unlocked::after { content: " ✖"; font-size: 11px; opacity: 0.8; }
            #shared-stamp-dock {
                position: fixed; bottom: 18px; right: 18px; z-index: 9999;
                display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
            }
            #shared-unlock-btn {
                background: #1e3a8a; color: #fff; border: 2px solid #dfaa2b;
                padding: 10px 16px; border-radius: 999px; font-weight: bold;
                cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            }
            #shared-stamp-palette {
                display: none; flex-wrap: wrap; gap: 6px; max-width: 420px;
                background: #fff; padding: 10px; border-radius: 10px;
                border: 2px solid #1e3a8a; box-shadow: 0 6px 18px rgba(0,0,0,0.22);
            }
            .shared-stamp-choice {
                border: 1.5px solid #ccc; background: #f8f9fa; padding: 6px 10px;
                border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;
            }
            .shared-stamp-choice.active { outline: 2px solid #1e3a8a; background: #e8eefc; }
            #shared-stamp-lock-btn {
                border: none; background: #d32f2f; color: #fff; padding: 6px 10px;
                border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;
            }
            body.shared-stamp-placing, body.shared-stamp-placing * { cursor: crosshair !important; }
            @media print { #shared-stamp-dock { display: none !important; } }
        `;
        document.head.appendChild(style);

        const container = getStampContainer();
        if (getComputedStyle(container).position === "static") {
            container.style.position = "relative";
        }
        const layer = document.createElement("div");
        layer.id = "shared-stamp-layer";
        container.appendChild(layer);

        const dock = document.createElement("div");
        dock.id = "shared-stamp-dock";
        dock.innerHTML = `
            <div id="shared-stamp-palette">
                <button type="button" class="shared-stamp-choice" data-stamp="assisted">🤝 Teacher Assisted</button>
                <button type="button" class="shared-stamp-choice" data-stamp="spag">✍️ SPaG Issues</button>
                <button type="button" class="shared-stamp-choice" data-stamp="proud">🏆 Proud Thursday Given</button>
                <button type="button" class="shared-stamp-choice" data-stamp="comment">💬 Comment</button>
                <button type="button" id="shared-stamp-lock-btn">Done</button>
            </div>
            <button type="button" id="shared-unlock-btn">👨‍🏫 Teacher Stamps</button>
        `;
        document.body.appendChild(dock);

        document.getElementById("shared-unlock-btn").addEventListener("click", () => {
            if (stampsUnlocked || sessionStorage.getItem("teacherMode") === "true") {
                unlockStamps();
                return;
            }
            const entered = prompt("Enter teacher passcode:");
            if (entered && entered.trim().toLowerCase() === STAMP_PASSCODE) {
                unlockStamps();
            } else if (entered !== null) {
                alert("Incorrect passcode.");
            }
        });

        document.getElementById("shared-stamp-lock-btn").addEventListener("click", lockStamps);

        dock.querySelectorAll(".shared-stamp-choice").forEach(btn => {
            btn.addEventListener("click", () => {
                const type = btn.getAttribute("data-stamp");
                if (activeStampType === type) {
                    activeStampType = null;
                    btn.classList.remove("active");
                    document.body.classList.remove("shared-stamp-placing");
                } else {
                    activeStampType = type;
                    dock.querySelectorAll(".shared-stamp-choice").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    document.body.classList.add("shared-stamp-placing");
                }
            });
        });

        container.addEventListener("click", handleContainerClick, true);
    }

    function unlockStamps() {
        stampsUnlocked = true;
        document.getElementById("shared-unlock-btn").style.display = "none";
        document.getElementById("shared-stamp-palette").style.display = "flex";
        renderSharedStamps();
    }

    function lockStamps() {
        stampsUnlocked = false;
        activeStampType = null;
        document.body.classList.remove("shared-stamp-placing");
        document.querySelectorAll(".shared-stamp-choice").forEach(b => b.classList.remove("active"));
        document.getElementById("shared-stamp-palette").style.display = "none";
        document.getElementById("shared-unlock-btn").style.display = "inline-block";
        renderSharedStamps();
    }

    function handleContainerClick(e) {
        if (!stampsUnlocked || !activeStampType) return;
        if (e.target.closest(".shared-teacher-stamp") || e.target.closest("#shared-stamp-dock")) return;

        e.preventDefault();
        e.stopPropagation();

        const container = getStampContainer();
        const rect = container.getBoundingClientRect();
        const xPercent = (((e.clientX - rect.left) / rect.width) * 100).toFixed(2);
        const yPercent = (((e.clientY - rect.top) / rect.height) * 100).toFixed(2);

        let targetLabel = "";
        const row = e.target.closest(".question-row, .question-group");
        const card = e.target.closest(".task-card");
        if (row) {
            const lbl = row.querySelector(".question-label, label");
            if (lbl) targetLabel = lbl.innerText.replace(/\s+/g, " ").trim();
        }
        if (!targetLabel && card) {
            const heading = card.querySelector("h2, .task-title");
            if (heading) targetLabel = heading.innerText.replace(/\s+/g, " ").trim();
        }

        let stampText = "";
        if (activeStampType === "comment") {
            const note = prompt("Enter teacher comment:");
            if (!note || !note.trim()) return;
            stampText = "💬 " + note.trim();
        } else {
            stampText = STAMP_TYPES[activeStampType].text;
        }

        placedStamps.push({
            id: Date.now().toString(),
            type: activeStampType,
            text: stampText,
            targetLabel: targetLabel,
            x: xPercent,
            y: yPercent
        });

        renderSharedStamps();
        saveSharedStamps();
    }

    function renderSharedStamps() {
        const layer = document.getElementById("shared-stamp-layer");
        if (!layer) return;
        layer.innerHTML = "";

        placedStamps.forEach(stamp => {
            const preset = STAMP_TYPES[stamp.type] || { bg: "#f3e5f5", color: "#4a148c", border: "#8e24aa" };
            const badge = document.createElement("div");
            badge.className = "shared-teacher-stamp" + (stampsUnlocked ? " unlocked" : "");
            badge.style.left = stamp.x + "%";
            badge.style.top = stamp.y + "%";
            badge.style.background = preset.bg;
            badge.style.color = preset.color;
            badge.style.borderColor = preset.border;
            badge.textContent = stamp.text;

            if (stampsUnlocked) {
                badge.title = "Click to remove stamp";
                badge.addEventListener("click", ev => {
                    ev.stopPropagation();
                    placedStamps = placedStamps.filter(s => s.id !== stamp.id);
                    renderSharedStamps();
                    saveSharedStamps();
                });
            }
            layer.appendChild(badge);
        });
    }

    async function saveSharedStamps() {
        const uid = getTargetUid();
        if (!uid || typeof db === "undefined") {
            console.warn("No student UID available; stamp not saved to Firestore.");
            return;
        }
        try {
            await db.collection("users").doc(uid).collection("lessons").doc(currentLessonId)
                .set({ teacherStamps: placedStamps, lastUpdated: Date.now() }, { merge: true });
        } catch (err) {
            console.error("Failed to save teacher stamps:", err);
        }
    }

    async function loadSharedStamps(uid) {
        if (!uid || typeof db === "undefined") return;
        try {
            const doc = await db.collection("users").doc(uid).collection("lessons").doc(currentLessonId).get();
            if (doc.exists && Array.isArray(doc.data().teacherStamps)) {
                placedStamps = doc.data().teacherStamps;
                renderSharedStamps();
            }
        } catch (err) {
            console.error("Failed to load teacher stamps:", err);
        }
    }

    window.addEventListener("DOMContentLoaded", () => {
        currentLessonId = getLessonDocId();
        injectStampStylesAndUI();

        const inspectUid = getTargetUid();
        if (sessionStorage.getItem("teacherMode") === "true" && inspectUid) {
            loadSharedStamps(inspectUid);
            unlockStamps();
        } else if (typeof auth !== "undefined" && auth && typeof auth.onAuthStateChanged === "function") {
            auth.onAuthStateChanged(user => {
                if (user) loadSharedStamps(user.uid);
            });
        }
    });
})();
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
