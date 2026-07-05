// Parse room ID from URL query parameters
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

if (!roomId) {
    window.location.href = 'index.html';
}

document.getElementById('lblRoomId').textContent = roomId;

// DOM Elements
const connStatusPill = document.getElementById('connStatusPill');
const connStatusText = document.getElementById('connStatusText');
const btnCopyLink = document.getElementById('btnCopyLink');
const logPanel = document.getElementById('logPanel');
const remoteVideo = document.getElementById('remoteVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const videoControls = document.getElementById('videoControls');
const videoPanel = document.getElementById('videoPanel');

// Control Buttons
const btnFullscreen = document.getElementById('btnFullscreen');
const btnScreenshot = document.getElementById('btnScreenshot');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomReset = document.getElementById('btnZoomReset');

let ws = null;
let peerConnection = null;
let zoomScale = 1;

// Configuration for WebRTC.
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Log message to the console panel
function log(msg) {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span style="color: var(--primary-fuchsia);">[${time}]</span> ${msg}`;
    logPanel.appendChild(div);
    logPanel.scrollTop = logPanel.scrollHeight;
}

// Update connection status
function updateStatus(status, text) {
    connStatusPill.className = `status-pill status-${status}`;
    connStatusText.textContent = text;
}

// Initialize WebSocket signaling connection
function initSignaling() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('waiting', 'متصل بالسيرفر. بانتظار العميل...');
        log('تم الاتصال بسيرفر الإشارات بنجاح.');
        
        // Join room as agent
        ws.send(JSON.stringify({
            type: 'join',
            roomId: roomId,
            role: 'agent'
        }));
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            const { type, status, payload } = data;

            switch (type) {
                case 'peer_status':
                    if (status === 'connected') {
                        updateStatus('connected', 'العميل متصل بالجلسة');
                        log('انضم العميل للجلسة. بانتظار مشاركة الشاشة...');
                    } else if (status === 'waiting') {
                        updateStatus('waiting', 'بانتظار العميل...');
                    } else if (status === 'disconnected') {
                        updateStatus('disconnected', 'انفصل العميل عن الجلسة');
                        log('انفصل العميل عن الجلسة. تم إنهاء البث.');
                        resetVideoState();
                    }
                    break;

                case 'signal':
                    if (payload.sdp && payload.sdp.type === 'offer') {
                        log('تم استلام طلب بدء البث (WebRTC Offer).');
                        await handleWebRTCOffer(payload.sdp);
                    } else if (payload.candidate) {
                        if (peerConnection) {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error('Error handling signaling message:', e);
        }
    };

    ws.onclose = () => {
        updateStatus('disconnected', 'انقطع الاتصال بالسيرفر. إعادة محاولة...');
        log('انقطع الاتصال بالسيرفر. جاري إعادة المحاولة خلال 3 ثوان...');
        setTimeout(initSignaling, 3000);
    };
}

// Handle incoming WebRTC Offer from client
async function handleWebRTCOffer(sdpOffer) {
    try {
        // Initialize PeerConnection
        peerConnection = new RTCPeerConnection(rtcConfig);

        // Forward local ICE candidates to Client
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    roomId: roomId,
                    role: 'agent',
                    payload: { candidate: event.candidate }
                }));
            }
        };

        // When remote screen video stream arrives, play it
        peerConnection.ontrack = (event) => {
            log('تم استقبال تدفق فيديو الشاشة (Screen Track).');
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                videoPlaceholder.style.display = 'none';
                videoControls.style.display = 'flex';
                log('بدأ عرض شاشة العميل بالوقت الحقيقي.');
            }
        };

        // Process offer and create answer
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Send Answer back to Client
        ws.send(JSON.stringify({
            type: 'signal',
            roomId: roomId,
            role: 'agent',
            payload: { sdp: peerConnection.localDescription }
        }));
        
        log('تم توليد وإرسال إذن الاستقبال (WebRTC Answer).');

    } catch (err) {
        console.error('Error handling WebRTC offer:', err);
        log('خطأ في إعداد اتصال WebRTC.');
    }
}

// Reset video element and display placeholder
function resetVideoState() {
    remoteVideo.srcObject = null;
    videoPlaceholder.style.display = 'flex';
    videoControls.style.display = 'none';
    zoomScale = 1;
    remoteVideo.style.transform = `scale(${zoomScale})`;
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

// Copy client join link to clipboard
btnCopyLink.addEventListener('click', () => {
    const clientLink = `${window.location.protocol}//${window.location.host}/client.html?room=${roomId}`;
    navigator.clipboard.writeText(clientLink).then(() => {
        log('تم نسخ رابط العميل بنجاح.');
        const originalText = btnCopyLink.innerHTML;
        btnCopyLink.innerHTML = '<i class="fa-solid fa-check"></i> تم النسخ!';
        setTimeout(() => {
            btnCopyLink.innerHTML = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Copy link failed:', err);
    });
});

// --- Console Controls ---

// Toggle Fullscreen
btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        videoPanel.requestFullscreen().catch(err => {
            log(`خطأ أثناء تفعيل ملء الشاشة: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
});

// Take Screenshot of active video stream
btnScreenshot.addEventListener('click', () => {
    if (!remoteVideo.srcObject) return;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = remoteVideo.videoWidth;
        canvas.height = remoteVideo.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
        
        // Trigger download
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `screenshot_room_${roomId}_${Date.now()}.png`;
        a.click();
        
        log('تم حفظ لقطة شاشة للبث بنجاح.');
    } catch (e) {
        log('فشل التقاط الشاشة: قد تكون دقة الفيديو غير متوفرة بعد.');
    }
});

// Zoom In stream
btnZoomIn.addEventListener('click', () => {
    zoomScale += 0.25;
    if (zoomScale > 3) zoomScale = 3; // Limit zoom
    remoteVideo.style.transform = `scale(${zoomScale})`;
    log(`تكبير البث: x${zoomScale}`);
});

// Reset zoom
btnZoomReset.addEventListener('click', () => {
    zoomScale = 1;
    remoteVideo.style.transform = `scale(${zoomScale})`;
    log('تم إعادة تعيين أبعاد البث.');
});

// Boot
initSignaling();
