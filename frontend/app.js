import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const state = {
  simID: null,
  streaming: false,
  streamInterval: null,
  ws: null,
  currentData: null,
  charts: {},
  polarData: null,
  sensorData: [],
};

const COLOR_MAPS = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26838f', '#1f9d8a', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma:  ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  jet:     ['#00007f', '#0000ff', '#007fff', '#00ffff', '#7fff7f', '#ffff00', '#ff7f00', '#ff0000', '#7f0000'],
  coolwarm:['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
};

function colormap(value, name = 'viridis', min = 0, max = 1) {
  const colors = COLOR_MAPS[name] || COLOR_MAPS.viridis;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const idx = t * (colors.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const c1 = new THREE.Color(colors[i]);
  const c2 = new THREE.Color(colors[Math.min(i + 1, colors.length - 1)]);
  return c1.lerp(c2, f);
}

function updateColorbarVisual(name) {
  const colors = COLOR_MAPS[name] || COLOR_MAPS.viridis;
  const visual = document.getElementById('colorbarVisual');
  visual.style.background = `linear-gradient(0deg, ${colors.join(', ')})`;
}

// ===== Three.js Scene Setup =====
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e17);
scene.fog = new THREE.Fog(0x0a0e17, 20, 80);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(8, 5, 10);

const container = document.getElementById('canvasContainer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 15, 10);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.3);
fillLight.position.set(-10, 5, -10);
scene.add(fillLight);

let gridHelper, windTunnelGroup, flowGroup, airfoilMesh, streamlineGroup;
let frameCount = 0, lastTime = performance.now(), fps = 0;

function initScene() {
  gridHelper = new THREE.GridHelper(20, 20, 0x2a3548, 0x1a2332);
  gridHelper.position.y = -2;
  scene.add(gridHelper);

  windTunnelGroup = new THREE.Group();
  const edges = [
    [[-10, -2, -4], [10, -2, -4]],
    [[-10, 4, -4], [10, 4, -4]],
    [[-10, -2, 4], [10, -2, 4]],
    [[-10, 4, 4], [10, 4, 4]],
    [[-10, -2, -4], [-10, 4, -4]],
    [[-10, -2, 4], [-10, 4, 4]],
    [[10, -2, -4], [10, 4, -4]],
    [[10, -2, 4], [10, 4, 4]],
    [[-10, -2, -4], [-10, -2, 4]],
    [[10, -2, -4], [10, -2, 4]],
    [[-10, 4, -4], [-10, 4, 4]],
    [[10, 4, -4], [10, 4, 4]],
  ];
  edges.forEach(([s, e]) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...s), new THREE.Vector3(...e)]);
    windTunnelGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5 })));
  });
  const inletGeom = new THREE.PlaneGeometry(8, 6);
  const inletMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
  const inlet = new THREE.Mesh(inletGeom, inletMat);
  inlet.position.set(-9.9, 1, 0);
  windTunnelGroup.add(inlet);
  scene.add(windTunnelGroup);

  flowGroup = new THREE.Group();
  scene.add(flowGroup);

  streamlineGroup = new THREE.Group();
  scene.add(streamlineGroup);

  createAirfoil();
}

