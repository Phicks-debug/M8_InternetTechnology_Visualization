const CENTER = { latitude: 52.2405, longitude: 6.854 };
const FLOW_TIMEOUT = 12000;
const FLOW_TRAVEL_RATIO = 0.72;
const PACKET_VISIBLE_FROM_PROGRESS = 0.04;
const SENSOR_TIMEOUT = 60000;
const FLOW_ARCH_HEIGHT = 20;
const MARKER_DISPLAY_OFFSET = 50;
const PACKET_AVERAGE_BYTES = 15;
const WS_URL = "ws://192.87.172.82:1337";
const BUILDINGS_ITEM_ID = "c444b24b184c4523a5dc96248bfea4e1";
const sessionStartedAt = Date.now();

let selectedScope = "total";

const GATEWAYS = {
  "a8:40:41:1e:ad:fc:41:50": {
    name: "Meander",
    latitude: 52.236887101823,
    longitude: 6.859867572784425,
    altitude: 4,
  },
  "a8:40:41:1e:e8:90:41:50": {
    name: "Vrijhof",
    latitude: 52.243762,
    longitude: 6.853425,
    altitude: 3,
  },
  "00:00:02:4b:08:03:01:bf": {
    name: "Spiegel",
    latitude: 52.23989,
    longitude: 6.85014,
    altitude: 54,
  },
  "a8:40:41:1e:ae:00:41:50": {
    name: "Ravelijn-A",
    latitude: 52.23923592912191,
    longitude: 6.855506300926209,
    altitude: 4,
  },
  "a8:40:41:1e:da:56:c4:15:00": {
    name: "Ravelijn-B",
    latitude: 52.23913,
    longitude: 6.85565,
    altitude: 6,
  },
};
const GATEWAY_ENTRIES = Object.entries(GATEWAYS);

const stats = {
  total: 0,
  devices: new Set(),
  lastTime: null,
  perGateway: {},
  totalBytes: 0,
  source: "Connecting",
};

const sensors = new Map();
const flows = [];

