// dump 头部/眼睛/眉毛/鼻子的模型 JSON + MDL mesh 原始数据
import fs from 'fs';
const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
const scene = pkg.readJson('scene.json');

const targets = [697, 329, 295, 373, 701];
const out = [];
for (const t of targets) {
  const o = scene.objects.find(x => String(x.id) === String(t));
  out.push(`\n========== OBJECT id=${t} name=${o.name} parent=${o.parent}`);
  out.push(`origin=${o.origin} size=${o.size} angles=${o.angles}`);
  out.push(`image=${o.image}`);
  const model = pkg.readJson(o.image);
  if (model) {
    out.push('--- MODEL keys: ' + Object.keys(model).join(', '));
    for (const k of ['size','cropoffset','cropsize','autosize','origin','texture','puppet','fullscreen','material','uvoffset','uvsize']) {
      if (model[k] !== undefined) out.push(`  ${k} = ${JSON.stringify(model[k])}`);
    }
    // puppet 分析
    if (model.puppet) {
      const mdlRaw = pkg.read(model.puppet);
      out.push(`  MDL bytes: ${mdlRaw ? mdlRaw.length : 'NULL'}`);
      if (mdlRaw) {
        const mesh = mod.SceneRenderer ? null : null;
        // 复用渲染器的 _parseMdl 逻辑 (静态复制)
        const dv = new DataView(mdlRaw.buffer, mdlRaw.byteOffset, mdlRaw.byteLength);
        let mdlsOffset = mdlRaw.length;
        for (let off = 9; off + 4 < mdlRaw.length; off++) {
          if (mdlRaw[off]===0x4d&&mdlRaw[off+1]===0x44&&mdlRaw[off+2]===0x4c&&mdlRaw[off+3]===0x53){mdlsOffset=off;break;}
        }
        let found = null;
        for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
          const vertexBytes = dv.getUint32(offset + 4, true);
          const verticesOffset = offset + 8;
          if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
          const indexLenOffset = verticesOffset + vertexBytes;
          if (indexLenOffset + 4 > mdlsOffset) continue;
          const indexBytes = dv.getUint32(indexLenOffset, true);
          const indicesOffset = indexLenOffset + 4;
          if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
          found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
          break;
        }
        if (found) {
          const vertexCount = found.vertexBytes / 80;
          const indexCount = found.indexBytes / 2;
          out.push(`  mesh: vertices=${vertexCount} indices=${indexCount}`);
          let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minU=1e9,maxU=-1e9,minV=1e9,maxV=-1e9;
          const positions=[], uvs=[];
          for (let i=0;i<vertexCount;i++){
            const vo=found.verticesOffset+i*80;
            const x=dv.getFloat32(vo,true),y=dv.getFloat32(vo+4,true),z=dv.getFloat32(vo+8,true);
            const u=dv.getFloat32(vo+72,true),v=dv.getFloat32(vo+76,true);
            positions.push([x,y,z]); uvs.push([u,v]);
            if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
            if(u<minU)minU=u;if(u>maxU)maxU=u;if(v<minV)minV=v;if(v>maxV)maxV=v;
          }
          out.push(`  posX [${minX.toFixed(2)}, ${maxX.toFixed(2)}] span=${(maxX-minX).toFixed(2)}`);
          out.push(`  posY [${minY.toFixed(2)}, ${maxY.toFixed(2)}] span=${(maxY-minY).toFixed(2)}`);
          out.push(`  center=(${((minX+maxX)/2).toFixed(2)}, ${((minY+maxY)/2).toFixed(2)})  (0,0)? ${(minX+maxX)<0.001&&(minY+maxY)<0.001 ? 'YES symmetric' : 'NO asymmetric'}`);
          out.push(`  uv U [${minU.toFixed(4)}, ${maxU.toFixed(4)}] V [${minV.toFixed(4)}, ${maxV.toFixed(4)}] (full 0..1? ${minU<=0.001&&maxU>=0.999&&minV<=0.001&&maxV>=0.999?'YES':'NO'})`);
          // 打印前 6 个顶点原始值
          for (let i=0;i<Math.min(6,vertexCount);i++) out.push(`    v${i}: pos=(${positions[i].map(v=>v.toFixed(2)).join(', ')}) uv=(${uvs[i].map(v=>v.toFixed(4)).join(', ')})`);
        } else out.push('  mesh: NOT FOUND in MDL');
      }
    }
  } else out.push('  MODEL NOT FOUND');
}
fs.writeFileSync('_refs/head-eye-data.txt', out.join('\n'), 'utf8');
console.log(out.join('\n'));
