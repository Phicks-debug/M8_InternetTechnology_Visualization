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
const knownSensors = new Map();
const deviceReceptions = new Map();
const MULTI_RX_WINDOW = 100000;

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

async function loadKnownSensors() {
  try {
    const response = await fetch("./sensor_locations(lora).csv");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    parseKnownSensorsCsv(text);
    console.log(`Loaded ${knownSensors.size} known sensor locations`);
  } catch (error) {
    console.error("Could not load sensor_location(lora).csv: ", error);
  }
}

function parseKnownSensorsCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return;

  const rows = lines.map(parseCsvLine);
  const header = rows[0];

  const euiIndex = header.indexOf("Sensor_Eui");
  const lonIndex = header.indexOf("St_X");
  const latIndex = header.indexOf("St_Y");
  const altIndex = header.indexOf("Altitude_Masl");
  const roomIndex = header.indexOf("Roomname");
  const floorIndex = header.indexOf("Mazemap_Floor");

  if (euiIndex === -1 || lonIndex === -1 || latIndex === -1) return;

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const eui = normalizeEui(row[euiIndex]);
    const longitude = Number(row[lonIndex]);
    const latitude = Number(row[latIndex]);
    const altitudeRaw = row[altIndex];
    const altitude = Number(altitudeRaw);
    const room = row[roomIndex] || null;
    const floor = row[floorIndex] || null;

    if (!eui) continue;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;

    knownSensors.set(eui, {
      longitude,
      latitude,
      altitude: Number.isFinite(altitude) ? altitude : null,
      room,
      floor,
    });
  }
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function normalizeEui(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[:\-\s]/g, "");
}

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

    view.when(async () => {
      addGateways(Graphic, Point, Polyline, gatewayLayer);
      prepareBuildingStyling(buildingsLayer);
      await loadKnownSensors();
      connectWS({ Graphic, Point, Polyline, sensorLayer, flowLayer });
      renderGatewayMenu();
      bindGatewayMenu();
      setInterval(() => {
        (pruneSensors(sensorLayer), pruneDeviceReceptions());
      }, 5000);
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
  // console.log(JSON.stringify(message, null, 2));
  const gateway = GATEWAYS[message.gateway];
  if (!gateway) return;

  const deviceKey =
    message.device_eui || message.device_addr || message.device_name;
  if (!deviceKey) return;

  recordReception(deviceKey, message);
  const multi = getMultiGatewaySummary(deviceKey);

  const sensor = createSensorPosition(gateway, message);
  sensor.multiGateway = multi.isMultiGateway;
  sensor.gatewayCount = multi.gatewayCount;
  sensor.gatewayList = multi.gateways;
  sensor.bestGateway = multi.bestGateway;
  sensor.bestRssi = multi.bestRssi;

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
      datrCounts: {},
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

  const datr = message.datr || null;
  if (datr) {
    bucket.datrCounts[datr] = (bucket.datrCounts[datr] || 0) + 1;
  }

  updateStats();
}

function recordReception(deviceKey, message) {
  const now = Date.now();
  const gateway = message.gateway;

  if (!deviceReceptions.has(deviceKey)) {
    deviceReceptions.set(deviceKey, {
      latestByGateway: new Map(),
      recentEvents: [],
    });
  }

  const entry = deviceReceptions.get(deviceKey);

  entry.latestByGateway.set(gateway, {
    time: now,
    rssi: Number(message.rssi),
    snr: Number(message.lsnr),
    datr: message.datr || null,
  });

  entry.recentEvents.push({
    gateway,
    time: now,
    rssi: Number(message.rssi),
    snr: Number(message.lsnr),
    datr: message.datr || null,
  });

  entry.recentEvents = entry.recentEvents.filter(
    (event) => now - event.time <= MULTI_RX_WINDOW,
  );

  entry.latestByGateway.forEach((value, key) => {
    if (now - value.time > MULTI_RX_WINDOW) {
      entry.latestByGateway.delete(key);
    }
  });

  console.log(
    "RX",
    deviceKey,
    [...entry.latestByGateway.keys()],
    entry.latestByGateway.size,
  );

  return entry;
}

function getMultiGatewaySummary(deviceKey) {
  const entry = deviceReceptions.get(deviceKey);
  if (!entry) {
    return {
      gatewayCount: 0,
      gateways: [],
      bestGateway: null,
      bestRssi: null,
      isMultiGateway: false,
    };
  }

  const latestEvents = [];
  entry.latestByGateway.forEach((value, gateway) => {
    if (Date.now() - value.time <= MULTI_RX_WINDOW) {
      latestEvents.push({ gateway, ...value });
    }
  });

  latestEvents.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  return {
    gatewayCount: latestEvents.length,
    gateways: latestEvents.map((item) => item.gateway),
    bestGateway: latestEvents[0]?.gateway || null,
    bestRssi: latestEvents[0]?.rssi ?? null,
    isMultiGateway: latestEvents.length >= 2,
  };
}

function pruneDeviceReceptions() {
  const now = Date.now();
  deviceReceptions.forEach((entry, key) => {
    entry.recentEvents = entry.recentEvents.filter(
      (event) => now - event.time <= MULTI_RX_WINDOW,
    );

    entry.latestByGateway.forEach((value, gateway) => {
      if (now - value.time > MULTI_RX_WINDOW) {
        entry.latestByGateway.delete(gateway);
      }
    });

    if (!entry.recentEvents.length && !entry.latestByGateway.size) {
      deviceReceptions.delete(key);
    }
  });
}
function topDatr(counts) {
  let best = null;
  let bestCount = 0;
  for (const [key, value] of Object.entries(counts || {})) {
    if (value > bestCount) {
      best = key;
      bestCount = value;
    }
  }
  return best || "-";
}

function createSensorPosition(gateway, message) {
  const jitter = () => (Math.random() - 0.5) * 0.00042;

  const deviceEui = normalizeEui(message.device_eui);
  const known = knownSensors.get(deviceEui);

  const latitude = known ? known.latitude : gateway.latitude + jitter();
  const longitude = known ? known.longitude : gateway.longitude + jitter();

  return {
    latitude,
    longitude,
    name:
      message.device_name ||
      message.device_eui ||
      message.device_addr ||
      "unknown sensor",
    rssi: message.rssi,
    snr: message.lsnr,
    datr: message.datr || null,
    gateway: gateway.name,
    gatewayAddress: message.gateway,
    altitude: sensorAltitude(message, gateway, known),
    lastPayload: message.size || 0,
    lastSeen: Date.now(),
    room: known?.room || null,
    floor: known?.floor || null,
    knownLocation: Boolean(known),
  };
}

function sensorAltitude(message, gateway, knownSensor = null) {
  const value =
    message.altitude ?? message.elevation ?? message.height ?? message.z;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const knownAltitude = Number(knownSensor?.altitude);
  if (Number.isFinite(knownAltitude)) return knownAltitude;

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

  point.symbol = pointSymbol(
    rssiColor(sensor.rssi),
    sensor.multiGateway ? "#123040" : "#ffffff",
    sensor.multiGateway ? 20 : 10,
  );

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
    room: sensor.room || "n/a",
    floor: sensor.floor || "n/a",
    locationType: sensor.knownLocation
      ? "Known sensor CSV"
      : "Estimated near gateway",
    multiGateway: sensor.multiGateway ? "Yes" : "No",
    gatewayCount: sensor.gatewayCount || 1,
    gatewayList: (sensor.gatewayList || [])
      .map((id) => GATEWAYS[id]?.name || id)
      .join(", "),
    bestGateway:
      GATEWAYS[sensor.bestGateway]?.name || sensor.bestGateway || "n/a",
    bestRssi: sensor.bestRssi ?? "n/a",
    datr: sensor.datr || "n/a",
  };

  point.popupTemplate = {
    title: "{name}",
    content:
      "Gateway: {gateway}<br>" +
      "Location source: {locationType}<br>" +
      "Room: {room}<br>" +
      "Floor: {floor}<br>" +
      "Height: {altitude} m<br>" +
      "RSSI: {rssi} dBm<br>" +
      "SNR: {snr} dB<br>" +
      "Payload: {payload} bytes<br>" +
      "Multi-gateway: {multiGateway}<br>" +
      "Seen by: {gatewayCount} gateways<br>" +
      "Best gateway: {bestGateway}<br>" +
      "Best RSSI: {bestRssi} dBm<br>" +
      "Gateways: {gatewayList}<br>" +
      "Data rate: {datr}<br>" +
      "Last: {lastSeen}",
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
    const datrCounts = {};

    Object.values(stats.perGateway).forEach((bucket) => {
      packets += bucket.packets;
      rssiSum += bucket.rssiSum;
      rssiCount += bucket.rssiCount;
      snrSum += bucket.snrSum;
      snrCount += bucket.snrCount;

      bucket.devices.forEach((device) => devices.add(device));

      Object.entries(bucket.datrCounts || {}).forEach(([key, value]) => {
        datrCounts[key] = (datrCounts[key] || 0) + value;
      });

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
      datrCounts,
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
    const datrCounts = {};

    ravKeys.forEach((key) => {
      const bucket = stats.perGateway[key];
      if (!bucket) return;

      packets += bucket.packets;
      rssiSum += bucket.rssiSum;
      rssiCount += bucket.rssiCount;
      snrSum += bucket.snrSum;
      snrCount += bucket.snrCount;

      bucket.devices.forEach((device) => devices.add(device));

      Object.entries(bucket.datrCounts || {}).forEach(([key, value]) => {
        datrCounts[key] = (datrCounts[key] || 0) + value;
      });

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
      datrCounts,
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
      datrCounts: {},
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
  setText("best-datr", topDatr(scopeStats.datrCounts));
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
