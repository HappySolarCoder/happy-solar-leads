package com.happyslr.raydar;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RaydarCompassPlugin.class);
        registerPlugin(RaydarDictationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
