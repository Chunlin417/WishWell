// Hall-only finishing passes. All colour changes happen in linear shader space.
import { NOISE_GLSL } from './shaders.js';

export function finishMural(material) {
  material.customProgramCacheKey = () => 'hall-mural-aged-v1';
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 wallUV = vMapUv;
        float pigment = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
        diffuseColor.rgb = mix(vec3(pigment), diffuseColor.rgb, .72);
        float wear = smoothstep(.54,.78,fbm2(wallUV*31.));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.095,.085,.063), wear*.26);
        float edgeDist = min(min(wallUV.x,1.-wallUV.x),min(wallUV.y,1.-wallUV.y));
        float edgeWear = 1.-smoothstep(.035,.07,edgeDist + (fbm2(wallUV*70.)-.5)*.012);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.055,.049,.036),edgeWear*.9);
      `);
  };
  return material;
}

export function finishCloth(material) {
  material.customProgramCacheKey = () => 'hall-cloth-woven-v1';
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float clothLuma = dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb = mix(vec3(clothLuma),diffuseColor.rgb,.62);
      // Fade fine threads at a distance to avoid moire through the doorway.
      vec2 threadUV = vMapUv*vec2(620.,1240.);
      vec2 footprint = fwidth(threadUV);
      vec2 thread = sin(threadUV*6.28318)*(1.-smoothstep(vec2(.2),vec2(.9),footprint));
      diffuseColor.rgb *= .95 + .025*(thread.x+thread.y);
    `);
  };
  return material;
}

export function finishPoolStone(material, waterY) {
  const original = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + '-pool-damp-v1';
  material.onBeforeCompile = shader => {
    original(shader);
    shader.uniforms.hallWaterY = { value: waterY };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float hallWaterY;')
      .replace('diffuseColor.rgb *= base * (1. - .4 * grime);', `
        gWet = (1.-smoothstep(hallWaterY-.02,hallWaterY+.22,vWp.y))
          * (.55+.25*fbm2(vWp.xz*5.));
        diffuseColor.rgb *= base * (1. - .4 * grime);`);
  };
  return material;
}
