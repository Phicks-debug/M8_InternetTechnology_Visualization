const CENTER = { latitude: 52.2405, longitude: 6.854 }
const FLOW_TIMEOUT = 7000
const SENSOR_TIMEOUT = 60000
const MARKER_DISPLAY_OFFSET = 20
const WS_URL = 'ws://192.87.172.82:1337'
const BUILDINGS_ITEM_ID = 'c444b24b184c4523a5dc96248bfea4e1'

const GATEWAYS = {
  'a8:40:41:1e:ad:fc:41:50': { name: 'Meander', latitude: 52.236887101823, longitude: 6.859867572784425, altitude: 4 },
  'a8:40:41:1e:e8:90:41:50': { name: 'Vrijhof', latitude: 52.243762, longitude: 6.853425, altitude: 3 },
  '00:00:02:4b:08:03:01:bf': { name: 'Spiegel', latitude: 52.23989, longitude: 6.85014, altitude: 54 },
  'a8:40:41:1e:ae:00:41:50': { name: 'Ravelijn-A', latitude: 52.23923592912191, longitude: 6.855506300926209, altitude: 4 },
  'a8:40:41:1e:da:56:c4:15:00': { name: 'Ravelijn-B', latitude: 52.23913, longitude: 6.85565, altitude: 6 },
}

const stats = {
  total: 0,
  devices: new Set(),
  lastTime: null,
  perGateway: {},
  totalBytes: 0,
  source: 'Connecting',
}

const sensors = new Map()
const flows = []
const buildingActivity = new Map()
const gatewayBuildingIds = new Map()
let buildingRendererUpdate = null
let activeBuildingsLayer = null

window.require([
  'esri/Map',
  'esri/views/SceneView',
  'esri/layers/SceneLayer',
  'esri/layers/GraphicsLayer',
  'esri/Graphic',
  'esri/geometry/Point',
  'esri/geometry/Polyline',
], (
  ArcGISMap,
  SceneView,
  SceneLayer,
  GraphicsLayer,
  Graphic,
  Point,
  Polyline
) => {
  const buildingsLayer = new SceneLayer({
    portalItem: { id: BUILDINGS_ITEM_ID },
    title: 'Open 3D Buildings',
    opacity: 0.56,
  })

  const gatewayLayer = new GraphicsLayer({
    title: 'Gateways',
    elevationInfo: { mode: 'relative-to-ground' },
  })

  const sensorLayer = new GraphicsLayer({
    title: 'Sensors',
    elevationInfo: { mode: 'relative-to-ground' },
  })

  const flowLayer = new GraphicsLayer({
    title: 'Packet flow',
    elevationInfo: { mode: 'relative-to-ground' },
  })

  const map = new ArcGISMap({
    basemap: 'topo-vector',
    ground: 'world-elevation',
    layers: [buildingsLayer, flowLayer, gatewayLayer, sensorLayer],
  })

  activeBuildingsLayer = buildingsLayer

  const view = new SceneView({
    container: 'view',
    map,
    qualityProfile: 'low',
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
      background: { type: 'color', color: [244, 249, 247, 1] },
      lighting: {
        type: 'sun',
        date: new Date('2026-05-21T10:30:00+02:00'),
        directShadowsEnabled: false,
        ambientOcclusionEnabled: false,
      },
    },
    popup: {
      dockEnabled: true,
      dockOptions: { position: 'bottom-right', buttonEnabled: false },
    },
    ui: {
      components: ['zoom', 'navigation-toggle', 'compass', 'attribution'],
    },
  })

  view.when(() => {
    addGateways(Graphic, Point, Polyline, gatewayLayer)
    prepareBuildingStyling(buildingsLayer, Point)
    connectWS({ Graphic, Point, Polyline, sensorLayer, flowLayer })
    setInterval(() => pruneSensors(sensorLayer), 5000)
    setInterval(decayBuildingActivity, 1800)
    requestAnimationFrame(() => animateFlows(Point))
    updateStats()
  })
})

