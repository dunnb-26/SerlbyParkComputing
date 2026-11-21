/* --- STANDALONE TEACHER STAMP SYSTEM (NO PASSWORD PROMPT) --- */
(function () {
    const STAMP_PRESETS = {
        assisted: { text: "🤝 Teacher Assisted", bg: "#e3f2fd", color: "#0d47a1", border: "#1976d2" },
        spag:     { text: "✍️ SPaG Issues",     bg: "#fff3e0", color: "#e65100", border: "#f57c00" },
        proud:    { text: "🏆 Proud Thursday Given", bg: "#fff8e1", color: "#7f6000", border: "#dfaa2b" }
    };

    let stampsUnlocked = false;
    let activeStampType = null;
    let placedStamps = [];
    let currentLessonId = null;

    function resolveLessonId() {
        if (typeof LESSON_ID !== "undefined" && LESSON_ID) return LESSON_ID;
        if (window.LESSON_ID) return window.LESSON_ID;
        if (document.body && document.body.dataset.lessonId) return document.body.dataset.lessonId;
        const file = (window.location.pathname.split("/").pop() || "lesson").replace(/\.html$/i, "");
        return file || "default-lesson";
    }

    function resolveTargetUid() {
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

    function getStampTarget() {
        return document.getElementById("main-workspace")
            || document.querySelector(".task-container")
            || document.querySelector("main")
            || document.body;
    }

    function setupStampUI() {
        if (document.getElementById("ts-dock")) return;

        const style = document.createElement("style");
        style.textContent = `
            #ts-layer { position: absolute; inset: 0; pointer-events: none; z-index: 25; }
            .ts-badge {
                position: absolute; transform: translate(-50%, -50%);
                padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold;
                border: 2px solid; box-shadow: 0 3px 8px rgba(0,0,0,0.18);
                white-space: nowrap; user-select: none; z-index: 30;
            }
            .ts-badge.unlocked { pointer-events: auto; cursor: pointer; }
            .ts-badge.unlocked::after { content: " ✖"; font-size: 11px; opacity: 0.85; }
            #ts-dock {
                position: fixed; bottom: 18px; right: 18px; z-index: 9999;
                display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
            }
            #ts-open-btn {
                background: #1e3a8a; color: #fff; border: 2px solid #dfaa2b;
                padding: 10px 16px; border-radius: 999px; font-weight: bold;
                cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            }
            #ts-palette {
                display: none; flex-wrap: wrap; gap: 6px; max-width: 430px;
                background: #fff; padding: 10px; border-radius: 10px;
                border: 2px solid #1e3a8a; box-shadow: 0 6px 18px rgba(0,0,0,0.22);
            }
            .ts-choice {
                border: 1.5px solid #ccc; background: #f8f9fa; padding: 6px 10px;
                border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;
            }
            .ts-choice.active { outline: 2px solid #1e3a8a; background: #e8eefc; }
            #ts-done-btn {
                border: none; background: #d32f2f; color: #fff; padding: 6px 10px;
                border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;
            }
            body.ts-placing, body.ts-placing * { cursor: crosshair !important; }
            @media print { #ts-dock { display: none !important; } }
        `;
        document.head.appendChild(style);

        const container = getStampTarget();
        if (getComputedStyle(container).position === "static") {
            container.style.position = "relative";
        }

        const layer = document.createElement("div");
        layer.id = "ts-layer";
        container.appendChild(layer);

        const dock = document.createElement("div");
        dock.id = "ts-dock";
        dock.innerHTML = `
            <div id="ts-palette">
                <button type="button" class="ts-choice" data-type="assisted">🤝 Teacher Assisted</button>
                <button type="button" class="ts-choice" data-type="spag">✍️ SPaG Issues</button>
                <button type="button" class="ts-choice" data-type="proud">🏆 Proud Thursday Given</button>
                <button type="button" class="ts-choice" data-type="comment">💬 Comment</button>
                <button type="button" id="ts-done-btn">Done</button>
            </div>
            <button type="button" id="ts-open-btn">👨‍🏫 Teacher Stamps</button>
        `;
        document.body.appendChild(dock);

        // Unlocks directly without a passcode modal
        document.getElementById("ts-open-btn").addEventListener("click", unlockStamps);
        document.getElementById("ts-done-btn").addEventListener("click", lockStamps);

        dock.querySelectorAll(".ts-choice").forEach(btn => {
            btn.addEventListener("click", () => {
                const type = btn.getAttribute("data-type");
                if (activeStampType === type) {
                    activeStampType = null;
                    btn.classList.remove("active");
                    document.body.classList.remove("ts-placing");
                } else {
                    activeStampType = type;
                    dock.querySelectorAll(".ts-choice").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    document.body.classList.add("ts-placing");
                }
            });
        });

        container.addEventListener("click", onStampClick, true);
    }

    function unlockStamps() {
        stampsUnlocked = true;
        document.getElementById("ts-open-btn").style.display = "none";
        document.getElementById("ts-palette").style.display = "flex";
        renderStamps();
    }

    function lockStamps() {
        stampsUnlocked = false;
        activeStampType = null;
        document.body.classList.remove("ts-placing");
        document.querySelectorAll(".ts-choice").forEach(b => b.classList.remove("active"));
        document.getElementById("ts-palette").style.display = "none";
        document.getElementById("ts-open-btn").style.display = "inline-block";
        renderStamps();
    }

    function onStampClick(e) {
        if (!stampsUnlocked || !activeStampType) return;
        if (e.target.closest(".ts-badge") || e.target.closest("#ts-dock")) return;

        e.preventDefault();
        e.stopPropagation();

        const container = getStampTarget();
        const rect = container.getBoundingClientRect();
        const xPercent = (((e.clientX - rect.left) / rect.width) * 100).toFixed(2);
        const yPercent = (((e.clientY - rect.top) / rect.height) * 100).toFixed(2);

        let targetLabel = "";
        const row = e.target.closest(".question-row, .question-group, .question-wrapper");
        const card = e.target.closest(".task-card");
        if (row) {
            const lbl = row.querySelector(".question-label, label");
            if (lbl) targetLabel = lbl.innerText.replace(/\s+/g, " ").trim();
        }
        if (!targetLabel && card) {
            const heading = card.querySelector("h2, .task-title");
            if (heading) targetLabel = heading.innerText.replace(/\s+/g, " ").trim();
        }

        let labelText = "";
        if (activeStampType === "comment") {
            const note = prompt("Enter teacher comment:");
            if (!note || !note.trim()) return;
            labelText = "💬 " + note.trim();
        } else {
            labelText = STAMP_PRESETS[activeStampType].text;
        }

        placedStamps.push({
            id: Date.now().toString(),
            type: activeStampType,
            text: labelText,
            targetLabel: targetLabel,
            x: xPercent,
            y: yPercent
        });

        renderStamps();
        saveStamps();
    }

    function renderStamps() {
        const layer = document.getElementById("ts-layer");
        if (!layer) return;
        layer.innerHTML = "";

        placedStamps.forEach(stamp => {
            const preset = STAMP_PRESETS[stamp.type] || { bg: "#f3e5f5", color: "#4a148c", border: "#8e24aa" };
            const badge = document.createElement("div");
            badge.className = "ts-badge" + (stampsUnlocked ? " unlocked" : "");
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
                    renderStamps();
                    saveStamps();
                });
            }
            layer.appendChild(badge);
        });
    }

    async function saveStamps() {
        const uid = resolveTargetUid();
        if (!uid || typeof db === "undefined") {
            console.warn("No signed-in student UID found; stamp not saved to Firestore.");
            return;
        }
        try {
            await db.collection("users").doc(uid).collection("lessons").doc(currentLessonId)
                .set({ teacherStamps: placedStamps, lastUpdated: Date.now() }, { merge: true });
        } catch (err) {
            console.error("Error saving teacher stamps:", err);
        }
    }

    async function loadStamps(uid) {
        if (!uid || typeof db === "undefined") return;
        try {
            const doc = await db.collection("users").doc(uid).collection("lessons").doc(currentLessonId).get();
            if (doc.exists && Array.isArray(doc.data().teacherStamps)) {
                placedStamps = doc.data().teacherStamps;
                renderStamps();
            }
        } catch (err) {
            console.error("Error loading teacher stamps:", err);
        }
    }

    window.addEventListener("DOMContentLoaded", () => {
        currentLessonId = resolveLessonId();
        setupStampUI();

        const inspectUid = resolveTargetUid();
        if (sessionStorage.getItem("teacherMode") === "true" && inspectUid) {
            loadStamps(inspectUid);
            unlockStamps();
        } else if (typeof auth !== "undefined" && auth && typeof auth.onAuthStateChanged === "function") {
            auth.onAuthStateChanged(user => {
                if (user) loadStamps(user.uid);
            });
        }
    });
})();
