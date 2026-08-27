import * as THREE from "three";
import { BUSINESS, type LicenseKey } from "./data";
import { proceduralSceneFor } from "./proceduralAssets";

const AUTO_ROTATION_RADIANS_PER_SECOND = 0.13;
const DRAG_RADIANS_PER_PIXEL = 0.009;
const AUTO_ROTATION_RESUME_DELAY_MS = 1_200;

/** Dispose a procedural model. Every call to proceduralSceneFor creates fresh resources. */
function disposeModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

/**
 * Lightweight business-model preview for the HUD.
 *
 * The caller owns the canvas and decides when the drawer is open via setVisible(). The
 * turntable owns only its Three.js resources and the small text fallback it inserts next
 * to the canvas. It never runs a frame while the drawer or document is hidden.
 */
export class BusinessTurntable {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(29, 1, 0.1, 160);
  private readonly pivot = new THREE.Group();
  private readonly fallback: HTMLDivElement;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly mobileOrShort = window.matchMedia("(max-width: 740px), (max-height: 620px), (pointer: coarse)");
  private readonly resizeObserver: ResizeObserver;

  private renderer: THREE.WebGLRenderer | null = null;
  private model: THREE.Group | null = null;
  private license: LicenseKey | null | undefined;
  private visible = false;
  private destroyed = false;
  private contextLost = false;
  private rendererFailed = false;
  private needsResize = true;
  private frameRequest: number | null = null;
  private lastFrameAt = 0;
  private resumeAutoRotationAt = 0;
  private pointerId: number | null = null;
  private pointerX = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.dataset.turntableState = "empty";

    this.fallback = document.createElement("div");
    this.fallback.className = "business-turntable-fallback";
    this.fallback.hidden = true;
    this.fallback.setAttribute("role", "img");
    this.fallback.setAttribute("aria-live", "polite");
    this.canvas.insertAdjacentElement("afterend", this.fallback);

