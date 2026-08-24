// wallpaper64.exe 导入表分析: 找时间源/渲染相关 API
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const text = b.toString('latin1');
// 找常见时间/渲染 API 名称
const apis = [
  'QueryPerformanceCounter', 'QueryPerformanceFrequency', 'GetTickCount', 'timeGetTime',
  'SwapChain', 'Present', 'CreateSwapChain', 'DrawIndexed', 'Draw', 'Map', 'UpdateSubresource',
  'CreateRenderTargetView', 'RSSetViewports', 'OMSetRenderTargets', 'ClearRenderTargetView',
  'sleep', 'Sleep', 'WaitForSingleObject', 'CreateWindowEx', 'DispatchMessage',
];
const found = [];
for (const api of apis) {
  let idx = -1, cnt = 0;
  while ((idx = text.indexOf(api, idx + 1)) >= 0 && cnt < 3) {
    // 检查是否在 .rdata (导入名)
    if (idx >= 0x424e00 && idx < 0x4da000) {
      found.push({ api, off: idx, rva: 0x426000 + (idx - 0x424e00) });
      cnt++;
    }
  }
}
found.forEach(f => console.log(`${f.api}: 文件 0x${f.off.toString(16)} RVA 0x${f.rva.toString(16)}`));
console.log(`共 ${found.length} 个`);
