export const CAMERA_CONFIG = [
  {
    id: "kitchen",
    name: "Kitchen",
    entity: "camera.kitchen",
    mode: "snapshot",
    snapshotPath: "/api/image_proxy/image.kitchen_event_image"
  },
  {
    id: "piano_room",
    name: "Piano Room",
    entity: "camera.piano_room",
    mode: "snapshot",
    snapshotPath: "/api/image_proxy/image.piano_room_event_image"
  },
  {
    id: "tilt_pan",
    name: "Garage (Pan & Tilt)",
    entity: "camera.tilt_pan",
    mode: "snapshot",
    snapshotPath: "/api/image_proxy/image.tilt_pan_event_image"
  },
  {
    id: "doorbell",
    name: "Doorbell",
    entity: "camera.doorbell",
    mode: "snapshot",
    streamType: "hls",
    streamFallbacks: ["mjpeg"],
    streamPaths: {
      hls: "/api/hls?src=doorbell",
      mjpeg: "/api/mjpeg?src=doorbell"
    },
    snapshotPath: "/api/camera_proxy/camera.doorbell"
  },
  {
    id: "front_yard",
    name: "Front Yard",
    entity: "camera.front_yard",
    mode: "snapshot",
    streamType: "hls",
    streamFallbacks: ["mjpeg"],
    streamPaths: {
      hls: "/api/hls?src=front_yard",
      mjpeg: "/api/mjpeg?src=front_yard"
    },
    snapshotPath: "/api/camera_proxy/camera.front_yard"
  },
  {
    id: "driveway",
    name: "Driveway",
    entity: "camera.driveway",
    mode: "snapshot",
    streamType: "hls",
    streamFallbacks: ["mjpeg"],
    streamPaths: {
      hls: "/api/hls?src=driveway",
      mjpeg: "/api/mjpeg?src=driveway"
    },
    snapshotPath: "/api/camera_proxy/camera.driveway"
  },
  {
    id: "backyard",
    name: "Backyard",
    entity: "camera.backyard",
    mode: "snapshot",
    streamType: "hls",
    streamFallbacks: ["mjpeg"],
    streamPaths: {
      hls: "/api/hls?src=backyard",
      mjpeg: "/api/mjpeg?src=backyard"
    },
    snapshotPath: "/api/camera_proxy/camera.backyard"
  },
  {
    id: "patio",
    name: "Patio",
    entity: "camera.patio",
    mode: "snapshot",
    streamType: "hls",
    streamFallbacks: ["mjpeg"],
    streamPaths: {
      hls: "/api/hls?src=patio",
      mjpeg: "/api/mjpeg?src=patio"
    },
    snapshotPath: "/api/camera_proxy/camera.patio"
  },
  {
    id: "side_gate",
    name: "Side Gate",
    entity: "camera.side_gate",
    mode: "snapshot",
    streamType: "hls",
    streamFallbacks: ["mjpeg"],
    streamPaths: {
      hls: "/api/hls?src=side_gate",
      mjpeg: "/api/mjpeg?src=side_gate"
    },
    snapshotPath: "/api/camera_proxy/camera.side_gate"
  }
];
