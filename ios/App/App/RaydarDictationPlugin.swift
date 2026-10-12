import AVFoundation
import Capacitor
import Speech
import UIKit

/// Visible, user-initiated dictation. Audio is streamed to Apple's recognizer;
/// Raydar keeps only the returned text and never writes an audio file.
@objc(RaydarDictationPlugin)
public class RaydarDictationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RaydarDictationPlugin"
    public let jsName = "RaydarDictation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "dictate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var pendingID: UUID?
    private var engine: AVAudioEngine?
    private var tapped = false
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var sheet: UIAlertController?
    private var timer: Timer?
    private var backgroundObserver: NSObjectProtocol?
    private var interruptionObserver: NSObjectProtocol?
    private var transcript = ""

    @objc func dictate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Dictation is already open."); return }
            let id = UUID()
            self.pending = call
            self.pendingID = id
            self.transcript = ""
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    guard self.pendingID == id else { return }
                    guard status == .authorized else {
                        self.finish(error: "Allow Speech Recognition for Raydar in iPhone Settings, or type your notes.")
                        return
                    }
                    AVAudioSession.sharedInstance().requestRecordPermission { granted in
                        DispatchQueue.main.async {
                            guard self.pendingID == id else { return }
                            guard granted else {
                                self.finish(error: "Allow Microphone access for Raydar in iPhone Settings, or type your notes.")
                                return
                            }
                            self.begin(id: id)
                        }
                    }
                }
            }
        }
    }

    private func begin(id: UUID) {
        guard let host = bridge?.viewController,
              let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
            finish(error: "Speech recognition is unavailable right now. Try again or type your notes.")
            return
        }
        self.recognizer = recognizer
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let engine = AVAudioEngine()
            self.engine = engine
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                finish(error: "No microphone input is available. Check your device or simulator audio input.")
                return
            }
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.taskHint = .dictation
            if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
            self.request = request
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            tapped = true
            task = recognizer.recognitionTask(with: request) { result, error in
                DispatchQueue.main.async {
                    guard self.pendingID == id else { return }
                    if let result = result {
                        self.transcript = result.bestTranscription.formattedString
                        self.sheet?.message = self.transcript
                        if result.isFinal { self.finish(); return }
                    }
                    if error != nil {
                        self.finish(error: self.transcript.isEmpty ? "No speech was captured. Try again or type your notes." : nil)
                    }
                }
            }
            let sheet = UIAlertController(title: "Dictate notes", message: "Listening… Speak your note, then tap Done.", preferredStyle: .alert)
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in self.finish(cancelled: true) })
            sheet.addAction(UIAlertAction(title: "Done", style: .default) { _ in
                self.stopAudio()
                self.request?.endAudio()
                self.timer?.invalidate()
                self.timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { _ in self.finish() }
            })
            self.sheet = sheet
            host.present(sheet, animated: true)
            engine.prepare()
            try engine.start()
            timer = Timer.scheduledTimer(withTimeInterval: 55, repeats: false) { _ in self.finish() }
            backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in self.finish(cancelled: true) }
            interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { _ in self.finish() }
        } catch {
            finish(error: "The microphone could not start. Check microphone access and try again.")
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.finish(cancelled: true); call.resolve() }
    }

    private func stopAudio() {
        engine?.stop()
        if tapped { engine?.inputNode.removeTap(onBus: 0); tapped = false }
    }

    private func finish(error: String? = nil, cancelled: Bool = false) {
        guard let call = pending else { return }
        pending = nil
        pendingID = nil
        timer?.invalidate(); timer = nil
        stopAudio()
        request?.endAudio()
        task?.cancel()
        task = nil; request = nil; engine = nil; recognizer = nil
        if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
        if let observer = interruptionObserver { NotificationCenter.default.removeObserver(observer) }
        backgroundObserver = nil; interruptionObserver = nil
        sheet?.dismiss(animated: true); sheet = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let error = error { call.reject(error) }
        else { call.resolve(["text": cancelled ? "" : transcript.trimmingCharacters(in: .whitespacesAndNewlines)]) }
        transcript = ""
    }
}