function addGateways(Graphic, Point, Polyline, layer) {
  Object.entries(GATEWAYS).forEach(([address, gateway]) => {
    const visibleAltitude = displayAltitude(gateway.altitude)
    const stem = new Graphic({
      geometry: new Polyline({
        hasZ: true,
        paths: [[
          [gateway.longitude, gateway.latitude, gateway.altitude],
          [gateway.longitude, gateway.latitude, visibleAltitude],
        ]],
        spatialReference: { wkid: 4326 },
      }),
      symbol: stemSymbol(),
      attributes: { type: 'Gateway stem', address },
    })
    const point = new Graphic({
      geometry: new Point({
        latitude: gateway.latitude,
        longitude: gateway.longitude,
        z: visibleAltitude,
      }),
      symbol: pointSymbol('#0877b9', '#ffffff', 11),
      attributes: { type: 'Gateway', name: gateway.name, address, altitude: gateway.altitude },
      popupTemplate: {
        title: '{name}',
        content: 'Gateway<br>Address: {address}<br>Altitude: {altitude} m',
      },
    })
    layer.addMany([stem, point])
  })
}

function connectWS(context) {
  setSource('Connecting')

  let ws
  try {
    ws = new WebSocket(WS_URL)
  } catch {
    startDemoTraffic(context)
    return
  }

  const fallback = window.setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) startDemoTraffic(context)
  }, 2500)

  ws.onopen = () => {
    window.clearTimeout(fallback)
    stopDemoTraffic()
    setSource('Live')
  }

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data), context)
    } catch (error) {
      console.error('Could not parse websocket message:', error)
    }
  }

  ws.onclose = () => {
    setSource('Demo')
    startDemoTraffic(context)
    setTimeout(() => connectWS(context), 6000)
  }

  ws.onerror = () => {
    setSource('Demo')
    startDemoTraffic(context)
  }
}

let demoTimer = null

function startDemoTraffic(context) {
  if (demoTimer) return
  setSource('Demo')

  demoTimer = window.setInterval(() => {
    const [gateway] = randomEntry(GATEWAYS)
    const deviceNumber = Math.floor(1 + Math.random() * 16)
    handleMessage({
      gateway,
      device_name: `sensor-${String(deviceNumber).padStart(2, '0')}`,
      device_eui: `demo-${deviceNumber}`,
      rssi: -68 - Math.floor(Math.random() * 48),
      lsnr: Number((Math.random() * 9 - 2).toFixed(1)),
      size: 8 + Math.floor(Math.random() * 52),
    }, context)
  }, 1200)
}

function stopDemoTraffic() {
  if (!demoTimer) return
  window.clearInterval(demoTimer)
  demoTimer = null
}

function handleMessage(message, context) {
  const gateway = GATEWAYS[message.gateway]
  if (!gateway) return

  const deviceKey = message.device_eui || message.device_addr || message.device_name
  if (!deviceKey) return

  const sensor = createSensorPosition(gateway, message)
  sensors.set(deviceKey, sensor)

  updateSensorGraphic(deviceKey, sensor, context.Graphic, context.Point, context.Polyline, context.sensorLayer)
  createFlow(sensor, gateway, context.Graphic, context.Point, context.Polyline, context.flowLayer)
  recordBuildingActivity(message.gateway)

  stats.total += 1
  stats.devices.add(deviceKey)
  stats.lastTime = Date.now()
  stats.totalBytes += message.size || 0
  stats.perGateway[gateway.name] = (stats.perGateway[gateway.name] || 0) + 1
  updateStats()
}

function createSensorPosition(gateway, message) {
  const jitter = () => (Math.random() - 0.5) * 0.00042
  return {
    latitude: gateway.latitude + jitter(),
    longitude: gateway.longitude + jitter(),
    name: message.device_name || message.device_eui || message.device_addr || 'unknown sensor',
    rssi: message.rssi,
    snr: message.lsnr,
    gateway: gateway.name,
    gatewayAddress: message.gateway,
    altitude: sensorAltitude(message, gateway),
    lastPayload: message.size || 0,
    lastSeen: Date.now(),
  }
}