window.require(
  [
    "esri/Map",
    "esri/Ground",
    "esri/views/SceneView",
    "esri/layers/SceneLayer",
    "esri/layers/GraphicsLayer",
    "esri/Graphic",
    "esri/geometry/Point",
    "esri/geometry/Polyline",
  ],
  (
    ArcGISMap,
    Ground,
    SceneView,
    SceneLayer,
    GraphicsLayer,
    Graphic,
    Point,
    Polyline,
  ) => {
    const buildingsLayer = new SceneLayer({
      portalItem: { id: BUILDINGS_ITEM_ID },
      title: "Open 3D Buildings",
      opacity: 0.56,
      elevationInfo: { mode: "on-the-ground" },
    });

    const gatewayLayer = new GraphicsLayer({
      title: "Gateways",
      elevationInfo: { mode: "relative-to-ground" },
    });

    const sensorLayer = new GraphicsLayer({
      title: "Sensors",
      elevationInfo: { mode: "relative-to-ground" },
    });

    const flowLayer = new GraphicsLayer({
      title: "Packet flow",
      elevationInfo: { mode: "relative-to-ground" },
    });

    const map = new ArcGISMap({
      basemap: "topo-vector",
      ground: new Ground({ layers: [] }),
      layers: [buildingsLayer, flowLayer, gatewayLayer, sensorLayer],
    });

    const view = new SceneView({
      container: "view",
      map,
      qualityProfile: "low",
      alphaCompositingEnabled: true,
      camera: {
        position: {
          longitude: CENTER.longitude - 0.007,
          latitude: CENTER.latitude - 0.01,
          z: 850,
        },
        heading: 28,
        tilt: 62,
      },
      environment: {
        atmosphereEnabled: false,
        starsEnabled: false,
        background: { type: "color", color: [244, 249, 247, 1] },
        lighting: {
          type: "sun",
          date: new Date("2026-05-21T10:30:00+02:00"),
          directShadowsEnabled: false,
          ambientOcclusionEnabled: false,
        },
      },
      popup: {
        dockEnabled: true,
        dockOptions: { position: "bottom-right", buttonEnabled: false },
      },
      ui: {
        components: ["zoom", "navigation-toggle", "compass", "attribution"],
      },
    });

    const TOTAL_CAMERA = {
      position: {
        longitude: 6.8449,
        latitude: 52.2288,
        z: 1200,
      },
      heading: 28,
      tilt: 60,
    };

    const RAVELIJN_CAMERA = {
      position: {
        longitude: 6.8536,
        latitude: 52.237,
        z: 90,
      },
      heading: 28,
      tilt: 80,
    };

    const GATEWAY_MENU_ITEMS = [
      { key: "total", label: "Total" },
      { key: "a8:40:41:1e:ad:fc:41:50", label: "Meander" },
      { key: "a8:40:41:1e:e8:90:41:50", label: "Vrijhof" },
      { key: "00:00:02:4b:08:03:01:bf", label: "Spiegel" },
      { key: "ravelijn", label: "Ravelijn" },
    ];

    // render each button based on gate way for zoom in to building
    function renderGatewayMenu() {
      const container = document.getElementById("gateway-menus");
      if (!container) return;

      container.innerHTML = GATEWAY_MENU_ITEMS.map(
        (item) =>
          `
      <button type="button" data-gateway="${item.key}" class="${item.key === selectedScope ? "active" : ""}">${item.label}</button>
    `,
      ).join("");
    }

    function bindGatewayMenu() {
      const container = document.getElementById("gateway-menus");
      if (!container) return;

      container.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-gateway]");
        if (!button) return;

        const key = button.dataset.gateway;
        selectedScope = key;
        zoomToGateway(key);
        updateStats();

        container.querySelectorAll("button").forEach((item) => {
          item.classList.remove("active");
        });
        button.classList.add("active");
      });
    }

    function zoomToGateway(key) {
      if (key === "total") {
        view.goTo(TOTAL_CAMERA, { duration: 1600 });
        return;
      }
      if (key === "ravelijn") {
        view.goTo(RAVELIJN_CAMERA, { duration: 1600 });
        return;
      }

      const gateway = GATEWAYS[key];
      if (!gateway) return;

      view.goTo(
        {
          position: {
            longitude: gateway.longitude - 0.0018,
            latitude: gateway.latitude - 0.0018,
            z: gateway.altitude + 80,
          },
          heading: 28,
          tilt: 80,
        },
        {
          duration: 1600,
        },
      );
    }

    view.when(() => {
      addGateways(Graphic, Point, Polyline, gatewayLayer);
      prepareBuildingStyling(buildingsLayer);
      connectWS({ Graphic, Point, Polyline, sensorLayer, flowLayer });
      renderGatewayMenu();
      bindGatewayMenu();
      setInterval(() => pruneSensors(sensorLayer), 5000);
      requestAnimationFrame(() => animateFlows(Point, Polyline));
      updateStats();
    });
  },
);

function addGateways(Graphic, Point, Polyline, layer) {
  GATEWAY_ENTRIES.forEach(([address, gateway]) => {
    const visibleAltitude = displayAltitude(gateway.altitude);
    const stem = new Graphic({
      geometry: new Polyline({
        hasZ: true,
        paths: [
          [
            [gateway.longitude, gateway.latitude, gateway.altitude],
            [gateway.longitude, gateway.latitude, visibleAltitude],
          ],
        ],
        spatialReference: { wkid: 4326 },
      }),
      symbol: stemSymbol(),
      attributes: { type: "Gateway stem", address },
    });
    const point = new Graphic({
      geometry: new Point({
        latitude: gateway.latitude,
        longitude: gateway.longitude,
        z: visibleAltitude,
      }),
      symbol: pointSymbol("#0877b9", "#ffffff", 11),
      attributes: {
        type: "Gateway",
        name: gateway.name,
        address,
        altitude: gateway.altitude,
      },
      popupTemplate: {
        title: "{name}",
        content: "Gateway<br>Address: {address}<br>Altitude: {altitude} m",
      },
    });
    layer.addMany([stem, point]);
  });
}

