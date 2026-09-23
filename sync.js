/**
 * REALTIME SYNC & STORAGE ENGINE (OFFICIAL FIREBASE FIRESTORE INTEGRATION)
 * PSTS XI ENGLISH TL 2026 - SMA PLUS PGRI CIBINONG
 */

const SYNC_CONFIG = {
    FIREBASE_CONFIG: {
        apiKey: "AIzaSyCocJJXa8oTPc5uxxvlP16I9qX-ujVaK34",
        authDomain: "tka-english-wajib-2025.firebaseapp.com",
        projectId: "tka-english-wajib-2025",
        storageBucket: "tka-english-wajib-2025.firebasestorage.app",
        messagingSenderId: "32444504637",
        appId: "1:32444504637:web:27f9b04f0095ece2312854"
    },
    COLLECTION: "psts_xi_tl_submissions_2026",
    LOCAL_KEY: "PSTS_XI_ENGLISH_TL_SUBMISSIONS",
    ATTEMPT_KEY: "PSTS_XI_TL_MY_ATTEMPT",
    TIMER_KEY: "PSTS_XI_ENGLISH_TL_TIMER_REMAINING",
    EXAM_DURATION_SECONDS: 60 * 60 // 1 Hour (3600 seconds)
};

class RealtimeSyncEngine {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('psts_xi_tl_sync_channel') : null;
        this.listeners = [];
        this.initFirebase();
        this.initChannelListener();
    }

    initFirebase() {
        try {
            if (typeof firebase !== 'undefined') {
                if (!firebase.apps.length) {
                    firebase.initializeApp(SYNC_CONFIG.FIREBASE_CONFIG);
                }
                this.db = firebase.firestore();
                this.isInitialized = true;
                console.log("✅ [Firebase] Firestore connected for PSTS Grade XI TL.");
            }
        } catch (err) {
            console.warn("⚠️ [Firebase] SDK initialization fallback to REST:", err);
        }
    }

    initChannelListener() {
        if (this.channel) {
            this.channel.onmessage = (event) => {
                if (event.data && event.data.type === 'NEW_SUBMISSION') {
                    this.notifyListeners(event.data.payload);
                }
            };
        }
    }

    onNewData(callback) {
        if (typeof callback === 'function') {
            this.listeners.push(callback);
        }
    }

    notifyListeners(submission) {
        this.listeners.forEach(cb => {
            try { cb(submission); } catch (err) { console.error(err); }
        });
    }

    // Check if student has already submitted (1-Attempt Enforcement)
    async checkExistingAttempt(name, studentClass) {
        const cleanName = (name || "").toLowerCase().trim();
        const cleanClass = (studentClass || "").trim();

        // 1. Check local record
        try {
            const myAttempt = localStorage.getItem(SYNC_CONFIG.ATTEMPT_KEY);
            if (myAttempt) {
                const parsed = JSON.parse(myAttempt);
                if (parsed && parsed.name && parsed.name.toLowerCase().trim() === cleanName && parsed.studentClass === cleanClass) {
                    return parsed;
                }
            }
        } catch (e) {}

        // 2. Check full submissions in Firestore Cloud
        const all = await this.getAllSubmissions();
        const found = all.find(s => (s.name || "").toLowerCase().trim() === cleanName && (s.studentClass || "").trim() === cleanClass);
        if (found) {
            localStorage.setItem(SYNC_CONFIG.ATTEMPT_KEY, JSON.stringify(found));
            return found;
        }

        return null;
    }

    // Get all submissions from LocalStorage & Firebase Firestore
    async getAllSubmissions() {
        let localData = [];
        try {
            const raw = localStorage.getItem(SYNC_CONFIG.LOCAL_KEY);
            if (raw) localData = JSON.parse(raw);
        } catch (e) {
            console.warn("Error reading localStorage:", e);
        }

        // 1. Try Firebase Firestore SDK
        if (this.db) {
            try {
                const snapshot = await this.db.collection(SYNC_CONFIG.COLLECTION)
                    .orderBy("timestamp", "desc")
                    .get();

                const cloudList = [];
                snapshot.forEach(doc => {
                    cloudList.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });

                if (cloudList.length > 0 || snapshot.empty) {
                    localStorage.setItem(SYNC_CONFIG.LOCAL_KEY, JSON.stringify(cloudList));
                    return cloudList;
                }
            } catch (err) {
                console.warn("Firestore SDK fetch error, trying REST API:", err);
            }
        }

        // 2. Fallback: Firestore REST API
        try {
            const projectId = SYNC_CONFIG.FIREBASE_CONFIG.projectId;
            const apiKey = SYNC_CONFIG.FIREBASE_CONFIG.apiKey;
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${SYNC_CONFIG.COLLECTION}?key=${apiKey}`;

            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                if (json.documents) {
                    const cloudList = json.documents.map(doc => {
                        const f = doc.fields || {};
                        const parsedDoc = { id: doc.name.split('/').pop() };
                        for (let k in f) {
                            if (f[k].stringValue !== undefined) parsedDoc[k] = f[k].stringValue;
                            else if (f[k].integerValue !== undefined) parsedDoc[k] = parseInt(f[k].integerValue, 10);
                            else if (f[k].booleanValue !== undefined) parsedDoc[k] = f[k].booleanValue;
                            else if (f[k].mapValue !== undefined) {
                                parsedDoc[k] = {};
                                const subMap = f[k].mapValue.fields || {};
                                for (let sk in subMap) {
                                    parsedDoc[k][sk] = subMap[sk].stringValue || subMap[sk].booleanValue || subMap[sk].integerValue;
                                }
                            }
                        }
                        if (typeof parsedDoc.answers === 'string') {
                            try { parsedDoc.answers = JSON.parse(parsedDoc.answers); } catch(e){}
                        }
                        if (typeof parsedDoc.reflections === 'string') {
                            try { parsedDoc.reflections = JSON.parse(parsedDoc.reflections); } catch(e){}
                        }
                        return parsedDoc;
                    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                    localStorage.setItem(SYNC_CONFIG.LOCAL_KEY, JSON.stringify(cloudList));
                    return cloudList;
                }
            }
        } catch (restErr) {
            console.log("REST fallback error:", restErr.message);
        }

        return localData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // Submit new student exam record
    async submitExam(data) {
        const payload = {
            name: data.name,
            studentClass: data.studentClass,
            studentId: data.studentId || "-",
            answers: data.answers || {},
            score: data.score,
            correctCount: data.correctCount,
            totalQuestions: 25,
            itemResults: data.itemResults || {},
            reflections: data.reflections || {},
            timeSpent: data.timeSpent || "0m",
            timestamp: new Date().toISOString()
        };

        let savedId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

        // 1. Submit via Firestore SDK
        if (this.db) {
            try {
                const docRef = await this.db.collection(SYNC_CONFIG.COLLECTION).add(payload);
                savedId = docRef.id;
                console.log("✅ [Firebase] Submitted to Firestore with ID:", savedId);
            } catch (sdkErr) {
                console.warn("Firestore SDK write error, trying REST:", sdkErr);
                await this.submitViaREST(payload);
            }
        } else {
            await this.submitViaREST(payload);
        }

        const fullSubmission = { id: savedId, ...payload };

        // 2. Save locally & record attempt
        try {
            const existing = await this.getAllSubmissions();
            const updated = [fullSubmission, ...existing.filter(i => i.id !== savedId)];
            localStorage.setItem(SYNC_CONFIG.LOCAL_KEY, JSON.stringify(updated));
            localStorage.setItem(SYNC_CONFIG.ATTEMPT_KEY, JSON.stringify(fullSubmission));
        } catch (e) {
            console.warn("Failed saving locally:", e);
        }

        // 3. Broadcast to other tabs
        if (this.channel) {
            this.channel.postMessage({
                type: 'NEW_SUBMISSION',
                payload: fullSubmission
            });
        }

        return fullSubmission;
    }

    async submitViaREST(payload) {
        try {
            const projectId = SYNC_CONFIG.FIREBASE_CONFIG.projectId;
            const apiKey = SYNC_CONFIG.FIREBASE_CONFIG.apiKey;
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${SYNC_CONFIG.COLLECTION}?key=${apiKey}`;

            const fields = {
                name: { stringValue: payload.name },
                studentClass: { stringValue: payload.studentClass },
                studentId: { stringValue: payload.studentId || "-" },
                score: { integerValue: payload.score },
                correctCount: { integerValue: payload.correctCount },
                totalQuestions: { integerValue: payload.totalQuestions || 25 },
                answers: { stringValue: JSON.stringify(payload.answers || {}) },
                reflections: { stringValue: JSON.stringify(payload.reflections || {}) },
                timeSpent: { stringValue: payload.timeSpent || "-" },
                timestamp: { stringValue: payload.timestamp }
            };

            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields })
            });
            return res.ok;
        } catch (e) {
            console.error("REST Submit failed:", e);
            return false;
        }
    }

    // Realtime Listener for Teacher Dashboard (Firestore onSnapshot)
    subscribeCloudRealtime(onDataUpdate) {
        if (this.db) {
            try {
                return this.db.collection(SYNC_CONFIG.COLLECTION)
                    .orderBy("timestamp", "desc")
                    .onSnapshot((snapshot) => {
                        const list = [];
                        snapshot.forEach(doc => {
                            list.push({ id: doc.id, ...doc.data() });
                        });
                        localStorage.setItem(SYNC_CONFIG.LOCAL_KEY, JSON.stringify(list));
                        if (onDataUpdate) onDataUpdate(list);
                    }, (err) => {
                        console.warn("Firestore Realtime listener error:", err);
                    });
            } catch (e) {
                console.warn("Could not attach Firestore listener:", e);
            }
        }
        return null;
    }
}

// Global instance
const syncEngine = new RealtimeSyncEngine();
