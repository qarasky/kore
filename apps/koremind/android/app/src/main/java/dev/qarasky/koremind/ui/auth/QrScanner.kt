package dev.qarasky.koremind.ui.auth

import android.content.Context
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Opens Google's QR scanner screen (part of Play services, so this app needs no camera permission).
 * [onResult] gets the raw text of the code; [onUnavailable] means the scanner could not open at all.
 * Backing out of the scanner does nothing.
 */
fun startQrScan(context: Context, onResult: (String) -> Unit, onUnavailable: () -> Unit) {
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    try {
        GmsBarcodeScanning.getClient(context, options).startScan()
            .addOnSuccessListener { onResult(it.rawValue ?: "") }
            .addOnFailureListener { onUnavailable() }
    } catch (_: Exception) { onUnavailable() }
}
