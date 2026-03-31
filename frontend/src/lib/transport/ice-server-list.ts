export const defaultIceServerList: RTCIceServer[] = [
  // Public STUN servers - use multiple for redundancy
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:openrelay.metered.ca:80" },
  { urls: "stun:stun.twilio.com:3478" },
  // TURN servers - REQUIRED for mobile/CGNAT connections
  {
    urls: [
      "turn:awful.frav.in:3478?transport=udp",
      "turn:awful.frav.in:3478?transport=tcp",
      "turn:awful.frav.in:5349?transport=tcp",
    ],
    username: "awful",
    credential: "awful",
  },
  // Free public TURN as fallback (may have rate limits)
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
