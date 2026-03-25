// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDiRp2iXzkif-AHfs-1G3F8U11jvMUlkOk",
    authDomain: "tf-app-565a7.firebaseapp.com",
    projectId: "tf-app-565a7",
    storageBucket: "tf-app-565a7.firebasestorage.app",
    messagingSenderId: "296068790533",
    appId: "1:296068790533:web:8b690118e1a19a07a89f6c",
    measurementId: "G-ZFDLDENCQB"
  };
  
// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const docRef = db.collection("taskApp").doc("sharedState");

// Data Models
let state = {
    subjects: [], 
    tasks: {},    
    activeSubjectId: null
};

const SUBJECT_COLORS = [
    'rgb(21, 223, 73)',
    'rgb(229, 227, 66)',
    'rgb(203, 209, 206)'
];

function getSubjectColor(index) {
    return SUBJECT_COLORS[index % SUBJECT_COLORS.length];
}

// DOM Elements
const elements = {
    subjectList: document.getElementById('subject-list'),
    taskList: document.getElementById('task-list'),
    currentSubjectTitle: document.getElementById('current-subject-title'),
    btnShowAddSubject: document.getElementById('btn-show-add-subject'),
    btnDeleteSubject: document.getElementById('btn-delete-subject'),
    btnShowAddTask: document.getElementById('btn-show-add-task'),
    emptyStateMsg: document.getElementById('empty-state-msg'),
    
    modalOverlay: document.getElementById('modal-overlay'),
    modals: document.querySelectorAll('.modal'),
    closeBtns: document.querySelectorAll('.close-btn'),
    
    modalSubject: document.getElementById('modal-subject'),
    modalSubjectTitle: document.getElementById('modal-subject-title'),
    inputSubjectId: document.getElementById('input-subject-id'),
    inputSubjectName: document.getElementById('input-subject-name'),
    btnSaveSubject: document.getElementById('btn-save-subject'),
    
    modalTask: document.getElementById('modal-task'),
    modalTaskTitle: document.getElementById('modal-task-title'),
    inputTaskId: document.getElementById('input-task-id'),
    inputTaskName: document.getElementById('input-task-name'),
    btnSaveTask: document.getElementById('btn-save-task'),
    
    modalAlarm: document.getElementById('modal-alarm'),
    alarmTaskNameDisplay: document.getElementById('alarm-task-name-display'),
    inputAlarmMonth: document.getElementById('input-alarm-month'),
    inputAlarmDay: document.getElementById('input-alarm-day'),
    inputAlarmHour: document.getElementById('input-alarm-hour'),
    inputAlarmMinute: document.getElementById('input-alarm-minute'),
    btnSetAlarm: document.getElementById('btn-set-alarm'),
    btnClearAlarm: document.getElementById('btn-clear-alarm'),
    
    toastContainer: document.getElementById('toast-container')
};

let currentAlarmTaskId = null;
let alarmInterval = null;

let pressTimer = null;
let isLongPress = false;
let startX = 0;
let startY = 0;
let lastTapId = null;
let lastTapTime = 0;

function safeStr(val) {
    return val !== null && val !== undefined ? String(val) : '';
}

function init() {
    // 💥 FACTORY RESET LOGIC 💥
    if (window.location.search.includes('reset=true')) {
        if (confirm('【警告】すべての件名とタスクを完全に消去し、アプリを初期化しますか？\n（この操作は取り消せません）')) {
            localStorage.clear();
            docRef.set({ subjects: [], tasks: {} }).then(() => {
                alert('初期化が完了しました。まっさらな状態で再スタートします！');
                window.location.href = window.location.pathname; // Remove ?reset=true payload
            }).catch(e => alert('初期化エラー: ' + e.message));
        } else {
            window.location.href = window.location.pathname; // Cancelled
        }
        return; // Halt normal initialization
    }

    // Restore local tab focus
    const local = localStorage.getItem('taskApp_localInfo');
    if (local) {
        try {
            state.activeSubjectId = JSON.parse(local).activeSubjectId;
        } catch(e) {}
    }
    
    setupEventListeners();
    startAlarmChecker();
    
    showToast("クラウドに接続中...", false);

    // Force server fetch to guarantee DB is genuinely accessible, avoiding offline cache traps
    docRef.get({ source: 'server' }).then((doc) => {
        if (doc.exists) {
            showToast("同期データを読み込みました！", false);
            listenForUpdates();
        } else {
            showToast("初回のクラウドデータを作成します...", false);
            migrateAndListen();
        }
    }).catch((error) => {
        console.error("Firestore Init Error:", error);
        if (error.code === 'permission-denied') {
            showToast("⚠️注意: データベースが「テストモード」ではないため同期がブロックされました。Firebaseの設定を確認してください。", true);
        } else {
            showToast("⚠️データベースにアクセスできません。一時的にオフライン動作になります。", true);
        }
        // Use local storage as fallback if completely broken
        loadLocalFallback();
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkAlarmsNow();
    });
    
    // Initialize Drag and Drop
    initSortable();
}

