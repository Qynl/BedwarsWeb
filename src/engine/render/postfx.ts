/*
 * Post-processing: bright-pass bloom, screen-space sun shafts, a soft filmic
 * shoulder, colour grading, radial chromatic aberration, vignette and a
 * dither to stop gradient banding.
 *
 * The world renders into a half-float target, the first-person hand is drawn
 * into the same target, and the result reaches the screen through one
 * composite pass. Everything scales down with the drawing-buffer size, so
 * low-quality settings stay cheap.
 */
import {
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three'

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FULLSCREEN = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;

  vec3 tap(vec2 uv) { return texture2D(tDiffuse, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb; }

  // Four bilinear taps make a cheap, stable downsample.
  vec3 downsample(vec2 uv) {
    vec3 c = tap(uv + uTexel * vec2(-1.0, -1.0));
    c += tap(uv + uTexel * vec2(1.0, -1.0));
    c += tap(uv + uTexel * vec2(-1.0, 1.0));
    c += tap(uv + uTexel * vec2(1.0, 1.0));
    return c * 0.25;
  }

  void main() { gl_FragColor = vec4(downsample(vUv), 1.0); }
`

const BRIGHT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;

  vec3 tap(vec2 uv) { return texture2D(tDiffuse, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb; }

  void main() {
    vec3 c = tap(vUv + uTexel * vec2(-1.0, -1.0));
    c += tap(vUv + uTexel * vec2(1.0, -1.0));
    c += tap(vUv + uTexel * vec2(-1.0, 1.0));
    c += tap(vUv + uTexel * vec2(1.0, 1.0));
    c *= 0.25;
    float l = max(max(c.r, c.g), c.b);
    float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float weight = max(soft, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * weight, 1.0);
  }
`

const BLUR = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;
  varying vec2 vUv;

  void main() {
    // Nine-tap Gaussian in one direction (five samples, the pairs mirrored).
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    c += texture2D(tDiffuse, vUv + uDir * 1.0).rgb * 0.1945945946;
    c += texture2D(tDiffuse, vUv - uDir * 1.0).rgb * 0.1945945946;
    c += texture2D(tDiffuse, vUv + uDir * 2.0).rgb * 0.1216216216;
    c += texture2D(tDiffuse, vUv - uDir * 2.0).rgb * 0.1216216216;
    c += texture2D(tDiffuse, vUv + uDir * 3.0).rgb * 0.0540540541;
    c += texture2D(tDiffuse, vUv - uDir * 3.0).rgb * 0.0540540541;
    c += texture2D(tDiffuse, vUv + uDir * 4.0).rgb * 0.0162162162;
    c += texture2D(tDiffuse, vUv - uDir * 4.0).rgb * 0.0162162162;
    gl_FragColor = vec4(c, 1.0);
  }
`

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tWide;
  uniform vec2 uRes;
  uniform vec2 uSun;
  uniform vec3 uSunColor;
  uniform float uSunVisible;
  uniform float uTime;
  uniform float uExposure;
  uniform float uBloom;
  uniform float uRays;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uVignette;
  uniform float uAberration;
  varying vec2 vUv;

  float rand(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 shaft(vec2 uv) {
    vec2 delta = (uSun - uv) / 24.0;
    vec2 p = uv;
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 24; i++) {
      p += delta;
      float weight = exp(-float(i) * 0.085);
      sum += texture2D(tBloom, clamp(p, vec2(0.001), vec2(0.999))).rgb * weight;
      total += weight;
    }
    return sum / max(total, 1e-4);
  }

  void main() {
    // Radial chromatic aberration: clean at the centre, splitting a little at the edges.
    vec2 d = vUv - 0.5;
    float r2 = dot(d, d);
    vec2 offset = d * r2 * uAberration;
    vec3 color;
    color.r = texture2D(tScene, vUv - offset).r;
    color.g = texture2D(tScene, vUv).g;
    color.b = texture2D(tScene, vUv + offset).b;

    vec3 bloom = texture2D(tBloom, vUv).rgb + texture2D(tWide, vUv).rgb * 1.35;
    color += bloom * uBloom;

    if (uSunVisible > 0.001) {
      float aspect = uRes.x / max(uRes.y, 1.0);
      vec2 sunAspect = (uSun - 0.5) * vec2(aspect, 1.0);
      vec2 uvAspect = (vUv - 0.5) * vec2(aspect, 1.0);
      float near = smoothstep(1.15, 0.05, distance(uvAspect, sunAspect));
      color += shaft(vUv) * uSunColor * uRays * uSunVisible * (0.3 + near * 0.7);

      // Anamorphic streak: a long, thin horizontal flare at the sun's height.
      // It samples the wide glow, so it only appears around genuinely bright sky.
      vec3 streak = vec3(0.0);
      for (int i = 1; i <= 8; i++) {
        float o = float(i) * 0.011;
        float squash = 1.0 - float(i) * 0.075;
        streak += texture2D(tWide, clamp(vec2(vUv.x + o, uSun.y + (vUv.y - uSun.y) * squash), vec2(0.001), vec2(0.999))).rgb;
        streak += texture2D(tWide, clamp(vec2(vUv.x - o, uSun.y + (vUv.y - uSun.y) * squash), vec2(0.001), vec2(0.999))).rgb;
      }
      streak *= 0.0625;
      color += streak * uSunColor * uSunVisible * near * 0.55;
    }

    // A gentler shoulder than Reinhard: only highlights above 0.8 give ground.
    color = color / (1.0 + max(color - 0.8, 0.0));

    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, uSaturation);
    color = (color - 0.5) * uContrast + 0.5;
    color *= uExposure;
    // Cool shadows, warm highlights: a slight cinematic split-tone.
    color += vec3(0.004, 0.002, 0.009) * (1.0 - smoothstep(0.0, 0.55, luma));
    color -= vec3(0.006, 0.001, 0.0) * smoothstep(0.55, 1.0, luma);

    float v = smoothstep(1.15, 0.3, length((vUv - 0.5) * vec2(1.0, 0.92)) * 1.55);
    color *= mix(1.0, v, uVignette);

    // Dither: one 8-bit step of noise, enough to dissolve sky banding.
    color += (rand(vUv * uRes + uTime) - 0.5) / 255.0;

    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    #include <colorspace_fragment>
  }
`

export interface PostOptions {
  /** Drawn after the world, into the same target (the first-person hand), with the depth buffer cleared. */
  overlay?: () => void
}

export class PostFX {
  enabled = true
  /** 0..1 spikes while the player is hurt or a shell lands nearby. */
  pulse = 0

  private sceneTarget: WebGLRenderTarget | null = null
  private bloomA: WebGLRenderTarget | null = null
  private bloomB: WebGLRenderTarget | null = null
  private wideA: WebGLRenderTarget | null = null
  private wideB: WebGLRenderTarget | null = null
  private bright = this.material(BRIGHT, { tDiffuse: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 0.82 }, uKnee: { value: 0.38 } })
  private copy = this.material(FULLSCREEN, { tDiffuse: { value: null }, uTexel: { value: new Vector2() } })
  private blur = this.material(BLUR, { tDiffuse: { value: null }, uDir: { value: new Vector2() } })
  private composite = this.material(COMPOSITE, {
    tScene: { value: null },
    tBloom: { value: null },
    tWide: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uSun: { value: new Vector2(0.5, 0.5) },
    uSunColor: { value: new Color(1, 0.96, 0.88) },
    uSunVisible: { value: 0 },
    uTime: { value: 0 },
    uExposure: { value: 1.05 },
    uBloom: { value: 0.72 },
    uRays: { value: 1.35 },
    uSaturation: { value: 1.2 },
    uContrast: { value: 1.07 },
    uVignette: { value: 0.42 },
    uAberration: { value: 0.0055 },
  })
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad = new Mesh(new PlaneGeometry(2, 2))
  private size = new Vector2()
  private sunPoint = new Vector3()
  private forward = new Vector3()

  constructor() {
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  private material(fragmentShader: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    })
  }

  setSize(renderer: WebGLRenderer) {
    renderer.getDrawingBufferSize(this.size)
    const w = Math.max(1, Math.floor(this.size.x))
    const h = Math.max(1, Math.floor(this.size.y))
    if (this.sceneTarget && this.sceneTarget.width === w && this.sceneTarget.height === h) return
    this.sceneTarget?.dispose()
    this.bloomA?.dispose()
    this.bloomB?.dispose()
    this.wideA?.dispose()
    this.wideB?.dispose()
    const hdr = { type: HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter }
    this.sceneTarget = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    })
    const bw = Math.max(1, w >> 1)
    const bh = Math.max(1, h >> 1)
    const ww = Math.max(1, w >> 2)
    const wh = Math.max(1, h >> 2)
    this.bloomA = new WebGLRenderTarget(bw, bh, hdr)
    this.bloomB = new WebGLRenderTarget(bw, bh, hdr)
    this.wideA = new WebGLRenderTarget(ww, wh, hdr)
    this.wideB = new WebGLRenderTarget(ww, wh, hdr)
    this.composite.uniforms.uRes.value.set(w, h)
  }

  /** Vivid, cinematic or off. Every preset is tuned from the same uniforms, so switching is instant. */
  setPreset(preset: 'off' | 'vivid' | 'cinematic'): void {
    this.enabled = preset !== 'off'
    if (preset === 'off') return
    const u = this.composite.uniforms
    const cinematic = preset === 'cinematic'
    u.uExposure.value = cinematic ? 1.02 : 1.05
    u.uBloom.value = cinematic ? 0.95 : 0.72
    u.uRays.value = cinematic ? 1.15 : 1.35
    u.uSaturation.value = cinematic ? 1.03 : 1.2
    u.uContrast.value = cinematic ? 1.14 : 1.07
    u.uVignette.value = cinematic ? 0.55 : 0.42
    u.uAberration.value = cinematic ? 0.0032 : 0.0055
  }

  /** Projects the sun into screen space so the shafts radiate from the real sun. */
  private aimSun(camera: Camera, sunDirection: Vector3, sunColor: Color) {
    camera.getWorldDirection(this.forward)
    this.sunPoint.copy(camera.position).addScaledVector(sunDirection, 1200).project(camera)
    const facing = this.forward.dot(sunDirection) > 0.08
    const onScreen = Math.abs(this.sunPoint.x) < 1.75 && Math.abs(this.sunPoint.y) < 1.75
    this.composite.uniforms.uSun.value.set(this.sunPoint.x * 0.5 + 0.5, this.sunPoint.y * 0.5 + 0.5)
    this.composite.uniforms.uSunVisible.value = facing && onScreen ? 1 : 0
    this.composite.uniforms.uSunColor.value.copy(sunColor)
  }

  private draw(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.quad.material = material
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
  }

  /** World (and hand) into the HDR target, then every pass, then the screen. */
  render(renderer: WebGLRenderer, world: Scene, camera: Camera, time: number, sunDirection: Vector3, sunColor: Color, options: PostOptions = {}) {
    this.setSize(renderer)
    if (!this.sceneTarget || !this.bloomA || !this.bloomB || !this.wideA || !this.wideB) return

    renderer.setRenderTarget(this.sceneTarget)
    renderer.clear()
    renderer.render(world, camera)
    if (options.overlay) {
      renderer.clearDepth()
      options.overlay()
    }

    // Bright pass straight into half resolution, then a separable blur.
    this.bright.uniforms.tDiffuse.value = this.sceneTarget.texture
    this.bright.uniforms.uTexel.value.set(1 / this.sceneTarget.width, 1 / this.sceneTarget.height)
    this.draw(renderer, this.bright, this.bloomA)

    this.blur.uniforms.tDiffuse.value = this.bloomA.texture
    this.blur.uniforms.uDir.value.set(1 / this.bloomA.width, 0)
    this.draw(renderer, this.blur, this.bloomB)
    this.blur.uniforms.tDiffuse.value = this.bloomB.texture
    this.blur.uniforms.uDir.value.set(0, 1 / this.bloomA.height)
    this.draw(renderer, this.blur, this.bloomA)

    // Quarter resolution, blurred further: the soft wide glow around bright things.
    this.copy.uniforms.tDiffuse.value = this.bloomA.texture
    this.copy.uniforms.uTexel.value.set(1 / this.bloomA.width, 1 / this.bloomA.height)
    this.draw(renderer, this.copy, this.wideA)
    this.blur.uniforms.tDiffuse.value = this.wideA.texture
    this.blur.uniforms.uDir.value.set(1.6 / this.wideA.width, 0)
    this.draw(renderer, this.blur, this.wideB)
    this.blur.uniforms.tDiffuse.value = this.wideB.texture
    this.blur.uniforms.uDir.value.set(0, 1.6 / this.wideA.height)
    this.draw(renderer, this.blur, this.wideA)

    this.aimSun(camera, sunDirection, sunColor)
    const u = this.composite.uniforms
    u.tScene.value = this.sceneTarget.texture
    u.tBloom.value = this.bloomA.texture
    u.tWide.value = this.wideA.texture
    u.uTime.value = time
    this.draw(renderer, this.composite, null)
    renderer.setRenderTarget(null)
  }

  dispose() {
    for (const t of [this.sceneTarget, this.bloomA, this.bloomB, this.wideA, this.wideB]) t?.dispose()
    this.quad.geometry.dispose()
    for (const m of [this.bright, this.copy, this.blur, this.composite]) m.dispose()
  }
}
