import Capacitor

class RaydarViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RaydarDictationPlugin())
    }
}