function createAirfoil() {
  const naca = '0012';
  const m = parseInt(naca[0]) / 100, p = parseInt(naca[1]) / 10, t = parseInt(naca.slice(2)) / 100;
  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    let yc, dyc;
    if (p === 0) { yc = 0; dyc = 0; }
    else if (x < p) { yc = m / (p ** 2) * (2 * p * x - x ** 2); dyc = 2 * m / (p ** 2) * (p - x); }
    else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x ** 2); dyc = 2 * m / ((1 - p) ** 2) * (p - x); }
    const theta = Math.atan(dyc);
    pts.push([x - yt * Math.sin(theta), yc + yt * Math.cos(theta)]);
  }
  for (let i = 99; i >= 1; i--) {
    const x = i / 100;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    let yc, dyc;
    if (p === 0) { yc = 0; dyc = 0; }
    else if (x < p) { yc = m / (p ** 2) * (2 * p * x - x ** 2); dyc = 2 * m / (p ** 2) * (p - x); }
    else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x ** 2); dyc = 2 * m / ((1 - p) ** 2) * (p - x); }
    const theta = Math.atan(dyc);
    pts.push([x + yt * Math.sin(theta), yc - yt * Math.cos(theta)]);
  }
  const shape = new THREE.Shape();
  const scale = 4;
  shape.moveTo(pts[0][0] * scale - scale / 2, pts[0][1] * scale);
  pts.forEach((pt, i) => { if (i > 0) shape.lineTo(pt[0] * scale - scale / 2, pt[1] * scale); });
  const extrudeSettings = { depth: 2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.center();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x4a5568, metalness: 0.7, roughness: 0.3,
    clearcoat: 0.2, clearcoatRoughness: 0.4, side: THREE.DoubleSide,
  });
  airfoilMesh = new THREE.Mesh(geometry, material);
  airfoilMesh.position.set(0, 1, 0);
  airfoilMesh.rotation.z = THREE.MathUtils.degToRad(0);
  scene.add(airfoilMesh);
}

function rotateAirfoil(alphaDeg) {
  if (airfoilMesh) airfoilMesh.rotation.z = THREE.MathUtils.degToRad(-alphaDeg);
}

// ===== Flow Visualization =====
function clearFlow() {
  while (flowGroup.children.length) {
    const c = flowGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
      else c.material.dispose();
    }
  }
}

