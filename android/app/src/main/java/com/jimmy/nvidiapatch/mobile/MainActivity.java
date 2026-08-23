package com.jimmy.nvidiapatch.mobile;

import android.os.Bundle;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, windowInsets) -> {
                int top = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()).top;
                int bottom = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime()).bottom;
                int left = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()).left;
                int right = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()).right;

                view.setPadding(left, top, right, bottom);
                return windowInsets;
            });
        }
    }
}