function initSortable() {
    if (typeof Sortable === 'undefined') return;

    Sortable.create(elements.subjectList, {
        animation: 150,
        delay: 150, 
        delayOnTouchOnly: false,
        forceFallback: true,
        onEnd: function (evt) {
            const { oldIndex, newIndex } = evt;
            if (oldIndex === newIndex) return;

            const movedItem = state.subjects.splice(oldIndex, 1)[0];
            state.subjects.splice(newIndex, 0, movedItem);
            
            saveGlobalState();
            setTimeout(() => renderSubjects(), 50); // Defer to prevent DOM crash during animation
        }
    });

    Sortable.create(elements.taskList, {
        animation: 150,
        delay: 150,
        delayOnTouchOnly: false,
        forceFallback: true,
        filter: '.empty-state', 
        onEnd: function (evt) {
            const { oldIndex, newIndex } = evt;
            if (oldIndex === newIndex) return;

            if (!state.activeSubjectId) return;
            const subjectTasks = state.tasks[state.activeSubjectId];
            
            const movedItem = subjectTasks.splice(oldIndex, 1)[0];
            subjectTasks.splice(newIndex, 0, movedItem);
            
            saveGlobalState();
            setTimeout(() => renderTasks(), 50); // Defer to prevent DOM crash during animation
        }
    });
}

function migrateAndListen() {
    const saved = localStorage.getItem('taskApp_state');
    if (saved) {
        try {
            const localData = JSON.parse(saved);
            state.subjects = localData.subjects || [];
            state.tasks = localData.tasks || {};
        } catch(e) {}
    }
    docRef.set({ subjects: state.subjects, tasks: state.tasks }).then(() => {
        listenForUpdates();
    }).catch(e => {
        console.error("Write Error:", e);
        showToast("⚠️注意: 書き込み権限がありません。Firebaseの設定を確認してください。", true);
        loadLocalFallback();
    });
}

function loadLocalFallback() {
    const saved = localStorage.getItem('taskApp_state');
    if (saved) {
        try {
            const localData = JSON.parse(saved);
            state.subjects = localData.subjects || [];
            state.tasks = localData.tasks || {};
        } catch(e) {}
    }
    renderSubjects();
}

function listenForUpdates() {
    docRef.onSnapshot((doc) => {
        if (!doc.exists) return;
        const data = doc.data();
        // Simple: always accept what Firestore says and re-render
        state.subjects = data.subjects || [];
        state.tasks = data.tasks || {};
        renderSubjects();
    });
}

function saveGlobalState() {
    docRef.set({
        subjects: state.subjects,
        tasks: state.tasks
    }).catch(e => {
        console.error(e);
        showToast("⚠️同期エラーが発生しました。", true);
    });
    localStorage.setItem('taskApp_state', JSON.stringify({
        subjects: state.subjects,
        tasks: state.tasks
    }));
}

function saveLocalState() {
    localStorage.setItem('taskApp_localInfo', JSON.stringify({
        activeSubjectId: state.activeSubjectId
    }));
}

