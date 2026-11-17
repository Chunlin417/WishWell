// 共用的 GLSL 片段

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
float fbm2(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= .5; } return s; }
`;

// 树荫光斑：阳光穿过一层看不见的树冠（9 米高）落下来——沿光线方向把着色点投到树冠平面上，查两张叶影图
// （粗的一张 9 米一格，决定大块的树影和光斑；细的一张 3.6 米一格、转了个角度，是叶片大小的碎影），所以太阳移动时光斑也跟着挪，石头、草、水面的光斑方向一致。
// 返回 0（被叶子挡住）～ 1（直射）；两张图各自有镜像对称的毛病，错开尺度、旋转、缓慢漂移后看不出重复
export const CANOPY_GLSL = /* glsl */`
uniform sampler2D tCanopy;   // R：粗的叶影，G：细的叶影（合成一张图，省一个贴图单元）
float canopyLit(vec3 wp, vec3 L, float t){
  vec2 q = wp.xz + L.xz / max(L.y, .25) * (9. - wp.y);
  vec2 sway = vec2(sin(t * .31) + .6 * sin(t * .73 + 1.), cos(t * .23) + .6 * cos(t * .61)) * .12 + t * vec2(.012, .007);
  q += sway;
  float c = texture2D(tCanopy, q / 9. + vec2(.13, .41)).r;
  vec2 r = mat2(.8, .6, -.6, .8) * q;
  float f = texture2D(tCanopy, r / 3.6 + vec2(.57, .22) + sway * .1).g;
  // 粗的一张决定大块的明暗（几十厘米的光斑和树荫）；细的一张是几厘米的叶片碎影：
  // 亮处里有叶子形状的暗点，暗处里有叶子形状的亮点——这样看起来才是透过树叶的光，不是一块块迷彩
  float m = smoothstep(.4, .56, c), d = smoothstep(.34, .6, f);
  return m * (.7 + .3 * d) + (1. - m) * .16 * d;
}
// 夜里月光穿过树冠的明暗（给植被用）：只查粗的那张叶影图、不摇晃只缓慢漂移——一次贴图采样，比白天的光斑便宜一半。
// 投影方式和 canopyLit 一样（沿主光方向投到 9 米高的树冠平面），所以月影的方向跟着月亮走
float moonDapple(vec3 wp, vec3 L, float t){
  vec2 q = wp.xz + L.xz / max(L.y, .25) * (9. - wp.y) + t * vec2(.004, .0025);
  return smoothstep(.36, .62, texture2D(tCanopy, q / 9. + vec2(.61, .17)).r);
}
`;

// 调色：对比度 + 饱和度，作用于整个画面（输出到屏幕前的 sRGB 颜色）
export const GradeShader = {
  // night：夜里的"月夜"调色——暗处褪色、偏冷蓝；被灯照亮的亮处保留原本的暖色
  // court：小院的清晨调色（0～1）；grain：胶片颗粒的强度；time：让颗粒每帧变
  uniforms: { tDiffuse: { value: null }, contrast: { value: 1.1 }, saturation: { value: 1.12 }, night: { value: 0 }, dayWarm: { value: 0 }, vig: { value: 0 },
    court: { value: 0 }, realm: { value: 0 }, grain: { value: 0 }, time: { value: 0 }, sharp: { value: 0 }, texel: { value: { x: 1e-3, y: 1e-3 } } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float night; uniform float dayWarm; uniform float vig; varying vec2 vUv;
    uniform float court, realm, grain, time, sharp; uniform vec2 texel;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (sharp > 0.) {
        // 轻微锐化：减去上下左右四个邻居的平均（只锐化细节，不改变大块明暗）；限幅，避免亮边出现白色描边
        vec3 nb = texture2D(tDiffuse, vUv + vec2(texel.x, 0.)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.)).rgb
                + texture2D(tDiffuse, vUv + vec2(0., texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0., texel.y)).rgb;
        c.rgb += clamp((c.rgb - nb * .25) * sharp * 2., -.06, .06);
      }
      vec3 col = (c.rgb - .5) * contrast + .5;
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(l), col, saturation);
      if (dayWarm > 0.) {
        // 夏日午后的暖调：亮处偏金黄，暗处是深橄榄绿 / 暖褐（不是发蓝的灰），整体再压深一点
        col *= mix(vec3(1.), vec3(1.07, 1.01, .88), dayWarm);
        float sh = 1. - smoothstep(0., .4, l);
        col = mix(col, col * vec3(.9, 1.0, .78) + vec3(.004, .007, 0.), sh * dayWarm * .7);
        col = mix(col, col * col * 1.15, dayWarm * .25);
      }
      if (night > 0.) {
        // 判断"被灯照亮"看的是暖色程度（红比蓝多），而不是亮度：月光下的亮处也会褪色
        float warm = clamp((col.r - col.b) * 4., 0., 1.);
        float teal = clamp((min(col.g, col.b) - col.r) * 3., 0., 1.);   // 池心的青色微光也保留颜色（绿色植物不算，蓝色分量不够）
        float lit = smoothstep(.12, .35, l) * max(warm, teal * .35);   // 浅水的青色不再整片保留：不让池子发光
        vec3 moon = mix(vec3(l), col, .78) * vec3(.9, .99, 1.07);   // 月夜：保留一半原色（石头的灰绿、植物的深绿），只轻轻偏冷，不整体刷成蓝灰
        col = mix(col, mix(moon, col, lit), night);
      }
      if (court > 0.) {
        // 小院的清晨：亮处偏暖（阳光）、暗处偏青绿（树荫和苔），中间调不动
        float lc = dot(col, vec3(.2126, .7152, .0722));
        vec3 tint = mix(vec3(.94, 1.0, .99), vec3(1.045, 1.0, .91), smoothstep(.12, .7, lc));
        col *= mix(vec3(1.), tint, court);
        // 太"新鲜"的绿色收一点饱和：真实的树叶和苔偏灰绿
        float green = clamp((col.g - max(col.r, col.b)) * 6., 0., 1.);
        col = mix(col, mix(vec3(lc), col, .8), green * court);
        // 轻微的 S 曲线：暗处压实、亮处收住，画面不发灰
        vec3 sc = clamp(col, 0., 1.);
        col = mix(col, sc * sc * (3. - 2. * sc), .22 * court);
        // 最暗处稍微抬起一点、带一点青——胶片的黑不是纯黑
        col += vec3(.006, .011, .012) * court * (1. - smoothstep(0., .18, lc));
      }
      if (realm > 0.) {
        // 殿里的"洞天"（月夜云海）：冷暖分开——暗处沉成青蓝，亮处（月光、灯笼、金边）推成金黄；中间调几乎不动
        float lr = dot(col, vec3(.2126, .7152, .0722));
        vec3 tint = mix(vec3(.86, 1.0, 1.1), vec3(1.1, 1.0, .8), smoothstep(.06, .55, lr));
        col *= mix(vec3(1.), tint, realm);
        vec3 sc = clamp(col, 0., 1.);
        col = mix(col, sc * sc * (3. - 2. * sc), .28 * realm);                               // S 曲线：暗处压实，画面不发灰
        col += vec3(.003, .009, .013) * realm * (1. - smoothstep(0., .14, lr));              // 最暗处带一点青，不是死黑
      }
      if (vig > 0.) col *= 1. - vig * smoothstep(.3, .95, length((vUv - .5) * vec2(1.25, 1.)));   // 夜里的暗角
      if (grain > 0.) {
        // 胶片颗粒：每帧换一组随机数；暗处、中间调明显，亮处几乎看不见
        vec2 gp = floor(gl_FragCoord.xy) + fract(time * vec2(13.71, 7.93)) * 517.;
        vec3 p3 = fract(vec3(gp.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33);
        float n = fract((p3.x + p3.y) * p3.z) + fract((p3.y + p3.z) * p3.x) - 1.;   // 两个均匀随机数相加：近似高斯
        float lg = dot(col, vec3(.2126, .7152, .0722));
        col += n * grain * (1. - smoothstep(.45, 1., lg));
      }
      gl_FragColor = vec4(clamp(col, 0., 1.), c.a);
    }`,
};

// 焦散：水底那种明亮的网状光纹
export const CAUSTIC_GLSL = /* glsl */`
float caustic(vec2 p, float t){
  // 焦散图（canopy_mask 的 B 通道，一张自己生成的无缝水底光纹）：两层不同尺度、不同方向缓慢漂移的叠加，
  // 两层同时亮的地方才是亮线（sqrt(a * b)），自然织成网状；不用额外的贴图单元
  vec2 w = .025 * vec2(sin(p.y * 1.3 + t * .7), cos(p.x * 1.1 - t * .6));
  float a = texture2D(tCanopy, p * .55 + vec2(t * .021, t * .013) + w).b;
  float b = texture2D(tCanopy, mat2(.8, .6, -.6, .8) * p * .83 + vec2(.3, .7) - vec2(t * .017, -t * .02) - w).b;
  return 2.6 * pow(sqrt(a * b), 1.35);
}
`;
