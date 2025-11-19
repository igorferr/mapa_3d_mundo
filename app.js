// app.js (module)
import * as THREE from "./three.module.js";
import { OrbitControls } from "./OrbitControls.js";

const container = document.getElementById("container");
const tooltip = document.getElementById("tooltip");
const searchInput = document.getElementById("search");
const selectArea = document.getElementById("select-area");
const selectCountry = document.getElementById("select-country");
const btnReset = document.getElementById("btn-reset");
const legend = document.getElementById("legend");

let scene, camera, renderer, controls;
let instancedMesh;
const dummy = new THREE.Object3D();

const DATA_URL = "./designers.json"; // coloque designers.json na mesma pasta
let rawData = [];
let visibleIndices = []; // indices que passam no filtro
let instCount = 0;
let areaColors = {};
const defaultColor = new THREE.Color(0x44aaff);
const hideScale = 0.0001;

init();

async function init(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0, -5, 35);

  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 5;
  controls.maxDistance = 200;

  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient);

  // plane (subtle)
  const planeGeo = new THREE.PlaneGeometry(60, 30, 1,1);
  const planeMat = new THREE.MeshBasicMaterial({color:0x071022});
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI/2;
  plane.position.z = -0.1;
  scene.add(plane);

  // load data
  await loadData();

  // create instanced pins
  createInstancedPins();

  // UI
  window.addEventListener("resize", onResize);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  searchInput.addEventListener("input", applyFiltersDebounced);
  selectArea.addEventListener("change", applyFilters);
  selectCountry.addEventListener("change", applyFilters);
  btnReset.addEventListener("click", resetFilters);

  animate();
}

// ---------- data utils ----------
async function loadData(){
  try {
    const res = await fetch(DATA_URL);
    rawData = await res.json();
  } catch(e) {
    console.error("Erro ao carregar designers.json", e);
    return;
  }

  // normalize lat/lon keys and filter valid coords
  rawData = rawData.map((d, i) => {
    const copy = {...d};
    if (Array.isArray(copy.coords) && copy.coords.length >= 2) {
      copy.lat = Number(copy.coords[0]);
      copy.lon = Number(copy.coords[1]);
    } else if (copy.lat === undefined && copy.latitude !== undefined) {
      copy.lat = Number(copy.latitude);
      copy.lon = Number(copy.longitude);
    } else if (copy.lat !== undefined && copy.lon !== undefined) {
      copy.lat = Number(copy.lat);
      copy.lon = Number(copy.lon);
    } else {
      copy.lat = null; copy.lon = null;
    }
    copy._idx = i;
    return copy;
  }).filter(d => d.lat !== null && !Number.isNaN(d.lat) && d.lon !== null && !Number.isNaN(d.lon));

  // build filters
  buildFilterOptions();
}

function buildFilterOptions(){
  const areas = new Set();
  const countries = new Set();
  rawData.forEach(d => {
    if (d.area) areas.add(d.area);
    if (d.pais) countries.add(d.pais);
    // also allow 'country'/'local' variants
    if (d.country) countries.add(d.country);
    if (d.localizacao && !d.pais && !d.country) {
      // sometimes localizacao contains country text; skip
    }
  });

  const areaList = Array.from(areas).sort();
  const countryList = Array.from(countries).sort();

  // assign colors for a few areas
  const palette = [
    0xFF6B6B,0x4D96FF,0x9B59B6,0xFFD66B,0x4EE39A,0xFF8C42,0xC0E0FF
  ];
  areaList.forEach((a,i) => areaColors[a] = new THREE.Color(palette[i % palette.length]));

  // populate selects
  areaList.forEach(a => {
    const o = document.createElement("option");
    o.value = a; o.textContent = a;
    selectArea.appendChild(o);
  });
  countryList.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    selectCountry.appendChild(o);
  });

  // legend
  legend.innerHTML = (areaList.slice(0,6).map(a => `<div style="display:inline-block;margin-right:8px;"><span style="display:inline-block;width:12px;height:12px;background:${areaColors[a].getStyle()};border-radius:3px;margin-right:6px;vertical-align:middle;"></span>${a}</div>`)).join("");
}

// ---------- projection ----------
/**
 * Simple equirectangular projection to plane.
 * We will map lon [-180..180] -> x, lat [-90..90] -> y
 */
const MAP_WIDTH = 40;
const MAP_HEIGHT = 20;
function projectLatLonToPlane(lat, lon){
  // clamp
  if (lat > 90) lat = 90;
  if (lat < -90) lat = -90;
  if (lon > 180) lon = lon - 360;
  if (lon < -180) lon = lon + 360;

  const x = (lon / 180) * (MAP_WIDTH/2);
  const y = (lat / 90) * (MAP_HEIGHT/2);
  // we keep z = 0
  return new THREE.Vector3(x, -y, 0); // invert y so north is up visually
}