function saveSubject(name, id) {
    if (id) {
        const sid = safeStr(id);
        const subj = state.subjects.find(s => safeStr(s.id) === sid);
        if (subj) subj.name = name;
        showToast('件名を書き換えました');
    } else {
        const newId = 'subj_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        state.subjects.push({ id: newId, name });
        state.tasks[newId] = [];
        state.activeSubjectId = newId;
        saveLocalState();
        showToast('件名を追加しました');
    }
    saveGlobalState();
    renderSubjects();
}

function saveTask(text, id) {
    if (!state.activeSubjectId) return;
    
    if (id) {
        const task = state.tasks[state.activeSubjectId].find(t => t.id === id);
        if (task) task.text = text;
        showToast('タスクを書き換えました');
    } else {
        const newId = 'task_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
        const newTask = {
            id: newId,
            text,
            createdAt: Date.now(),
            isDone: false,
            alarm: null,
            alarmFired: false
        };
        if(!state.tasks[state.activeSubjectId]) state.tasks[state.activeSubjectId] = [];
        state.tasks[state.activeSubjectId].unshift(newTask); // Add to top
        showToast('タスクを追加しました');
    }
    saveGlobalState();
    renderSubjects(); // Immediate feedback
}

function deleteTask(subjectId, taskId) {
    const taskList = state.tasks[subjectId] || [];
    const idx = taskList.findIndex(t => safeStr(t.id) === safeStr(taskId));
    if (idx !== -1) {
        if (confirm('このタスクを削除しますか？')) {
            taskList.splice(idx, 1);
            saveGlobalState();
            renderSubjects();
        }
    }
}

function updateTaskAlarm(taskId, alarmData) {
    for (const subjectId in state.tasks) {
        const task = state.tasks[subjectId].find(t => t.id === taskId);
        if (task) {
            task.alarm = alarmData;
            task.alarmFired = false;
            saveGlobalState();
            renderSubjects(); // Immediate feedback
            break;
        }
    }
}

function handleInteraction(e, type, id) {
    const now = Date.now();
    const strId = safeStr(id);
    if (!strId) return;
    
    if (lastTapId === strId && (now - lastTapTime) < 400) {
        if (navigator.vibrate) navigator.vibrate(50);
        if (type === 'subject') openEditSubjectModal(strId);
        if (type === 'task') openEditTaskModal(strId);
        lastTapTime = 0; 
        lastTapId = null;
    } else {
        lastTapId = strId;
        lastTapTime = now;
        if (type === 'subject') {
            state.activeSubjectId = strId;
            saveLocalState();
            // DEFER RENDER: Allow browser to finish current click cycle before blasting DOM
            setTimeout(() => renderSubjects(), 1); 
        }
    }
}

function renderSubjects() {
    elements.subjectList.innerHTML = '';
    state.subjects.forEach((subject, index) => {
        const div = document.createElement('div');
        const sid = safeStr(subject.id);
        const isActive = state.activeSubjectId && sid === safeStr(state.activeSubjectId);
        div.className = `subject-tab ${isActive ? 'active' : ''}`;
        div.setAttribute('data-id', sid);
        div.innerHTML = `<span class="subject-tab-text" style="pointer-events:none;">${escapeHtml(subject.name)}</span>`;
        div.style.backgroundColor = getSubjectColor(index);
        
        div.oncontextmenu = (e) => { e.preventDefault(); openEditSubjectModal(sid); return false; };
        elements.subjectList.appendChild(div);
    });
    elements.btnDeleteSubject.disabled = !state.activeSubjectId || state.subjects.length === 0;
    renderTasks();
}

// --- GLOBAL EVENT DELEGATION ---
elements.subjectList.onclick = (e) => {
    const tab = e.target.closest('.subject-tab');
    if (tab) handleInteraction(e, 'subject', tab.getAttribute('data-id'));
};

elements.taskList.onclick = (e) => {
    // 1. Check for action buttons first
    const btnComp = e.target.closest('.btn-complete');
    if (btnComp) { deleteTask(btnComp.dataset.subject, btnComp.dataset.id); return; }
    
    const btnAlarm = e.target.closest('.btn-alarm');
    if (btnAlarm) { openAlarmModal(btnAlarm.dataset.subject, btnAlarm.dataset.id); return; }

    // 2. Otherwise check for task item body (for selection/edit)
    const taskContent = e.target.closest('.task-content');
    if (taskContent) {
        const item = taskContent.closest('.task-item');
        if (item) handleInteraction(e, 'task', item.dataset.id);
    }
};