function connectWS(context) {
  setSource("Connecting");

  let ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    startDemoTraffic(context);
    return;
  }

  const fallback = window.setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) startDemoTraffic(context);
  }, 2500);

  ws.onopen = () => {
    window.clearTimeout(fallback);
    stopDemoTraffic();
    setSource("Live");
  };

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data), context);
    } catch (error) {
      console.error("Could not parse websocket message:", error);
    }
  };

  ws.onclose = () => {
    setSource("Demo");
    startDemoTraffic(context);
    setTimeout(() => connectWS(context), 6000);
  };

  ws.onerror = () => {
    setSource("Demo");
    startDemoTraffic(context);
  };
}

let demoTimer = null;

function startDemoTraffic(context) {
  if (demoTimer) return;
  setSource("Demo");

  demoTimer = window.setInterval(() => {
    const [gateway] = randomEntry(GATEWAYS);
    const deviceNumber = Math.floor(1 + Math.random() * 16);
    handleMessage(
      {
        gateway,
        device_name: `sensor-${String(deviceNumber).padStart(2, "0")}`,
        device_eui: `demo-${deviceNumber}`,
        rssi: -68 - Math.floor(Math.random() * 48),
        lsnr: Number((Math.random() * 9 - 2).toFixed(1)),
        size: demoPacketSize(),
      },
      context,
    );
  }, 1200);
}

function stopDemoTraffic() {
  if (!demoTimer) return;
  window.clearInterval(demoTimer);
  demoTimer = null;
}

function handleMessage(message, context) {
  const gateway = GATEWAYS[message.gateway];
  if (!gateway) return;

  const deviceKey =
    message.device_eui || message.device_addr || message.device_name;
  if (!deviceKey) return;

  const sensor = createSensorPosition(gateway, message);
  sensors.set(deviceKey, sensor);

  updateSensorGraphic(
    deviceKey,
    sensor,
    context.Graphic,
    context.Point,
    context.Polyline,
    context.sensorLayer,
  );
  createFlow(
    sensor,
    gateway,
    message.size || 0,
    context.Graphic,
    context.Point,
    context.Polyline,
    context.flowLayer,
  );

  stats.total += 1;
  stats.devices.add(deviceKey);
  stats.lastTime = Date.now();
  stats.totalBytes += message.size || 0;
  // stats.perGateway[gateway.name] = (stats.perGateway[gateway.name] || 0) + 1;

  const gatewayKey = message.gateway;

  if (!stats.perGateway[gatewayKey]) {
    stats.perGateway[gatewayKey] = {
      packets: 0,
      rssiSum: 0,
      rssiCount: 0,
      snrSum: 0,
      snrCount: 0,
      devices: new Set(),
      lastTime: null,
    };
  }

  const bucket = stats.perGateway[gatewayKey];
  bucket.packets += 1;
  bucket.lastTime = Date.now();
  bucket.devices.add(deviceKey);

  const rssi = Number(message.rssi);
  if (Number.isFinite(rssi)) {
    bucket.rssiSum += rssi;
    bucket.rssiCount += 1;
  }

  const snr = Number(message.lsnr);
  if (Number.isFinite(snr)) {
    bucket.snrSum += snr;
    bucket.snrCount += 1;
  }
  updateStats();
}

function createSensorPosition(gateway, message) {
  const jitter = () => (Math.random() - 0.5) * 0.00042;
  return {
    latitude: gateway.latitude + jitter(),
    longitude: gateway.longitude + jitter(),
    name:
      message.device_name ||
      message.device_eui ||
      message.device_addr ||
      "unknown sensor",
    rssi: message.rssi,
    snr: message.lsnr,
    gateway: gateway.name,
    gatewayAddress: message.gateway,
    altitude: sensorAltitude(message, gateway),
    lastPayload: message.size || 0,
    lastSeen: Date.now(),
  };
}

function sensorAltitude(message, gateway) {
  const value =
    message.altitude ?? message.elevation ?? message.height ?? message.z;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  // No sensor height is present in the current feed, so keep simulated sensors
  // near the installation height instead of lifting them above buildings.
  return Math.max(1.5, Math.min(8, gateway.altitude || 1.5));
}