// ---------- instancing ----------
function createInstancedPins(){
  const points = rawData;
  instCount = points.length;

  const geom = new THREE.SphereGeometry(0.18, 10, 10);
  const mat = new THREE.MeshStandardMaterial({metalness:0.2, roughness:0.6, color: defaultColor});
  instancedMesh = new THREE.InstancedMesh(geom, mat, instCount);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instancedMesh.userData = { rawData: points };

  // color attribute per instance (fallback)
  const colorArray = new Float32Array(instCount * 3);
  for (let i = 0; i < instCount; i++){
    const d = points[i];
    const pos = projectLatLonToPlane(d.lat, d.lon);
    dummy.position.copy(pos);
    dummy.scale.set(1,1,1);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);

    const col = areaColors[d.area] || defaultColor;
    colorArray[i*3+0] = col.r;
    colorArray[i*3+1] = col.g;
    colorArray[i*3+2] = col.b;
  }
  instancedMesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorArray, 3));
  // modify material to use instanceColor via onBeforeCompile
  instancedMesh.material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute vec3 instanceColor;\nvarying vec3 vInstanceColor;\nvoid main() { vInstanceColor = instanceColor;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      'varying vec3 vInstanceColor;\nvoid main() { vec3 diffuseColor = vInstanceColor;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      'gl_FragColor = vec4(outgoingLight * diffuseColor, 1.0);'
    );
  };

  scene.add(instancedMesh);

  // initially all visible
  visibleIndices = Array.from({length: instCount}, (_,i)=>i);
}

// ---------- interaction ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerMove(event){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = - ((event.clientY - rect.top) / rect.height) * 2 + 1;

  checkIntersections(event.clientX, event.clientY);
}

function checkIntersections(clientX, clientY){
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(instancedMesh);
  if (intersects.length > 0){
    const it = intersects[0];
    const id = it.instanceId;
    if (id !== undefined) {
      showTooltipForInstance(id, clientX, clientY);
      return;
    }
  }
  hideTooltip();
}

function onPointerDown(event){
  // could be used to lock selection or open detail panel
}

function showTooltipForInstance(id, clientX, clientY){
  const item = instancedMesh.userData.rawData[id];
  if (!item) return;
  const name = item.nome || item.name || "—";
  const area = item.area || item['área'] || "—";
  const loc = item.localizacao || item.local || (item.pais || item.country) || `${item.lat}, ${item.lon}`;
  const site = item.site || item.url || "";

  tooltip.classList.remove("hidden");
  tooltip.style.left = `${clientX + 12}px`;
  tooltip.style.top = `${clientY + 12}px`;
  tooltip.innerHTML = `<strong>${escapeHtml(name)}</strong><br/><small>${escapeHtml(area)} — ${escapeHtml(loc)}</small>
    ${site ? `<div style="margin-top:8px;"><a class="tooltip-link" href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">Abrir site</a></div>` : ""}`;
}

function hideTooltip(){
  tooltip.classList.add("hidden");
}

function escapeHtml(str){
  if (!str) return "";
  return String(str).replace(/[&<>"'`]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',"`":'&#96;'}[s]));
}

// ---------- filtering ----------
let filterTimeout = null;
function applyFiltersDebounced(){ clearTimeout(filterTimeout); filterTimeout = setTimeout(applyFilters, 180); }

function applyFilters(){
  const q = searchInput.value.trim().toLowerCase();
  const area = selectArea.value;
  const country = selectCountry.value;

  visibleIndices = [];
  for (let i=0;i<instCount;i++){
    const d = instancedMesh.userData.rawData[i];
    let ok = true;
    if (area && (!d.area || d.area !== area)) ok = false;
    if (country) {
      const c = (d.pais || d.country || "").toString();
      if (!c || c !== country) ok = false;
    }
    if (q) {
      const name = (d.nome || d.name || "").toString().toLowerCase();
      if (!name.includes(q)) ok = false;
    }
    if (ok) visibleIndices.push(i);
  }
  updateInstanceVisibility();
}

function updateInstanceVisibility(){
  // we'll set scale to 0 for hidden instances
  for (let i=0;i<instCount;i++){
    const d = instancedMesh.userData.rawData[i];
    const pos = projectLatLonToPlane(d.lat, d.lon);
    dummy.position.copy(pos);
    if (visibleIndices.includes(i)){
      dummy.scale.set(1,1,1);
    } else {
      dummy.scale.set(hideScale, hideScale, hideScale);
    }
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;
}

function resetFilters(){
  searchInput.value = "";
  selectArea.value = "";
  selectCountry.value = "";
  visibleIndices = Array.from({length: instCount}, (_,i)=>i);
  updateInstanceVisibility();
}

// ---------- resize & animate ----------
function onResize(){
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