    this.scene.add(this.pivot);
    this.scene.add(new THREE.HemisphereLight(0xe9fff3, 0x264942, 2.15));
    const sun = new THREE.DirectionalLight(0xffe3a3, 4.1);
    sun.position.set(-9, 14, 11);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x86e1dd, 1.2);
    fill.position.set(10, 7, -9);
    this.scene.add(fill);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.canvas);
    this.reducedMotion.addEventListener("change", this.handleMotionPreference);
    this.mobileOrShort.addEventListener("change", this.handleDisplayTier);
    document.addEventListener("visibilitychange", this.handleDocumentVisibility);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerEnd);
    this.canvas.addEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.addEventListener("lostpointercapture", this.handlePointerEnd);
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
  }

  /** Replace the preview with the exact procedural model used by the world renderer. */
  setBusiness(license: LicenseKey | null): void {
    if (this.destroyed || license === this.license) {
      this.requestFrame();
      return;
    }

    this.clearModel();
    this.license = license;
    this.pivot.rotation.set(0, -Math.PI * 0.18, 0);
    this.lastFrameAt = 0;

    if (!license) {
      this.canvas.dataset.turntableState = "empty";
      this.canvas.setAttribute("aria-label", "No business selected");
      this.hideFallback();
      this.cancelFrame();
      return;
    }

    const config = BUSINESS[license];
    this.canvas.setAttribute("aria-label", `Rotating 3D model of ${config.name}. Drag to turn.`);
    try {
      const model = proceduralSceneFor(config.model);
      if (!model) throw new Error(`No procedural model for ${config.model}`);
      this.model = model;
      this.pivot.add(model);
      this.frameModel(model);
      if (this.contextLost || this.rendererFailed) {
        this.canvas.dataset.turntableState = "fallback";
        this.showFallback(`${config.icon}  ${config.name}`, "3D preview unavailable on this device");
      } else {
        this.canvas.dataset.turntableState = "ready";
        this.hideFallback();
      }
    } catch (error) {
      console.warn("Business turntable model unavailable", error);
      this.canvas.dataset.turntableState = "fallback";
      this.showFallback(`${config.icon}  ${config.name}`, "3D preview unavailable");
    }

    this.requestFrame();
  }

  /** Tell the preview whether its containing HUD drawer is currently open and visible. */
  setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    this.canvas.setAttribute("aria-hidden", String(!visible));
    if (visible) {
      if (this.canvas.dataset.turntableState === "fallback" && this.fallback.textContent) {
        this.fallback.hidden = false;
      }
      this.needsResize = true;
      this.lastFrameAt = 0;
      this.requestFrame();
    } else {
      this.cancelFrame();
      this.fallback.hidden = true;
      if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
        this.canvas.releasePointerCapture(this.pointerId);
      }
      this.pointerId = null;
    }
  }

  /** Permanently release DOM listeners, GPU resources, and the current model. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelFrame();
    this.resizeObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.handleMotionPreference);
    this.mobileOrShort.removeEventListener("change", this.handleDisplayTier);
    document.removeEventListener("visibilitychange", this.handleDocumentVisibility);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerEnd);
    this.canvas.removeEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.removeEventListener("lostpointercapture", this.handlePointerEnd);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.clearModel();
    this.renderer?.renderLists.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.fallback.remove();
    delete this.canvas.dataset.turntableState;
  }

  private frameModel(model: THREE.Group): void {
    const bounds = new THREE.Box3().setFromObject(model, true);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, -bounds.min.y, -centre.z);

    const horizontalSpan = Math.max(size.x, size.z, 1);
    const verticalSpan = Math.max(size.y, 1);
    const targetY = verticalSpan * 0.38;
    const framingSpan = Math.max(horizontalSpan, verticalSpan * 1.3);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = framingSpan / (2 * Math.tan(verticalFov / 2)) * 1.3;
    this.camera.position.set(distance * 0.7, targetY + framingSpan * 0.42, distance);
    this.camera.near = Math.max(0.05, distance / 100);
    this.camera.far = distance * 8;
    this.camera.lookAt(0, targetY, 0);
    this.camera.updateProjectionMatrix();
  }

  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    if (this.rendererFailed || this.contextLost || this.destroyed) return false;
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.16;
      renderer.setClearColor(0x000000, 0);
      this.renderer = renderer;
      this.needsResize = true;
      return true;
    } catch (error) {
      this.rendererFailed = true;
      console.warn("Business turntable WebGL unavailable", error);
      const config = this.license ? BUSINESS[this.license] : null;
      this.canvas.dataset.turntableState = "fallback";
      this.showFallback(config ? `${config.icon}  ${config.name}` : "Business preview", "3D preview unavailable on this device");
      return false;
    }
  }

  private resizeRenderer(): boolean {
    const renderer = this.renderer;
    if (!renderer) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const pixelRatioCap = this.mobileOrShort.matches ? 1 : 1.25;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioCap);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.needsResize = false;
    return true;
  }

  private canDraw(): boolean {
    return !this.destroyed
      && this.visible
      && document.visibilityState === "visible"
      && !this.contextLost
      && this.model !== null;
  }

  private shouldAnimate(): boolean {
    return this.canDraw() && !this.reducedMotion.matches;
  }

  private requestFrame(): void {
    if (!this.canDraw() || this.frameRequest !== null || !this.ensureRenderer()) return;
    this.frameRequest = requestAnimationFrame(this.drawFrame);
  }

  private cancelFrame(): void {
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.lastFrameAt = 0;
  }

  private readonly drawFrame = (now: number): void => {
    this.frameRequest = null;
    if (!this.canDraw() || !this.renderer) return;
    if (this.needsResize && !this.resizeRenderer()) return;

    const elapsedSeconds = this.lastFrameAt === 0 ? 0 : Math.min((now - this.lastFrameAt) / 1_000, 0.05);
    this.lastFrameAt = now;
    if (!this.reducedMotion.matches && now >= this.resumeAutoRotationAt) {
      this.pivot.rotation.y += elapsedSeconds * AUTO_ROTATION_RADIANS_PER_SECOND;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.shouldAnimate()) this.requestFrame();
  };

  private readonly handleResize = (): void => {
    this.needsResize = true;
    this.requestFrame();
  };

  private readonly handleMotionPreference = (): void => {
    this.lastFrameAt = 0;
    if (this.reducedMotion.matches) this.cancelFrame();
    this.requestFrame();
  };

  private readonly handleDisplayTier = (): void => {
    this.needsResize = true;
    this.requestFrame();
  };

  private readonly handleDocumentVisibility = (): void => {
    if (document.visibilityState === "visible") {
      this.lastFrameAt = 0;
      this.requestFrame();
    } else {
      this.cancelFrame();
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.canDraw() || event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.pointerX = event.clientX;
    this.resumeAutoRotationAt = Number.POSITIVE_INFINITY;
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const movement = event.clientX - this.pointerX;
    this.pointerX = event.clientX;
    this.pivot.rotation.y += movement * DRAG_RADIANS_PER_PIXEL;
    this.requestFrame();
    event.preventDefault();
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.pointerId = null;
    this.resumeAutoRotationAt = performance.now() + AUTO_ROTATION_RESUME_DELAY_MS;
    this.lastFrameAt = 0;
    this.requestFrame();
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.cancelFrame();
    const config = this.license ? BUSINESS[this.license] : null;
    this.canvas.dataset.turntableState = "fallback";
    this.showFallback(config ? `${config.icon}  ${config.name}` : "Business preview", "3D preview paused");
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.needsResize = true;
    this.canvas.dataset.turntableState = this.model ? "ready" : "empty";
    this.hideFallback();
    this.requestFrame();
  };

  private clearModel(): void {
    if (!this.model) return;
    this.pivot.remove(this.model);
    disposeModel(this.model);
    this.model = null;
  }

  private showFallback(title: string, detail: string): void {
    this.fallback.textContent = `${title} — ${detail}`;
    this.fallback.setAttribute("aria-label", `${title}. ${detail}.`);
    this.fallback.hidden = !this.visible;
  }

  private hideFallback(): void {
    this.fallback.hidden = true;
    this.fallback.textContent = "";
    this.fallback.removeAttribute("aria-label");
  }
}
