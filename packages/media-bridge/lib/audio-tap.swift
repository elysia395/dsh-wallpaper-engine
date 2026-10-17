// dsh-wallpaper-engine — 系统音频频谱采集器（macOS 14.2+ CoreAudio Process Tap）
//
// 用途：把「系统正在播放的声音」（loopback，不经过麦克风）转成 64 段频谱，
// 20fps 写到 stdout（每帧固定 64 字节，0-255 整数）—— 供插件宿主喂给
// WebWallGL 渲染页，让壁纸的音频可视化 / registerAudioBuffers 跟随真实音乐。
//
// 权限：首次运行会请求「音频录制」（TCC）。未授权时 AudioHardwareCreateProcessTap
// 返回错误码，本程序以 stderr 一行 `tap-create-failed <code>` 退出 —— 宿主据此
// 在设置界面给出授权指引，并回落到模拟频谱。
//
// 设计取舍：
//  - tap 的 IOProc 在实时线程：回调里只做「写环形缓冲」（无分配、无锁；单写单读
//    的环形缓冲最坏读到半帧数据，频谱略微跳动，音频可视化完全可接受）。
//  - FFT / 分箱 / 输出放在主线程 20fps 定时器里做（2048 点 vDSP real FFT，微秒级）。
//  - 立体声 → 单声道（多声道取平均）：壁纸音条不强调声道差（上游对自带 BGM 也是
//    同值喂左右）。
import AudioToolbox
import CoreAudio
import Accelerate
import Foundation

let FFT_N = 2048
let LOG2N = vDSP_Length(11) // 2^11 = 2048
let BANDS = 64
let FPS = 20
let RING = 1 << 15 // 32768 样本（约 0.68s @48k），远大于 FFT 窗口

private var ring = [Float](repeating: 0, count: RING)
private var ringWrite = 0

private func fail(_ msg: String, _ code: Int32) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(code)
}

// ── 1. Process Tap（系统全局音频；排除自身进程避免自采反馈）──────────────────
let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tapDesc.name = "dsh-we-audio-tap"
tapDesc.isPrivate = true
tapDesc.muteBehavior = .unmuted // 只监听，不影响系统输出

var tapID = AudioObjectID(kAudioObjectUnknown)
var err = AudioHardwareCreateProcessTap(tapDesc, &tapID)
if err != noErr { fail("tap-create-failed \(err)", 2) }

// ── 2. 聚合设备承载 tap ──────────────────────────────────────────────────────
let aggDesc: [String: Any] = [
  kAudioAggregateDeviceNameKey: "dsh-we-audio-tap-agg",
  kAudioAggregateDeviceUIDKey: UUID().uuidString,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceTapListKey: [[
    kAudioSubTapUIDKey: tapDesc.uuid.uuidString,
    kAudioSubTapDriftCompensationKey: true,
  ]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
err = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
if err != noErr { fail("agg-create-failed \(err)", 3) }

// ── 3. IOProc：只写环形缓冲 ─────────────────────────────────────────────────
var procID: AudioDeviceIOProcID?
err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
  let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
  guard abl.count > 0 else { return }
  let buf = abl[0]
  guard let mData = buf.mData else { return }
  let ch = max(1, Int(buf.mNumberChannels))
  let total = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
  let ptr = mData.bindMemory(to: Float.self, capacity: total)
  if ch == 1 {
    for i in 0..<total {
      ring[ringWrite] = ptr[i]
      ringWrite = (ringWrite + 1) % RING
    }
  } else {
    var i = 0
    while i + ch <= total {
      var s: Float = 0
      for c in 0..<ch { s += ptr[i + c] }
      ring[ringWrite] = s / Float(ch)
      ringWrite = (ringWrite + 1) % RING
      i += ch
    }
  }
}
if err != noErr { fail("ioproc-create-failed \(err)", 4) }
err = AudioDeviceStart(aggID, procID)
if err != noErr { fail("device-start-failed \(err)", 5) }
FileHandle.standardError.write("ready\n".data(using: .utf8)!)

// ── 4. 主线程 20fps：FFT → 64 段 → stdout ──────────────────────────────────
let setup = vDSP_create_fftsetup(LOG2N, FFTRadix(kFFTRadix2))!
var hann = [Float](repeating: 0, count: FFT_N)
vDSP_hann_window(&hann, vDSP_Length(FFT_N), Int32(vDSP_HANN_NORM))
var input = [Float](repeating: 0, count: FFT_N)
var real = [Float](repeating: 0, count: FFT_N / 2)
var imag = [Float](repeating: 0, count: FFT_N / 2)
var mags = [Float](repeating: 0, count: FFT_N / 2)
var out = [UInt8](repeating: 0, count: BANDS)
let usable = Float(FFT_N / 2) * 0.72 // 截到 ~16kHz@48k：更高频段能量极微
let lo = 2

func emitFrame() {
  let w = ringWrite
  let start = (w - FFT_N + RING) % RING
  for i in 0..<FFT_N { input[i] = ring[(start + i) % RING] }
  vDSP_vmul(input, 1, hann, 1, &input, 1, vDSP_Length(FFT_N))
  real.withUnsafeMutableBufferPointer { rp in
    imag.withUnsafeMutableBufferPointer { ip in
      var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
      input.withUnsafeBufferPointer { inp in
        inp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: FFT_N / 2) { cp in
          vDSP_ctoz(cp, 2, &split, 1, vDSP_Length(FFT_N / 2))
        }
      }
      vDSP_fft_zrip(setup, &split, 1, LOG2N, FFTDirection(FFT_FORWARD))
      vDSP_zvabs(&split, 1, &mags, 1, vDSP_Length(FFT_N / 2))
    }
  }
  let norm = 1.0 / Float(FFT_N) // real FFT 的幅度归一（相对值，标定足够）
  for b in 0..<BANDS {
    let f0 = lo + Int(Float(usable) * pow(Float(b) / Float(BANDS), 2))
    let f1 = max(f0 + 1, lo + Int(Float(usable) * pow(Float(b + 1) / Float(BANDS), 2)))
    var peak: Float = 0
    var f = f0
    while f < f1 && f < mags.count {
      let v = mags[f] * norm
      if v > peak { peak = v }
      f += 1
    }
    // -70dB..0dB → 0..255（对数观感，安静段落接近 0 而不是恒亮）
    let db = 20 * log10(max(peak, 1e-7))
    let n = max(0, min(1, (db + 70) / 70))
    out[b] = UInt8(n * 255)
  }
  FileHandle.standardOutput.write(Data(out))
}

let timer = Timer(timeInterval: 1.0 / Double(FPS), repeats: true) { _ in emitFrame() }
RunLoop.main.add(timer, forMode: .common)

// 信号兜底：宿主 kill 时安静退出（private 聚合设备随进程回收）
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

RunLoop.main.run()
