/* ==========================================================================
   UNIVERSAL FIREBASE CLOUD SYNC (cloud-sync.js)
   Saves and restores student work in users/{uid}/lessons/{lessonId}.
   ========================================================================== */

(function () {
    'use strict';

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
        console.error("Firebase SDKs are missing from this page.");
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();
    const pathParts = window.location.pathname.split('/');
    const rawFile = pathParts[pathParts.length - 1] || 'lesson';
    const lessonId = window.LESSON_ID || rawFile.replace(/\.html$/i, '').toLowerCase() || 'lesson';
    const statusPill = document.getElementById('save-status-pill');
    let activeUser = null;
    let isReady = false;
    let syncTimer = null;

    function getTrackableInputs() {
        return Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
            .filter(function (el) {
                const type = (el.type || '').toLowerCase();
                return !el.disabled &&
                    !el.readOnly &&
                    !el.hasAttribute('data-no-autosave') &&
                    !['button', 'submit', 'reset', 'file', 'image', 'hidden', 'password'].includes(type) &&
                    el.id !== 'teacher-password-input' &&
                    !el.closest('#verify-modal, #teacher-modal, .modal-overlay, [data-no-autosave]');
            });
    }

    function getFieldKey(el, index) {
        if (el.id) return 'id:' + el.id;
        if (el.name) return 'name:' + el.name + ':' + index;
        return 'field:' + index;
    }

    function getFieldState(el) {
        if (el.type === 'checkbox' || el.type === 'radio') {
            return { kind: el.type, value: el.value, checked: el.checked };
        }
        if (el.tagName === 'SELECT' && el.multiple) {
            return {
                kind: 'select-multiple',
                value: Array.from(el.options).filter(function (option) {
                    return option.selected;
                }).map(function (option) {
                    return option.value;
                })
            };
        }
        if (el.isContentEditable) {
            return { kind: 'contenteditable', value: el.innerText || el.textContent || '' };
        }
        return { kind: 'value', value: el.value };
    }

    function getDisplayValue(el, state) {
        if (state.kind === 'checkbox' || state.kind === 'radio') {
            return state.checked ? (state.value || 'Selected') : '';
        }
        if (state.kind === 'select-multiple') {
            return Array.from(el.options).filter(function (option) {
                return option.selected;
            }).map(function (option) {
                return option.textContent.trim();
            }).join(', ');
        }
        if (state.kind === 'contenteditable') return state.value;
        return state.value == null ? '' : String(state.value);
    }

    function applySavedValue(el, saved) {
        if (saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'kind')) {
            if (saved.kind === 'checkbox' || saved.kind === 'radio') {
                el.checked = !!saved.checked;
                return;
            }
            if (saved.kind === 'select-multiple' && Array.isArray(saved.value)) {
                Array.from(el.options).forEach(function (option) {
                    option.selected = saved.value.includes(option.value);
                });
                return;
            }
            if (saved.kind === 'contenteditable') {
                el.textContent = saved.value || '';
                return;
            }
            el.value = saved.value == null ? '' : saved.value;
            return;
        }

        const legacyValue = saved == null ? '' : saved;
        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = String(legacyValue) === 'true' || String(legacyValue) === el.value;
        } else if (el.isContentEditable) {
            el.textContent = String(legacyValue);
        } else {
            el.value = legacyValue;
        }
    }

    function findLabelForInput(el, index) {
        if (el.getAttribute('data-label')) return el.getAttribute('data-label');

        const prev = el.previousElementSibling;
        if (prev && ['LABEL', 'P', 'H4'].includes(prev.tagName)) {
            return (prev.innerText || prev.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        }

        const row = el.closest('.question-row, .task-card, tr, .demonstrate-box, .question-wrapper');
        if (row) {
            const heading = row.querySelector('label, h3, h4, strong, td:first-child, .question-label');
            if (heading && (heading.innerText || heading.textContent).trim()) {
                return (heading.innerText || heading.textContent).replace(/\s+/g, ' ').trim().slice(0, 120);
            }
        }

        if (el.id) return el.id.toUpperCase();
        if (el.placeholder) return el.placeholder.slice(0, 80);
        return 'Question / Box ' + (index + 1);
    }

    function buildPayload() {
        const inputs = getTrackableInputs();
        const items = [];
        const fields = {};
        const payload = {
            pageTitle: document.title || lessonId,
            lastUpdated: Date.now()
        };

        inputs.forEach(function (el, index) {
            const state = getFieldState(el);
            const value = getDisplayValue(el, state);
            const className = typeof el.className === 'string' ? el.className : '';
            let status = 'neutral';

            if (className.includes('input-correct') || (className.includes('correct') && !className.includes('incorrect'))) {
                status = 'correct';
            } else if (className.includes('incorrect')) {
                status = 'incorrect';
            }

            fields[getFieldKey(el, index)] = state;
            payload['input_' + index] = value;
            payload['class_' + index] = className;
            if (el.id) payload['id_' + index] = el.id;

            items.push({
                index: index,
                id: el.id || ('input_' + index),
                label: findLabelForInput(el, index),
                value: value,
                className: className,
                status: status
            });
        });

        payload.fields = fields;
        payload.items = items;

        const scoreEl = document.getElementById('score-display');
        if (scoreEl && scoreEl.innerText.trim()) {
            payload.scoreText = scoreEl.innerText.replace(/\s+/g, ' ').trim();
        }

        const cardMaroon = document.getElementById('card-maroon');
        const cardNavy = document.getElementById('card-navy');
        if (cardMaroon) payload.maroon_verified = cardMaroon.classList.contains('teacher-verified');
        if (cardNavy) payload.navy_verified = cardNavy.classList.contains('teacher-verified');

        const imgMaroon = document.getElementById('img-maroon');
        const imgNavy = document.getElementById('img-navy');
        if (imgMaroon && imgMaroon.src.startsWith('data:image')) payload.img_maroon = imgMaroon.src;
        if (imgNavy && imgNavy.src.startsWith('data:image')) payload.img_navy = imgNavy.src;

        return payload;
    }

    window.syncWorkToCloud = function (immediate) {
        if (!isReady || !activeUser) return;

        const user = activeUser;
        const payload = buildPayload();
        if (statusPill) statusPill.innerText = '⏳ Saving...';

        clearTimeout(syncTimer);
        syncTimer = setTimeout(function () {
            db.collection('users').doc(user.uid).collection('lessons').doc(lessonId)
                .set(payload, { merge: true })
                .then(function () {
                    if (statusPill) statusPill.innerText = '☁️ Saved to Cloud';
                })
                .catch(function (error) {
                    console.error('Cloud sync error:', error);
                    if (statusPill) statusPill.innerText = '⚠️ Save failed';
                });
        }, immediate ? 0 : 700);
    };

    async function loadStudentWork(user) {
        try {
            const doc = await db.collection('users').doc(user.uid).collection('lessons').doc(lessonId).get();
            if (doc.exists) {
                const data = doc.data();
                const inputs = getTrackableInputs();

                inputs.forEach(function (el, index) {
                    const key = getFieldKey(el, index);
                    let savedValue;

                    if (data.fields && Object.prototype.hasOwnProperty.call(data.fields, key)) {
                        savedValue = data.fields[key];
                    } else if (data['input_' + index] !== undefined) {
                        savedValue = data['input_' + index];
                    } else if (data.items && data.items[index]) {
                        savedValue = data.items[index].value;
                    }

                    if (savedValue !== undefined) {
                        applySavedValue(el, savedValue);
                        if (data['class_' + index]) el.className = data['class_' + index];
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

                if (typeof window.recalculateScore === 'function') window.recalculateScore();
            }
        } catch (error) {
            console.error('Error loading cloud lesson:', error);
        } finally {
            isReady = true;
        }
    }

    auth.onAuthStateChanged(function (user) {
        if (!user) {
            activeUser = null;
            if (sessionStorage.getItem('teacherMode') === 'true') {
                isReady = true;
                return;
            }

            const loginUrl = new URL('index-test.html', window.location.href);
            if (loginUrl.pathname !== window.location.pathname) {
                sessionStorage.setItem(
                    'spcAutosaveReturnTo',
                    window.location.pathname + window.location.search + window.location.hash
                );
                window.location.replace(loginUrl.href);
            }
            return;
        }

        activeUser = user;
        isReady = false;
        loadStudentWork(user);
    });

    document.addEventListener('input', function (event) {
        if (event.target.matches('input, textarea, [contenteditable="true"]')) {
            window.syncWorkToCloud(false);
        }
    });

    document.addEventListener('change', function (event) {
        if (event.target.matches('input, textarea, select')) {
            window.syncWorkToCloud(false);
        }
    });

    document.addEventListener('click', function (event) {
        if (event.target.closest('button')) {
            setTimeout(function () {
                window.syncWorkToCloud(true);
            }, 200);
        }
    });

    window.addEventListener('pagehide', function () {
        window.syncWorkToCloud(true);
    });
})();