function updateSensorGraphic(key, sensor, Graphic, Point, Polyline, layer) {
  const visibleAltitude = displayAltitude(sensor.altitude);
  const existingPoint = layer.graphics.find(
    (graphic) =>
      graphic.attributes?.key === key && graphic.attributes?.role === "point",
  );
  const existingStem = layer.graphics.find(
    (graphic) =>
      graphic.attributes?.key === key && graphic.attributes?.role === "stem",
  );
  const point =
    existingPoint || new Graphic({ attributes: { key, role: "point" } });
  const stem =
    existingStem || new Graphic({ attributes: { key, role: "stem" } });

  stem.geometry = new Polyline({
    hasZ: true,
    paths: [
      [
        [sensor.longitude, sensor.latitude, sensor.altitude],
        [sensor.longitude, sensor.latitude, visibleAltitude],
      ],
    ],
    spatialReference: { wkid: 4326 },
  });
  stem.symbol = stemSymbol();
  stem.attributes = { key, role: "stem" };

  point.geometry = new Point({
    latitude: sensor.latitude,
    longitude: sensor.longitude,
    z: visibleAltitude,
  });
  point.symbol = pointSymbol(rssiColor(sensor.rssi), "#ffffff", 10);
  point.attributes = {
    key,
    role: "point",
    name: sensor.name,
    gateway: sensor.gateway,
    rssi: sensor.rssi ?? "n/a",
    snr: sensor.snr ?? "n/a",
    altitude: sensor.altitude,
    payload: sensor.lastPayload,
    lastSeen: new Date(sensor.lastSeen).toLocaleTimeString(),
  };
  point.popupTemplate = {
    title: "{name}",
    content:
      "Gateway: {gateway}<br>Height: {altitude} m<br>RSSI: {rssi} dBm<br>SNR: {snr} dB<br>Payload: {payload} bytes<br>Last: {lastSeen}",
  };

  if (!existingStem) layer.add(stem);
  if (!existingPoint) layer.add(point);
}

function createFlow(
  sensor,
  gateway,
  payloadBytes,
  Graphic,
  Point,
  Polyline,
  layer,
) {
  const path = curvedPath(sensor, gateway);
  const style = packetStyle(payloadBytes);
  const line = new Graphic({
    geometry: new Polyline({
      hasZ: true,
      paths: [[path[0], path[1]]],
      spatialReference: { wkid: 4326 },
    }),
    symbol: flowLineSymbol(style.color, 0.66, style.width),
  });

  layer.add(line);
  flows.push({
    path,
    line,
    packet: null,
    style,
    Graphic,
    Point,
    layer,
    startedAt: performance.now(),
  });
}

function animateFlows(Point, Polyline) {
  const now = performance.now();

  for (let index = flows.length - 1; index >= 0; index -= 1) {
    const flow = flows[index];
    const progress = (now - flow.startedAt) / FLOW_TIMEOUT;

    if (progress >= 1) {
      removeGraphic(flow.line);
      removeGraphic(flow.packet);
      flows.splice(index, 1);
      continue;
    }

    const travelProgress = Math.min(1, progress / FLOW_TRAVEL_RATIO);
    if (travelProgress >= 1) {
      if (flow.packet) {
        removeGraphic(flow.packet);
        flow.packet = null;
      }
    } else if (travelProgress >= PACKET_VISIBLE_FROM_PROGRESS) {
      const point = pointAlongPath(flow.path, travelProgress);
      if (!flow.packet) {
        flow.packet = new flow.Graphic({
          symbol: pointSymbol(
            flow.style.color,
            "#ffffff",
            flow.style.packetSize,
          ),
        });
        flow.layer.add(flow.packet);
      }
      flow.packet.geometry = new Point({
        longitude: point[0],
        latitude: point[1],
        z: point[2],
      });
    }
    flow.line.geometry = new Polyline({
      hasZ: true,
      paths: [pathUntilProgress(flow.path, travelProgress)],
      spatialReference: { wkid: 4326 },
    });

    const fadeProgress = Math.max(
      0,
      (progress - FLOW_TRAVEL_RATIO) / (1 - FLOW_TRAVEL_RATIO),
    );
    const alpha = 0.2 + 0.66 * (1 - fadeProgress);
    flow.line.symbol = flowLineSymbol(
      flow.style.color,
      alpha,
      flow.style.width,
    );
  }

  requestAnimationFrame(() => animateFlows(Point, Polyline));
}

