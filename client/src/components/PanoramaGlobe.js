import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import * as THREE from 'three';
import { buildAnglePixelMapping } from './panoramaMapping';

const SPHERE_RADIUS = 500;
const GRID_RADIUS = SPHERE_RADIUS * 0.995;
const LABEL_RADIUS = SPHERE_RADIUS * 0.97;
const GRATICULE_STEP_DEG = 10;
const KEY_STEP_ROT = 5;
const KEY_STEP_TILT = 5;

// Device (rotation, tilt) -> 3D point. tilt 90 = horizon (lat 0), tilt 0 = nadir
// (lat -90). Rotation increases to the right on screen (negative world x).
function dirFromAngles(rotation, tilt, radius) {
  const lat = THREE.MathUtils.degToRad(tilt - 90);
  const lon = THREE.MathUtils.degToRad(rotation);
  return new THREE.Vector3(
    -radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon)
  );
}

function makeLabelSprite(text) {
  const pad = 8;
  const font = 'bold 48px sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, pad, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(w * 0.6, h * 0.6, 1);
  return sprite;
}

const PanoramaGlobe = ({ panoramaUrl, frames, gridInfo, fov, height = 460 }) => {
  const mountRef = useRef(null);
  const viewApiRef = useRef(null);
  const [hoverCoords, setHoverCoords] = useState(null);
  const [viewCoords, setViewCoords] = useState(null);
  const [error, setError] = useState(null);
  const [canvasSide, setCanvasSide] = useState(height);

  const deviceFov = useMemo(() => (fov && fov > 5 ? fov : 60), [fov]);

  const mapping = useMemo(
    () => buildAnglePixelMapping(frames, gridInfo, fov),
    [frames, gridInfo, fov]
  );

  useEffect(() => {
    if (!panoramaUrl || !mapping) return undefined;
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    let renderer;
    let animationId;
    const cleanupFns = [];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101013);

    // The camera FoV is matched to the device FoV so the 3D view shows the same
    // angular window as a single camera shot (a natural, rectilinear view) rather
    // than a stretched ~180° fisheye. To make that hold horizontally *and*
    // vertically, the viewport is kept square (aspect = 1).
    const deviceFovLocal = deviceFov;
    const MAX_SIDE = height ? Math.max(height, 600) : 720;
    const getSize = () => {
      // Size to the available (parent) width so the square canvas exactly fills
      // its box; the box width is then matched to this side (no dark side bars).
      const avail = mount.parentElement?.clientWidth || mount.clientWidth || 600;
      const side = Math.max(200, Math.min(avail, MAX_SIDE));
      setCanvasSide(side);
      return { width: side, height: side };
    };

    const { width: w0, height: h0 } = getSize();
    const camera = new THREE.PerspectiveCamera(deviceFovLocal, w0 / h0, 1, 1100);
    camera.position.set(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w0, h0);
    mount.appendChild(renderer.domElement);

    // View direction (device rotation/tilt the camera looks at).
    const view = { rotation: 90, tilt: 60, fov: deviceFovLocal };

    viewApiRef.current = {
      resetFov: () => {
        view.fov = deviceFovLocal;
        camera.fov = deviceFovLocal;
        camera.updateProjectionMatrix();
        setViewCoords({ rotation: view.rotation, tilt: view.tilt, fov: view.fov });
      }
    };

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      panoramaUrl,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;

        const imgW = texture.image?.naturalWidth || texture.image?.width || gridInfo?.canvas_width;
        const imgH = texture.image?.naturalHeight || texture.image?.height || gridInfo?.canvas_height;
        if (!imgW || !imgH) {
          setError('Panorama-Größe unbekannt');
          return;
        }

        // Angular extent covered by the (cropped) panorama image.
        const corners = [
          mapping.fromPixelRaw(0, 0),
          mapping.fromPixelRaw(imgW, 0),
          mapping.fromPixelRaw(0, imgH),
          mapping.fromPixelRaw(imgW, imgH)
        ];
        const rots = corners.map((c) => c.rotation);
        const tilts = corners.map((c) => c.tilt);
        // Texture extent: the stitched image maps to an axis-aligned rectangle in
        // (rotation, tilt) for an equirectangular panorama. The textured mesh must
        // cover exactly this range, otherwise edge texels get clamped/stretched.
        const texRotMin = Math.min(...rots);
        const texRotMax = Math.max(...rots);
        const texTiltMin = Math.min(...tilts);
        const texTiltMax = Math.max(...tilts);
        // Full angular bounds (incl. camera FoV beyond the stitched pixels) drive
        // the graticule range and navigation limits, not the texture.
        const rotMin = mapping.bounds?.rotMin ?? texRotMin;
        const rotMax = mapping.bounds?.rotMax ?? texRotMax;
        const tiltMin = mapping.bounds?.tiltMin ?? texTiltMin;
        const tiltMax = mapping.bounds?.tiltMax ?? texTiltMax;

        view.rotation = (rotMin + rotMax) / 2;
        view.tilt = (tiltMin + tiltMax) / 2;
        view.bounds = { rotMin, rotMax, tiltMin, tiltMax };
        setViewCoords({ rotation: view.rotation, tilt: view.tilt, fov: view.fov });

        // Build a parametric sphere patch over the covered range with UVs that
        // map the panorama texture 1:1 (so the graticule lines align exactly).
        const Ni = 160;
        const Nj = 100;
        const positions = [];
        const uvs = [];
        const indices = [];
        for (let j = 0; j <= Nj; j++) {
          const tilt = texTiltMax - (j / Nj) * (texTiltMax - texTiltMin);
          for (let i = 0; i <= Ni; i++) {
            const rotation = texRotMin + (i / Ni) * (texRotMax - texRotMin);
            const p = dirFromAngles(rotation, tilt, SPHERE_RADIUS);
            const tex = mapping.toPixel(rotation, tilt);
            positions.push(p.x, p.y, p.z);
            uvs.push(
              THREE.MathUtils.clamp(tex.x / imgW, 0, 1),
              1 - THREE.MathUtils.clamp(tex.y / imgH, 0, 1)
            );
          }
        }
        const rowLen = Ni + 1;
        for (let j = 0; j < Nj; j++) {
          for (let i = 0; i < Ni; i++) {
            const a = j * rowLen + i;
            const b = a + 1;
            const c = a + rowLen;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
        cleanupFns.push(() => {
          geometry.dispose();
          material.dispose();
          texture.dispose();
        });

        // Graticule: lines of constant rotation and constant tilt. These curve
        // on the sphere and converge toward the nadir.
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
        const lineMatMajor = new THREE.LineBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.85 });
        cleanupFns.push(() => { lineMat.dispose(); lineMatMajor.dispose(); });

        const floorTo = (v, s) => Math.ceil(v / s) * s;
        const addLine = (pts, mat) => {
          const g = new THREE.BufferGeometry().setFromPoints(pts);
          const line = new THREE.Line(g, mat);
          scene.add(line);
          cleanupFns.push(() => g.dispose());
        };

        for (let rot = floorTo(rotMin, GRATICULE_STEP_DEG); rot <= rotMax; rot += GRATICULE_STEP_DEG) {
          const pts = [];
          for (let t = tiltMin; t <= tiltMax + 1e-6; t += 1) {
            pts.push(dirFromAngles(rot, t, GRID_RADIUS));
          }
          addLine(pts, rot % 90 === 0 ? lineMatMajor : lineMat);
          const label = makeLabelSprite(`${rot}°`);
          label.position.copy(dirFromAngles(rot, Math.min(tiltMax, view.tilt + 18), LABEL_RADIUS));
          scene.add(label);
          cleanupFns.push(() => { label.material.map.dispose(); label.material.dispose(); });
        }

        for (let tilt = floorTo(tiltMin, GRATICULE_STEP_DEG); tilt <= tiltMax; tilt += GRATICULE_STEP_DEG) {
          const pts = [];
          for (let r = rotMin; r <= rotMax + 1e-6; r += 1) {
            pts.push(dirFromAngles(r, tilt, GRID_RADIUS));
          }
          addLine(pts, tilt % 90 === 0 ? lineMatMajor : lineMat);
          const label = makeLabelSprite(`${tilt}°`);
          label.position.copy(dirFromAngles(rotMin + (rotMax - rotMin) * 0.04, tilt, LABEL_RADIUS));
          scene.add(label);
          cleanupFns.push(() => { label.material.map.dispose(); label.material.dispose(); });
        }
      },
      undefined,
      () => setError('Panorama konnte nicht geladen werden')
    );

    // Interaction: drag to look around, wheel to zoom (fov).
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const updatePointerCoords = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const target = raycaster.ray.at(SPHERE_RADIUS, new THREE.Vector3());
      const r = target.length();
      const lat = Math.asin(THREE.MathUtils.clamp(target.y / r, -1, 1));
      const lon = Math.atan2(-target.x, target.z);
      setHoverCoords({
        rotation: THREE.MathUtils.radToDeg(lon),
        tilt: THREE.MathUtils.radToDeg(lat) + 90
      });
    };

    const clampView = () => {
      if (view.bounds) {
        view.rotation = THREE.MathUtils.clamp(view.rotation, view.bounds.rotMin, view.bounds.rotMax);
        view.tilt = THREE.MathUtils.clamp(view.tilt, view.bounds.tiltMin, view.bounds.tiltMax);
      } else {
        view.tilt = THREE.MathUtils.clamp(view.tilt, -40, 140);
      }
    };

    const onPointerDown = (e) => {
      mount.focus();
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = () => { dragging = false; };
    const onPointerMove = (e) => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        const k = view.fov / 800;
        view.rotation -= dx * k * 60;
        view.tilt += dy * k * 60;
        clampView();
        setViewCoords({ rotation: view.rotation, tilt: view.tilt, fov: view.fov });
      }
      updatePointerCoords(e.clientX, e.clientY);
    };
    const onKeyDown = (e) => {
      let handled = false;
      switch (e.key) {
        case 'ArrowLeft':
          view.rotation -= KEY_STEP_ROT;
          handled = true;
          break;
        case 'ArrowRight':
          view.rotation += KEY_STEP_ROT;
          handled = true;
          break;
        case 'ArrowUp':
          view.tilt += KEY_STEP_TILT;
          handled = true;
          break;
        case 'ArrowDown':
          view.tilt -= KEY_STEP_TILT;
          handled = true;
          break;
        default:
          break;
      }
      if (!handled) return;
      e.preventDefault();
      clampView();
      setViewCoords({ rotation: view.rotation, tilt: view.tilt, fov: view.fov });
    };
    const onWheel = (e) => {
      e.preventDefault();
      view.fov = THREE.MathUtils.clamp(view.fov + Math.sign(e.deltaY) * 4, 10, 110);
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
      setViewCoords({ rotation: view.rotation, tilt: view.tilt, fov: view.fov });
    };
    const onLeave = () => setHoverCoords(null);

    const el = renderer.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerleave', onLeave);
    mount.addEventListener('keydown', onKeyDown);
    el.style.cursor = 'grab';
    el.style.touchAction = 'none';
    mount.focus();

    const onResize = () => {
      const { width, height: h } = getSize();
      renderer.setSize(width, h);
      camera.aspect = width / h || 1;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount.parentElement || mount);

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const look = dirFromAngles(view.rotation, view.tilt, 10);
      camera.lookAt(look);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      viewApiRef.current = null;
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerleave', onLeave);
      mount.removeEventListener('keydown', onKeyDown);
      cleanupFns.forEach((fn) => fn());
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [panoramaUrl, mapping, gridInfo, height, fov, deviceFov]);

  const currentFov = viewCoords?.fov ?? deviceFov;
  const fovAtDefault = Math.abs(currentFov - deviceFov) < 0.5;

  if (!mapping) {
    return (
      <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="body2" color="text.secondary">
          3D-Kugelansicht nur für equirektangulare Panoramen (Hugin/Grid) verfügbar.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        ref={mountRef}
        tabIndex={0}
        sx={{
          width: canvasSide,
          height: canvasSide,
          maxWidth: '100%',
          mx: 'auto',
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: '#101013',
          '& canvas': { display: 'block', borderRadius: 1 },
          '&:focus-visible': { boxShadow: '0 0 0 2px rgba(79, 195, 247, 0.8)' }
        }}
      />
      <Box
        sx={{
          mt: 1,
          px: 1.5,
          py: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap'
        }}
      >
        {error ? (
          <span style={{ color: '#f44336' }}>{error}</span>
        ) : (
          <>
            {hoverCoords ? (
              <>
                <span>Ziel Rot {hoverCoords.rotation.toFixed(1)}°</span>
                <span>Ziel Tilt {hoverCoords.tilt.toFixed(1)}°</span>
              </>
            ) : viewCoords ? (
              <>
                <span>Blick Rot {viewCoords.rotation.toFixed(1)}°</span>
                <span>Blick Tilt {viewCoords.tilt.toFixed(1)}°</span>
              </>
            ) : null}
            <span style={{ opacity: 0.7 }}>
              Blickwinkel ≈ {currentFov.toFixed(0)}° · Pfeiltasten · Ziehen · Mausrad
            </span>
            <Button
              size="small"
              variant="outlined"
              disabled={fovAtDefault}
              onClick={() => viewApiRef.current?.resetFov()}
              sx={{ ml: 'auto', fontFamily: 'inherit', fontSize: '0.75rem', py: 0.25 }}
            >
              Blickwinkel zurücksetzen
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
};

export default PanoramaGlobe;
