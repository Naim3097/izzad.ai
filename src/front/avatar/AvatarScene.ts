// The whole picture in one scene: wall, lettering, the avatar, its glass smoke and its paint.
// Composition, poses and smoke layout are taken from the reference art; see pipeline/avatar.
// Everything here is imperative three.js. React only owns the canvas it draws into.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Authored on the rig rather than played from motion capture, so they stay clean on a head this size. */
export type Gesture = 'wave' | 'cheer' | 'shake' | 'catch';

export interface SprayOptions {
  /** Leave a mark on the wall. Off when the target is something on the page rather than the wall itself. */
  mark?: boolean;
  /** Called the moment paint first reaches the target. */
  onLand?: () => void;
}

export interface Frame {
  /** Where the character's centre sits in the canvas, 0..1 from the top-left. */
  cx: number;
  cy: number;
  /** Character height as a fraction of the canvas height. */
  h: number;
}

export interface AvatarOptions {
  avatarUrl: string;
  smokeUrl: string;
  wallUrl: string;
  lettersUrl: string;
  reducedMotion: boolean;
  onReady: () => void;
  onError: (reason: string) => void;
}

// The posed character's bounding box, from the Blender build (metres; origin between the feet).
const BOX = { x: -0.023, y: 0.595, h: 1.152 };
const WALL_Z = -0.62;
const LETTERS_Z = WALL_Z + 0.05;
const PAINT_Z = WALL_Z + 0.06;
const SHADOW_Z = WALL_Z + 0.07;
// Lettering in the reference: 2.05 character-heights wide, centred a touch right of and below the character.
const LETTERS_W = 2.05 * BOX.h * 1.15; // widened to undo the perspective at the wall's depth
const LETTERS_ASPECT = 561 / 2000;
// The smoke was measured against the character's height; against the head it wants to be this much larger.
const SMOKE_SCALE = 1.06;
/** Draw order for the flat layers on the wall, back to front. Shadows go last so they fall across the paint too. */
const ON_WALL = { mist: 1, paint: 2, shadows: 3, spray: 4 };