function updateVisualization(stateData) {
  clearFlow();
  const mode = document.getElementById('vizMode').value;
  const cmap = document.getElementById('colormap').value;
  updateColorbarVisual(cmap);

  const grid = stateData.grid || { nx: 16, ny: 12, nz: 4 };
  const vel = stateData.velocity || {};
  const mag = vel.magnitude || [];
  const p = stateData.pressure || [];
  const vort = stateData.vorticity || {};
  const vmag = vort.magnitude || [];

  if (mag.length === 0) return;
  const nz = mag.length, ny = mag[0]?.length || 0, nx = mag[0][0]?.length || 0;
  const sx = 18 / Math.max(nx, 1);
  const sy = 5 / Math.max(ny, 1);
  const sz = 7 / Math.max(nz, 1);

  let dataArray, maxV, minV, title;
  if (mode === 'pressure') { dataArray = p; title = '压力 Pressure'; }
  else if (mode === 'vorticity') { dataArray = vmag; title = '涡量 Vorticity'; }
  else { dataArray = mag; title = '速度大小 Velocity'; }

  document.getElementById('colorbarTitle').textContent = title;
  let allVals = [];
  dataArray.forEach(z => z.forEach(y => allVals.push(...y)));
  maxV = Math.max(...allVals, 1e-6);
  minV = Math.min(...allVals, 0);
  document.getElementById('colorMax').textContent = maxV.toFixed(3);
  document.getElementById('colorMin').textContent = minV.toFixed(3);

  if (mode === 'volume') {
    const positions = [], colors = [];
    const step = 1;
    for (let zi = 0; zi < nz; zi += step) {
      for (let yi = 0; yi < ny; yi += step) {
        for (let xi = 0; xi < nx; xi += step) {
          const v = dataArray[zi][yi][xi];
          if (v < (maxV - minV) * 0.05 + minV) continue;
          const x = (xi / (nx - 1)) * 18 - 9;
          const y = (yi / (ny - 1)) * 5 - 0.5;
          const z = (zi / (nz - 1)) * 7 - 3.5;
          positions.push(x, y, z);
          const c = colormap(v, cmap, minV, maxV);
          colors.push(c.r, c.g, c.b);
        }
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true });
    flowGroup.add(new THREE.Points(geom, mat));
  }
  else if (mode === 'slice') {
    const axis = document.getElementById('sliceAxis').value;
    const positions = [], colors = [], indices = [];
    const nSegs = 20;
    const xs = [], ys = [], zs = [];
    for (let i = 0; i <= nSegs; i++) { xs.push(i / nSegs); ys.push(i / nSegs); zs.push(i / nSegs); }
    const getV = (ai, bi) => {
      if (axis === 'z') {
        const zi = Math.floor(nz / 2);
        const xi = Math.floor(ai * (nx - 1)), yi = Math.floor(bi * (ny - 1));
        return dataArray[Math.min(zi, nz - 1)][Math.min(yi, ny - 1)][Math.min(xi, nx - 1)];
      } else if (axis === 'y') {
        const yi = Math.floor(ny / 2);
        const xi = Math.floor(ai * (nx - 1)), zi = Math.floor(bi * (nz - 1));
        return dataArray[Math.min(zi, nz - 1)][Math.min(yi, ny - 1)][Math.min(xi, nx - 1)];
      } else {
        const xi = Math.floor(nx / 2);
        const yi = Math.floor(ai * (ny - 1)), zi = Math.floor(bi * (nz - 1));
        return dataArray[Math.min(zi, nz - 1)][Math.min(yi, ny - 1)][Math.min(xi, nx - 1)];
      }
    };
    for (let j = 0; j <= nSegs; j++) {
      for (let i = 0; i <= nSegs; i++) {
        let x, y, z;
        if (axis === 'z') { x = xs[i] * 18 - 9; y = ys[j] * 5 - 0.5; z = 0; }
        else if (axis === 'y') { x = xs[i] * 18 - 9; y = 1; z = zs[j] * 7 - 3.5; }
        else { x = 0; y = ys[i] * 5 - 0.5; z = zs[j] * 7 - 3.5; }
        positions.push(x, y, z);
        const v = getV(xs[i], ys[j]);
        const c = colormap(v, cmap, minV, maxV);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nSegs; j++) {
      for (let i = 0; i < nSegs; i++) {
        const a = j * (nSegs + 1) + i;
        const b = a + 1, c = a + (nSegs + 1), d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9, shininess: 50 });
    flowGroup.add(new THREE.Mesh(geom, mat));
    const wire = new THREE.WireframeGeometry(geom);
    flowGroup.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.2 })));
  }
  else if (mode === 'streamline') {
    const u = vel.u || [], v = vel.v || [], w = vel.w || [];
    const nLines = 40;
    for (let li = 0; li < nLines; li++) {
      const startX = -9;
      const startY = (Math.random() - 0.1) * 5;
      const startZ = (Math.random() - 0.5) * 6;
      const pts = [];
      let x = startX, y = startY, z = startZ;
      const maxSteps = 200;
      for (let s = 0; s < maxSteps; s++) {
        pts.push(new THREE.Vector3(x, y, z));
        const xi = Math.floor(((x + 9) / 18) * (nx - 1));
        const yi = Math.floor(((y + 0.5) / 5) * (ny - 1));
        const zi = Math.floor(((z + 3.5) / 7) * (nz - 1));
        if (xi < 0 || xi >= nx || yi < 0 || yi >= ny || zi < 0 || zi >= nz) break;
        const vx = u[zi]?.[yi]?.[xi] || 0;
        const vy = v[zi]?.[yi]?.[xi] || 0;
        const vz = w[zi]?.[yi]?.[xi] || 0;
        const step = 0.15 / (Math.sqrt(vx * vx + vy * vy + vz * vz) + 0.01);
        x += vx * step;
        y += vy * step * 3;
        z += vz * step * 3;
        if (x > 9) break;
      }
      if (pts.length > 2) {
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const lineVel = dataArray.flat(2)[Math.floor(Math.random() * dataArray.flat(2).length)] || 0.5;
        const c = colormap(lineVel, cmap, minV, maxV);
        const mat = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.75 });
        streamlineGroup.add(new THREE.Line(geom, mat));
      }
    }
  }
}

