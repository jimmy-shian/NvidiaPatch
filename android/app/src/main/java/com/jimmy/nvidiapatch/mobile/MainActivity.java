package com.jimmy.nvidiapatch.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "NvidiaPatchInsets";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure edge-to-edge window compatibility (Android 15+ targetSdk 35)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Set Root Window & DecorView background to pure black #0B0F17
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0B0F17"));

        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(Color.parseColor("#0B0F17"));

            ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, windowInsets) -> {
                Insets systemBars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | 
                    WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

                int top = systemBars.top;
                // Single-owner bottom inset: use IME height when keyboard is open, otherwise system navigation bar
                int bottom = ime.bottom > 0 ? ime.bottom : systemBars.bottom;
                int left = systemBars.left;
                int right = systemBars.right;

                Log.i(TAG, String.format(
                    "Insets -> Top: %d | NavBottom: %d | IME: %d | AppliedBottom: %d | Left: %d | Right: %d",
                    top, systemBars.bottom, ime.bottom, bottom, left, right
                ));

                v.setPadding(left, top, right, bottom);
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }
}
