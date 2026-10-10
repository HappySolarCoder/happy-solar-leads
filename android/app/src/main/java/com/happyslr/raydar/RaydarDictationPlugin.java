package com.happyslr.raydar;

import android.app.Activity;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Locale;

/** Opens the phone's visible dictation UI. Raydar never records or stores audio. */
@CapacitorPlugin(name = "RaydarDictation")
public class RaydarDictationPlugin extends Plugin {
    @PluginMethod public void dictate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Dictate your own notes, then review before saving");
            try { startActivityForResult(call, intent, "dictationResult"); }
            catch (ActivityNotFoundException e) { call.reject("Phone dictation is unavailable. Use the microphone on your keyboard."); }
            catch (Exception e) { call.reject("Dictation could not start. Your notes are unchanged."); }
        });
    }
    @ActivityCallback private void dictationResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject value = new JSObject();
        String text = "";
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty()) text = matches.get(0);
        }
        value.put("text", text);
        call.resolve(value);
    }
}