function renderTasks() {
    elements.taskList.innerHTML = '';
    
    if (!state.activeSubjectId) {
        elements.currentSubjectTitle.textContent = '件名を選択してください';
        elements.btnShowAddTask.disabled = true;
        elements.emptyStateMsg.style.display = 'block';
        elements.emptyStateMsg.textContent = '左のタブから件名を選択してください。';
        elements.taskList.appendChild(elements.emptyStateMsg);
        return;
    }
    
    const activeSubjectIndex = state.subjects.findIndex(s => safeStr(s.id) === safeStr(state.activeSubjectId));
    
    if (activeSubjectIndex === -1) {
        elements.currentSubjectTitle.textContent = '件名を選択してください';
        elements.btnShowAddTask.disabled = true;
        elements.emptyStateMsg.style.display = 'block';
        elements.emptyStateMsg.textContent = '（エラー）件名が見つかりません。';
        elements.taskList.appendChild(elements.emptyStateMsg);
        return;
    }
    
    const activeSubject = state.subjects[activeSubjectIndex];
    
    elements.currentSubjectTitle.textContent = activeSubject.name;
    elements.btnShowAddTask.disabled = false;
    
    const subjectTasks = state.tasks[state.activeSubjectId] || [];
    const themeColor = getSubjectColor(activeSubjectIndex);
    
    if (subjectTasks.length === 0) {
        elements.emptyStateMsg.style.display = 'block';
        elements.emptyStateMsg.textContent = 'タスクがありません。「＋」ボタンから追加してください。';
        elements.taskList.appendChild(elements.emptyStateMsg);
    } else {
        elements.emptyStateMsg.style.display = 'none';
        
        subjectTasks.forEach(task => {
            const el = document.createElement('div');
            const tid = safeStr(task.id);
            el.className = `task-item ${task.isDone ? 'completed' : ''}`;
            el.style.backgroundColor = themeColor;
            el.setAttribute('data-id', tid);
            
            let alarmHtml = '';
            if (task.alarm) {
                const now = new Date();
                const alarmDate = new Date(now.getFullYear(), task.alarm.month - 1, task.alarm.day, task.alarm.hour, task.alarm.minute);
                
                if (task.alarm.month < now.getMonth() + 1) {
                    alarmDate.setFullYear(now.getFullYear() + 1);
                }
                
                const isOverdue = !task.isDone && alarmDate < now && !task.alarmFired;
                const m = task.alarm.month.toString().padStart(2, '0');
                const d = task.alarm.day.toString().padStart(2, '0');
                const h = task.alarm.hour.toString().padStart(2, '0');
                const min = task.alarm.minute.toString().padStart(2, '0');
                alarmHtml = `<div class="alarm-indicator ${isOverdue ? 'overdue' : ''}">T ${m}/${d} ${h}:${min}</div>`;
            }
            
            el.innerHTML = `
                <div class="task-content" style="cursor: pointer;">
                    <div class="task-text" style="pointer-events:none;">${escapeHtml(task.text)}</div>
                    <div class="task-meta" style="pointer-events:none;">
                        <span>${new Date(task.createdAt).toLocaleDateString()}</span>
                        ${alarmHtml}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="action-btn btn-alarm" data-id="${tid}" data-subject="${safeStr(state.activeSubjectId)}" title="アラーム設定">T</button>
                    <button class="action-btn btn-complete" data-id="${tid}" data-subject="${safeStr(state.activeSubjectId)}" title="削除">—</button>
                </div>
            `;
            
            el.oncontextmenu = (e) => { e.preventDefault(); openEditTaskModal(tid); return false; };
            elements.taskList.appendChild(el);
        });
        
        document.querySelectorAll('.btn-complete').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.getAttribute('data-id');
                const subj = e.target.getAttribute('data-subject');
                toggleTaskComplete(subj, id);
            };
        });
        
        document.querySelectorAll('.btn-alarm').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.getAttribute('data-id');
                const subj = e.target.getAttribute('data-subject');
                openAlarmModal(subj, id);
            };
        });
    }
}