/** Bones that carry procedural motion on top of the clip. */
const LAYERED = ['Spine', 'neck', 'Head', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightUpLeg', 'RightLeg', 'LeftUpLeg', 'LeftLeg'];

const damp = (current: number, target: number, lambda: number, dt: number) => current + (target - current) * (1 - Math.exp(-lambda * dt));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const backOut = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
/** 0 to 1 and back over a gesture: eases in over `a` seconds, holds, eases out over `b`. */
const envelope = (t: number, total: number, a: number, b: number) => (t < a ? ease(t / a) : t > total - b ? ease(Math.max(0, total - t) / b) : 1);
// How long each gesture runs, and how long it takes to ease in and out.
const LENGTH: Record<Gesture, number> = { wave: 1.9, cheer: 1.15, shake: 1.05, catch: 0.6 };
const LEAD: Record<Gesture, number> = { wave: 0.32, cheer: 0, shake: 0.16, catch: 0.1 };
const TAIL: Record<Gesture, number> = { wave: 0.4, cheer: 0, shake: 0.3, catch: 0.36 };
const CHEER = LENGTH.cheer;
// A spray: the arm comes up, the can sprays, the arm comes down. Paint takes FLIGHT to reach the wall,
// and the mark builds from that moment until the can stops.
const RAISE = 0.24;
const SWING = 0.14; // straight on from another spray, the arm is already up
const HOLD = 0.62;
const FLIGHT = 0.14;

interface Puff {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  scale: THREE.Vector3;
  phase: number;
  wisp: boolean;
  delay: number; // entrance stagger
}

interface Spray {
  t: number; // seconds since it became the current one
  target: THREE.Vector3; // where the paint lands
  aim: THREE.Vector3; // where the arm points
  color: string;
  mark: boolean;
  onLand?: () => void;
  landed: boolean;
  chained: boolean;
  splat: Splat | null;
}

interface Splat {
  group: THREE.Group;
  core: THREE.Mesh;
  spatter: THREE.Mesh;
  runs: THREE.Mesh[];
  size: number;
  cover: number; // how much paint has landed, 0..1, driven by the spray
  shown: number; // what is drawn, easing after `cover`
  ran: number; // seconds the runs have been creeping
  fade: number; // > 0 once it is being retired
  dispose: () => void;
}

export class AvatarScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  private clock = new THREE.Clock();
  private rig = new THREE.Group(); // turntable + float
  private mixer: THREE.AnimationMixer | null = null;
  private gesture: { kind: Gesture; t: number } | null = null;
  private greeted = false;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, THREE.Quaternion>();
  // The mixer only writes a bone when its clip value changes, so anything we add on top has to be
  // undone before we add it again: `clipPose` is what the clip asked for, `leftPose` what we left behind.
  private clipPose = new Map<string, THREE.Quaternion>();
  private leftPose = new Map<string, THREE.Quaternion>();

  private wall: THREE.Mesh;
  private shadowCatcher: THREE.Mesh;
  private letters: THREE.Mesh | null = null;
  private lettersShadow: THREE.Mesh | null = null;
  private smoke = new THREE.Group();
  private puffs: Puff[] = [];
  private drops: THREE.InstancedMesh;
  private dropState: { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number }[] = [];
  private splats: Splat[] = [];
  private runMap: THREE.CanvasTexture;
  private cone: THREE.Mesh; // the visible spray between the nozzle and the wall
  private proxy: THREE.Mesh;
  private raycaster = new THREE.Raycaster();

  private width = 1;
  private height = 1;
  private frameTo: Frame = { cx: 0.5, cy: 0.5, h: 0.6 };
  private frame: Frame = { cx: 0.5, cy: 0.5, h: 0.6 };
  private camDist = 5;
  private pointer = new THREE.Vector2(0, 0); // NDC
  private attention = 0; // 0 = holding the hero pose, 1 = following the pointer
  private lastMove = -10;
  private look = new THREE.Vector2(0, 0);
  private focusYaw = 0;
  private focusPitch = 0;
  private dragYaw = 0;
  private dragging = false;
  private releaseAt = 0;
  private yaw = 0;
  private hopT = -1;
  private nodT = -1;
  private pulse = 0; // the smoke swells when it cheers
  private spray: Spray | null = null;
  private queue: Spray[] = [];
  private aimWeight = 0;
  private aimNow = new THREE.Vector3();
  private w = { wave: 0, shake: 0, catch: 0 }; // gesture weights, eased
  private faceUntil = -1;
  private parallax = new THREE.Vector2();
  private time = 0;
  private bornAt = 0;
  private raf = 0;
  private running = false;
  private visible = true;
  private disposed = false;
  private ready = false;

  // scratch
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private v5 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private q3 = new THREE.Quaternion();
  private m1 = new THREE.Matrix4();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  private readonly identity = new THREE.Quaternion();

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: AvatarOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x06303d, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // the glass pass renders the scene twice
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.46;
    pmrem.dispose();

    // One strong key from the upper left, as in the reference, so forms turn from light into shadow.
    const key = new THREE.DirectionalLight(0xfff4e6, 3.3);
    key.position.set(-2.8, 3.4, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2.4;
    key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -1.6;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    const rim = new THREE.DirectionalLight(0xa8e2f2, 0.8);
    rim.position.set(3.0, 1.6, -2.4);
    const kick = new THREE.DirectionalLight(0xff8a3a, 0.5);
    kick.position.set(-2.6, -0.8, -1.2);
    this.scene.add(key, rim, kick, new THREE.HemisphereLight(0xd8eef5, 0x123f4d, 0.5));

    // The wall and lettering are finished art: shown as painted, with the scene's shadows laid over them.
    const loader = new THREE.TextureLoader();
    const wallMap = loader.load(opts.wallUrl);
    wallMap.colorSpace = THREE.SRGBColorSpace;
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: wallMap, toneMapped: false }));
    this.wall.position.z = WALL_Z;
    // Everything flat on the wall is drawn in a fixed order (ON_WALL), not by distance: with the camera tilted,
    // distance puts a mark high on the wall after the shadow layer in front of it, and the mark is lost.
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x00090d, opacity: 0.2, depthWrite: false }));
    this.shadowCatcher.position.z = SHADOW_Z;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.renderOrder = ON_WALL.shadows;
    this.scene.add(this.wall, this.shadowCatcher);
    loader.load(opts.lettersUrl, (map) => this.mountLetters(map));

    const mist = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.05), new THREE.MeshBasicMaterial({ map: mistTexture(), transparent: true, depthWrite: false, toneMapped: false }));
    mist.position.set(BOX.x + 0.26, BOX.y + 0.32, WALL_Z + 0.02);
    mist.renderOrder = ON_WALL.mist;
    this.scene.add(mist);

    this.scene.add(this.rig);
    this.smoke.position.set(BOX.x, BOX.y, 0);
    this.smoke.scale.setScalar(SMOKE_SCALE);
    this.scene.add(this.smoke);

    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.35, emissive: 0xf26a1b, emissiveIntensity: 0.3 }), 260);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.scene.add(this.drops);
    this.runMap = runTexture();
    // apex on the nozzle, opening toward the wall; densest where it leaves the can
    this.cone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xf26a1b, alphaMap: coneTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.cone.visible = false;
    this.cone.frustumCulled = false;
    this.cone.renderOrder = ON_WALL.spray;
    this.scene.add(this.cone);

    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.1, 0.6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.proxy.position.set(BOX.x, BOX.y, 0);
    this.rig.add(this.proxy);

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.load();
  }

  // ---- loading -------------------------------------------------------------

  private async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    try {
      const [avatar, smoke] = await Promise.all([loader.loadAsync(this.opts.avatarUrl), loader.loadAsync(this.opts.smokeUrl)]);
      if (this.disposed) return;
      this.mountAvatar(avatar);
      this.mountSmoke(smoke);
      this.ready = true;
      this.bornAt = this.time;
      this.renderer.compile(this.scene, this.camera);
      this.renderOnce();
      this.start();
      this.opts.onReady();
    } catch (e) {
      if (!this.disposed) this.opts.onError(e instanceof Error ? e.message : 'load failed');
    }
  }

  private mountLetters(map: THREE.Texture) {
    if (this.disposed) return;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // Cut out rather than blended, so the lettering stays in the opaque pass and shows through the glass.
    const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, toneMapped: false });
    this.letters = new THREE.Mesh(new THREE.PlaneGeometry(1, LETTERS_ASPECT), material);
    this.lettersShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, LETTERS_ASPECT * 1.24),
      new THREE.MeshBasicMaterial({ map: shadowTexture(map.image as HTMLImageElement), transparent: true, depthWrite: false, opacity: 0.62, toneMapped: false }),
    );
    this.scene.add(this.lettersShadow, this.letters);
    this.fitBackdrop();
    if (this.ready && !this.running) this.renderOnce();
  }

  private mountAvatar(gltf: GLTF) {
    const root = gltf.scene;
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.bones.set(o.name, o as THREE.Bone);
        this.rest.set(o.name, o.quaternion.clone());
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds are not worth trusting
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const std = m as THREE.MeshStandardMaterial;
          if (std.map) std.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        }
      }
    });
    this.rig.add(root);

    // One authored pose, held. Everything that moves after this is layered on top of it in update().
    this.mixer = new THREE.AnimationMixer(root);
    const hover = gltf.animations.find((c) => c.name === 'Hover');
    if (hover) this.mixer.clipAction(hover).play();
    this.mixer.update(0);
  }

  private mountSmoke(gltf: GLTF) {
    // The smoke is the reference sculpture itself, inflated into a relief (see pipeline/avatar), and it
    // arrives carrying the original painting as its base colour. Here it becomes frosted glass: mostly
    // transmission, so the wall and lettering show through blurred, with the painted pearl shading on top.
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.46,
      metalness: 0,
      transmission: 0.58,
      thickness: 0.45,
      ior: 1.18,
      attenuationColor: new THREE.Color(0xf2f8f9),
      attenuationDistance: 1.4,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      specularIntensity: 1,
      envMapIntensity: 1.9,
    });
    glass.onBeforeCompile = (shader) => {
      // a brighter edge where the surface turns away, which is what gives the reference its drawn outline
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float izzadRim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.4);
        outgoingLight += vec3(0.9, 0.94, 0.95) * izzadRim * 0.46;
        #include <opaque_fragment>`,
      );
    };
    glass.customProgramCacheKey = () => 'izzad-glass';

    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const painted = meshes.map((m) => (m.material as THREE.MeshStandardMaterial).map).find(Boolean);
    if (painted) {
      painted.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      glass.map = painted;
      // a little of the painting shows by its own light, so the pearl reads as painted whatever the key light is doing
      glass.emissiveMap = painted;
      glass.emissive.set(0xffffff);
      glass.emissiveIntensity = 0.24;
    }
    meshes.forEach((mesh, i) => {
      mesh.material = glass;
      this.smoke.add(mesh); // positions in the file are already relative to the character's box
      const wisp = /Wisp/.test(mesh.name);
      this.puffs.push({ mesh, home: mesh.position.clone(), scale: mesh.scale.clone(), phase: i * 1.7, wisp, delay: 0.12 + i * 0.045 });
      mesh.scale.setScalar(1e-4);
    });
  }

  // ---- public controls -----------------------------------------------------

  resize(width: number, height: number, frame: Frame) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.frameTo = frame;
    if (!this.ready) this.frame = { ...frame };
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.applyFrame();
    if (this.ready && !this.running) this.renderOnce();
  }

  /** Re-seat the character; the camera eases to the new framing. */
  setFrame(frame: Frame) {
    this.frameTo = frame;
  }

  /** Pointer in canvas pixels. The head follows it for a few seconds, then settles back into the pose. */
  setPointer(x: number, y: number) {
    this.pointer.set((x / this.width) * 2 - 1, -((y / this.height) * 2 - 1));
    this.lastMove = this.time;
  }

  /** Turn toward something off to one side: yaw and pitch in -1..1. */
  setFocus(yaw: number, pitch: number) {
    this.focusYaw = clamp(yaw, -1, 1);
    this.focusPitch = clamp(pitch, -1, 1);
    if (yaw || pitch) this.lastMove = this.time;
  }

  hitTest(x: number, y: number): boolean {
    if (!this.ready) return false;
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    return this.raycaster.intersectObject(this.proxy, false).length > 0;
  }

  dragStart() {
    this.dragging = true;
  }
  dragBy(dx: number) {
    this.dragYaw += dx * 0.009;
  }
  dragEnd() {
    this.dragging = false;
    this.releaseAt = this.time + 1.4;
  }

  /** Start a gesture. A new one cuts in on the last, except a spin, which has to land first. */
  perform(kind: Gesture) {
    if (!this.ready || this.opts.reducedMotion || this.gesture?.kind === 'cheer') return;
    this.gesture = { kind, t: 0 };
  }

  hop() {
    if (!this.opts.reducedMotion) this.hopT = 0;
  }

  /** A short nod, for when it speaks. */
  nod() {
    if (!this.opts.reducedMotion) this.nodT = 0;
  }

  /** Look straight out at the visitor for a moment, wherever the pointer is. */
  face(seconds = 1.6) {
    this.faceUntil = this.time + seconds;
  }

  /** Where a part of the avatar is on the canvas, in pixels. Null until the model is in. */
  anchor(part: 'hand' | 'head'): { x: number; y: number } | null {
    const bone = this.bones.get(part === 'hand' ? 'RightHand' : 'Head');
    if (!this.ready || !bone) return null;
    const p = bone.getWorldPosition(new THREE.Vector3()).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
  }

  /**
   * Aim the can at a point (canvas pixels) and spray it. Sprays queue, so nothing asked for is dropped
   * while the can is busy. Returns false only when there is no avatar to do it.
   */
  sprayAt(x: number, y: number, color: string, opts: SprayOptions = {}): boolean {
    if (!this.ready) return false;
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const ray = this.raycaster.ray;
    const hit = (z: number) => ray.direction.clone().multiplyScalar((z - ray.origin.z) / ray.direction.z).add(ray.origin);
    const next: Spray = { t: 0, target: hit(PAINT_Z), aim: hit(-0.1), color, mark: opts.mark ?? true, onLand: opts.onLand, landed: false, chained: false, splat: null };
    if (this.opts.reducedMotion || !this.running) {
      // no motion wanted, or nobody watching (the tab is in the background): the result simply appears
      if (next.mark) this.addSplat(next.target, color).cover = 1;
      next.onLand?.();
      return true;
    }
    if (!this.spray) this.begin(next);
    else {
      if (this.queue.length >= 3) this.queue.shift()?.onLand?.(); // never leave the page waiting on a spray that will not happen
      this.queue.push(next);
    }
    return true;
  }

  private begin(next: Spray) {
    const paint = this.drops.material as THREE.MeshStandardMaterial;
    paint.color.set(next.color);
    paint.emissive.set(next.color);
    (this.cone.material as THREE.MeshBasicMaterial).color.set(next.color);
    if (!next.chained) this.aimNow.copy(next.aim);
    this.spray = next;
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v) this.start();
    else this.stop();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.mixer?.stopAllAction();
    for (const s of this.splats) s.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    });
    this.scene.environment?.dispose();
    this.runMap.dispose();
    this.renderer.dispose();
  }

  // ---- framing -------------------------------------------------------------

  private applyFrame() {
    const f = this.frame;
    // Distance that makes the character `h` of the canvas tall, then a lens shift to seat it at (cx, cy).
    const visible = BOX.h / clamp(f.h, 0.15, 1);
    this.camDist = visible / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.setViewOffset(this.width, this.height, (0.5 - f.cx) * this.width, (0.5 - f.cy) * this.height, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.fitBackdrop();
  }

  /** Size the wall to cover the view, and the lettering to the reference's proportion, or to fit if the screen is narrow. */
  private fitBackdrop() {
    this.camera.position.set(0, BOX.y + 0.16, this.camDist);
    this.camera.lookAt(0, BOX.y, 0);
    this.camera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      this.v1.set(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
      const k = (WALL_Z - this.camera.position.z) / this.v1.z;
      const x = this.camera.position.x + this.v1.x * k;
      const y = this.camera.position.y + this.v1.y * k;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const cover = Math.max(w / 16, h / 9) * 1.14; // the wall art is 16:9; the margin covers the parallax
    for (const plane of [this.wall, this.shadowCatcher]) {
      plane.scale.set(16 * cover, 9 * cover, 1);
      plane.position.x = (minX + maxX) / 2;
      plane.position.y = (minY + maxY) / 2;
    }
    if (this.letters && this.lettersShadow) {
      // Keep the reference's proportion where it fits; shrink to fit when that costs little; past that, let the ends run off.
      const lw = Math.min(LETTERS_W, Math.max(w * 0.94, LETTERS_W * 0.7));
      this.letters.scale.set(lw, lw, 1);
      this.letters.position.set(BOX.x + 0.012, BOX.y - 0.02, LETTERS_Z);
      this.lettersShadow.scale.set(lw, lw, 1);
      this.lettersShadow.position.set(BOX.x + 0.012 + lw * 0.017, BOX.y - 0.02 - lw * 0.024, LETTERS_Z - 0.012);
    }
  }

  // ---- loop ----------------------------------------------------------------

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.stop();
    this.opts.onError('context lost');
  };

  private onVisibility = () => {
    if (document.hidden) {
      this.stop();
      this.settleSprays();
    } else if (this.visible) this.start();
  };

  /** Finish every spray in hand at once, so nothing on the page is left waiting on an animation that has stopped. */
  private settleSprays() {
    for (const s of [this.spray, ...this.queue]) {
      if (!s) continue;
      if (s.mark && !s.splat) s.splat = this.addSplat(s.target, s.color);
      if (s.splat) s.splat.cover = 1;
      if (!s.landed) s.onLand?.();
    }
    this.spray = null;
    this.queue = [];
  }

  private start() {
    if (this.running || !this.ready || this.disposed || document.hidden || !this.visible) return;
    this.running = true;
    this.clock.getDelta();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = () => {
    if (!this.running) return;
    this.update(Math.min(this.clock.getDelta(), 1 / 20));
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };

  private renderOnce() {
    this.update(0);
    this.renderer.render(this.scene, this.camera);
  }

  private ndc(x: number, y: number) {
    return new THREE.Vector2((x / this.width) * 2 - 1, -((y / this.height) * 2 - 1));
  }

  /** Rotate a bone about an axis given in world space. */
  private turn(name: string, axis: THREE.Vector3, angle: number) {
    const bone = this.bones.get(name);
    if (!bone || !bone.parent || Math.abs(angle) < 1e-5) return;
    bone.parent.getWorldQuaternion(this.q1);
    this.q2.setFromAxisAngle(axis, angle);
    this.q3.copy(this.q1).invert().multiply(this.q2).multiply(this.q1);
    bone.quaternion.premultiply(this.q3);
  }

  private update(dt: number) {
    const calm = this.opts.reducedMotion;
    this.time += dt;
    const t = this.time;

    // -- framing eases to its target (the character steps back when an answer opens beneath it)
    const f = this.frame;
    const g = this.frameTo;
    if (Math.abs(f.cx - g.cx) + Math.abs(f.cy - g.cy) + Math.abs(f.h - g.h) > 0.0005) {
      f.cx = damp(f.cx, g.cx, 6, dt);
      f.cy = damp(f.cy, g.cy, 6, dt);
      f.h = damp(f.h, g.h, 6, dt);
      this.applyFrame();
    }

    // -- attention: follow the pointer while it moves, then relax back into the pose
    const facing = !calm && t < this.faceUntil;
    const attentive = !calm && (facing || t - this.lastMove < 3.2);
    this.attention = damp(this.attention, attentive ? 1 : 0, attentive ? 5 : 1.6, dt);

    // -- camera: a little parallax so wall, lettering, character and smoke separate
    this.parallax.x = damp(this.parallax.x, calm || facing ? 0 : this.pointer.x * this.attention, 3, dt);
    this.parallax.y = damp(this.parallax.y, calm || facing ? 0 : this.pointer.y * this.attention, 3, dt);
    this.camera.position.set(this.parallax.x * 0.3, BOX.y + 0.16 + this.parallax.y * 0.14, this.camDist);
    this.camera.lookAt(0, BOX.y, 0);

    // -- turntable: drag, then drift home; lean toward whatever has focus
    if (!this.dragging && t > this.releaseAt) this.dragYaw = damp(this.dragYaw, 0, 2.2, dt);
    const sprayYaw = this.spray ? clamp(this.spray.aim.x * 0.4, -0.55, 0.55) : 0;
    // the whole body leans after the pointer a little, not just the head
    this.yaw = damp(this.yaw, this.dragYaw + this.focusYaw * 0.36 + sprayYaw + this.parallax.x * 0.2, 6, dt);

    // -- gestures run on their own clocks; their weights ease, so one can cut in on another without a pop
    const act = this.gesture;
    let cheer = 0;
    let spin = 0;
    if (act) {
      act.t += dt;
      if (act.t >= LENGTH[act.kind]) this.gesture = null;
      else if (act.kind === 'cheer') {
        cheer = Math.sin((act.t / CHEER) * Math.PI);
        spin = ease(act.t / CHEER) * Math.PI * 2;
      }
    }
    const level = (k: 'wave' | 'shake' | 'catch') => (this.gesture?.kind === k ? envelope(this.gesture.t, LENGTH[k], LEAD[k], TAIL[k]) : 0);
    this.w.wave = damp(this.w.wave, level('wave'), 16, dt);
    this.w.shake = damp(this.w.shake, level('shake'), 18, dt);
    this.w.catch = damp(this.w.catch, level('catch'), 20, dt);
    if (!calm && !this.greeted && t - this.bornAt > 1.1) {
      this.greeted = true;
      this.perform('wave'); // hello
    }
    this.pulse = damp(this.pulse, cheer, 9, dt);

    // -- the hover: it hangs in the air, so nothing is ever quite still
    const hw = calm ? 0 : 1;
    let y = (calm ? 0 : Math.sin(t * 1.15) * 0.032 + Math.sin(t * 0.53 + 1) * 0.014) + cheer * 0.2 - this.w.catch * 0.07;
    let squash = 1;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const k = this.hopT / 0.62;
      if (k >= 1) this.hopT = -1;
      else {
        y += Math.sin(k * Math.PI) * 0.2;
        squash = 1 + Math.sin(k * Math.PI * 2) * 0.05;
      }
    }
    // entrance: drops in from just above
    const arrive = calm ? 1 : backOut(clamp((t - this.bornAt) / 0.7, 0, 1));
    this.rig.position.set(this.parallax.x * 0.04 + Math.sin(t * 0.41) * 0.012 * hw, y + (1 - arrive) * 0.5, 0);
    this.rig.rotation.set(Math.sin(t * 0.9 + 1) * 0.026 * hw + this.w.catch * 0.16, this.yaw + spin, Math.sin(t * 0.7) * 0.036 * hw);
    this.rig.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    this.mixer?.update(dt);

    if (this.bones.size) {
      for (const name of LAYERED) {
        const bone = this.bones.get(name);
        if (!bone) continue;
        let clip = this.clipPose.get(name);
        const left = this.leftPose.get(name);
        if (!clip) this.clipPose.set(name, (clip = bone.quaternion.clone()));
        else if (left && bone.quaternion.equals(left)) bone.quaternion.copy(clip);
        else clip.copy(bone.quaternion);
      }

      this.rig.updateWorldMatrix(true, false);
      const fwd = this.v2.copy(this.axisZ).applyAxisAngle(this.axisY, this.yaw);
      const side = this.v3.copy(this.axisX).applyAxisAngle(this.axisY, this.yaw);

      // -- limbs drift while it hovers
      if (hw > 0.01) {
        this.turn('Spine', side, Math.sin(t * 1.6) * 0.02 * hw);
        this.turn('RightArm', fwd, Math.sin(t * 0.8) * 0.065 * hw);
        this.turn('LeftArm', fwd, Math.sin(t * 0.8 + 2.1) * 0.075 * hw);
        this.turn('LeftHand', fwd, Math.sin(t * 1.3 + 0.6) * 0.11 * hw);
        this.turn('RightUpLeg', side, Math.sin(t * 1.15 + 0.4) * 0.09 * hw);
        this.turn('RightLeg', side, Math.sin(t * 1.15 + 1.2) * 0.08 * hw);
        this.turn('LeftUpLeg', side, Math.sin(t * 1.15 + 3.3) * 0.1 * hw);
        this.turn('LeftLeg', side, Math.sin(t * 1.15 + 4.0) * 0.09 * hw);
      }

      // -- hello: the free hand goes up and the forearm does the waving
      const wave = this.w.wave;
      if (wave > 0.001) {
        this.turn('LeftArm', fwd, 1.2 * wave);
        this.turn('LeftForeArm', fwd, (0.45 + Math.sin(t * 11.5) * 0.36) * wave);
        this.turn('LeftHand', fwd, (0.62 + Math.sin(t * 11.5 - 0.7) * 0.22) * wave);
        this.turn('Head', fwd, -0.1 * wave);
      }
      // -- the rattle: the can comes up in front and gets a shake, the way you would before using it
      const shake = this.w.shake;
      if (shake > 0.001) {
        const rattle = Math.sin(t * 36);
        this.turn('RightArm', fwd, -0.2 * shake);
        this.turn('RightForeArm', side, (-0.8 + rattle * 0.14) * shake);
        this.turn('RightHand', side, rattle * 0.22 * shake);
      }
      // -- the catch: a quick dip toward whatever was just handed over
      const caught = this.w.catch;
      if (caught > 0.001) {
        this.turn('LeftArm', fwd, -0.3 * caught);
        this.turn('RightArm', fwd, 0.22 * caught);
      }
      // -- cheer: arms fly out and the knees tuck as it spins
      if (cheer > 0.001) {
        this.turn('RightArm', fwd, -0.55 * cheer);
        this.turn('LeftArm', fwd, 0.75 * cheer);
        this.turn('RightLeg', side, 0.5 * cheer);
        this.turn('LeftLeg', side, 0.6 * cheer);
      }

      // -- eyes on the pointer: offset from wherever the pose has the head facing, toward the cursor
      const head = this.bones.get('Head');
      const nose = this.bones.get('headfront');
      let tx = 0;
      let ty = 0;
      const pitchAxis = this.v5.copy(side);
      if (head && nose && this.attention > 0.001 && cheer < 0.01) {
        const at = head.getWorldPosition(this.v1);
        const to = nose.getWorldPosition(this.v4).sub(at);
        const yaw0 = Math.atan2(to.x, to.z);
        const pitch0 = Math.atan2(to.y, Math.hypot(to.x, to.z));
        pitchAxis.set(to.z, 0, -to.x).normalize(); // nod about the line between the ears, wherever the head faces
        at.project(this.camera);
        const wantYaw = facing ? 0 : clamp((this.pointer.x - at.x) * 0.75 + this.focusYaw * 0.4, -0.7, 0.7);
        const wantPitch = facing ? 0.03 : clamp((this.pointer.y - at.y) * 0.5 + this.focusPitch * 0.3, -0.45, 0.45);
        tx = clamp(wantYaw - yaw0, -0.75, 0.75) * this.attention;
        ty = clamp(wantPitch - pitch0, -0.5, 0.5) * this.attention;
      }
      if (this.nodT >= 0) {
        this.nodT += dt;
        if (this.nodT > 0.9) this.nodT = -1;
        else ty -= Math.sin(this.nodT * 17) * 0.09 * Math.exp(-this.nodT * 4.5);
      }
      ty -= this.w.catch * 0.22;
      this.look.x = damp(this.look.x, tx, 7, dt);
      this.look.y = damp(this.look.y, ty, 9, dt);
      for (const [name, share] of [['Spine', 0.16], ['neck', 0.32], ['Head', 0.52]] as const) {
        this.turn(name, this.axisY, this.look.x * share);
        this.turn(name, pitchAxis, -this.look.y * share);
      }

      this.updateSpray(dt);

      for (const name of LAYERED) {
        const bone = this.bones.get(name);
        if (!bone) continue;
        const left = this.leftPose.get(name);
        if (left) left.copy(bone.quaternion);
        else this.leftPose.set(name, bone.quaternion.clone());
      }
    }

    this.updateSmoke(t);
    this.updatePaint(dt);
  }

  private updateSpray(dt: number) {
    let s = this.spray;
    if (s) {
      s.t += dt;
      if (s.t - (s.chained ? SWING : RAISE) >= HOLD) {
        // the can stops; whatever has landed is the mark
        if (s.splat) s.splat.cover = 1;
        if (!s.landed) s.onLand?.();
        const next = this.queue.shift();
        if (next) {
          next.chained = true;
          this.begin(next);
        } else this.spray = null;
        s = this.spray;
      }
    }
    this.aimWeight = s ? (s.chained ? 1 : ease(clamp(s.t / RAISE, 0, 1))) : damp(this.aimWeight, 0, 9, dt);
    if (s) this.aimNow.lerp(s.aim, 1 - Math.exp(-16 * dt));
    const w = this.aimWeight;
    const cone = this.cone.material as THREE.MeshBasicMaterial;
    const held = s ? s.t - (s.chained ? SWING : RAISE) : -1;
    const spraying = held >= 0 && held < HOLD;
    if (s && spraying) {
      // Paint reaches the wall FLIGHT after the can opens, and the mark builds from then until it shuts.
      if (!s.landed && held >= FLIGHT) {
        s.landed = true;
        if (s.mark) s.splat = this.addSplat(s.target, s.color);
        s.onLand?.();
      }
      if (s.splat) s.splat.cover = clamp((held - FLIGHT) / (HOLD - FLIGHT), 0, 1);
    }

    const arm = this.bones.get('RightArm');
    const fore = this.bones.get('RightForeArm');
    const nozzle = this.bones.get('Nozzle');
    if (w < 0.002 || !arm || !fore || !nozzle) {
      cone.opacity = damp(cone.opacity, 0, 20, dt);
      this.cone.visible = cone.opacity > 0.004;
      return;
    }

    // Straighten the elbow, then swing the whole arm until the nozzle line runs through the aim point.
    const foreRest = this.rest.get('RightForeArm');
    if (foreRest) fore.quaternion.slerp(foreRest, w * 0.85);
    this.rig.updateWorldMatrix(true, false);
    arm.updateWorldMatrix(true, true);
    const a = arm.getWorldPosition(this.v1);
    const n = nozzle.getWorldPosition(this.v2);
    const from = n.sub(a).normalize();
    const to = this.v3.copy(this.aimNow).sub(a).normalize();
    this.q2.setFromUnitVectors(from, to);
    this.q2.slerpQuaternions(this.identity, this.q2, w);
    arm.parent!.getWorldQuaternion(this.q1);
    this.q3.copy(this.q1).invert().multiply(this.q2).multiply(this.q1);
    arm.quaternion.premultiply(this.q3);

    if (s && spraying) {
      const hand = this.bones.get('RightHand');
      if (hand) hand.rotateX(Math.sin(s.t * 46) * 0.035); // the rattle of the can
      arm.updateWorldMatrix(true, true);
      const tip = nozzle.getWorldPosition(this.v1);
      this.emitMist(tip, s.target, 7);
      // the cone of spray itself: from the nozzle to where it lands
      const reach = this.v2.copy(s.target).sub(tip);
      const length = reach.length();
      this.cone.position.copy(tip);
      this.cone.quaternion.setFromUnitVectors(this.v3.set(0, -1, 0), reach.divideScalar(length));
      this.cone.scale.set(0.12, length, 0.12);
      cone.opacity = damp(cone.opacity, 0.2 + Math.sin(s.t * 60) * 0.035, 30, dt);
      this.cone.visible = true;
    } else {
      cone.opacity = damp(cone.opacity, 0, 20, dt);
      this.cone.visible = cone.opacity > 0.004;
    }
  }

  // ---- paint ---------------------------------------------------------------

  /** Fine drops along the cone, timed to arrive as the mark grows. */
  private emitMist(from: THREE.Vector3, to: THREE.Vector3, count: number) {
    for (let i = 0; i < count && this.dropState.length < 260; i++) {
      const life = FLIGHT * (0.8 + Math.random() * 0.6);
      const r = 0.11 * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const end = this.v4.set(to.x + Math.cos(a) * r, to.y + Math.sin(a) * r, to.z);
      this.dropState.push({ p: from.clone(), v: end.sub(from).divideScalar(life).clone(), life, max: life });
    }
  }

  /** A mark on the wall. It starts as nothing and is built up by `cover` while the can sprays. */
  private addSplat(at: THREE.Vector3, color: string): Splat {
    const size = 0.34 + Math.random() * 0.2;
    const flat = { transparent: true, depthWrite: false, toneMapped: false, opacity: 0 };
    const coreMap = coreTexture(color);
    const spatterMap = spatterTexture(color);
    const geo = new THREE.PlaneGeometry(1, 1);
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: coreMap, ...flat }));
    const spatter = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: spatterMap, ...flat }));
    const group = new THREE.Group();
    group.position.set(at.x, at.y, PAINT_Z + (this.splats.length % 14) * 0.0004);
    group.rotation.z = (Math.random() - 0.5) * 0.7;
    spatter.position.z = -0.0001;
    core.renderOrder = spatter.renderOrder = ON_WALL.paint;
    group.add(spatter, core);
    const runMat = new THREE.MeshBasicMaterial({ map: this.runMap, color, ...flat, opacity: 1 });
    const runGeo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0); // grows down from its top edge
    const runs: THREE.Mesh[] = [];
    for (let i = 0, n = 1 + Math.floor(Math.random() * 2); i < n; i++) {
      const run = new THREE.Mesh(runGeo, runMat);
      run.position.set((Math.random() - 0.5) * size * 0.3, -size * 0.05, -0.0002);
      run.scale.set(size * (0.03 + Math.random() * 0.025), 0.0001, 1);
      run.userData.length = size * (0.28 + Math.random() * 0.42);
      run.userData.delay = i * 0.2;
      run.rotation.z = -group.rotation.z; // paint runs straight down whatever way the mark landed
      run.visible = false;
      run.renderOrder = ON_WALL.paint;
      runs.push(run);
      group.add(run);
    }
    this.scene.add(group);
    const splat: Splat = {
      group,
      core,
      spatter,
      runs,
      size,
      cover: 0,
      shown: 0,
      ran: 0,
      fade: 0,
      dispose: () => {
        this.scene.remove(group);
        coreMap.dispose();
        spatterMap.dispose();
        geo.dispose();
        (core.material as THREE.Material).dispose();
        (spatter.material as THREE.Material).dispose();
        runGeo.dispose();
        runMat.dispose();
      },
    };
    this.splats.push(splat);
    // the wall holds a dozen; the oldest is retired gently, not snatched away
    const live = this.splats.filter((p) => p.fade === 0);
    if (live.length > 12) live[0].fade = 1.4;
    return splat;
  }

  private updatePaint(dt: number) {
    let n = 0;
    for (let i = this.dropState.length - 1; i >= 0; i--) {
      const d = this.dropState[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.dropState.splice(i, 1);
        continue;
      }
      d.p.addScaledVector(d.v, dt);
    }
    for (const d of this.dropState) {
      const size = 0.004 + 0.008 * (d.life / d.max);
      this.m1.makeScale(size, size, size).setPosition(d.p);
      this.drops.setMatrixAt(n++, this.m1);
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      let alpha = 1;
      if (s.fade > 0) {
        s.fade -= dt;
        if (s.fade <= 0) {
          s.dispose();
          this.splats.splice(i, 1);
          continue;
        }
        alpha = s.fade / 1.4;
      }
      if (s.shown > 0.999 && s.ran > 3 && s.fade === 0) continue; // dry
      s.shown = damp(s.shown, s.cover, 16, dt);
      const k = ease(clamp(s.shown, 0, 1));
      s.core.scale.setScalar(s.size * (0.26 + 0.74 * k));
      (s.core.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.shown * 7) * alpha;
      s.spatter.scale.setScalar(s.size * (1.7 + 0.3 * k));
      (s.spatter.material as THREE.MeshBasicMaterial).opacity = k * k * alpha;
      // it only runs once there is enough paint on the wall to run
      if (s.shown > 0.8) s.ran += dt;
      for (const run of s.runs) {
        const r = clamp((s.ran - run.userData.delay) / 2.4, 0, 1);
        run.visible = r > 0;
        run.scale.y = Math.max(0.0001, run.userData.length * (1 - (1 - r) ** 3));
        (run.material as THREE.MeshBasicMaterial).opacity = alpha;
      }
    }
  }

  // ---- smoke ---------------------------------------------------------------

  private updateSmoke(t: number) {
    const calm = this.opts.reducedMotion;
    const since = t - this.bornAt;
    for (const p of this.puffs) {
      // it bursts out from behind the character, piece by piece
      const k = calm ? 1 : clamp((since - p.delay) / 0.62, 0, 1);
      const grow = k <= 0 ? 0.0001 : backOut(k);
      const out = (0.35 + 0.65 * Math.min(1, grow)) * (1 + this.pulse * 0.07);
      const a = t * 0.5 + p.phase;
      const amp = calm ? 0 : p.wisp ? 0.02 : 0.012;
      const breathe = (calm ? 1 : 1 + Math.sin(a * 1.6) * (p.wisp ? 0.035 : 0.018)) * (1 + this.pulse * 0.09);
      p.mesh.position.set(p.home.x * out + Math.sin(a) * amp, p.home.y * out + Math.cos(a * 1.3) * amp * 1.2, p.home.z);
      p.mesh.scale.copy(p.scale).multiplyScalar(grow * breathe);
      p.mesh.rotation.z = calm ? 0 : Math.sin(a * 0.9) * (p.wisp ? 0.09 : 0.025);
    }
  }
}