function pruneSensors(sensorLayer) {
  const now = Date.now();
  sensors.forEach((sensor, key) => {
    if (now - sensor.lastSeen <= SENSOR_TIMEOUT) return;

    sensors.delete(key);
    const graphics = sensorLayer.graphics.filter(
      (item) => item.attributes?.key === key,
    );
    sensorLayer.removeMany(graphics);
  });

  updateStats();
}

function curvedPath(sensor, gateway) {
  const steps = 18;
  const path = [];
  const sensorZ = displayAltitude(sensor.altitude);
  const gatewayZ = displayAltitude(gateway.altitude);

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const longitude = lerp(sensor.longitude, gateway.longitude, t);
    const latitude = lerp(sensor.latitude, gateway.latitude, t);
    const z =
      lerp(sensorZ, gatewayZ, t) + Math.sin(Math.PI * t) * FLOW_ARCH_HEIGHT;
    path.push([longitude, latitude, z]);
  }

  return path;
}

function pointAlongPath(path, progress) {
  const scaled = progress * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const start = path[index];
  const end = path[index + 1];

  return [
    lerp(start[0], end[0], local),
    lerp(start[1], end[1], local),
    lerp(start[2], end[2], local),
  ];
}

function pathUntilProgress(path, progress) {
  if (progress >= 1) return path;

  const scaled = progress * (path.length - 1);
  const index = Math.max(1, Math.floor(scaled));
  const partial = path.slice(0, index + 1);
  partial[partial.length - 1] = pointAlongPath(path, progress);
  return partial;
}

function pointSymbol(fill, outline, size) {
  return {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive: "circle" },
        material: { color: fill },
        size,
        outline: { color: outline, size: 2 },
      },
    ],
  };
}

function flowLineSymbol(color, alpha, width) {
  return {
    type: "simple-line",
    color: [...color, alpha],
    width,
  };
}

function stemSymbol() {
  return {
    type: "line-3d",
    symbolLayers: [
      {
        type: "line",
        material: { color: [18, 48, 64, 0.74] },
        size: 1.4,
      },
    ],
  };
}

function displayAltitude(altitude) {
  return altitude + MARKER_DISPLAY_OFFSET;
}

function prepareBuildingStyling(buildingsLayer) {
  buildingsLayer
    .load()
    .then(() => {
      setDefaultBuildingRenderer(buildingsLayer);
    })
    .catch((error) => {
      console.warn("Building styling could not initialize:", error);
    });
}

function setDefaultBuildingRenderer(buildingsLayer) {
  buildingsLayer.renderer = {
    type: "simple",
    symbol: buildingSymbol([226, 231, 224, 0.5]),
  };
}

function buildingSymbol(color) {
  return {
    type: "mesh-3d",
    symbolLayers: [
      {
        type: "fill",
        material: { color },
        edges: {
          type: "solid",
          color: [120, 132, 126, 0.22],
          size: 0.45,
        },
      },
    ],
  };
}

function rssiColor(rssi) {
  if (!rssi || rssi <= -100) return "#e14b4b";
  if (rssi <= -80) return "#e6a331";
  return "#2fbf69";
}

function setSource(source) {
  stats.source = source;
  updateStats();
}

// checking which scope
function scopeLabel(scope) {
  if (scope === "total") return "Total";
  if (scope === "ravelijn") return "Ravelijn";

  const gateway = GATEWAYS[scope];
  return gateway?.name || "Unknown";
}

