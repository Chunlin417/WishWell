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

// 调色：对比度 + 饱和度，作用于整个画面（输出到屏幕前的 sRGB 颜色）
export const GradeShader = {
  // night：夜里的"月夜"调色——暗处褪色、偏冷蓝；被灯照亮的亮处保留原本的暖色
  uniforms: { tDiffuse: { value: null }, contrast: { value: 1.1 }, saturation: { value: 1.12 }, night: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float night; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = (c.rgb - .5) * contrast + .5;
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(l), col, saturation);
      if (night > 0.) {
        // 判断"被灯照亮"看的是暖色程度（红比蓝多），而不是亮度：月光下的亮处也会褪色
        float warm = clamp((col.r - col.b) * 4., 0., 1.);
        float teal = clamp((min(col.g, col.b) - col.r) * 3., 0., 1.);   // 池心的青色微光也保留颜色（绿色植物不算，蓝色分量不够）
        float lit = smoothstep(.12, .35, l) * max(warm, teal);
        vec3 moon = mix(vec3(l), col, .25) * vec3(.82, .93, 1.15);
        col = mix(col, mix(moon, col, lit), night);
      }
      gl_FragColor = vec4(clamp(col, 0., 1.), c.a);
    }`,
};

// 焦散：两层动态 Voronoi 边缘叠加，形成水底那种明亮的网状光纹
export const CAUSTIC_GLSL = /* glsl */`
float voroEdge(vec2 p, float t){
  vec2 n = floor(p), f = fract(p); float f1 = 8., f2 = 8.;
  for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j)); vec2 o = hash22(n + g); o = .5 + .45 * sin(t + 6.2831 * o);
    float d = length(g + o - f);
    if(d < f1){ f2 = f1; f1 = d; } else if(d < f2){ f2 = d; }
  }
  return f2 - f1;
}
float caustic(vec2 p, float t){
  p += .25 * vec2(sin(p.y * 1.3 + t * .7), cos(p.x * 1.1 - t * .6));
  float a = voroEdge(p, t * .9), b = voroEdge(p * 1.43 + vec2(3.1, 1.7), -t * .7 + 1.3);
  float ca = clamp(1. - smoothstep(0., .22, a), 0., 1.), cb = clamp(1. - smoothstep(0., .2, b), 0., 1.);
  return ca * ca * sqrt(ca) + .6 * cb * cb * sqrt(cb);
}
`;