// ---- generated textures ----------------------------------------------------

function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function asTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The fine orange spray caught on the wall behind the hood. */
function mistTexture() {
  const [c, g] = canvas2d(512, 430);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 1.7) * 215;
    const r = rnd() < 0.06 ? 3 + rnd() * 6 : 0.5 + rnd() * 1.9;
    g.fillStyle = rnd() < 0.3 ? '#f5b31a' : '#f26a1b';
    g.globalAlpha = 0.25 + rnd() * 0.6;
    g.beginPath();
    g.arc(256 + Math.cos(a) * d * 1.1, 215 + Math.sin(a) * d * 0.9, r, 0, Math.PI * 2);
    g.fill();
  }
  return asTexture(c);
}

/** The lettering's own drop shadow, down and to the right as in the reference. */
function shadowTexture(letters: HTMLImageElement) {
  const [c, g] = canvas2d(1080, Math.round(1080 * LETTERS_ASPECT * (1.24 / 1.08)));
  const w = 1000;
  const h = w * LETTERS_ASPECT;
  g.filter = 'blur(9px)';
  g.drawImage(letters, (c.width - w) / 2, (c.height - h) / 2, w, h);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#00090d';
  g.fillRect(0, 0, c.width, c.height);
  return asTexture(c);
}

/** The body of a mark: a lumpy blob. */
function coreTexture(color: string) {
  const [c, g] = canvas2d(160, 160);
  g.fillStyle = color;
  g.translate(80, 80);
  const r = 50; // lumps reach 1.22 r, and must stay inside the canvas or the mark comes out square
  const n = 13;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.72 + Math.random() * 0.5);
    return [Math.cos(a) * k, Math.sin(a) * k] as const;
  });
  const mid = (p: readonly [number, number], q: readonly [number, number]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
  g.beginPath();
  g.moveTo(...mid(pts[n - 1], pts[0]));
  for (let i = 0; i < n; i++) g.quadraticCurveTo(...pts[i], ...mid(pts[i], pts[(i + 1) % n]));
  g.fill();
  return asTexture(c);
}

/** The overspray round it: fine dots, thinning with distance. Drawn twice the size of the body. */
function spatterTexture(color: string) {
  const [c, g] = canvas2d(256, 256);
  g.fillStyle = color;
  g.translate(128, 128);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 34 + Math.pow(Math.random(), 1.6) * 88;
    g.globalAlpha = 0.55 + Math.random() * 0.45;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.8 + Math.random() * (d < 70 ? 4.2 : 2.2), 0, Math.PI * 2);
    g.fill();
  }
  return asTexture(c);
}

/** Density along the spray: thick at the nozzle, thinning to nothing at the wall. */
function coneTexture() {
  const [c, g] = canvas2d(4, 64);
  const fade = g.createLinearGradient(0, 0, 0, 64);
  fade.addColorStop(0, '#fff'); // v = 1 is the apex
  fade.addColorStop(0.5, '#777');
  fade.addColorStop(1, '#000');
  g.fillStyle = fade;
  g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

/** A run of paint: a white capsule the material tints. */
function runTexture() {
  const [c, g] = canvas2d(16, 128);
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(1, 0, 14, 128, 7);
  g.fill();
  return asTexture(c);
}