function sensorAltitude(message, gateway) {
  const value = message.altitude ?? message.elevation ?? message.height ?? message.z
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric

  // No sensor height is present in the current feed, so keep simulated sensors
  // near the installation height instead of lifting them above buildings.
  return Math.max(1.5, Math.min(8, gateway.altitude || 1.5))
}

function updateSensorGraphic(key, sensor, Graphic, Point, Polyline, layer) {
  const visibleAltitude = displayAltitude(sensor.altitude)
  const existingPoint = layer.graphics.find((graphic) => graphic.attributes?.key === key && graphic.attributes?.role === 'point')
  const existingStem = layer.graphics.find((graphic) => graphic.attributes?.key === key && graphic.attributes?.role === 'stem')
  const point = existingPoint || new Graphic({ attributes: { key, role: 'point' } })
  const stem = existingStem || new Graphic({ attributes: { key, role: 'stem' } })

  stem.geometry = new Polyline({
    hasZ: true,
    paths: [[
      [sensor.longitude, sensor.latitude, sensor.altitude],
      [sensor.longitude, sensor.latitude, visibleAltitude],
    ]],
    spatialReference: { wkid: 4326 },
  })
  stem.symbol = stemSymbol()
  stem.attributes = { key, role: 'stem' }

  point.geometry = new Point({
    latitude: sensor.latitude,
    longitude: sensor.longitude,
    z: visibleAltitude,
  })
  point.symbol = pointSymbol(rssiColor(sensor.rssi), '#ffffff', 10)
  point.attributes = {
    key,
    role: 'point',
    name: sensor.name,
    gateway: sensor.gateway,
    rssi: sensor.rssi ?? 'n/a',
    snr: sensor.snr ?? 'n/a',
    altitude: sensor.altitude,
    payload: sensor.lastPayload,
    lastSeen: new Date(sensor.lastSeen).toLocaleTimeString(),
  }
  point.popupTemplate = {
    title: '{name}',
    content: 'Gateway: {gateway}<br>Height: {altitude} m<br>RSSI: {rssi} dBm<br>SNR: {snr} dB<br>Payload: {payload} bytes<br>Last: {lastSeen}',
  }

  if (!existingStem) layer.add(stem)
  if (!existingPoint) layer.add(point)
}

function createFlow(sensor, gateway, Graphic, Point, Polyline, layer) {
  const path = curvedPath(sensor, gateway)
  const line = new Graphic({
    geometry: new Polyline({
      hasZ: true,
      paths: [path],
      spatialReference: { wkid: 4326 },
    }),
    symbol: {
      type: 'simple-line',
      color: [20, 139, 230, 0.55],
      width: 3,
    },
  })
  const packet = new Graphic({
    geometry: new Point({
      longitude: path[0][0],
      latitude: path[0][1],
      z: path[0][2],
    }),
    symbol: pointSymbol('#f6b43b', '#ffffff', 6),
  })

  layer.addMany([line, packet])
  flows.push({ path, line, packet, startedAt: performance.now() })
}

function animateFlows(Point) {
  const now = performance.now()

  for (let index = flows.length - 1; index >= 0; index -= 1) {
    const flow = flows[index]
    const progress = (now - flow.startedAt) / FLOW_TIMEOUT

    if (progress >= 1) {
      removeGraphic(flow.line)
      removeGraphic(flow.packet)
      flows.splice(index, 1)
      continue
    }

    const point = pointAlongPath(flow.path, progress)
    flow.packet.geometry = new Point({
      longitude: point[0],
      latitude: point[1],
      z: point[2],
    })
    flow.line.symbol = {
      type: 'simple-line',
      color: [20, 139, 230, Math.max(0.12, 0.5 - progress * 0.4)],
      width: 3,
    }
  }

  requestAnimationFrame(() => animateFlows(Point))
}

