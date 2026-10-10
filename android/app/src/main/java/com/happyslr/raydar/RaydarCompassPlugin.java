package com.happyslr.raydar;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.SystemClock;
import android.view.Surface;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** On-device compass only: no GPS watch, network, storage or background service. */
@CapacitorPlugin(name = "RaydarCompass")
public class RaydarCompassPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensors;
    private Sensor rotation;
    private String sessionId;
    private boolean requested = false;
    private long lastSent = 0;
    private final float[] matrix = new float[9];
    private final float[] screenMatrix = new float[9];
    private final float[] angles = new float[3];

    @Override public void load() {
        sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensors != null) {
            rotation = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (rotation == null) rotation = sensors.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
        }
    }

    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (sensors == null || rotation == null) {
                call.reject("A magnetic compass sensor is unavailable on this device.");
                return;
            }
            sensors.unregisterListener(this);
            sessionId = call.getString("sessionId");
            requested = true;
            lastSent = 0;
            if (!sensors.registerListener(this, rotation, SensorManager.SENSOR_DELAY_UI)) {
                requested = false;
                call.reject("The compass sensor could not start.");
            } else call.resolve();
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (sessionId != null && sessionId.equals(call.getString("sessionId"))) {
                requested = false;
                sensors.unregisterListener(this);
                sessionId = null;
            }
            call.resolve();
        });
    }

    @Override protected void handleOnPause() {
        if (sensors != null) sensors.unregisterListener(this);
    }
    @Override protected void handleOnResume() {
        if (requested && sensors != null && rotation != null) sensors.registerListener(this, rotation, SensorManager.SENSOR_DELAY_UI);
    }
    @Override protected void handleOnDestroy() {
        requested = false;
        if (sensors != null) sensors.unregisterListener(this);
    }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    @Override public void onSensorChanged(SensorEvent event) {
        long now = SystemClock.elapsedRealtime();
        if (!requested || now - lastSent < 100) return;
        lastSent = now;
        SensorManager.getRotationMatrixFromVector(matrix, event.values);
        int x = SensorManager.AXIS_X, y = SensorManager.AXIS_Y;
        int displayRotation = getActivity().getWindowManager().getDefaultDisplay().getRotation();
        if (displayRotation == Surface.ROTATION_90) { x = SensorManager.AXIS_Y; y = SensorManager.AXIS_MINUS_X; }
        else if (displayRotation == Surface.ROTATION_180) { x = SensorManager.AXIS_MINUS_X; y = SensorManager.AXIS_MINUS_Y; }
        else if (displayRotation == Surface.ROTATION_270) { x = SensorManager.AXIS_MINUS_Y; y = SensorManager.AXIS_X; }
        SensorManager.remapCoordinateSystem(matrix, x, y, screenMatrix);
        SensorManager.getOrientation(screenMatrix, angles);
        String status = matrix[8] < .57f ? "flat" : event.accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM ? "calibrate" : "ready";
        JSObject value = new JSObject();
        value.put("sessionId", sessionId);
        value.put("heading", status.equals("ready") ? (Math.toDegrees(angles[0]) + 360) % 360 : JSObject.NULL);
        value.put("status", status);
        value.put("reference", "magnetic");
        value.put("timestamp", System.currentTimeMillis());
        notifyListeners("heading", value);
    }
}