// ===== WebSocket =====
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/api/ws`;
  state.ws = new WebSocket(url);
  state.ws.onopen = () => {
    document.getElementById('statusWS').classList.add('connected');
    sendWS({ type: 'list_simulations' });
    pollCFDHealth();
  };
  state.ws.onclose = () => {
    document.getElementById('statusWS').classList.remove('connected');
    setTimeout(connectWS, 2000);
  };
  state.ws.onerror = () => {};
  state.ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    handleWSMessage(msg);
  };
}

function sendWS(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
  }
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'simulation_created':
      state.simID = msg.payload.simulation_id;
      document.getElementById('simID').textContent = state.simID;
      updateCompareList();
      break;
    case 'state_updated':
    case 'stream_data':
    case 'state_data':
      const stateData = msg.payload.state || msg.payload;
      if (stateData) {
        state.currentData = stateData;
        document.getElementById('simStep').textContent = msg.payload.total_steps || 0;
        document.getElementById('simTime').textContent = (stateData.time || 0).toFixed(3) + 's';
        document.getElementById('hudRe').textContent = stateData.reynolds || '--';
        updateVisualization(stateData);
        while (streamlineGroup.children.length) {
          const c = streamlineGroup.children.pop();
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        }
      }
      break;
    case 'aerodynamics_data':
      updateAeroMetrics(msg.payload.forces);
      updatePressureChart(msg.payload.surface_pressure);
      break;
    case 'polar_data':
      state.polarData = msg.payload.polar_curve;
      updatePolarCharts(state.polarData);
      break;
    case 'comparison_data':
      updateCompareChart(msg.payload);
      break;
    case 'simulations_list':
      updateCompareListWithData(msg.payload.simulations);
      break;
    case 'simulation_reset':
      document.getElementById('simStep').textContent = '0';
      document.getElementById('simTime').textContent = '0.000s';
      break;
    case 'sensor_data_broadcast':
      addSensorReading(msg.payload);
      break;
    default:
      if (msg.error) console.warn('WS Error:', msg.type, msg.error);
  }
}

function pollCFDHealth() {
  fetch('/api/health').then(r => r.json()).then(d => {
    const dot = document.getElementById('statusCFD');
    if (d.cfd_status === 'ok') dot.classList.add('connected');
    else dot.classList.remove('connected');
  }).catch(() => {});
  setTimeout(pollCFDHealth, 5000);
}

// ===== Aero Metrics & Charts =====
function updateAeroMetrics(f) {
  document.getElementById('metricCL').textContent = f.CL.toFixed(4);
  document.getElementById('metricCD').textContent = f.CD.toFixed(5);
  document.getElementById('metricLD').textContent = f.L_D_ratio.toFixed(2);
  document.getElementById('metricCM').textContent = f.CM.toFixed(4);
}

function initCharts() {
  const commonOpts = (yLabel) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8a96ac', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' }, title: { display: true, text: '迎角 α (°)', color: '#8a96ac' } },
      y: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' }, title: { display: true, text: yLabel, color: '#8a96ac' } },
    },
  });
  state.charts.CLAlpha = new Chart(document.getElementById('chartCLAlpha'), {
    type: 'line', data: { labels: [], datasets: [{ label: 'CL', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3, pointRadius: 3 }] },
    options: commonOpts('CL'),
  });
  state.charts.CDAlpha = new Chart(document.getElementById('chartCDAlpha'), {
    type: 'line', data: { labels: [], datasets: [{ label: 'CD', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.3, pointRadius: 3 }] },
    options: commonOpts('CD'),
  });
  state.charts.LDAlpha = new Chart(document.getElementById('chartLDAlpha'), {
    type: 'line', data: { labels: [], datasets: [{ label: 'L/D', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.3, pointRadius: 3 }] },
    options: commonOpts('L/D'),
  });
  state.charts.Polar = new Chart(document.getElementById('chartPolar'), {
    type: 'scatter', data: { datasets: [{ label: 'CL-CD', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.5)', pointRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8a96ac', font: { size: 11 } } } },
      scales: {
        x: { type: 'linear', ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' }, title: { display: true, text: 'CD', color: '#8a96ac' } },
        y: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' }, title: { display: true, text: 'CL', color: '#8a96ac' } },
      },
    },
  });
  state.charts.Pressure = new Chart(document.getElementById('chartPressure'), {
    type: 'line', data: { labels: [], datasets: [
      { label: '上表面', data: [], borderColor: '#3b82f6', pointRadius: 2, tension: 0.4 },
      { label: '下表面', data: [], borderColor: '#ef4444', pointRadius: 2, tension: 0.4 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8a96ac', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' }, title: { display: true, text: 'x/c', color: '#8a96ac' } },
        y: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' }, title: { display: true, text: 'Cp', color: '#8a96ac' }, reverse: true },
      },
    },
  });
  state.charts.Compare = new Chart(document.getElementById('chartCompare'), {
    type: 'bar', data: { labels: [], datasets: [{ label: '对比值', data: [], backgroundColor: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'] }] },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' } },
        y: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' } },
      },
    },
  });
  state.charts.Sensor = new Chart(document.getElementById('chartSensor'), {
    type: 'line', data: { labels: [], datasets: [
      { label: '压力 P1', data: [], borderColor: '#3b82f6', pointRadius: 0, tension: 0.4 },
      { label: '温度 T1', data: [], borderColor: '#f59e0b', pointRadius: 0, tension: 0.4 },
      { label: '速度 V1', data: [], borderColor: '#10b981', pointRadius: 0, tension: 0.4 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#8a96ac', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#8a96ac', maxTicksLimit: 10 }, grid: { color: '#2a3548' } },
        y: { ticks: { color: '#8a96ac' }, grid: { color: '#2a3548' } },
      },
    },
  });
}

function updatePolarCharts(polar) {
  state.charts.CLAlpha.data.labels = polar.alphas;
  state.charts.CLAlpha.data.datasets[0].data = polar.CL;
  state.charts.CLAlpha.update();
  state.charts.CDAlpha.data.labels = polar.alphas;
  state.charts.CDAlpha.data.datasets[0].data = polar.CD;
  state.charts.CDAlpha.update();
  state.charts.LDAlpha.data.labels = polar.alphas;
  state.charts.LDAlpha.data.datasets[0].data = polar.L_D_ratio;
  state.charts.LDAlpha.update();
  state.charts.Polar.data.datasets[0].data = polar.CD.map((cd, i) => ({ x: cd, y: polar.CL[i] }));
  state.charts.Polar.update();
}

function updatePressureChart(surface) {
  const pts = surface.surface_points;
  const n = pts.length;
  const half = Math.floor(n / 2);
  const upper = pts.slice(0, half + 1);
  const lower = pts.slice(half).reverse();
  state.charts.Pressure.data.labels = upper.map(p => p.x.toFixed(3));
  state.charts.Pressure.data.datasets[0].data = upper.map(p => p.cp);
  state.charts.Pressure.data.datasets[1].data = lower.map(p => p.cp);
  state.charts.Pressure.update();
}

function updateCompareChart(data) {
  state.charts.Compare.data.labels = data.comparisons.map(c => c.simulation_id);
  state.charts.Compare.data.datasets[0].data = data.comparisons.map(c => c.metric_value);
  state.charts.Compare.update();
}

function updateCompareList() { sendWS({ type: 'list_simulations' }); }
function updateCompareListWithData(sims) {
  const container = document.getElementById('compareList');
  container.innerHTML = '';
  sims.forEach(s => {
    const div = document.createElement('div');
    div.className = 'compare-item';
    div.innerHTML = `<input type="checkbox" value="${s.id}" ${s.id === state.simID ? 'checked' : ''}><span>${s.id} (步:${s.steps})</span>`;
    container.appendChild(div);
  });
}

// ===== Sensors =====
const sensorDefs = [
  { id: 'P001', name: '总压管-Pitot', unit: 'Pa', loc: [0, 0, 0], key: 'pressure_total' },
  { id: 'P002', name: '静压传感器', unit: 'Pa', loc: [0, 1, 0], key: 'pressure_static' },
  { id: 'V001', name: '热线风速仪', unit: 'm/s', loc: [0, 2, 0], key: 'velocity' },
  { id: 'T001', name: '温度传感器', unit: '°C', loc: [1, 0, 0], key: 'temperature' },
  { id: 'F001', name: '天平-升力', unit: 'N', loc: [0, 0, 1], key: 'force_lift' },
  { id: 'F002', name: '天平-阻力', unit: 'N', loc: [0, 0, 2], key: 'force_drag' },
  { id: 'A001', name: '加速度计-X', unit: 'g', loc: [1, 1, 1], key: 'accel_x' },
  { id: 'A002', name: '加速度计-Y', unit: 'g', loc: [1, 1, 2], key: 'accel_y' },
];

function initSensorCards() {
  const grid = document.getElementById('sensorGrid');
  sensorDefs.forEach(s => {
    const div = document.createElement('div');
    div.className = 'sensor-card';
    div.innerHTML = `
      <div class="sid">${s.id}</div>
      <div class="sname">${s.name}</div>
      <div><span class="sval" id="sval_${s.id}">--</span><span class="sunit">${s.unit}</span></div>
      <div class="sloc">位置: (${s.loc.join(', ')})</div>
    `;
    grid.appendChild(div);
  });
}

function addSensorReading(data) {
  if (!data.measurements) return;
  state.sensorData.push(data);
  if (state.sensorData.length > 200) state.sensorData.shift();
  sensorDefs.forEach(s => {
    const v = data.measurements[s.key];
    if (v !== undefined) {
      const el = document.getElementById(`sval_${s.id}`);
      if (el) el.textContent = v.toFixed(3);
    }
  });
  if (state.sensorData.length % 5 === 0) {
    state.charts.Sensor.data.labels = state.sensorData.map((_, i) => i);
    state.charts.Sensor.data.datasets[0].data = state.sensorData.map(d => d.measurements.pressure_static || 0);
    state.charts.Sensor.data.datasets[1].data = state.sensorData.map(d => d.measurements.temperature || 0);
    state.charts.Sensor.data.datasets[2].data = state.sensorData.map(d => d.measurements.velocity || 0);
    state.charts.Sensor.update('none');
  }
}

function simulateSensor() {
  const alpha = parseFloat(document.getElementById('alpha').value) || 0;
  const re = parseFloat(document.getElementById('reynolds').value) || 1000;
  sensorDefs.forEach(s => {
    const base = {
      pressure_total: 101325 + re * 0.1 + Math.random() * 50,
      pressure_static: 101000 + re * 0.05 + Math.random() * 30,
      velocity: 10 + alpha * 0.2 + Math.random() * 0.5,
      temperature: 22 + Math.random() * 0.5,
      force_lift: Math.sin(alpha * Math.PI / 180) * 50 + Math.random() * 2,
      force_drag: (1 - Math.cos(alpha * Math.PI / 180)) * 20 + 5 + Math.random() * 1,
      accel_x: Math.random() * 0.1,
      accel_y: Math.random() * 0.05,
    };
    sendWS({
      type: 'sensor_data',
      payload: {
        sensor_id: s.id,
        location: s.loc,
        measurements: { [s.key]: base[s.key] },
      },
    });
  });
}

// ===== UI Events =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'charts') Object.values(state.charts).forEach(c => c.resize());
  });
});

document.getElementById('btnCreate').addEventListener('click', () => {
  const config = {
    reynolds: parseFloat(document.getElementById('reynolds').value) || 1000,
    free_stream: {
      u: parseFloat(document.getElementById('uinf').value) || 1,
      v: 0, w: 0,
    },
    grid: {
      nx: parseInt(document.getElementById('gridX').value) || 64,
      ny: parseInt(document.getElementById('gridY').value) || 48,
      nz: parseInt(document.getElementById('gridZ').value) || 16,
    },
    dt: 0.001,
  };
  sendWS({ type: 'create_simulation', payload: config });
});

document.getElementById('btnStep').addEventListener('click', () => {
  if (!state.simID) return alert('请先创建仿真');
  sendWS({ type: 'step_simulation', payload: { simulation_id: state.simID, steps: 5 } });
});

document.getElementById('btnReset').addEventListener('click', () => {
  if (!state.simID) return;
  sendWS({ type: 'reset_simulation', payload: { simulation_id: state.simID } });
});

document.getElementById('btnStream').addEventListener('click', (e) => {
  if (!state.simID) return alert('请先创建仿真');
  if (state.streaming) {
    sendWS({ type: 'stop_stream', payload: { simulation_id: state.simID } });
    state.streaming = false;
    e.target.textContent = '开始实时流';
    e.target.classList.remove('active');
    document.getElementById('statusWS').classList.remove('streaming');
  } else {
    const interval = parseInt(document.getElementById('interval').value) || 500;
    sendWS({ type: 'start_stream', payload: { simulation_id: state.simID, interval_ms: interval } });
    state.streaming = true;
    e.target.textContent = '停止实时流';
    e.target.classList.add('active');
    document.getElementById('statusWS').classList.add('streaming');
  }
});

document.getElementById('btnAnalyze').addEventListener('click', () => {
  if (!state.simID) return alert('请先创建仿真');
  const alpha = parseFloat(document.getElementById('alpha').value) || 0;
  sendWS({ type: 'get_aerodynamics', payload: { simulation_id: state.simID, alpha } });
  rotateAirfoil(alpha);
  document.getElementById('hudAlpha').textContent = alpha + '°';
});

document.getElementById('btnPolar').addEventListener('click', () => {
  if (!state.simID) return alert('请先创建仿真');
  const alphas = [];
  for (let a = -10; a <= 20; a += 2) alphas.push(a);
  sendWS({ type: 'get_polar', payload: { simulation_id: state.simID, alphas } });
});

document.getElementById('btnCompare').addEventListener('click', () => {
  if (!state.simID) return alert('请先创建仿真');
  const checked = [...document.querySelectorAll('#compareList input:checked')].map(i => i.value).filter(v => v !== state.simID);
  const metric = document.getElementById('compareMetric').value;
  const alpha = parseFloat(document.getElementById('alpha').value) || 0;
  sendWS({ type: 'compare_simulations', payload: { simulation_id: state.simID, compare_with: checked, metric, alpha } });
});

document.getElementById('btnSimSensor').addEventListener('click', () => {
  if (state._sensorTimer) {
    clearInterval(state._sensorTimer);
    state._sensorTimer = null;
    document.getElementById('btnSimSensor').textContent = '模拟传感器';
  } else {
    state._sensorTimer = setInterval(simulateSensor, 200);
    document.getElementById('btnSimSensor').textContent = '停止模拟';
  }
});

document.getElementById('vizMode').addEventListener('change', () => {
  if (state.currentData) updateVisualization(state.currentData);
});
document.getElementById('colormap').addEventListener('change', () => {
  if (state.currentData) updateVisualization(state.currentData);
});
document.getElementById('sliceAxis').addEventListener('change', () => {
  if (state.currentData && document.getElementById('vizMode').value === 'slice') updateVisualization(state.currentData);
});
document.getElementById('showGrid').addEventListener('change', (e) => {
  if (gridHelper) gridHelper.visible = e.target.checked;
});
document.getElementById('showAirfoil').addEventListener('change', (e) => {
  if (airfoilMesh) airfoilMesh.visible = e.target.checked;
});

document.getElementById('btnScreenshot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = `wind-tunnel-${Date.now()}.png`;
  link.href = renderer.domElement.toDataURL();
  link.click();
});

document.getElementById('btnExport').addEventListener('click', () => {
  const exportData = {
    simulation_id: state.simID,
    export_time: new Date().toISOString(),
    polar: state.polarData,
    state: state.currentData ? { time: state.currentData.time, reynolds: state.currentData.reynolds } : null,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `export-${Date.now()}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
});

// ===== Resize =====
function resize() {
  const rect = container.getBoundingClientRect();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height);
}
window.addEventListener('resize', resize);

// ===== Animate =====
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastTime = now;
    const fpsEl = document.getElementById('hudFPS');
    if (fpsEl) fpsEl.textContent = fps;
  }
}

// ===== Init =====
initScene();
initCharts();
initSensorCards();
resize();
animate();
connectWS();