function pruneSensors(sensorLayer) {
  const now = Date.now()
  sensors.forEach((sensor, key) => {
    if (now - sensor.lastSeen <= SENSOR_TIMEOUT) return

    sensors.delete(key)
    const graphics = sensorLayer.graphics.filter((item) => item.attributes?.key === key)
    sensorLayer.removeMany(graphics)
  })

  updateStats()
}

function curvedPath(sensor, gateway) {
  const steps = 18
  const path = []
  const sensorZ = displayAltitude(sensor.altitude)
  const gatewayZ = displayAltitude(gateway.altitude)

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const longitude = lerp(sensor.longitude, gateway.longitude, t)
    const latitude = lerp(sensor.latitude, gateway.latitude, t)
    const lift = Math.sin(Math.PI * t) * 20
    const z = lerp(sensorZ, gatewayZ, t) + lift
    path.push([longitude, latitude, z])
  }

  return path
}

function pointAlongPath(path, progress) {
  const scaled = progress * (path.length - 1)
  const index = Math.min(path.length - 2, Math.floor(scaled))
  const local = scaled - index
  const start = path[index]
  const end = path[index + 1]

  return [
    lerp(start[0], end[0], local),
    lerp(start[1], end[1], local),
    lerp(start[2], end[2], local),
  ]
}

function pointSymbol(fill, outline, size) {
  return {
    type: 'point-3d',
    symbolLayers: [{
      type: 'icon',
      resource: { primitive: 'circle' },
      material: { color: fill },
      size,
      outline: { color: outline, size: 2 },
    }],
  }
}

function stemSymbol() {
  return {
    type: 'line-3d',
    symbolLayers: [{
      type: 'line',
      material: { color: [18, 48, 64, 0.74] },
      size: 1.4,
    }],
  }
}

function displayAltitude(altitude) {
  return altitude + MARKER_DISPLAY_OFFSET
}

function prepareBuildingStyling(buildingsLayer, Point) {
  buildingsLayer.load().then(() => {
    setDefaultBuildingRenderer(buildingsLayer)

    Object.entries(GATEWAYS).forEach(([address, gateway]) => {
      queryGatewayBuilding(buildingsLayer, Point, address, gateway)
    })
  }).catch((error) => {
    console.warn('Building activity styling could not initialize:', error)
  })
}

function queryGatewayBuilding(buildingsLayer, Point, address, gateway) {
  const query = buildingsLayer.createQuery()
  query.geometry = new Point({
    latitude: gateway.latitude,
    longitude: gateway.longitude,
    spatialReference: { wkid: 4326 },
  })
  query.distance = 45
  query.units = 'meters'
  query.spatialRelationship = 'intersects'
  query.outFields = [buildingsLayer.objectIdField]
  query.returnGeometry = false
  query.num = 4

  buildingsLayer.queryFeatures(query).then((result) => {
    const ids = result.features
      .map((feature) => feature.attributes?.[buildingsLayer.objectIdField])
      .filter((id) => id !== undefined && id !== null)

    if (ids.length) {
      gatewayBuildingIds.set(address, ids)
      scheduleBuildingRendererUpdate()
    }
  }).catch(() => {
    gatewayBuildingIds.set(address, [])
  })
}

function recordBuildingActivity(address) {
  const current = buildingActivity.get(address) || 0
  buildingActivity.set(address, Math.min(12, current + 2.4))
  scheduleBuildingRendererUpdate()
  updateActivityList()
}

function decayBuildingActivity() {
  let changed = false

  buildingActivity.forEach((value, address) => {
    const next = value * 0.82
    if (next < 0.2) {
      buildingActivity.delete(address)
    } else {
      buildingActivity.set(address, next)
    }
    changed = true
  })

  if (!changed) return

  scheduleBuildingRendererUpdate()
  updateActivityList()
}

