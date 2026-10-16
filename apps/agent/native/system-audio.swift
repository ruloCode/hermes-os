// Helper nativo: captura el AUDIO DEL SISTEMA (lo que suena en la Mac — la
// app de Teams, Zoom, Slack… — sin el micrófono) con ScreenCaptureKit y lo
// escribe a stdout como PCM16LE mono 16 kHz. El agente lo reenvía al browser,
// que lo mezcla con el mic en el mismo worklet de la junta en vivo.
//
// stdout = audio crudo (nada más) · stderr = estado en NDJSON:
//   {"state":"capturing","rate":16000}
//   {"state":"error","message":"…","permission":true}
// Termina solo cuando se cierra stdin (el agente murió o cortó la captura).
//
// Permiso: Grabación de pantalla y audio del sistema, del proceso que lo
// lanza (el node del agente bajo launchd). Compilar: scripts/build-system-audio.sh
import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

setvbuf(stdout, nil, _IONBF, 0)

let TARGET_RATE = 16_000.0

func status(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

final class Capturer: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "hermes.system-audio")
    private let screenQueue = DispatchQueue(label: "hermes.system-audio.screen")
    private let out = FileHandle.standardOutput
    // Resampleo lineal si el sistema no entrega 16 kHz (se arrastra la fase
    // entre buffers para no meter clics en cada borde).
    private var phase = 0.0
    private var last: Float = 0
    private var announced = false

    func start() async {
        if !CGPreflightScreenCaptureAccess() {
            // Pide el permiso (agrega el proceso a la lista de Ajustes) y avisa.
            _ = CGRequestScreenCaptureAccess()
            status([
                "state": "error",
                "permission": true,
                "message": "Falta el permiso de Grabación de pantalla y audio del sistema para el proceso del agente",
            ])
            exit(3)
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                status(["state": "error", "message": "no hay pantalla para anclar la captura"])
                exit(2)
            }
            // Todo el audio del sistema: la app de la llamada puede reproducir
            // desde un proceso auxiliar (Teams usa WebView), y filtrar por app
            // lo perdería. Este mismo proceso queda fuera.
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let cfg = SCStreamConfiguration()
            cfg.capturesAudio = true
            cfg.sampleRate = Int(TARGET_RATE)
            cfg.channelCount = 1
            cfg.excludesCurrentProcessAudio = true
            // El video es obligatorio en SCStream: el mínimo posible.
            cfg.width = 2
            cfg.height = 2
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            cfg.queueDepth = 3
            let s = SCStream(filter: filter, configuration: cfg, delegate: self)
            try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: screenQueue)
            try await s.startCapture()
            stream = s
        } catch {
            let ns = error as NSError
            status([
                "state": "error",
                "message": ns.localizedDescription,
                "permission": ns.code == -3801, // SCStreamErrorUserDeclined
            ])
            exit(1)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        status(["state": "error", "message": "la captura se detuvo: \(error.localizedDescription)"])
        exit(4)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid, CMSampleBufferGetNumSamples(sb) > 0 else { return }
        guard let fmt = CMSampleBufferGetFormatDescription(sb),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fmt) else { return }
        let asbd = asbdPtr.pointee
        let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
        let rate = asbd.mSampleRate
        if !announced {
            announced = true
            status(["state": "capturing", "rate": rate, "channels": asbd.mChannelsPerFrame])
        }
        var mono: [Float] = []
        do {
            try sb.withAudioBufferList { list, _ in
                // Mono: con varios canales (o buffers) se promedian.
                let buffers = Array(list)
                guard let first = buffers.first, let base = first.mData else { return }
                let channelsInBuffer = Int(first.mNumberChannels)
                let bytesPer = isFloat ? 4 : 2
                let frames = Int(first.mDataByteSize) / (bytesPer * max(1, channelsInBuffer))
                mono = [Float](repeating: 0, count: frames)
                for b in buffers {
                    guard let data = b.mData else { continue }
                    let ch = max(1, Int(b.mNumberChannels))
                    for i in 0..<frames {
                        var acc: Float = 0
                        for c in 0..<ch {
                            let idx = i * ch + c
                            acc += isFloat
                                ? data.assumingMemoryBound(to: Float.self)[idx]
                                : Float(data.assumingMemoryBound(to: Int16.self)[idx]) / 32768
                        }
                        mono[i] += acc
                    }
                }
                let total = Float(buffers.reduce(0) { $0 + max(1, Int($1.mNumberChannels)) })
                if total > 1 { for i in 0..<frames { mono[i] /= total } }
                _ = base
            }
        } catch {
            return
        }
        write(resample(mono, from: rate))
    }

    private func resample(_ input: [Float], from rate: Double) -> [Float] {
        if abs(rate - TARGET_RATE) < 1 || input.isEmpty { return input }
        let step = rate / TARGET_RATE
        var output: [Float] = []
        output.reserveCapacity(Int(Double(input.count) / step) + 1)
        var pos = phase
        while pos < Double(input.count) {
            let i = Int(pos)
            let frac = Float(pos - Double(i))
            let a = i == 0 ? last : input[i - 1]
            let b = input[i]
            output.append(a + (b - a) * frac)
            pos += step
        }
        phase = pos - Double(input.count)
        last = input[input.count - 1]
        return output
    }

    private func write(_ samples: [Float]) {
        if samples.isEmpty { return }
        var pcm = [Int16](repeating: 0, count: samples.count)
        for (i, v) in samples.enumerated() {
            let c = max(-1, min(1, v))
            pcm[i] = Int16(c < 0 ? c * 32768 : c * 32767)
        }
        pcm.withUnsafeBufferPointer { ptr in
            out.write(Data(buffer: ptr))
        }
    }
}

// stdin cerrado = el agente cortó (o murió): salir sin dejar la captura huérfana.
DispatchQueue.global().async {
    while readLine() != nil {}
    exit(0)
}

let capturer = Capturer()
Task { await capturer.start() }
dispatchMain()