function openModal(modalEl) {
    elements.modalOverlay.classList.add('active');
    modalEl.classList.add('active');
}

function closeModal(modalEl) {
    if (!modalEl) {
        elements.modals.forEach(m => m.classList.remove('active'));
    } else {
        modalEl.classList.remove('active');
    }
    elements.modalOverlay.classList.remove('active');
}

function openEditSubjectModal(id) {
    const subj = state.subjects.find(s => safeStr(s.id) === safeStr(id));
    if (!subj) return;
    elements.modalSubjectTitle.textContent = '件名を書き換える';
    elements.inputSubjectId.value = id;
    elements.inputSubjectName.value = subj.name;
    openModal(elements.modalSubject);
    setTimeout(() => elements.inputSubjectName.focus(), 100);
}

function openEditTaskModal(id) {
    if (!state.activeSubjectId) return;
    const task = (state.tasks[state.activeSubjectId] || []).find(t => safeStr(t.id) === safeStr(id));
    if (!task) return;
    elements.modalTaskTitle.textContent = 'タスクを書き換える';
    elements.inputTaskId.value = id;
    elements.inputTaskName.value = task.text;
    openModal(elements.modalTask);
    setTimeout(() => elements.inputTaskName.focus(), 100);
}

function openAlarmModal(subjectId, taskId) {
    const task = (state.tasks[subjectId] || []).find(t => safeStr(t.id) === safeStr(taskId));
    if (!task) return;
    
    currentAlarmTaskId = taskId;
    elements.alarmTaskNameDisplay.textContent = task.text.substring(0, 50) + (task.text.length > 50 ? '...' : '');
    
    const now = new Date();
    
    if (task.alarm) {
        elements.inputAlarmMonth.value = task.alarm.month;
        elements.inputAlarmDay.value = task.alarm.day;
        elements.inputAlarmHour.value = task.alarm.hour;
        elements.inputAlarmMinute.value = task.alarm.minute;
        elements.btnClearAlarm.style.display = 'block';
    } else {
        elements.inputAlarmMonth.value = now.getMonth() + 1;
        elements.inputAlarmDay.value = now.getDate();
        elements.inputAlarmHour.value = now.getHours();
        
        let nextMin = Math.ceil(now.getMinutes() / 5) * 5;
        if(nextMin >= 60) nextMin = 59;
        
        elements.inputAlarmMinute.value = nextMin;
        elements.btnClearAlarm.style.display = 'none';
    }
    
    openModal(elements.modalAlarm);
}