function scheduleBuildingRendererUpdate() {
  if (buildingRendererUpdate || !activeBuildingsLayer) return

  buildingRendererUpdate = window.setTimeout(() => {
    buildingRendererUpdate = null
    updateBuildingRenderer()
  }, 120)
}

function updateBuildingRenderer() {
  if (!activeBuildingsLayer?.objectIdField) return

  const uniqueValueInfos = []
  buildingActivity.forEach((value, address) => {
    const ids = gatewayBuildingIds.get(address) || []
    const level = activityLevel(value)
    ids.forEach((id) => {
      uniqueValueInfos.push({
        value: id,
        symbol: buildingSymbol(level.building),
        label: `${GATEWAYS[address]?.name || 'Active building'} activity`,
      })
    })
  })

  activeBuildingsLayer.renderer = {
    type: 'unique-value',
    field: activeBuildingsLayer.objectIdField,
    defaultSymbol: buildingSymbol([226, 231, 224, 0.5]),
    uniqueValueInfos,
  }
}

function setDefaultBuildingRenderer(buildingsLayer) {
  buildingsLayer.renderer = {
    type: 'simple',
    symbol: buildingSymbol([226, 231, 224, 0.5]),
  }
}

function buildingSymbol(color) {
  return {
    type: 'mesh-3d',
    symbolLayers: [{
      type: 'fill',
      material: { color },
      edges: {
        type: 'solid',
        color: [120, 132, 126, 0.22],
        size: 0.45,
      },
    }],
  }
}

function activityLevel(value) {
  if (value > 7) {
    return {
      fill: [225, 75, 75, 0.36],
      outline: [225, 75, 75, 0.75],
      building: [225, 75, 75, 0.82],
      label: 'High',
    }
  }

  if (value > 3) {
    return {
      fill: [230, 163, 49, 0.34],
      outline: [230, 163, 49, 0.72],
      building: [230, 163, 49, 0.82],
      label: 'Medium',
    }
  }

  return {
    fill: [47, 127, 210, 0.3],
    outline: [47, 127, 210, 0.68],
    building: [47, 127, 210, 0.72],
    label: 'Low',
  }
}

function rssiColor(rssi) {
  if (!rssi || rssi <= -100) return '#e14b4b'
  if (rssi <= -80) return '#e6a331'
  return '#2fbf69'
}

function setSource(source) {
  stats.source = source
  updateStats()
}

function updateStats() {
  setText('total-msgs', stats.total)
  setText('active-devices', sensors.size)
  setText('last-msg', stats.lastTime ? new Date(stats.lastTime).toLocaleTimeString() : '-')
  setText('ws-status', stats.source)
  setText('source-mode', stats.source === 'Connecting' ? 'link' : 'feed')
  updateActivityList()
}

function updateActivityList() {
  const activity = document.getElementById('activity-list')
  if (!activity) return

  const rows = Object.entries(GATEWAYS)
    .map(([address, gateway]) => ({
      name: gateway.name,
      value: buildingActivity.get(address) || 0,
    }))
    .filter((row) => row.value > 0.2)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  activity.innerHTML = rows.length
    ? rows.map((row) => {
      const level = activityLevel(row.value)
      const width = Math.min(100, Math.round(row.value * 8))
      return `<div class="activity-row">
        <span>${row.name}</span>
        <div class="meter" title="${level.label} activity"><span style="width:${width}%"></span></div>
      </div>`
    }).join('')
    : '<div class="activity-row"><span>No recent building activity</span><strong>-</strong></div>'
}

function setText(id, value) {
  const element = document.getElementById(id)
  if (element) element.textContent = value
}

function randomEntry(value) {
  const entries = Object.entries(value)
  return entries[Math.floor(Math.random() * entries.length)]
}

function removeGraphic(graphic) {
  if (graphic?.layer) graphic.layer.remove(graphic)
}

function lerp(start, end, amount) {
  return start + (end - start) * amount
}