function getScopeStats(scope) {
  if (scope === "total") {
    let packets = 0;
    let rssiSum = 0;
    let rssiCount = 0;
    let snrSum = 0;
    let snrCount = 0;
    let lastTime = null;
    const devices = new Set();

    Object.values(stats.perGateway).forEach((bucket) => {
      packets += bucket.packets;
      rssiSum += bucket.rssiSum;
      rssiCount += bucket.rssiCount;
      snrSum += bucket.snrSum;
      snrCount += bucket.snrCount;

      bucket.devices.forEach((device) => devices.add(device));

      if (!lastTime || (bucket.lastTime && bucket.lastTime > lastTime)) {
        lastTime = bucket.lastTime;
      }
    });
    return {
      packets,
      rssiSum,
      rssiCount,
      snrSum,
      snrCount,
      devices,
      lastTime,
    };
  }
  if (scope === "ravelijn") {
    const ravKeys = ["a8:40:41:1e:ae:00:41:50", "a8:40:41:1e:da:56:c4:15:00"];

    let packets = 0;
    let rssiSum = 0;
    let rssiCount = 0;
    let snrSum = 0;
    let snrCount = 0;
    let lastTime = null;
    const devices = new Set();

    ravKeys.forEach((key) => {
      const bucket = stats.perGateway[key];
      if (!bucket) return;

      rssiSum += bucket.rssiSum;
      rssiCount += bucket.rssiCount;
      snrSum += bucket.snrSum;
      snrCount += bucket.snrCount;

      bucket.devices.forEach((device) => devices.add(device));

      if (!lastTime || (bucket.lastTime && bucket.lastTime > lastTime)) {
        lastTime = bucket.lastTime;
      }
    });
    return {
      packets,
      rssiSum,
      rssiCount,
      snrSum,
      snrCount,
      devices,
      lastTime,
    };
  }

  const bucket = stats.perGateway[scope];
  if (!bucket) {
    return {
      packets: 0,
      rssiSum: 0,
      rssiCount: 0,
      snrSum: 0,
      snrCount: 0,
      devices: new Set(),
      lastTime: null,
    };
  }
  return bucket;
}

function formatAvg(sum, count, unit = "") {
  if (!count) return "-";
  return `${(sum / count).toFixed(1)}${unit}`;
}

function updateStats() {
  const scopeStats = getScopeStats(selectedScope);
  setText("total-msgs", scopeStats.packets);
  setText("active-devices", scopeStats.devices.size);
  setText(
    "last-msg",
    scopeStats.lastTime
      ? new Date(scopeStats.lastTime).toLocaleTimeString()
      : "-",
  );
  setText(
    "avg-rssi",
    formatAvg(scopeStats.rssiSum, scopeStats.rssiCount, "dBm"),
  );
  setText("avg-snr", formatAvg(scopeStats.snrSum, scopeStats.snrCount, "dB"));
  setText("ws-status", stats.source);
  setText("source-mode", stats.source === "Connecting" ? "link" : "feed");
  setText("scope-name", scopeLabel(selectedScope));
  setText("session-started", new Date(sessionStartedAt).toLocaleTimeString());
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function randomEntry(value) {
  const entries = Object.entries(value);
  return entries[Math.floor(Math.random() * entries.length)];
}

function demoPacketSize() {
  return Math.round(7 + Math.random() * 12 + Math.random() * 12);
}

function packetStyle(bytes) {
  const value =
    Number.isFinite(Number(bytes)) && Number(bytes) > 0
      ? Number(bytes)
      : PACKET_AVERAGE_BYTES;
  const color = packetColor(value);
  const normalized = clamp((value - 6) / 34, 0, 1);

  return {
    color,
    packetSize: 6 + normalized * 4,
    width: 2.6 + normalized * 2.2,
  };
}

function packetColor(bytes) {
  const stops = [
    { value: 6, color: [34, 128, 213] },
    { value: PACKET_AVERAGE_BYTES, color: [47, 191, 105] },
    { value: 26, color: [230, 163, 49] },
    { value: 46, color: [225, 75, 75] },
  ];

  if (bytes <= stops[0].value) return stops[0].color;

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    if (bytes <= next.value) {
      const amount = (bytes - previous.value) / (next.value - previous.value);
      return interpolateColor(previous.color, next.color, amount);
    }
  }

  return stops[stops.length - 1].color;
}

function interpolateColor(start, end, amount) {
  return start.map((value, index) =>
    Math.round(lerp(value, end[index], amount)),
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function removeGraphic(graphic) {
  if (graphic?.layer) graphic.layer.remove(graphic);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}