function setupEventListeners() {
    elements.btnShowAddSubject.onclick = () => {
        elements.modalSubjectTitle.textContent = '新しい件名';
        elements.inputSubjectId.value = '';
        elements.inputSubjectName.value = '';
        openModal(elements.modalSubject);
        setTimeout(() => elements.inputSubjectName.focus(), 100);
    };
    
    elements.btnDeleteSubject.onclick = () => {
        if (!state.activeSubjectId) return;
        const subject = state.subjects.find(s => safeStr(s.id) === safeStr(state.activeSubjectId));
        if (!subject) return;

        if (confirm(`件名「${subject.name}」を削除しますか？\n(含まれる全タスクも一緒に削除されます)`)) {
            state.subjects = state.subjects.filter(s => safeStr(s.id) !== safeStr(state.activeSubjectId));
            delete state.tasks[state.activeSubjectId];
            
            state.activeSubjectId = state.subjects.length > 0 ? safeStr(state.subjects[0].id) : null;
            
            saveLocalState();
            saveGlobalState();
            renderSubjects();
            showToast('件名を削除しました');
        }
    };
    
    elements.btnSaveSubject.onclick = () => {
        const val = elements.inputSubjectName.value.trim();
        const id = elements.inputSubjectId.value;
        if (val) {
            saveSubject(val, id);
            closeModal(elements.modalSubject);
            elements.inputSubjectName.value = ''; // Clear for next time
        }
    };
    
    elements.btnShowAddTask.onclick = () => {
        if (!state.activeSubjectId) return;
        elements.modalTaskTitle.textContent = '新しいタスク';
        elements.inputTaskId.value = '';
        elements.inputTaskName.value = '';
        openModal(elements.modalTask);
        setTimeout(() => elements.inputTaskName.focus(), 100);
    };
    
    elements.btnSaveTask.onclick = () => {
        const val = elements.inputTaskName.value.trim();
        const id = elements.inputTaskId.value;
        if (val) {
            saveTask(val, id);
            closeModal(elements.modalTask);
        }
    };
    
    elements.btnSetAlarm.onclick = () => {
        if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
        
        const month = parseInt(elements.inputAlarmMonth.value);
        const day = parseInt(elements.inputAlarmDay.value);
        const hour = parseInt(elements.inputAlarmHour.value);
        const minute = parseInt(elements.inputAlarmMinute.value);
        
        if (!month || !day || isNaN(hour) || isNaN(minute)) {
            showToast('日時を正しく入力してください', true);
            return;
        }
        
        if (currentAlarmTaskId) {
            updateTaskAlarm(currentAlarmTaskId, { month, day, hour, minute });
            closeModal(elements.modalAlarm);
            showToast('アラームを設定しました');
            checkAlarmsNow();
        }
    };
    
    elements.btnClearAlarm.onclick = () => {
        if (currentAlarmTaskId) {
            updateTaskAlarm(currentAlarmTaskId, null);
            closeModal(elements.modalAlarm);
            showToast('アラームを解除しました');
        }
    };
    
    elements.modalOverlay.onclick = () => closeModal();
    
    elements.closeBtns.forEach(btn => {
        btn.onclick = (e) => {
            const modalId = e.target.getAttribute('data-modal');
            closeModal(document.getElementById(modalId));
        };
    });
    
    elements.inputSubjectName.onkeypress = (e) => { if (e.key === 'Enter') elements.btnSaveSubject.click(); };
    elements.inputTaskName.onkeypress = (e) => { if (e.key === 'Enter') elements.btnSaveTask.click(); };
    
    // iOS Safari Keyboard Fix: prevent screen from staying scrolled/zoomed when keyboard closes
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('blur', () => {
            setTimeout(() => {
                window.scrollTo(0, 0);
                document.body.scrollTop = 0;
            }, 100);
        });
    });
}

function showToast(message, isToastError = false, isAlarm = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${isAlarm ? 'alarm-toast' : ''}`;
    
    let icon = isAlarm ? '<b style="color:var(--accent-color)">T</b>' : (isToastError ? '⚠️' : '✅');
    
    toast.innerHTML = `
        <div style="font-size: 24px;">${icon}</div>
        <div class="toast-content">
            ${isAlarm ? '<h4>アラーム通知</h4>' : ''}
            <p>${escapeHtml(message)}</p>
        </div>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, isAlarm ? 15000 : 4000); // Errors/Normal are 4 seconds
}

function notifyUser(title, body) {
    showToast(body, false, true);
    
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, { body, icon: '/favicon.ico' });
        } catch(e) {
            console.error('Notification API err', e);
        }
    }
}

function checkAlarmsNow() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    let shouldSave = false;
    
    for (const subjectId in state.tasks) {
        state.tasks[subjectId].forEach(task => {
            if (!task.isDone && task.alarm && !task.alarmFired) {
                let targetYear = now.getFullYear();
                if (task.alarm.month < currentMonth && currentMonth - task.alarm.month > 6) {
                    targetYear += 1;
                }
                
                const alarmTime = new Date(targetYear, task.alarm.month - 1, task.alarm.day, task.alarm.hour, task.alarm.minute).getTime();
                
                if (now.getTime() >= alarmTime && now.getTime() - alarmTime < 300000) {
                    task.alarmFired = true;
                    shouldSave = true;
                    
                    const subjectName = state.subjects.find(s => safeStr(s.id) === safeStr(subjectId))?.name || 'タスク';
                    notifyUser('時間です！', `[${subjectName}] ${task.text}`);
                }
            }
        });
    }
    
    if (shouldSave) {
        saveGlobalState();
    }
}

function startAlarmChecker() {
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = setInterval(checkAlarmsNow, 10000); 
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

init();
