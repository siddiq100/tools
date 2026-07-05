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
const btnStartShare = document.getElementById('btnStartShare');
const btnStopShare = document.getElementById('btnStopShare');
const clientLayout = document.getElementById('clientLayout');
const errorBox = document.getElementById('errorBox');
const errorMsg = document.getElementById('errorMsg');
const radarIcon = document.getElementById('radarIcon');

let ws = null;
let peerConnection = null;
let localStream = null;
let remoteCandidatesQueue = [];

// Configuration for WebRTC. Uses free Google STUN servers for NAT traversal by default.
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Initialize WebSocket signaling connection
function initSignaling() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Connect to port 3000 if running locally (e.g. from XAMPP Apache), otherwise use current host for cloud deployment
    const host = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
        ? `${window.location.hostname}:3000` 
        : window.location.host;
        
    const wsUrl = `${protocol}//${host}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('waiting', 'متصل بالسيرفر. بانتظار المهندس...');
        // Join room as client
        ws.send(JSON.stringify({
            type: 'join',
            roomId: roomId,
            role: 'client'
        }));
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            const { type, status, otherRole, payload } = data;

            switch (type) {
                case 'peer_status':
                    if (status === 'connected') {
                        updateStatus('connected', 'مهندس الدعم الفني متصل بالجلسة');
                        btnStartShare.disabled = false;
                    } else if (status === 'waiting') {
                        updateStatus('waiting', 'بانتظار انضمام مهندس الدعم الفني...');
                        btnStartShare.disabled = true;
                    } else if (status === 'disconnected') {
                        updateStatus('disconnected', 'انفصل المهندس عن الجلسة');
                        stopScreenSharing();
                    }
                    break;

                case 'signal':
                    if (payload.sdp && payload.sdp.type === 'answer') {
                        console.log('Received WebRTC Answer from Agent');
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                        
                        // Process queued ICE candidates now that remote description is set
                        for (const candidate of remoteCandidatesQueue) {
                            try {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                            } catch (e) {
                                console.error('Error adding queued ICE candidate:', e);
                            }
                        }
                        remoteCandidatesQueue = [];
                    } else if (payload.candidate) {
                        console.log('Received ICE Candidate from Agent');
                        if (peerConnection && peerConnection.remoteDescription) {
                            try {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
                            } catch (e) {
                                console.error('Error adding ICE candidate:', e);
                            }
                        } else {
                            remoteCandidatesQueue.push(payload.candidate);
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error('Error handling signaling message:', e);
        }
    };

    ws.onclose = () => {
        updateStatus('disconnected', 'انقطع الاتصال بالسيرفر. جاري إعادة المحاولة...');
        btnStartShare.disabled = true;
        setTimeout(initSignaling, 3000); // Reconnect loop
    };

    ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
    };
}

// Update connection status in the UI
function updateStatus(status, text) {
    connStatusPill.className = `status-pill status-${status}`;
    connStatusText.textContent = text;
}

// Start screen capture and setup PeerConnection
async function startScreenSharing() {
    try {
        errorBox.style.display = 'none';

        // Capture client screen stream
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor"
            },
            audio: false
        });

        clientLayout.classList.add('active-sharing');
        radarIcon.className = 'fa-solid fa-signal';
        btnStartShare.style.display = 'none';
        btnStopShare.style.display = 'inline-flex';

        // Initialize PeerConnection
        peerConnection = new RTCPeerConnection(rtcConfig);

        // Add local screen track to connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            
            // Auto stop connection if sharing is ended by OS control bar
            track.onended = () => {
                stopScreenSharing();
            };
        });

        // Relay local ICE candidates to Agent
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    roomId: roomId,
                    role: 'client',
                    payload: { candidate: event.candidate }
                }));
            }
        };

        // Create WebRTC Offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Send Offer to Agent
        ws.send(JSON.stringify({
            type: 'join', // Re-verify join room
            roomId: roomId,
            role: 'client'
        }));

        ws.send(JSON.stringify({
            type: 'signal',
            roomId: roomId,
            role: 'client',
            payload: { sdp: peerConnection.localDescription }
        }));

        console.log('WebRTC Offer sent to Agent.');

    } catch (err) {
        console.error('Error starting screen sharing:', err);
        showError('فشل تشغيل مشاركة الشاشة. تأكد من إعطاء الصلاحيات اللازمة للمتصفح.');
    }
}

// Stop screen sharing and reset PeerConnection
function stopScreenSharing() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteCandidatesQueue = [];

    clientLayout.classList.remove('active-sharing');
    radarIcon.className = 'fa-solid fa-desktop';
    btnStartShare.style.display = 'inline-flex';
    btnStopShare.style.display = 'none';
    console.log('Screen sharing stopped.');
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorBox.style.display = 'block';
}

// Event Listeners
btnStartShare.addEventListener('click', startScreenSharing);
btnStopShare.addEventListener('click', stopScreenSharing);

// Boot
initSignaling();
