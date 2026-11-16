// 高度雾（只给小院用）：贴着地面浓，往上很快变薄，远处还有一层薄薄的底雾。
// 做法：借用 three.js 的线性雾（THREE.Fog）那一支——许愿池用的是 FogExp2，不走这一支，所以不受影响。
//   fog.near = 贴地的雾浓度（每米），fog.far = 到处都有的底雾浓度（每米）；雾的厚度（多高变薄一半）和殿的范围在安装时写进着色器。
// 沿视线把"浓度随高度指数衰减"的雾积分起来（有解析解），所以看向地面、看向远处的树梢，雾的多少都是对的。
// 殿里不起雾：落在殿里的点只算从镜头到殿门那一段路上的雾（否则殿里暗处会被刷成一片灰白）。
import * as THREE from 'three';

let installed = false;
// halfH：雾浓度减半的高度（米）；clear：镜头附近多少米内没有雾（脚下的石板不发灰）；hall：殿的范围 { halfX, front, back, top }
export function installHeightFog({ halfH = 1.4, clear = 2.5, hall }) {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk, k = (Math.LN2 / halfH).toFixed(4), f = v => (+v).toFixed(3);
  const swap = (name, a, b) => {
    if (!C[name].includes(a)) throw new Error('heightFog: three.js 的 ' + name + ' 变了');
    C[name] = C[name].replace(a, b);
  };
  swap('fog_pars_vertex', 'varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogW;');
  // 视线向量（世界坐标，从镜头指向这个点）：viewMatrix 的旋转部分转置一下就是视图→世界
  swap('fog_vertex', 'vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogW = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;');
  swap('fog_pars_fragment', 'varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogW;');
  swap('fog_fragment', 'float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );', `
		float fd = length( vFogW );
		float ft = ${k} * vFogW.y;                                              // 这一段视线上升（下降）了多少个"雾厚度"
		float fi = abs( ft ) > 1e-3 ? ( 1. - exp( - ft ) ) / ft : 1. - .5 * ft;   // 浓度沿视线的平均值（相对镜头所在高度）
		float od = max( fd - ${f(clear)}, 0. ) * ( fogFar + fogNear * exp( - ${k} * max( cameraPosition.y, 0. ) ) * fi );
		vec3 fp = cameraPosition + vFogW;
		if ( abs( fp.x ) < ${f(hall.halfX)} && fp.z < ${f(hall.front)} && fp.z > ${f(hall.back)} && fp.y < ${f(hall.top)} ) {
			od *= clamp( ( cameraPosition.z - ${f(hall.front)} ) / max( cameraPosition.z - fp.z, 1e-3 ), 0., 1. );   // 殿里：只算殿门外那一段
		}
		float fogFactor = 1. - exp( - od );`);
}

// 小院的雾：ground = 贴地浓度，base = 底雾浓度（都是每米）
export const heightFog = (color, ground, base) => new THREE.Fog(color, ground, base);
